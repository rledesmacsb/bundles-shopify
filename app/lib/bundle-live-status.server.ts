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
  onlineStorePublished: boolean | null;
};

export type LiveBundleSnapshot = {
  checkedAt: string;
  rows: LiveBundleRow[];
  error: string | null;
  publicationCheckError: string | null;
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

/**
 * Only a verified Online Store publication can establish channel visibility.
 * A missing scope or ambiguous channel is shown as "not verified" rather
 * than pretending that ACTIVE means published.
 */
async function findOnlineStorePublication(admin: Admin): Promise<string | null> {
  const response = await admin.graphql(String.raw`#graphql
    query CsbyteCurrentOnlineStorePublication {
      publications(first: 50) {
        nodes { id channels(first: 10) { nodes { handle name } } }
        pageInfo { hasNextPage }
      }
    }
  `);
  const json = await response.json();
  if (json.errors?.length || json.data?.publications?.pageInfo?.hasNextPage) return null;
  const matches = (json.data?.publications?.nodes ?? []).filter(
    (pub: { channels?: { nodes?: Array<{ handle: string; name: string }> } }) =>
      pub.channels?.nodes?.some((channel) => {
        const name = String(channel.name ?? "").trim().toLowerCase();
        const handle = String(channel.handle ?? "").trim().toLowerCase();
        return ["online-store", "online_store"].includes(handle) ||
          ["online store", "tienda online"].includes(name);
      }),
  );
  return matches.length === 1 ? matches[0].id : null;
}

const QUERY_WITH_CHANNEL = String.raw`#graphql
  query CsbyteCurrentManagedBundleWithChannel($after: String, $publicationId: ID!) {
    products(first: 30, after: $after, query: "bundles:true") {
      nodes {
        id title status totalInventory
        onlineStorePublished: publishedOnPublication(publicationId: $publicationId)
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
  let publicationId: string | null = null;
  let publicationCheckError: string | null = null;
  try {
    try {
      publicationId = await findOnlineStorePublication(admin);
      if (!publicationId) publicationCheckError = "No se pudo identificar el canal Tienda online.";
    } catch {
      publicationCheckError = "Shopify no permitió consultar la publicación de Tienda online.";
    }
    for (let page = 0; page < 30; page++) {
      const response = await admin.graphql(
        publicationId ? QUERY_WITH_CHANNEL : QUERY,
        { variables: publicationId ? { after: cursor, publicationId } : { after: cursor } },
      );
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
          onlineStorePublished: publicationId && typeof item.onlineStorePublished === "boolean"
            ? item.onlineStorePublished : null,
        });
      }
      if (!connection.pageInfo.hasNextPage) {
        return { checkedAt: new Date().toISOString(), rows, error: null, publicationCheckError };
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
      error: error instanceof Error ? error.message : "No se pudo consultar Shopify.",
      publicationCheckError };
  }
}
