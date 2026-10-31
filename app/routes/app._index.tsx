import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";

import {
  useLoaderData,
} from "react-router";

import {
  boundary,
} from "@shopify/shopify-app-react-router/server";

import {
  authenticate,
} from "../shopify.server";

import {
  buildTemplateBundleState,
} from "../lib/bundle-template-engine";

import {
  loadCachedBundleDiagnostics,
  loadCachedBundleRuntimeSettings,
  loadCachedBundleTemplateCatalog,
} from "../lib/bundle-cache.server";

/* =========================================================
   LOADER
========================================================= */

export const loader =
  async ({
    request,
  }: LoaderFunctionArgs) => {
    const {
      admin,
      session,
    } =
      await authenticate.admin(
        request,
      );

    const [
      diagnostics,
      catalog,
      runtime,
    ] =
      await Promise.all([
        loadCachedBundleDiagnostics(
          admin,
          session.shop,
        ),

        loadCachedBundleTemplateCatalog(
          admin,
          session.shop,
        ),

        loadCachedBundleRuntimeSettings(
          admin,
          session.shop,
        ),
      ]);

    const templateState =
      buildTemplateBundleState(
        catalog.products,
        catalog.templates,
        runtime.componentConfig,
      );

    return {
      diagnostics,

      templateBundlePossibleCount:
        templateState
          .candidates
          .length,

      activeTemplateCount:
        templateState
          .summaries
          .filter(
            (summary) =>
              summary.enabled,
          )
          .length,
    };
  };

/* =========================================================
   COMPONENT
========================================================= */

