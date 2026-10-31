import { timingSafeEqual } from "node:crypto";
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { registerWebhooks, unauthenticated } from "../shopify.server";
import { runManagedBundleSync } from "../lib/bundle-sync.server";
import { allowedShopDomains, isAllowedShop } from "../lib/shop-allowlist.server";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16 || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!authorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Do not reconcile arbitrary shops from shared session storage.
  const allowlist = [...allowedShopDomains()];
  if (allowlist.length === 0) {
    console.error("CSBYTE cron disabled: CSBYTE_ALLOWED_SHOPS is missing");
    return Response.json(
      { ok: false, error: "No hay tiendas autorizadas para la sincronización." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const sessions = await prisma.session.findMany({
    where: { isOnline: false, shop: { in: allowlist } },
    distinct: ["shop"],
    select: { shop: true },
    take: allowlist.length,
  });
  if (sessions.length === 0) {
    console.error("CSBYTE cron: no hay sesiones offline para las tiendas autorizadas");
    return Response.json(
      { ok: false, error: "No se encontraron sesiones offline autorizadas." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const shops = [];
  for (const session of sessions) {
    if (!isAllowedShop(session.shop)) continue;
    try {
      const { admin, session: offline } = await unauthenticated.admin(session.shop);
      let webhookRegistered = false;
      try {
        const registration = await registerWebhooks({ session: offline });
        const hooks = (registration as Record<string, Array<{ success: boolean }>>).PRODUCTS_DELETE;
        webhookRegistered = Array.isArray(hooks) && hooks.length > 0 &&
          hooks.every((hook) => hook.success);
      } catch (error) {
        console.warn("CSBYTE cron: webhook registration failed", {
          shop: session.shop,
          message: error instanceof Error ? error.message : "Error desconocido",
        });
      }
      // A webhook-registration problem must not stop the daily inventory
      // and price safety check. Report the webhook state independently.
      const report = await runManagedBundleSync(admin, {
        apply: true,
        saveReport: true,
      });
      shops.push({
        shop: session.shop,
        checked: report.total,
        updated: report.updated,
        alerts: report.requiresAttention,
        disabled: report.unpublished,
        deletionWebhookRegistered: webhookRegistered,
        errors: report.errors,
      });
      console.info("CSBYTE cron shop result", {
        shop: session.shop,
        checked: report.total,
        updated: report.updated,
        unpublished: report.unpublished,
        errors: report.errors.length,
        webhookRegistered,
      });
    } catch (error) {
      shops.push({
        shop: session.shop,
        checked: 0,
        updated: 0,
        alerts: 0,
        disabled: 0,
        deletionWebhookRegistered: false,
        errors: [error instanceof Error ? error.message : "Error de sincronización."],
      });
    }
  }
  const ok = shops.every((shop) => shop.errors.length === 0);
  return Response.json(
    { ok, shops },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
};
