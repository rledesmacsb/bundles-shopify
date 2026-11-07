import { timingSafeEqual } from "node:crypto";
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { registerWebhooks, unauthenticated } from "../shopify.server";
import { runManagedBundleSync } from "../lib/bundle-sync.server";
import { storeDailyCronStatus } from "../lib/bundle-cron-status.server";
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
      const webhookStatus = { deletion: false, inventory: false, prices: false };
      try {
        await registerWebhooks({ session: offline });
        const response = await admin.graphql(`#graphql
          query CsbyteCronVerifyBundleWebhooks {
            webhookSubscriptions(first: 50, topics: [PRODUCTS_DELETE, INVENTORY_LEVELS_UPDATE, PRODUCTS_UPDATE]) {
              nodes { id topic uri }
              pageInfo { hasNextPage }
            }
          }
        `);
        const body = await response.json() as {
          data?: { webhookSubscriptions?: { nodes: Array<{ topic: string; uri: string }> } };
          errors?: Array<{ message: string }>;
        };
        if (body.errors?.length) {
          throw new Error(body.errors.map((e: { message: string }) => e.message).join(" · "));
        }
        const hooks = body.data?.webhookSubscriptions?.nodes ?? [];
        const expected = [
          { key: "deletion" as const, topic: "PRODUCTS_DELETE", path: "/webhooks/products/delete" },
          { key: "inventory" as const, topic: "INVENTORY_LEVELS_UPDATE", path: "/webhooks/inventory_levels/update" },
          { key: "prices" as const, topic: "PRODUCTS_UPDATE", path: "/webhooks/products/update" },
        ];
        for (const entry of expected) {
          webhookStatus[entry.key] = hooks.some((hook: { topic: string; uri: string }) => {
            try {
              const endpoint = new URL(hook.uri, process.env.SHOPIFY_APP_URL);
              return hook.topic === entry.topic &&
                endpoint.origin === new URL(process.env.SHOPIFY_APP_URL || "").origin &&
                endpoint.pathname === entry.path;
            } catch {
              return false;
            }
          });
          if (!webhookStatus[entry.key]) {
            console.warn("CSBYTE cron: webhook not verified", {
              shop: session.shop, topic: entry.topic,
            });
          }
        }
      } catch (error) {
        console.warn("CSBYTE cron: webhook verification failed", {
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
      // Record an actual Cron execution independently of manually saved audits.
      // Do not label this execution successful when reconciliation failed.
      await storeDailyCronStatus(admin, {
        checkedAt: report.checkedAt,
        ok: report.errors.length === 0,
        checked: report.total,
        updated: report.updated,
        unpublished: report.unpublished,
        requiresAttention: report.requiresAttention,
        errors: report.errors.slice(0, 20),
        webhooks: webhookStatus,
      });
      shops.push({
        shop: session.shop,
        checked: report.total,
        updated: report.updated,
        alerts: report.requiresAttention,
        disabled: report.unpublished,
        webhooks: webhookStatus,
        pricingRuleConfigured: report.priceRuleConfigured,
        checkedAt: report.checkedAt,
        errors: report.errors,
      });
      console.info("CSBYTE cron shop result", {
        shop: session.shop,
        checked: report.total,
        updated: report.updated,
        unpublished: report.unpublished,
        errors: report.errors.length,
        requiresAttention: report.requiresAttention,
        webhooks: webhookStatus,
      });
    } catch (error) {
      shops.push({
        shop: session.shop,
        checked: 0,
        updated: 0,
        alerts: 0,
        disabled: 0,
        webhooks: { deletion: false, inventory: false, prices: false },
        errors: [error instanceof Error ? error.message : "Error de sincronización."],
      });
    }
  }
  const ok = shops.length > 0 && shops.every((shop) => shop.errors.length === 0);
  console.info("CSBYTE daily audit finished", {
    ok, shops: shops.length,
    withErrors: shops.filter((shop) => shop.errors.length > 0).length,
    checkedAt: new Date().toISOString(),
  });
  return Response.json(
    { ok, shops },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
};
