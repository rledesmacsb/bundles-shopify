/**
 * An explicit store allowlist is required for any automated mutation.
 * The development app must never touch a production store even if an
 * old offline session remains in the shared database.
 */
export function allowedShopDomains(): Set<string> {
  const configured = process.env.CSBYTE_ALLOWED_SHOPS ?? "";
  return new Set(
    configured.split(",").map(shop => shop.trim().toLowerCase())
      .filter(shop => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)),
  );
}

export function isAllowedShop(shop: string): boolean {
  return allowedShopDomains().has(shop.trim().toLowerCase());
}
