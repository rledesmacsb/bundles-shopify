import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { protectBundlesAfterInventoryChange } from "../lib/bundle-deletion.server";
import { isAllowedShop } from "../lib/shop-allowlist.server";

/**
 * Signed Shopify inventory_levels/update webhook.
 * The payload quantity represents a single location and is not reliable
 * for deciding the Bundle's total availability. Always re-read Shopify.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, admin } = await authenticate.webhook(request);
  if (!isAllowedShop(shop)) {
    console.warn("Ignoring inventory webhook from unauthorized shop", { shop });
    return new Response(null, { status: 200 });
  }
  if (topic !== "INVENTORY_LEVELS_UPDATE") {
    return new Response("Invalid webhook topic", { status: 400 });
  }
  const event = payload as { inventory_item_id?: number | string };
  const id = event.inventory_item_id == null ? "" : String(event.inventory_item_id);
  if (!/^[1-9][0-9]*$/.test(id)) {
    console.warn("Shopify inventory webhook missing valid inventory item ID", { shop });
    return new Response("Invalid inventory item ID", { status: 422 });
  }

  try {
    const client = admin ?? (await unauthenticated.admin(shop)).admin;
    if (!client) throw new Error("No hay sesión offline autorizada.");
    const result = await protectBundlesAfterInventoryChange(
      client, "gid://shopify/InventoryItem/" + id,
    );
    if (result.errors.length) {
      console.error("Inventory safety check incomplete", {
        shop, examined: result.examined, matched: result.matched,
        errors: result.errors,
      });
      return new Response("Inventory protection incomplete", { status: 503 });
    }
    console.info("Inventory webhook processed", {
      shop, examined: result.examined, matched: result.matched,
      unpublished: result.unpublished,
    });
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("Inventory webhook processing failed", {
      shop, message: error instanceof Error ? error.message : "Error desconocido",
    });
    return new Response("Inventory protection unavailable", { status: 503 });
  }
};
