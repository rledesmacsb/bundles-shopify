import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, registerWebhooks, unauthenticated } from "../shopify.server";
import { isAllowedShop } from "../lib/shop-allowlist.server";
import { loadLiveBundleSnapshot } from "../lib/bundle-live-status.server";
import {
  runManagedBundleSync,
  type BundleSyncReport,
} from "../lib/bundle-sync.server";

type Admin = { graphql: (query: string, options?: any) => Promise<any> };

async function readPreviousReport(admin: Admin): Promise<BundleSyncReport | null> {
  try {
    const response = await admin.graphql(`#graphql
      query CsbyteGetLastBundleSync {
        currentAppInstallation {
          report: metafield(namespace: "app_config", key: "bundle_sync_last_report") {
            value
          }
        }
      }
    `);
    const data = await response.json();
    const value = data?.data?.currentAppInstallation?.report?.value;
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed.checkedAt === "string" &&
      Array.isArray(parsed.rows) ? parsed as BundleSyncReport : null;
  } catch {
    return null;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  if (!isAllowedShop(session.shop)) {
    throw new Response("Tienda no autorizada para esta aplicación.", { status: 403 });
  }
  // Fetch the last verified report without blocking on a full catalog scan.
  // The costly scan is explicitly requested or run by daily Cron.
  const previousReportPromise = readPreviousReport(admin);
  const liveSnapshotPromise = loadLiveBundleSnapshot(admin);
  // This shop-specific subscription is owned by CSBYTE Bundles itself.
  // Shopify's app-specific TOML configuration is intentionally unchanged.
  let deleteWebhookReady = false;
  let inventoryWebhookReady = false;
  let priceWebhookReady = false;
  let deleteWebhookError = "";
  try {
    const { session: offline, admin: shopAdmin } = await unauthenticated.admin(session.shop);
    await registerWebhooks({ session: offline });
    // Verify the installed subscription using CSBYTE's own app credentials;
    // external Shopify connectors cannot see another app's webhooks.
    const response = await shopAdmin.graphql(`#graphql
      query CsbyteVerifyDeleteSubscription {
        webhookSubscriptions(first: 50, topics: [PRODUCTS_DELETE, INVENTORY_LEVELS_UPDATE, PRODUCTS_UPDATE]) {
          nodes { id topic uri }
          pageInfo { hasNextPage }
        }
      }
    `);
    const payload = await response.json() as {
      data?: { webhookSubscriptions?: {
        nodes: Array<{ id: string; topic: string; uri: string }>;
        pageInfo: { hasNextPage: boolean };
      } };
      errors?: Array<{ message: string }>;
    };
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((e) => e.message).join(" · "));
    }
    const subscriptions = payload.data?.webhookSubscriptions;
    deleteWebhookReady = Boolean(subscriptions?.nodes.some((webhook) =>
      webhook.topic === "PRODUCTS_DELETE" &&
      (() => {
        try {
          const endpoint = new URL(webhook.uri, process.env.SHOPIFY_APP_URL);
          return endpoint.origin === new URL(process.env.SHOPIFY_APP_URL || request.url).origin &&
            endpoint.pathname === "/webhooks/products/delete";
        } catch {
          return false;
        }
      })(),
    ));
    inventoryWebhookReady = Boolean(subscriptions?.nodes.some((webhook) =>
      webhook.topic === "INVENTORY_LEVELS_UPDATE" &&
      (() => {
        try {
          const endpoint = new URL(webhook.uri, process.env.SHOPIFY_APP_URL);
          return endpoint.origin === new URL(process.env.SHOPIFY_APP_URL || request.url).origin &&
            endpoint.pathname === "/webhooks/inventory_levels/update";
        } catch {
          return false;
        }
      })(),
    ));
    priceWebhookReady = Boolean(subscriptions?.nodes.some((webhook) =>
      webhook.topic === "PRODUCTS_UPDATE" &&
      (() => {
        try {
          const endpoint = new URL(webhook.uri, process.env.SHOPIFY_APP_URL);
          return endpoint.origin === new URL(process.env.SHOPIFY_APP_URL || request.url).origin &&
            endpoint.pathname === "/webhooks/products/update";
        } catch {
          return false;
        }
      })(),
    ));
    if (!deleteWebhookReady) {
      deleteWebhookError = "No se encontró la suscripción products/delete de CSBYTE Bundles en Shopify.";
    }
  } catch (error) {
    deleteWebhookError = error instanceof Error
      ? error.message
      : "No fue posible registrar el webhook.";
  }
  const [lastReport, liveSnapshot] = await Promise.all([previousReportPromise, liveSnapshotPromise]);
  return { lastReport, liveSnapshot, deleteWebhookReady, deleteWebhookError, inventoryWebhookReady, priceWebhookReady };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  if (!isAllowedShop(session.shop)) {
    throw new Response("Tienda no autorizada para sincronización.", { status: 403 });
  }
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent !== "audit" && intent !== "reconcile") {
    return { report: null, message: "Operación no reconocida.", readOnly: true };
  }
  const readOnly = intent === "audit";
  const report = await runManagedBundleSync(admin, {
    apply: !readOnly,
    saveReport: !readOnly,
  });
  const liveSnapshot = await loadLiveBundleSnapshot(admin);
  return {
    report,
    liveSnapshot,
    readOnly,
    message: report.errors.length
      ? "La revisión necesita atención."
      : readOnly
        ? `Diagnóstico sin cambios: ${report.total} Bundles revisados, ${report.requiresAttention} con observaciones.`
        : `Revisados ${report.total} Bundles. Fichas sincronizadas: ${report.updated}. Despublicados por seguridad: ${report.unpublished}.`,
  };
};

