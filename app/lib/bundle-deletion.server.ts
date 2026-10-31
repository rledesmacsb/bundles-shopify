/**
 * Reaction to Shopify's signed PRODUCTS_DELETE webhook.
 *
 * Component identity is the Shopify Product GID, never the SKU. A duplicate
 * or replacement product may have the same SKU without being the same item.
 *
 * Only Bundles owned by CSBYTE Commerce Tools are affected. Shopify Bundles
 * created by other apps or merchants are not modified.
 */
type Admin = { graphql: (query: string, options?: any) => Promise<any> };

type BundleRef = {
  id: string;
  title: string;
  status: string;
  managed: { value: string } | null;
  snapshot: { value: string } | null;
};

export type DeletedProductWebhookResult = {
  deletedProductId: string;
  examined: number;
  matched: number;
  unpublished: number;
  skipped: number;
  errors: string[];
};

const PAGE_SIZE = 30;
const MAX_PAGES = 30;

async function graphql(admin: Admin, operation: string, variables: Record<string, unknown>) {
  const response = await admin.graphql(operation, { variables });
  const json = await response.json() as {
    data?: Record<string, any>;
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(json.errors.map(e => e.message).join(" · "));
  }
  if (!json.data) throw new Error("Shopify no devolvió datos de la operación.");
  return json.data;
}

function referencesProduct(snapshot: string | undefined, gid: string) {
  if (!snapshot) return false;
  try {
    const obj = JSON.parse(snapshot) as {
      base?: { productId?: string };
      monitor?: { productId?: string };
      keyboardMouse?: { productId?: string };
      wifiAdapter?: { productId?: string } | null;
    };
    return [obj.base, obj.monitor, obj.keyboardMouse, obj.wifiAdapter]
      .some(component => component?.productId === gid);
  } catch {
    // Malformed snapshots must be flagged by the periodic reconciliation.
    return false;
  }
}

async function loadPublishedManagedBundles(admin: Admin): Promise<BundleRef[]> {
  const result: BundleRef[] = [];
  let after: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await graphql(admin, String.raw`#graphql
      query CsbyteProductsDeleteBundleList($after: String) {
        products(first: 30, after: $after, query: "bundles:true") {
          nodes {
            id title status
            managed: metafield(namespace: "csbyte_bundle", key: "managed_by") { value }
            snapshot: metafield(namespace: "csbyte_bundle", key: "component_snapshot") { value }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { after });

    const connection = data.products;
    if (!connection || !Array.isArray(connection.nodes)) {
      throw new Error("Listado de Bundles incompleto: se mantiene pendiente el evento.");
    }
    for (const product of connection.nodes as BundleRef[]) {
      if (["ACTIVE", "UNLISTED"].includes(product.status) &&
          product.managed?.value === "csbyte-commerce-tools") {
        result.push(product);
      }
    }
    if (!connection.pageInfo.hasNextPage) return result;
    if (!connection.pageInfo.endCursor) {
      throw new Error("Shopify omitió el cursor de los Bundles.");
    }
    after = connection.pageInfo.endCursor;
  }

  throw new Error("Hay más Bundles que el límite de revisión por webhook.");
}

async function draftIfStillLinked(
  admin: Admin,
  parentId: string,
  deletedId: string,
): Promise<"unpublished" | "skipped"> {
  // Always re-read to avoid overwriting a repair performed while
  // the webhook was being delivered or retried.
  const data = await graphql(admin, String.raw`#graphql
    query CsbyteRecheckDeletedBundle($id: ID!) {
      product(id: $id) {
        id status
        managed: metafield(namespace: "csbyte_bundle", key: "managed_by") { value }
        snapshot: metafield(namespace: "csbyte_bundle", key: "component_snapshot") { value }
      }
    }
  `, { id: parentId });
  const parent = data.product as BundleRef | null;
  if (!parent || !["ACTIVE", "UNLISTED"].includes(parent.status) ||
      parent.managed?.value !== "csbyte-commerce-tools" ||
      !referencesProduct(parent.snapshot?.value, deletedId)) {
    return "skipped";
  }

  const result = await graphql(admin, String.raw`#graphql
    mutation CsbyteDraftDeletedComponentBundle($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id status }
        userErrors { field message }
      }
    }
  `, { product: { id: parentId, status: "DRAFT" } });
  const action = result.productUpdate;
  if (action?.userErrors?.length) {
    throw new Error(action.userErrors.map((e: {message: string}) => e.message).join(" · "));
  }
  if (action?.product?.id !== parentId || action.product.status !== "DRAFT") {
    throw new Error("Shopify no confirmó el cambio a borrador.");
  }
  return "unpublished";
}

export async function protectBundlesAfterProductDeletion(
  admin: Admin,
  deletedProductId: string,
): Promise<DeletedProductWebhookResult> {
  if (!/^gid:\/\/shopify\/Product\/[1-9][0-9]*$/.test(deletedProductId)) {
    throw new Error("El evento no contiene un ID válido de producto Shopify.");
  }
  const bundles = await loadPublishedManagedBundles(admin);
  const result: DeletedProductWebhookResult = {
    deletedProductId,
    examined: bundles.length,
    matched: 0,
    unpublished: 0,
    skipped: 0,
    errors: [],
  };

  // Sequential updates avoid API rate-limit bursts and preserve idempotency
  // when Shopify retries a webhook.
  for (const bundle of bundles) {
    if (!referencesProduct(bundle.snapshot?.value, deletedProductId)) continue;
    result.matched++;
    try {
      const action = await draftIfStillLinked(admin, bundle.id, deletedProductId);
      if (action === "unpublished") result.unpublished++;
      else result.skipped++;
    } catch (error) {
      result.errors.push(`${bundle.title}: ${error instanceof Error ? error.message : "Error de Shopify"}`);
    }
  }
  return result;
}