export default function Index() {
  const {
    diagnostics,
    templateBundlePossibleCount,
    activeTemplateCount,
  } =
    useLoaderData<
      typeof loader
    >();

  const configurationOkay =
    diagnostics.selectedMonitorCount >
      0 &&
    diagnostics.selectedKeyboardCount >
      0 &&
    diagnostics.priceConfigured;

  function getPriceStatus() {
    if (
      !diagnostics.priceConfigured
    ) {
      return "Pendiente";
    }

    if (
      diagnostics.priceMode ===
      "percentage"
    ) {
      return "Descuento %";
    }

    if (
      diagnostics.priceMode ===
      "fixed"
    ) {
      return "Descuento fijo";
    }

    return "Sin descuento";
  }

  return (
    <s-page heading="Resumen" inlineSize="large">

      <s-stack gap="base">

        <style>{`
          .csb-summary-metrics {
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 12px;
          }
          .csb-summary-metrics > s-section {
            min-width: 0;
            height: 100%;
          }
          .csb-summary-content {
            display: grid;
            grid-template-columns: minmax(0, 1.7fr) minmax(300px, 1fr);
            align-items: start;
            gap: 16px;
          }
          .csb-summary-content > s-section {
            min-width: 0;
          }
          .csb-summary-alert-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
          }
          .csb-summary-alert-grid > s-banner {
            min-width: 0;
          }
          @media (max-width: 1199px) {
            .csb-summary-metrics {
              grid-template-columns: repeat(3, minmax(0, 1fr));
            }
            .csb-summary-alert-grid {
              grid-template-columns: 1fr;
            }
          }
          @media (max-width: 949px) {
            .csb-summary-content {
              grid-template-columns: minmax(0, 1fr);
            }
          }
          @media (max-width: 719px) {
            .csb-summary-metrics {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }
          @media (max-width: 359px) {
            .csb-summary-metrics {
              grid-template-columns: minmax(0, 1fr);
            }
          }
        `}</style>

        <s-section>

          <s-paragraph>
            Estado general de productos, compatibilidad y Bundles disponibles.
          </s-paragraph>

        </s-section>

        <div className="csb-summary-metrics">

            <s-section>
              <s-stack gap="small">
                <s-text tone="neutral">
                  PC con stock
                </s-text>
                <s-heading>
                  {
                    diagnostics.totalPcWithStock
                  }
                </s-heading>
              </s-stack>
            </s-section>

            <s-section>
              <s-stack gap="small">
                <s-text tone="neutral">
                  Datos técnicos completos
                </s-text>
                <s-heading>
                  {
                    diagnostics.readyDataCount
                  }
                </s-heading>
              </s-stack>
            </s-section>

            <s-section>
              <s-stack gap="small">
                <s-text tone="neutral">
                  Bundles posibles
                </s-text>
                <s-heading>
                  {
                    templateBundlePossibleCount
                  }
                </s-heading>
                <s-badge tone="success">
                  Disponibles
                </s-badge>
              </s-stack>
            </s-section>

            <s-section>
              <s-stack gap="small">
                <s-text tone="neutral">
                  Faltan datos
                </s-text>
                <s-heading>
                  {
                    diagnostics.missingDataCount
                  }
                </s-heading>
                {diagnostics.missingDataCount >
                  0 && (
                  <s-badge tone="warning">
                    Revisar
                  </s-badge>
                )}
              </s-stack>
            </s-section>

            <s-section>
              <s-stack gap="small">
                <s-text tone="neutral">
                  Requieren atención
                </s-text>
                <s-heading>
                  {
                    diagnostics.attentionCount
                  }
                </s-heading>
                {diagnostics.attentionCount >
                  0 && (
                  <s-badge tone="warning">
                    Atención
                  </s-badge>
                )}
              </s-stack>
            </s-section>

        </div>

        <div className="csb-summary-content">



            <s-section heading="Estado de los productos">

              {diagnostics.attentionCount ===
              0 ? (
                <s-banner
                  heading="Todos los PC están listos"
                  tone="success"
                >
                  No se detectaron problemas que impidan generar Bundles.
                </s-banner>
              ) : (
                <div className="csb-summary-alert-grid">

                  {diagnostics.missingWifiCount >
                    0 && (
                    <s-banner
                      heading={`${diagnostics.missingWifiCount} PC sin información de Wi-Fi`}
                      tone="warning"
                    >
                      Debes informar si tienen o no tienen Wi-Fi integrado.

                      <s-button
                        slot="secondary-actions"
                        variant="secondary"
                        href="/app/problems?filter=missing_wifi"
                      >
                        Revisar
                      </s-button>
                    </s-banner>
                  )}

                  {diagnostics.missingVideoCount >
                    0 && (
                    <s-banner
                      heading={`${diagnostics.missingVideoCount} PC sin salidas de video`}
                      tone="warning"
                    >
                      Debes completar el metacampo de salidas de video.

                      <s-button
                        slot="secondary-actions"
                        variant="secondary"
                        href="/app/problems?filter=missing_video"
                      >
                        Revisar
                      </s-button>
                    </s-banner>
                  )}

                  {diagnostics.noCompatibleMonitorCount >
                    0 && (
                    <s-banner
                      heading={`${diagnostics.noCompatibleMonitorCount} PC sin monitor compatible`}
                      tone="warning"
                    >
                      Tienen datos completos, pero ningún monitor autorizado coincide con sus salidas.

                      <s-button
                        slot="secondary-actions"
                        variant="secondary"
                        href="/app/problems?filter=no_monitor"
                      >
                        Revisar
                      </s-button>
                    </s-banner>
                  )}

                </div>
              )}

            </s-section>

            <s-section heading="Configuración">

              <s-button
                slot="primary-action"
                variant="primary"
                href="/app/bundles"
              >
                Administrar Bundles
              </s-button>

              <s-button
                slot="secondary-actions"
                variant="secondary"
                href="/app/rules"
              >
                Reglas y cálculo
              </s-button>

              <s-stack gap="small">

                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="small"
                >
                  <s-text tone="neutral">
                    Plantillas activas
                  </s-text>
                  <s-badge tone="success">
                    {
                      activeTemplateCount
                    }
                  </s-badge>
                </s-grid>

                <s-divider />

                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="small"
                >
                  <s-text tone="neutral">
                    Monitores autorizados
                  </s-text>
                  <s-badge
                    tone={
                      diagnostics.selectedMonitorCount >
                      0
                        ? "success"
                        : "warning"
                    }
                  >
                    {
                      diagnostics.selectedMonitorCount
                    }
                  </s-badge>
                </s-grid>

                <s-divider />

                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="small"
                >
                  <s-text tone="neutral">
                    Teclado/Mouse
                  </s-text>
                  <s-badge
                    tone={
                      diagnostics.selectedKeyboardCount >
                      0
                        ? "success"
                        : "warning"
                    }
                  >
                    {diagnostics.selectedKeyboardCount >
                    0
                      ? "Configurado"
                      : "Pendiente"}
                  </s-badge>
                </s-grid>

                <s-divider />

                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="small"
                >
                  <s-text tone="neutral">
                    Adaptadores Wi-Fi
                  </s-text>
                  <s-badge tone="neutral">
                    {
                      diagnostics.selectedWifiCount
                    }
                  </s-badge>
                </s-grid>

                <s-divider />

                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="small"
                >
                  <s-text tone="neutral">
                    Precio comercial
                  </s-text>
                  <s-badge
                    tone={
                      diagnostics.priceConfigured
                        ? "success"
                        : "warning"
                    }
                  >
                    {getPriceStatus()}
                  </s-badge>
                </s-grid>

                <s-divider />

                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="small"
                >
                  <s-text tone="neutral">
                    Estado general
                  </s-text>
                  <s-badge
                    tone={
                      configurationOkay
                        ? "success"
                        : "warning"
                    }
                  >
                    {configurationOkay
                      ? "Configurado"
                      : "Incompleto"}
                  </s-badge>
                </s-grid>

              </s-stack>

            </s-section>

        </div>

      </s-stack>

    </s-page>
  );
}

export const headers:
  HeadersFunction = (
    headersArgs,
  ) => {
    return boundary.headers(
      headersArgs,
    );
  };