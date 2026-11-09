import type { TemplateBundleCandidate } from "./bundle-template-engine";

type AdminClient = {
  graphql: (query: string, options?: any) => Promise<any>;
};

type IssueCode =
  | "missing_weight"
  | "missing_sku"
  | "missing_price"
  | "out_of_stock"
  | "multiple_variants"
  | "missing_product";

export type MonitoredBundleComponent = {
  id: string;
  role: string;
};

export type BundleProductIssue = {
  componentId: string;
  componentTitle: string;
  componentSku: string | null;
  componentStock: number | null;
  role: string;
  code: IssueCode;
  message: string;
};

export type BundleReadinessIssue = BundleProductIssue & {
  candidateId: string;
  baseProductId: string;
};

export type BundleReadiness = {
  // Candidate-specific blocking issues for the "Por crear" tab.
  issues: BundleReadinessIssue[];
  // Product-specific issues, including configured components without candidates.
  productIssues: BundleProductIssue[];
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
    { id: candidate.baseProduct.id, role: "PC", title: candidate.baseProduct.title },
    { id: candidate.monitor.id, role: "Monitor", title: candidate.monitor.title },
    { id: candidate.keyboardMouse.id, role: "Teclado y mouse", title: candidate.keyboardMouse.title },
    ...(candidate.wifiAdapter
      ? [{ id: candidate.wifiAdapter.id, role: "Adaptador Wi-Fi", title: candidate.wifiAdapter.title }]
      : []),
  ];
}

export async function loadBundleReadiness(
  admin: AdminClient,
  candidates: TemplateBundleCandidate[],
  additionalComponents: MonitoredBundleComponent[] = [],
): Promise<BundleReadiness> {
  const references = new Map<string, { id: string; role: string; title: string }>();

  for (const candidate of candidates) {
    for (const entry of componentEntries(candidate)) {
      references.set(`${entry.id}:${entry.role}`, entry);
    }
  }

  // Authorized products must be checked even if the template engine did not
  // generate a candidate for them (e.g. no compatible monitor).
  for (const entry of additionalComponents) {
    if (entry.id?.startsWith("gid://shopify/Product/")) {
      const key = `${entry.id}:${entry.role}`;
      if (!references.has(key)) {
        references.set(key, {
          ...entry,
          title: "Producto seleccionado",
        });
      }
    }
  }

  const productIds = [...new Set(
    [...references.values()].map((entry) => entry.id),
  )];

  if (productIds.length === 0) {
    return { issues: [], productIssues: [], errors: [] };
  }

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

  // Fail closed. A partial catalog read must never mark proposals as ready.
  if (errors.length > 0) {
    return { issues: [], productIssues: [], errors };
  }

  const productIssues: BundleProductIssue[] = [];
  const issuesByRef = new Map<string, BundleProductIssue[]>();

  for (const entry of references.values()) {
    const product = products.get(entry.id);
    const key = `${entry.id}:${entry.role}`;
    const componentIssues: BundleProductIssue[] = [];

    const add = (code: IssueCode, reason: string) => {
      componentIssues.push({
        componentId: entry.id,
        componentTitle: product?.title ?? entry.title,
        componentSku: product?.variants?.nodes?.[0]?.sku ?? null,
        componentStock: product?.totalInventory ?? null,
        role: entry.role,
        code,
        message: `${entry.role}: ${reason}`,
      });
    };

    if (!product) {
      add("missing_product", "no se encontró el producto autorizado en Shopify.");
    } else if (product.variants.nodes.length !== 1) {
      add(
        "multiple_variants",
        "se requiere exactamente una variante para crear este bundle.",
      );
    } else {
      const variant = product.variants.nodes[0];

      if (product.totalInventory <= 0) {
        add("out_of_stock", "no tiene stock disponible.");
      }

      if (!variant.sku?.trim()) {
        add("missing_sku", "falta configurar el SKU.");
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

    issuesByRef.set(key, componentIssues);
    productIssues.push(...componentIssues);
  }

  const issues: BundleReadinessIssue[] = [];

  for (const candidate of candidates) {
    for (const component of componentEntries(candidate)) {
      const key = `${component.id}:${component.role}`;
      for (const issue of issuesByRef.get(key) ?? []) {
        issues.push({
          ...issue,
          candidateId: candidate.id,
          baseProductId: candidate.baseProduct.id,
        });
      }
    }
  }

  return { issues, productIssues, errors: [] };
}
