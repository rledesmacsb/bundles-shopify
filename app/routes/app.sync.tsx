import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, registerWebhooks, unauthenticated } from "../shopify.server";
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
  // Fetch the last verified report without blocking on a full catalog scan.
  // The costly scan is explicitly requested or run by daily Cron.
  const previousReportPromise = readPreviousReport(admin);
  // This shop-specific subscription is owned by CSBYTE Bundles itself.
  // Shopify's app-specific TOML configuration is intentionally unchanged.
  let deleteWebhookReady = false;
  let deleteWebhookError = "";
  try {
    const { session: offline, admin: shopAdmin } = await unauthenticated.admin(session.shop);
    await registerWebhooks({ session: offline });
    // Verify the installed subscription using CSBYTE's own app credentials;
    // external Shopify connectors cannot see another app's webhooks.
    const response = await shopAdmin.graphql(`#graphql
      query CsbyteVerifyDeleteSubscription {
        webhookSubscriptions(first: 50, topics: [PRODUCTS_DELETE]) {
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
    if (!deleteWebhookReady) {
      deleteWebhookError = "No se encontró la suscripción products/delete de CSBYTE Bundles en Shopify.";
    }
  } catch (error) {
    deleteWebhookError = error instanceof Error
      ? error.message
      : "No fue posible registrar el webhook.";
  }
  const lastReport = await previousReportPromise;
  return { lastReport, deleteWebhookReady, deleteWebhookError };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "reconcile") {
    return { report: null, message: "Operación no reconocida." };
  }
  const report = await runManagedBundleSync(admin, { apply: true, saveReport: true });
  return {
    report,
    message: report.errors.length
      ? "La revisión necesita atención."
      : `Revisados ${report.total} Bundles. Fichas sincronizadas: ${report.updated}. Despublicados por seguridad: ${report.unpublished}.`,
  };
};

export default function BundleSync() {
  const initial = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const report = fetcher.data?.report ?? initial.lastReport;
  const running = fetcher.state !== "idle";
  const last = fetcher.data?.report && !fetcher.data.report.errors.length
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
              <input type="hidden" name="intent" value="reconcile" />
              <s-button type="submit" variant="primary" disabled={running}>
                {running ? "Comprobando…" : "Revisar y sincronizar ahora"}
              </s-button>
            </fetcher.Form>
            <s-text tone="neutral">
              Revisión programada una vez al día. Los cambios no son instantáneos.
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

        <s-section heading="Estado de los Bundles">
          <s-stack gap="base">
            {!report && (
              <s-paragraph>
                No hay una revisión guardada. Selecciona «Revisar y sincronizar ahora»
                para comprobar los componentes.
              </s-paragraph>
            )}
            {report && (
              <s-paragraph>
                Revisados: {report.total} · Con observaciones: {report.requiresAttention} ·
                Fichas sincronizadas: {report.updated} ·
                Despublicados por seguridad: {report.unpublished ?? 0}.
              </s-paragraph>
            )}
            <div className="csbyte-sync-grid">
            {report?.rows.map((item) => (
              <div key={item.id} className="csbyte-sync-card">
                <s-stack gap="small">
                  <s-text><strong>{item.title}</strong></s-text>
                  <s-text tone="neutral">
                    {item.status === "ACTIVE" ? "Publicado" : "Borrador"}
                    {" · "}{item.available} disponibles
                    {" · "}Precio: {item.price == null
                      ? "Sin precio"
                      : item.price.toLocaleString("es-CL") + " CLP"}
                    {item.expectedPrice != null &&
                      " · Precio calculado: " +
                        item.expectedPrice.toLocaleString("es-CL") + " CLP"}
                  </s-text>
                  {item.autoUnpublished && (
                    <s-badge tone="warning">Despublicado por seguridad</s-badge>
                  )}
                  {item.updated && (
                    <s-badge tone="success">
                      {item.updatedDetail === "compare_at"
                        ? "Precio de comparación actualizado"
                        : item.updatedDetail === "both"
                          ? "Precio y comparación actualizados"
                          : "Precio de venta actualizado"}
                    </s-badge>
                  )}
                  {item.issues.length === 0 && !item.updated && (
                    <s-badge tone="success">Sin observaciones</s-badge>
                  )}
                  {item.issues.map((issue, index) => (
                    <s-text key={index} tone="warning">{issue}</s-text>
                  ))}
                </s-stack>
              </div>
            ))}
            </div>
            {report && report.rows.length === 0 && !report.errors.length && (
              <s-paragraph>No se encontraron Bundles administrados por la app.</s-paragraph>
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
