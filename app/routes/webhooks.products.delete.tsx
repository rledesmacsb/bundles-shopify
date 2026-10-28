import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { protectBundlesAfterProductDeletion } from "../lib/bundle-deletion.server";

/**
 * Shopify products/delete webhook.
 * Must stay outside the authenticated /app layout.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, admin } = await authenticate.webhook(request);

  if (topic !== "PRODUCTS_DELETE") {
    return new Response("Invalid webhook topic", { status: 400 });
  }

  // Shopify's verified payload includes a numeric product ID. An optional
  // admin_graphql_api_id can be used without deriving identity from SKU.
  const source = payload as {
    id?: number | string;
    admin_graphql_api_id?: string;
  };

  const directGid = typeof source.admin_graphql_api_id === "string"
    ? source.admin_graphql_api_id
    : null;
  const numericId = source.id == null ? "" : String(source.id);
  const deletedProductId = directGid && /^gid:\/\/shopify\/Product\/[1-9][0-9]*$/.test(directGid)
    ? directGid
    : /^[1-9][0-9]*$/.test(numericId)
      ? `gid://shopify/Product/${numericId}`
      : null;

  if (!deletedProductId) {
    console.error("PRODUCTS_DELETE sin identificador de producto válido", { shop });
    return new Response("Invalid Shopify product ID", { status: 422 });
  }

  try {
    // Webhooks run without an embedded browser session. Use the verified
    // webhook admin client when present, otherwise the stored offline session.
    const client = admin ?? (await unauthenticated.admin(shop)).admin;
    if (!client) throw new Error("No hay sesión offline para sincronizar esta tienda");

    const result = await protectBundlesAfterProductDeletion(client, deletedProductId);
    if (result.errors.length) {
      console.error("Error al proteger Bundles tras eliminación", {
        shop, deletedProductId, errors: result.errors,
      });
      // Shopify retries non-2xx deliveries. Idempotent status checks prevent
      // already-disabled Bundles from being modified a second time.
      return new Response("Bundle protection incomplete", { status: 503 });
    }
    console.info("Shopify product deletion processed", {
      shop,
      deletedProductId,
      inspected: result.examined,
      matched: result.matched,
      unpublished: result.unpublished,
    });
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("No fue posible procesar PRODUCTS_DELETE", {
      shop, deletedProductId,
      message: error instanceof Error ? error.message : "Error desconocido",
    });
    return new Response("Bundle protection temporarily unavailable", { status: 503 });
  }
};
