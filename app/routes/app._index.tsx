import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";

import {
  Link,
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
    <s-page heading="Home" inlineSize="large">

      <style>{`
        .csb-home {
          width: 100%;
          max-width: none;
          margin: 0;
          padding-bottom: 24px;
        }

        .csb-home-heading {
          margin-bottom: 18px;
          padding: 4px 2px 0;
        }

        .csb-home-title {
          margin: 0 0 5px;
          color: #202223;
          font-size: 21px;
          line-height: 1.2;
          font-weight: 720;
        }

        .csb-home-description {
          margin: 0;
          max-width: 760px;
          color: #69727d;
          font-size: 12px;
          line-height: 1.5;
        }

        .csb-stats {
          display: grid;
          grid-template-columns:
            repeat(
              5,
              minmax(0, 1fr)
            );
          gap: 12px;
          margin-bottom: 18px;
        }

        .csb-stat {
          min-width: 0;
          min-height: 92px;
          padding: 16px;
          border: 1px solid #e1e3e5;
          border-radius: 12px;
          background: #fff;
        }

        .csb-stat--success {
          background: #fbfefb;
        }

        .csb-stat--warning {
          background: #fffaf2;
        }

        .csb-stat__label {
          margin-bottom: 5px;
          color: #616161;
          font-size: 12px;
        }

        .csb-stat__value {
          color: #303030;
          font-size: 26px;
          line-height: 1;
          font-weight: 700;
        }

        .csb-dashboard-grid {
          display: grid;
          grid-template-columns:
            minmax(0, 1.5fr)
            minmax(300px, .75fr);
          gap: 18px;
          align-items: start;
        }

        .csb-card {
          border: 1px solid #e4e9f0;
          border-radius: 12px;
          background: #fff;
          overflow: hidden;
        }

        .csb-card-header {
          padding: 17px 18px;
          border-bottom: 1px solid #ededed;
        }

        .csb-card-title {
          margin: 0 0 4px;
          color: #303030;
          font-size: 15px;
          font-weight: 650;
        }

        .csb-card-description {
          margin: 0;
          color: #616161;
          font-size: 12px;
          line-height: 1.45;
        }

        .csb-alert {
          display: grid;
          grid-template-columns:
            38px
            minmax(0, 1fr)
            auto;
          gap: 12px;
          align-items: center;
          padding: 16px 18px;
          border-bottom: 1px solid #ededed;
        }

        .csb-alert:last-child {
          border-bottom: 0;
        }

        .csb-alert__icon {
          width: 36px;
          height: 36px;
          display: grid;
          place-items: center;
          border-radius: 10px;
          background: #fff2d8;
          color: #8a5a00;
          font-size: 17px;
        }

        .csb-alert--good .csb-alert__icon {
          background: #eaf8ee;
          color: #26733e;
        }

        .csb-alert__title {
          margin-bottom: 3px;
          color: #303030;
          font-size: 13px;
          font-weight: 600;
        }

        .csb-alert__detail {
          color: #616161;
          font-size: 11.5px;
          line-height: 1.4;
        }

        .csb-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 34px;
          padding: 6px 12px;
          border: 1px solid #c9c9c9;
          border-radius: 8px;
          background: #fff;
          color: #303030;
          font-size: 12px;
          font-weight: 600;
          text-decoration: none;
        }

        .csb-button:hover {
          background: #f7f7f7;
        }

        .csb-button--primary {
          border-color: #0c62f2;
          background: #0c62f2;
          color: #fff;
        }

        .csb-status-list {
          padding: 8px 18px;
        }

        .csb-status-row {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          padding: 11px 0;
          border-bottom: 1px solid #ededed;
          font-size: 12px;
        }

        .csb-status-row:last-child {
          border-bottom: 0;
        }

        .csb-status-label {
          color: #616161;
        }

        .csb-status-value {
          color: #303030;
          font-weight: 600;
          text-align: right;
        }

        .csb-good {
          color: #26733e;
        }

        .csb-warning {
          color: #8a5a00;
        }

        .csb-actions {
          display: grid;
          grid-template-columns:
            repeat(
              2,
              minmax(0, 1fr)
            );
          gap: 10px;
          padding: 16px 18px;
          border-top: 1px solid #ededed;
        }

        @media (max-width: 1050px) {
          .csb-stats {
            grid-template-columns:
              repeat(
                3,
                minmax(0, 1fr)
              );
          }

          .csb-dashboard-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 700px) {
          .csb-home {
            padding-bottom: 16px;
          }

          .csb-home-heading {
            margin-bottom: 14px;
            padding-top: 0;
          }

          .csb-home-title {
            font-size: 19px;
          }

          .csb-home-description {
            font-size: 12px;
          }

          .csb-stats {
            grid-template-columns:
              repeat(
                2,
                minmax(0, 1fr)
              );
            gap: 8px;
            margin-bottom: 12px;
          }

          .csb-stat {
            min-height: 82px;
            padding: 13px;
            border-radius: 10px;
          }

          .csb-stat:last-child {
            grid-column: 1 / -1;
          }

          .csb-stat__label {
            font-size: 10.5px;
            line-height: 1.25;
          }

          .csb-stat__value {
            font-size: 22px;
          }

          .csb-dashboard-grid {
            gap: 12px;
          }

          .csb-card {
            border-radius: 10px;
          }

          .csb-card-header {
            padding: 14px;
          }

          .csb-alert {
            grid-template-columns:
              32px
              minmax(0, 1fr);
            gap: 10px;
            padding: 13px 14px;
          }

          .csb-alert__icon {
            width: 32px;
            height: 32px;
            border-radius: 8px;
          }

          .csb-alert__title {
            font-size: 12px;
          }

          .csb-alert__detail {
            font-size: 10.5px;
          }

          .csb-alert .csb-button {
            grid-column: 2;
            width: 100%;
            min-height: 42px;
            justify-self: stretch;
          }

          .csb-status-list {
            padding: 6px 14px;
          }

          .csb-status-row {
            gap: 10px;
            padding: 10px 0;
            font-size: 11px;
          }

          .csb-actions {
            grid-template-columns: 1fr;
            padding: 14px;
          }

          .csb-actions .csb-button {
            min-height: 42px;
          }
        }
      `}</style>

      <div className="csb-home">

        <div className="csb-home-heading">

          <h1 className="csb-home-title">
            CSBYTE Commerce Tools
          </h1>

          <p className="csb-home-description">
            Estado general de productos, compatibilidad y bundles disponibles.
          </p>

        </div>

        <div className="csb-stats">

          <div className="csb-stat">
            <div className="csb-stat__label">
              PC con stock
            </div>

            <div className="csb-stat__value">
              {
                diagnostics.totalPcWithStock
              }
            </div>
          </div>

          <div className="csb-stat">
            <div className="csb-stat__label">
              Datos técnicos completos
            </div>

            <div className="csb-stat__value">
              {
                diagnostics.readyDataCount
              }
            </div>
          </div>

          <div className="csb-stat csb-stat--success">
            <div className="csb-stat__label">
              Bundles posibles
            </div>

            <div className="csb-stat__value">
              {
                templateBundlePossibleCount
              }
            </div>
          </div>

          <div
            className={
              diagnostics.missingDataCount >
              0
                ? "csb-stat csb-stat--warning"
                : "csb-stat"
            }
          >
            <div className="csb-stat__label">
              Faltan datos
            </div>

            <div className="csb-stat__value">
              {
                diagnostics.missingDataCount
              }
            </div>
          </div>

          <div
            className={
              diagnostics.attentionCount >
              0
                ? "csb-stat csb-stat--warning"
                : "csb-stat"
            }
          >
            <div className="csb-stat__label">
              Requieren atención
            </div>

            <div className="csb-stat__value">
              {
                diagnostics.attentionCount
              }
            </div>
          </div>

        </div>

        <div className="csb-dashboard-grid">

          <div className="csb-card">

            <div className="csb-card-header">

              <h2 className="csb-card-title">
                Estado de los productos
              </h2>

              <p className="csb-card-description">
                Problemas que actualmente impiden generar bundles.
              </p>

            </div>

            {diagnostics.attentionCount ===
            0 ? (
              <div className="csb-alert csb-alert--good">

                <div className="csb-alert__icon">
                  ✓
                </div>

                <div>
                  <div className="csb-alert__title">
                    Todos los PC están listos
                  </div>

                  <div className="csb-alert__detail">
                    No se detectaron problemas que impidan generar bundles.
                  </div>
                </div>

              </div>
            ) : (
              <>
                {diagnostics.missingWifiCount >
                  0 && (
                  <div className="csb-alert">

                    <div className="csb-alert__icon">
                      !
                    </div>

                    <div>
                      <div className="csb-alert__title">
                        {
                          diagnostics.missingWifiCount
                        }{" "}
                        PC sin información de Wi-Fi
                      </div>

                      <div className="csb-alert__detail">
                        Debes informar si tienen o no tienen Wi-Fi integrado.
                      </div>
                    </div>

                    <Link
                      className="csb-button"
                      to="/app/problems?filter=missing_wifi"
                    >
                      Revisar
                    </Link>

                  </div>
                )}

                {diagnostics.missingVideoCount >
                  0 && (
                  <div className="csb-alert">

                    <div className="csb-alert__icon">
                      !
                    </div>

                    <div>
                      <div className="csb-alert__title">
                        {
                          diagnostics.missingVideoCount
                        }{" "}
                        PC sin salidas de video
                      </div>

                      <div className="csb-alert__detail">
                        Debes completar el metafield de salidas de video.
                      </div>
                    </div>

                    <Link
                      className="csb-button"
                      to="/app/problems?filter=missing_video"
                    >
                      Revisar
                    </Link>

                  </div>
                )}

                {diagnostics.noCompatibleMonitorCount >
                  0 && (
                  <div className="csb-alert">

                    <div className="csb-alert__icon">
                      !
                    </div>

                    <div>
                      <div className="csb-alert__title">
                        {
                          diagnostics.noCompatibleMonitorCount
                        }{" "}
                        PC sin monitor compatible
                      </div>

                      <div className="csb-alert__detail">
                        Tienen datos completos, pero ningún monitor autorizado coincide con sus salidas.
                      </div>
                    </div>

                    <Link
                      className="csb-button"
                      to="/app/problems?filter=no_monitor"
                    >
                      Revisar
                    </Link>

                  </div>
                )}
              </>
            )}

          </div>

          <div className="csb-card">

            <div className="csb-card-header">

              <h2 className="csb-card-title">
                Configuración
              </h2>

              <p className="csb-card-description">
                Estado actual del generador basado en plantillas.
              </p>

            </div>

            <div className="csb-status-list">

              <div className="csb-status-row">

                <span className="csb-status-label">
                  Plantillas activas
                </span>

                <span className="csb-status-value csb-good">
                  {
                    activeTemplateCount
                  }
                </span>

              </div>

              <div className="csb-status-row">

                <span className="csb-status-label">
                  Monitores autorizados
                </span>

                <span
                  className={
                    diagnostics.selectedMonitorCount >
                    0
                      ? "csb-status-value csb-good"
                      : "csb-status-value csb-warning"
                  }
                >
                  {
                    diagnostics.selectedMonitorCount
                  }
                </span>

              </div>

              <div className="csb-status-row">

                <span className="csb-status-label">
                  Teclado/Mouse
                </span>

                <span
                  className={
                    diagnostics.selectedKeyboardCount >
                    0
                      ? "csb-status-value csb-good"
                      : "csb-status-value csb-warning"
                  }
                >
                  {diagnostics.selectedKeyboardCount >
                  0
                    ? "Configurado"
                    : "Pendiente"}
                </span>

              </div>

              <div className="csb-status-row">

                <span className="csb-status-label">
                  Adaptadores Wi-Fi
                </span>

                <span className="csb-status-value">
                  {
                    diagnostics.selectedWifiCount
                  }
                </span>

              </div>

              <div className="csb-status-row">

                <span className="csb-status-label">
                  Precio comercial
                </span>

                <span
                  className={
                    diagnostics.priceConfigured
                      ? "csb-status-value csb-good"
                      : "csb-status-value csb-warning"
                  }
                >
                  {getPriceStatus()}
                </span>

              </div>

              <div className="csb-status-row">

                <span className="csb-status-label">
                  Estado general
                </span>

                <span
                  className={
                    configurationOkay
                      ? "csb-status-value csb-good"
                      : "csb-status-value csb-warning"
                  }
                >
                  {configurationOkay
                    ? "Configurado"
                    : "Configuración incompleta"}
                </span>

              </div>

            </div>

            <div className="csb-actions">

              <Link
                className="csb-button csb-button--primary"
                to="/app/bundles"
              >
                Administrar bundles
              </Link>

              <Link
                className="csb-button"
                to="/app/rules"
              >
                Reglas y cálculo
              </Link>

            </div>

          </div>

        </div>

      </div>

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