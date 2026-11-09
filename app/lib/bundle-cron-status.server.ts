/**
 * Persist a small independent record of the scheduled audit.
 * A manually triggered reconciliation must never overwrite this entry.
 */
type Admin = { graphql: (query: string, options?: any) => Promise<any> };

export type DailyCronStatus = {
  checkedAt: string;
  ok: boolean;
  checked: number;
  updated: number;
  unpublished: number;
  requiresAttention: number;
  errors: string[];
  webhooks: { deletion: boolean; inventory: boolean; prices: boolean };
};

export async function storeDailyCronStatus(admin: Admin, status: DailyCronStatus): Promise<void> {
  const ownerResponse = await admin.graphql(String.raw`#graphql
    query CsbyteDailyAuditOwner { currentAppInstallation { id } }
  `);
  const owner = await ownerResponse.json();
  if (owner.errors?.length || !owner.data?.currentAppInstallation?.id) {
    throw new Error("No se pudo identificar la instalación para guardar el estado del cron.");
  }
  const response = await admin.graphql(String.raw`#graphql
    mutation CsbyteStoreDailyAuditStatus($inputs: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $inputs) {
        metafields { id }
        userErrors { field message }
      }
    }
  `, { variables: { inputs: [{
    ownerId: owner.data.currentAppInstallation.id,
    namespace: "app_config",
    key: "bundle_daily_cron_status",
    type: "json",
    value: JSON.stringify(status),
  }] } });
  const result = await response.json();
  if (result.errors?.length || result.data?.metafieldsSet?.userErrors?.length ||
      !result.data?.metafieldsSet?.metafields?.length) {
    throw new Error("Shopify no confirmó el registro de la auditoría programada.");
  }
}

export function parseDailyCronStatus(value: string | undefined | null): DailyCronStatus | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed.checkedAt !== "string" ||
        !Number.isFinite(Date.parse(parsed.checkedAt)) ||
        typeof parsed.ok !== "boolean" ||
        !Number.isFinite(parsed.checked) || !Number.isFinite(parsed.updated) ||
        !Number.isFinite(parsed.unpublished) || !Number.isFinite(parsed.requiresAttention) ||
        !Array.isArray(parsed.errors) || parsed.errors.some((x: unknown) => typeof x !== "string") ||
        !parsed.webhooks || ["deletion","inventory","prices"].some(
          (key) => typeof parsed.webhooks[key] !== "boolean")) return null;
    return parsed as DailyCronStatus;
  } catch {
    return null;
  }
}
