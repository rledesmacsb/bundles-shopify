import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { runManagedBundleSync } from "../lib/bundle-sync.server";
import { isAllowedShop } from "../lib/shop-allowlist.server";

/**
 * Shopify's authenticated PRODUCTS_UPDATE hook is a notification, not
 * a pricing source. Re-read current component prices from Admin and use
 * the existing calculation, manual price guard and snapshot controls.
 * Updating the Bundle's own product also emits PRODUCTS_UPDATE; those
 * notifications do not match a component ID and are safely ignored.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, admin } = await authenticate.webhook(request);
  if (!isAllowedShop(shop)) {
    console.warn("Ignoring products/update from unauthorized shop", { shop });
    return new Response(null, { status: 200 });
  }
  if (topic !== "PRODUCTS_UPDATE") {
    return new Response("Invalid webhook topic", { status: 400 });
  }
  const event = payload as { id?: number | string };
  const productId = event.id == null ? "" : String(event.id);
  if (!/^[1-9][0-9]*$/.test(productId)) {
    return new Response("Invalid product ID", { status: 422 });
  }

  try {
    const client = admin ?? (await unauthenticated.admin(shop)).admin;
    if (!client) throw new Error("No hay sesión offline autorizada.");
    const report = await runManagedBundleSync(client, {
      apply: true,
      saveReport: false,
      changedComponentProductId: `gid://shopify/Product/${productId}`,
    });
    // Any top-level failure should be retried by Shopify.
    if (report.errors.length) {
      console.error("Product price sync incomplete", {
        shop, componentId: productId, errors: report.errors,
      });
      return new Response("Product price synchronization incomplete", { status: 503 });
    }
    // A row error may be an intentional manual-price hold or a missing price rule.
    // Do not claim an affected row updated unless confirmed.
    const failedWrites = report.rows.filter((row) =>
      row.issues.some((issue) =>
        issue.includes("Error al sincronizar el precio") ||
        issue.includes("Precio guardado, pero") ||
        issue.includes("Shopify no confirmó") ||
        issue.includes("No fue posible poner en borrador") ||
        issue.includes("No fue posible despublicar")),
    );
    if (failedWrites.length) {
      console.error("Product webhook left failed writes", {
        shop, componentId: productId, count: failedWrites.length,
      });
      return new Response("Product update incomplete", { status: 503 });
    }
    console.info("Product webhook processed", {
      shop, componentId: productId, examined: report.total,
      updated: report.updated, unpublished: report.unpublished,
      requiresAttention: report.requiresAttention,
    });
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("Product webhook processing failed", {
      shop, componentId: productId,
      message: error instanceof Error ? error.message : "Error desconocido",
    });
    return new Response("Product synchronization unavailable", { status: 503 });
  }
};