export default function BundleSync() {
  const initial = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const report = fetcher.data?.report ?? initial.lastReport;
  const liveSnapshot = fetcher.data?.liveSnapshot ?? initial.liveSnapshot;
  const running = fetcher.state !== "idle";
  const historicalRows = new Map((report?.rows ?? []).map((row) => [row.id, row]));
  const last = fetcher.data?.report && !fetcher.data.readOnly &&
    !fetcher.data.report.errors.length
    ? fetcher.data.report : initial.lastReport;

  return (
    <s-page heading="Precios y disponibilidad" inlineSize="large">
      <s-stack gap="base">
        <s-section heading="Supervisión de Bundles">
          <s-stack gap="small">
            {initial.deleteWebhookReady ? (
              <s-badge tone="success">Protección por eliminación conectada</s-badge>
            ) : (
              <s-banner heading="Activación del webhook pendiente" tone="warning">
                {initial.deleteWebhookError ||
                  "Shopify todavía no confirmó la protección inmediata."}
                La revisión manual y diaria sigue disponible.
              </s-banner>
            )}
            {initial.inventoryWebhookReady ? (
              <s-badge tone="success">Protección por inventario conectada</s-badge>
            ) : (
              <s-banner heading="Protección inmediata por inventario pendiente" tone="warning">
                Falta confirmar la suscripción inventory_levels/update y el permiso read_inventory.
                La revisión programada y la protección antes de publicar siguen disponibles.
              </s-banner>
            )}
            {initial.priceWebhookReady ? (
              <s-badge tone="success">Sincronización inmediata de precios conectada</s-badge>
            ) : (
              <s-banner heading="Webhook de cambios de producto pendiente" tone="warning">
                Shopify todavía no confirmó products/update. La sincronización diaria sigue disponible.
              </s-banner>
            )}
            <s-paragraph>
              Compara los componentes reales del Bundle con su configuración guardada.
              Detecta cambios de precio, stock, publicación y composición.
              Shopify mantiene el inventario nativo de cada componente.
              Si se elimina o cambia un componente, los Bundles publicados
              afectados se pasan a borrador al ejecutar la sincronización.
              No se publican automáticamente después.
            </s-paragraph>
            {report && !report.priceRuleConfigured && (
              <s-banner heading="Falta una regla de precio" tone="warning">
                Configura el descuento en «Reglas y cálculo» antes de automatizar precios.
                Sin esa regla, la supervisión no modifica precios existentes.
              </s-banner>
            )}
            {report && report.errors.length > 0 && (
              <s-banner heading="Revisión incompleta" tone="critical">
                {report.errors.join(" · ")}
              </s-banner>
            )}
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="audit" />
              <s-button type="submit" variant="primary" disabled={running}>
                {running ? "Comprobando…" : "Diagnóstico sin modificar productos"}
              </s-button>
            </fetcher.Form>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="reconcile" />
              <s-button type="submit" disabled={running}>
                Revisar y aplicar sincronización
              </s-button>
            </fetcher.Form>
            {fetcher.data?.readOnly && (
              <s-banner heading="Diagnóstico de solo lectura">
                No se cambiaron precios, inventario ni estados de publicación.
              </s-banner>
            )}
            <s-text tone="neutral">
              Los cambios de precio se procesan por webhook y se revisan nuevamente una vez al día.
              Si alguien modifica manualmente el precio del Bundle, la app no lo sobrescribe.
            </s-text>
            {last && (
              <s-text tone="neutral">
                Último control guardado: {new Date(last.checkedAt).toLocaleString("es-CL")}.
                Fichas sincronizadas: {last.updated}.
              </s-text>
            )}
          </s-stack>
        </s-section>

        <s-section heading="Estado actual de los Bundles">
          <s-stack gap="base">
            <s-text tone="neutral">
              Datos consultados directamente en Shopify: {new Date(liveSnapshot.checkedAt).toLocaleString("es-CL")}.
              El estado ACTIVE no confirma publicación en el canal Tienda online.
            </s-text>
            {liveSnapshot.error ? (
              <s-banner heading="No fue posible confirmar el estado actual" tone="critical">
                {liveSnapshot.error} No se muestran resultados parciales ni datos históricos como actuales.
              </s-banner>
            ) : (
              <s-paragraph>
                Bundles administrados encontrados: {liveSnapshot.rows.length}.
                La última auditoría figura por separado y puede contener observaciones ya resueltas.
              </s-paragraph>
            )}
            {report && (
              <s-text tone="neutral">
                Última auditoría {new Date(report.checkedAt).toLocaleString("es-CL")}:
                {report.total} revisados · {report.requiresAttention} con observaciones ·
                {report.updated} actualizados · {report.unpublished ?? 0} pasados a borrador.
                Las observaciones corresponden a esa fecha, no necesariamente al estado actual.
              </s-text>
            )}
            {!liveSnapshot.error && (
              <div className="csbyte-sync-grid">
                {liveSnapshot.rows.map((item) => {
                  const previous = historicalRows.get(item.id);
                  const changed = previous && (previous.status !== item.status ||
                    previous.available !== item.available || previous.price !== item.price);
                  return (
                    <div key={item.id} className="csbyte-sync-card">
                      <s-stack gap="small">
                        <s-text><strong>{item.title}</strong></s-text>
                        {item.status === "DRAFT" ? (
                          <s-badge tone="warning">Borrador actual</s-badge>
                        ) : item.status === "ACTIVE" ? (
                          <s-badge tone="success">Activo en Shopify (canal no verificado)</s-badge>
                        ) : (
                          <s-badge>{item.status === "UNLISTED" ? "No listado" :
                            item.status === "ARCHIVED" ? "Archivado" : "Estado desconocido"}</s-badge>
                        )}
                        <s-text tone="neutral">
                          Stock actual: {item.available == null ? "No verificable" :
                            item.available.toLocaleString("es-CL")} · Precio actual:{" "}
                          {item.price == null ? "No verificable" :
                            item.price.toLocaleString("es-CL") + " CLP"}
                        </s-text>
                        {changed && <s-badge tone="info">Cambió desde la última auditoría</s-badge>}
                        {!previous && (
                          <s-text tone="neutral">Sin auditoría guardada para este Bundle.</s-text>
                        )}
                        {previous && previous.issues.length > 0 && (
                          <s-text tone="neutral">
                            Observaciones anteriores ({new Date(report!.checkedAt).toLocaleString("es-CL")}):
                            {" "}{previous.issues.join(" · ")}
                          </s-text>
                        )}
                      </s-stack>
                    </div>
                  );
                })}
              </div>
            )}
            {!liveSnapshot.error && liveSnapshot.rows.length === 0 && (
              <s-paragraph>No hay Bundles administrados para mostrar.</s-paragraph>
            )}
          </s-stack>
        </s-section>
        <style>{`
          .csbyte-sync-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
            width: 100%;
          }
          .csbyte-sync-card {
            min-width: 0;
            padding: 14px;
            border: 1px solid var(--p-color-border, #dedede);
            border-radius: 8px;
            overflow-wrap: anywhere;
          }
          @media (max-width: 740px) {
            .csbyte-sync-grid { grid-template-columns: minmax(0, 1fr); gap: 8px; }
            .csbyte-sync-card { padding: 12px; }
          }
        `}</style>
      </s-stack>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
