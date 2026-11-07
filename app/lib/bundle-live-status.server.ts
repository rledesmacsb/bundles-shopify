/**
 * Read-only, uncached Shopify snapshot for the supervision page.
 * Historical audit reports must never masquerade as current product status.
 * Shopify ACTIVE does not prove Online Store channel publication.
 */
type Admin = { graphql: (query: string, options?: any) => Promise<any> };

export type LiveBundleRow = {
  id: string;
  title: string;
  status: string;
  available: number | null;
  price: number | null;
  sku: string | null;
};

export type LiveBundleSnapshot = {
  checkedAt: string;
  rows: LiveBundleRow[];
  error: string | null;
};

const QUERY = String.raw`#graphql
  query CsbyteCurrentManagedBundleStatus($after: String) {
    products(first: 30, after: $after, query: "bundles:true") {
      nodes {
        id title status totalInventory
        managedBy: metafield(namespace: "csbyte_bundle", key: "managed_by") { value }
        variants(first: 2) {
          nodes { sku price }
          pageInfo { hasNextPage }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function loadLiveBundleSnapshot(admin: Admin): Promise<LiveBundleSnapshot> {
  const rows: LiveBundleRow[] = [];
  let cursor: string | null = null;
  try {
    for (let page = 0; page < 30; page++) {
      const response = await admin.graphql(QUERY, { variables: { after: cursor } });
      const body = await response.json();
      if (body.errors?.length) {
        throw new Error(body.errors.map((error: { message: string }) => error.message).join(" · "));
      }
      const connection = body.data?.products;
      if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo) {
        throw new Error("La respuesta de productos Shopify está incompleta.");
      }
      for (const item of connection.nodes) {
        if (item.managedBy?.value !== "csbyte-commerce-tools") continue;
        const variants = item.variants;
        const variant = variants?.nodes?.[0];
        const num = Number(variant?.price);
        rows.push({
          id: item.id,
          title: item.title,
          status: item.status,
          available: Number.isFinite(item.totalInventory) ? item.totalInventory : null,
          price: variant && !variants.pageInfo?.hasNextPage &&
            variants.nodes.length === 1 && Number.isFinite(num) && num > 0 ? num : null,
          sku: variant?.sku ?? null,
        });
      }
      if (!connection.pageInfo.hasNextPage) {
        return { checkedAt: new Date().toISOString(), rows, error: null };
      }
      if (!connection.pageInfo.endCursor) {
        throw new Error("La paginación de Shopify no devolvió el cursor esperado.");
      }
      cursor = connection.pageInfo.endCursor;
    }
    throw new Error("Se alcanzó el límite de Bundles; el estado no está completo.");
  } catch (error) {
    // Fail closed: never present partial results as an exhaustive live audit.
    return { checkedAt: new Date().toISOString(), rows: [],
      error: error instanceof Error ? error.message : "No se pudo consultar Shopify." };
  }
}
