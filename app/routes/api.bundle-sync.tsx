import { timingSafeEqual } from "node:crypto";
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { runManagedBundleSync } from "../lib/bundle-sync.server";

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

  // Only shops with authenticated offline sessions can be reconciled.
  const sessions = await prisma.session.findMany({
    where: { isOnline: false },
    distinct: ["shop"],
    select: { shop: true },
    take: 25,
  });

  const shops = [];
  for (const session of sessions) {
    try {
      const { admin } = await unauthenticated.admin(session.shop);
      const report = await runManagedBundleSync(admin, {
        apply: true,
        saveReport: true,
      });
      shops.push({
        shop: session.shop,
        checked: report.total,
        updated: report.updated,
        alerts: report.requiresAttention,
        errors: report.errors,
      });
    } catch (error) {
      shops.push({
        shop: session.shop,
        checked: 0,
        updated: 0,
        alerts: 0,
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
