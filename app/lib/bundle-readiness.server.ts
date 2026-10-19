import type { TemplateBundleCandidate } from "./bundle-template-engine";

type AdminClient = {
  graphql: (query: string, options?: any) => Promise<any>;
};

export type BundleReadinessIssue = {
  candidateId: string;
  baseProductId: string;
  componentId: string;
  componentTitle: string;
  role: string;
  code:
    | "missing_weight"
    | "missing_sku"
    | "missing_price"
    | "out_of_stock"
    | "multiple_variants"
    | "missing_product";
  message: string;
};

export type BundleReadiness = {
  issues: BundleReadinessIssue[];
  errors: string[];
};

type ShopifyComponent = {
  id: string;
  title: string;
  totalInventory: number;
  variants: {
    nodes: Array<{
      id: string;
      sku: string | null;
      price: string;
      inventoryItem: {
        measurement: {
          weight: {
            value: number;
            unit: string;
          } | null;
        } | null;
      } | null;
    }>;
  };
};

const BATCH_SIZE = 20;

function componentEntries(candidate: TemplateBundleCandidate) {
  return [
    { label: "PC", product: candidate.baseProduct },
    { label: "Monitor", product: candidate.monitor },
    { label: "Teclado y mouse", product: candidate.keyboardMouse },
    ...(candidate.wifiAdapter
      ? [{ label: "Adaptador Wi-Fi", product: candidate.wifiAdapter }]
      : []),
  ];
}

export async function loadBundleReadiness(
  admin: AdminClient,
  candidates: TemplateBundleCandidate[],
): Promise<BundleReadiness> {
  if (candidates.length === 0) return { issues: [], errors: [] };

  const productIds = Array.from(
    new Set(
      candidates.flatMap((candidate) =>
        componentEntries(candidate).map((component) => component.product.id),
      ),
    ),
  );

  const products = new Map<string, ShopifyComponent>();
  const errors: string[] = [];

  for (let index = 0; index < productIds.length; index += BATCH_SIZE) {
    const ids = productIds.slice(index, index + BATCH_SIZE);
    try {
      const response = await admin.graphql(
        `#graphql
          query CsbyteBundleReadiness($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Product {
                id
                title
                totalInventory
                variants(first: 2) {
                  nodes {
                    id
                    sku
                    price
                    inventoryItem {
                      measurement {
                        weight {
                          value
                          unit
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        { variables: { ids } },
      );

      const json = (await response.json()) as {
        data?: { nodes?: Array<ShopifyComponent | null> };
        errors?: Array<{ message: string }>;
      };
      if (json.errors?.length) {
        errors.push(...json.errors.map((error) => error.message));
        continue;
      }
      if (!Array.isArray(json.data?.nodes)) {
        errors.push("Shopify no devolvió los componentes para la revisión.");
        continue;
      }

      for (const product of json.data.nodes) {
        if (product?.id && product.variants?.nodes) {
          products.set(product.id, product);
        }
      }
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : "No fue posible verificar los datos de los componentes.",
      );
    }
  }

  if (errors.length > 0) {
    // A failed validation must never be represented as a ready-to-create bundle.
    return { issues: [], errors };
  }

  const issues: BundleReadinessIssue[] = [];

  for (const candidate of candidates) {
    for (const { label, product: original } of componentEntries(candidate)) {
      const product = products.get(original.id);
      const context = {
        candidateId: candidate.id,
        baseProductId: candidate.baseProduct.id,
        componentId: original.id,
        componentTitle: original.title,
        role: label,
      };

      const add = (
        code: BundleReadinessIssue["code"],
        reason: string,
      ) => {
        issues.push({
          ...context,
          code,
          message: `${label}: ${reason}`,
        });
      };

      if (!product) {
        add("missing_product", "no se pudo encontrar el producto en Shopify.");
        continue;
      }

      if (product.variants.nodes.length !== 1) {
        add(
          "multiple_variants",
          "debe tener exactamente una variante para crear este bundle.",
        );
        continue;
      }

      const variant = product.variants.nodes[0];

      if (product.totalInventory <= 0) {
        add("out_of_stock", "no tiene stock disponible.");
      }

      if (!variant.sku?.trim()) {
        add("missing_sku", "falta el SKU.");
      }

      const price = Number(variant.price);
      if (!Number.isFinite(price) || price <= 0) {
        add("missing_price", "falta configurar un precio válido.");
      }

      const weight = variant.inventoryItem?.measurement?.weight;
      if (
        !weight ||
        !Number.isFinite(weight.value) ||
        weight.value <= 0 ||
        !["GRAMS", "KILOGRAMS", "OUNCES", "POUNDS"].includes(weight.unit)
      ) {
        add("missing_weight", "falta configurar un peso válido en Shopify.");
      }
    }
  }

  return { issues, errors: [] };
}
