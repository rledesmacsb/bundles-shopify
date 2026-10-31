/**
 * Shopify allows duplicate SKUs. Bundles must not use a component SKU
 * unless the selected Shopify ProductVariant GID is unambiguous.
 *
 * Always compare variant GIDs, never substitute products based on SKU.
 * A single GraphQL operation can check up to 8 distinct SKUs.
 */
type Admin = { graphql: (query: string, options?: any) => Promise<any> };

export type CheckedComponentSku = {
  productId: string;
  variantId: string;
  sku: string | null | undefined;
  label: string;
};

export type ComponentSkuIssue = {
  sku: string;
  productId: string;
  variantId: string;
  label: string;
  code: "duplicate" | "missing" | "ambiguous" | "invalid" | "lookup_failed";
  message: string;
};

const PER_BATCH = 8;
const SEARCH_LIMIT = 30;

function normalizeSku(raw: string | null | undefined) {
  return String(raw ?? "").trim().toUpperCase();
}

export async function auditComponentSkuUniqueness(
  admin: Admin,
  components: CheckedComponentSku[],
): Promise<ComponentSkuIssue[]> {
  const issues: ComponentSkuIssue[] = [];
  const bySku = new Map<string, CheckedComponentSku[]>();

  for (const component of components) {
    const sku = normalizeSku(component.sku);
    if (!sku || !component.productId || !component.variantId ||
        !component.productId.startsWith("gid://shopify/Product/") ||
        !component.variantId.startsWith("gid://shopify/ProductVariant/")) {
      issues.push({
        ...component, sku,
        code: "invalid",
        message: `${component.label}: falta SKU o un identificador válido de variante.`,
      });
      continue;
    }
    const list = bySku.get(sku) || [];
    list.push(component);
    bySku.set(sku, list);
  }

  const keys = [...bySku.keys()];
  for (let offset = 0; offset < keys.length; offset += PER_BATCH) {
    const batch = keys.slice(offset, offset + PER_BATCH);
    const params = batch.map((_, i) => `$q${i}: String!`).join(", ");
    const selection = batch.map((_, i) => `v${i}: productVariants(
      first: ${SEARCH_LIMIT}, query: $q${i}
    ) {
      nodes { id sku product { id title } }
      pageInfo { hasNextPage }
    }`).join("\n");
    const operation = `#graphql
      query CsbyteValidateUniqueSkuBatch(${params}) {
        ${selection}
      }`;
    const variables = Object.fromEntries(
      batch.map((sku, i) => [`q${i}`, `sku:"${sku.replace(/["\\\\]/g, "")}"`]),
    );
    let json: any;
    try {
      const response = await admin.graphql(operation, { variables });
      json = await response.json();
      if (json.errors?.length || !json.data) {
        throw new Error(
          json.errors?.map((e: { message: string }) => e.message).join(" · ") ||
          "Shopify no devolvió resultados de SKU.",
        );
      }
    } catch {
      for (const sku of batch) {
        for (const item of bySku.get(sku) || []) {
          issues.push({
            ...item, sku, code: "lookup_failed",
            message: `${item.label}: no se pudo verificar la exclusividad del SKU ${sku}.`,
          });
        }
      }
      continue;
    }

    for (let i = 0; i < batch.length; i++) {
      const sku = batch[i];
      const result = json.data[`v${i}`] as {
        nodes: Array<{ id: string; sku: string | null; product: { id: string } }>;
        pageInfo: { hasNextPage: boolean };
      } | undefined;
      const exact = (result?.nodes || []).filter(
        (variant) => normalizeSku(variant.sku) === sku,
      );
      const ambiguous = !result || result.pageInfo.hasNextPage;
      for (const item of bySku.get(sku) || []) {
        let code: ComponentSkuIssue["code"] | null = null;
        if (ambiguous) code = "ambiguous";
        else if (exact.length > 1) code = "duplicate";
        else if (exact.length !== 1 ||
          exact[0].id !== item.variantId ||
          exact[0].product?.id !== item.productId) code = "missing";

        if (code) {
          issues.push({
            ...item, sku, code,
            message: code === "duplicate"
              ? `${item.label}: el SKU ${sku} está utilizado en ${exact.length} variantes. Corrige los duplicados antes de usarlo en Bundles.`
              : code === "ambiguous"
                ? `${item.label}: hay demasiados resultados para verificar el SKU ${sku}.`
                : `${item.label}: la variante original del SKU ${sku} no coincide con Shopify.`,
          });
        }
      }
    }
  }
  return issues;
}
