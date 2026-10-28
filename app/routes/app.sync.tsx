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
  // This shop-specific subscription is owned by CSBYTE Bundles itself.
  // Shopify's app-specific TOML configuration is intentionally unchanged.
  let deleteWebhookReady = false;
  let deleteWebhookError = "";
  try {
    const { session: offline } = await unauthenticated.admin(session.shop);
    const registration = await registerWebhooks({ session: offline });
    const result = (registration as Record<string, Array<{ success: boolean }>>).PRODUCTS_DELETE;
    deleteWebhookReady = Array.isArray(result) &&
      result.length > 0 && result.every((item) => item.success);
    if (!deleteWebhookReady) {
      deleteWebhookError = "Shopify no confirmó el webhook de eliminación. Vuelve a abrir esta sección.";
    }
  } catch (error) {
    deleteWebhookError = error instanceof Error
      ? error.message
      : "No fue posible registrar el webhook.";
  }
  const [report, lastReport] = await Promise.all([
    runManagedBundleSync(admin, { apply: false }),
    readPreviousReport(admin),
  ]);
  return { report, lastReport, deleteWebhookReady, deleteWebhookError };
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
  const report = fetcher.data?.report ?? initial.report;
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
            {!report.priceRuleConfigured && (
              <s-banner heading="Falta una regla de precio" tone="warning">
                Configura el descuento en «Reglas y cálculo» antes de automatizar precios.
                Sin esa regla, la supervisión no modifica precios existentes.
              </s-banner>
            )}
            {report.errors.length > 0 && (
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
            <s-paragraph>
              Revisados: {report.total} · Con observaciones: {report.requiresAttention} ·
              Fichas sincronizadas en esta revisión: {report.updated} ·
              Despublicados por seguridad: {report.unpublished ?? 0}.
            </s-paragraph>
            {report.rows.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: "14px 0",
                  borderTop: "1px solid var(--p-color-border, #dedede)",
                }}
              >
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
            {report.rows.length === 0 && !report.errors.length && (
              <s-paragraph>No se encontraron Bundles administrados por la app.</s-paragraph>
            )}
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
