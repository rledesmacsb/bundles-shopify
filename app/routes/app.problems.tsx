import {
  useMemo,
  useState,
} from "react";

import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";

import {
  useLoaderData,
  useSearchParams,
} from "react-router";

import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";

import {
  loadBundleDiagnostics,
  type ProductDiagnostic,
} from "../lib/bundle-diagnostics.server";

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

    const diagnostics =
      await loadBundleDiagnostics(
        admin,
      );

    return {
      diagnostics,
      shopDomain:
        session.shop,
    };
  };

/* =========================================================
   HELPERS
========================================================= */

function productNumericId(
  gid: string,
) {
  return gid.split("/").pop() ??
    "";
}

function getStatusLabel(
  product: ProductDiagnostic,
) {
  if (
    product.status ===
    "missing_data"
  ) {
    return "Falta información";
  }

  if (
    product.status ===
    "blocked"
  ) {
    return "Sin bundle";
  }

  return "Listo";
}

/* =========================================================
   COMPONENT
========================================================= */

export default function Problems() {
  const {
    diagnostics,
    shopDomain,
  } =
    useLoaderData<
      typeof loader
    >();

  const [
    searchParams,
    setSearchParams,
  ] =
    useSearchParams();

  const initialSearch =
    searchParams.get(
      "q",
    ) ?? "";

  const [
    search,
    setSearch,
  ] =
    useState(
      initialSearch,
    );

  const rawFilter =
    searchParams.get(
      "filter",
    ) ?? "attention";

  const filter =
    [
      "all",
      "attention",
      "missing_data",
      "missing_wifi",
      "missing_video",
      "no_monitor",
      "ready",
    ].includes(
      rawFilter,
    )
      ? rawFilter
      : "attention";

  /* =======================================================
     FILTER
  ======================================================= */

  const visibleProducts =
    useMemo(() => {
      let result = [
        ...diagnostics.products,
      ];

      if (
        filter ===
        "attention"
      ) {
        result =
          result.filter(
            (product) =>
              !product.bundlePossible,
          );
      }

      if (
        filter ===
        "missing_data"
      ) {
        result =
          result.filter(
            (product) =>
              product.status ===
              "missing_data",
          );
      }

      if (
        filter ===
        "missing_wifi"
      ) {
        result =
          result.filter(
            (product) =>
              product.problemCodes.includes(
                "missing_wifi",
              ),
          );
      }

      if (
        filter ===
        "missing_video"
      ) {
        result =
          result.filter(
            (product) =>
              product.problemCodes.includes(
                "missing_video",
              ),
          );
      }

      if (
        filter ===
        "no_monitor"
      ) {
        result =
          result.filter(
            (product) =>
              product.problemCodes.includes(
                "no_compatible_monitor",
              ),
          );
      }

      if (
        filter ===
        "ready"
      ) {
        result =
          result.filter(
            (product) =>
              product.bundlePossible,
          );
      }

      const query =
        search
          .trim()
          .toLocaleLowerCase(
            "es",
          );

      if (query) {
        result =
          result.filter(
            (product) =>
              product.title
                .toLocaleLowerCase(
                  "es",
                )
                .includes(
                  query,
                ) ||
              (
                product.sku ??
                ""
              )
                .toLocaleLowerCase(
                  "es",
                )
                .includes(
                  query,
                ),
          );
      }

      return result;
    }, [
      diagnostics.products,
      filter,
      search,
    ]);

  function changeFilter(
    newFilter: string,
  ) {
    const next =
      new URLSearchParams(
        searchParams,
      );

    next.set(
      "filter",
      newFilter,
    );

    setSearchParams(
      next,
    );
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <s-page heading="Productos con problemas">

      <style>{`
        .csb-problems {
          max-width: 1400px;
          margin: 0 auto;
        }

        .csb-problems-heading {
          margin-bottom: 18px;
        }

        .csb-problems-title {
          margin: 0 0 5px;
          color: #303030;
          font-size: 24px;
          font-weight: 700;
        }

        .csb-problems-description {
          margin: 0;
          color: #616161;
          font-size: 13px;
          line-height: 1.5;
        }

        .csb-kpis {
          display: grid;
          grid-template-columns:
            repeat(
              5,
              minmax(0, 1fr)
            );
          margin-bottom: 16px;
          border: 1px solid #e3e3e3;
          border-radius: 14px;
          overflow: hidden;
          background: #fff;
        }

        .csb-kpi {
          padding: 17px;
          border-right: 1px solid #ededed;
        }

        .csb-kpi:last-child {
          border-right: 0;
        }

        .csb-kpi__label {
          margin-bottom: 4px;
          color: #616161;
          font-size: 11px;
        }

        .csb-kpi__value {
          color: #303030;
          font-size: 22px;
          font-weight: 700;
        }

        .csb-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 14px;
          padding: 12px;
          border: 1px solid #e3e3e3;
          border-radius: 12px;
          background: #fff;
        }

        .csb-filters {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .csb-filter {
          min-height: 32px;
          padding: 5px 10px;
          border: 1px solid transparent;
          border-radius: 8px;
          background: transparent;
          color: #616161;
          font: inherit;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
        }

        .csb-filter:hover {
          background: #f7f7f7;
        }

        .csb-filter--active {
          border-color: #c9bcf5;
          background: #f5f2ff;
          color: #5c35d5;
        }

        .csb-search {
          width: 250px;
          max-width: 100%;
          min-height: 34px;
          padding: 7px 10px;
          border: 1px solid #c9c9c9;
          border-radius: 8px;
          font: inherit;
          font-size: 12px;
        }

        .csb-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .csb-product {
          display: grid;
          grid-template-columns:
            minmax(0, 1.6fr)
            minmax(220px, .8fr)
            auto;
          gap: 20px;
          align-items: center;
          padding: 16px 18px;
          border: 1px solid #e3e3e3;
          border-radius: 12px;
          background: #fff;
        }

        .csb-product--problem {
          border-left: 4px solid #e1a400;
        }

        .csb-product--ready {
          border-left: 4px solid #39a35a;
        }

        .csb-product__title {
          margin-bottom: 5px;
          color: #303030;
          font-size: 13px;
          line-height: 1.4;
          font-weight: 650;
        }

        .csb-product__sku {
          color: #616161;
          font-size: 10.5px;
          font-family:
            ui-monospace,
            SFMono-Regular,
            Menlo,
            Monaco,
            Consolas,
            monospace;
        }

        .csb-meta {
          display: flex;
          gap: 5px;
          flex-wrap: wrap;
          margin-top: 8px;
        }

        .csb-chip {
          display: inline-flex;
          align-items: center;
          min-height: 22px;
          padding: 2px 7px;
          border-radius: 999px;
          background: #f1f1f1;
          color: #616161;
          font-size: 10.5px;
        }

        .csb-chip--warning {
          background: #fff1d7;
          color: #835800;
        }

        .csb-chip--success {
          background: #eaf8ee;
          color: #26733e;
        }

        .csb-problem-list {
          margin: 0;
          padding: 0;
          list-style: none;
        }

        .csb-problem {
          position: relative;
          margin-bottom: 6px;
          padding-left: 17px;
          color: #7a5700;
          font-size: 11.5px;
          line-height: 1.4;
        }

        .csb-problem:last-child {
          margin-bottom: 0;
        }

        .csb-problem::before {
          content: "!";
          position: absolute;
          left: 0;
          top: 0;
          width: 13px;
          height: 13px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          background: #fff1d7;
          color: #8a5a00;
          font-size: 8px;
          font-weight: 700;
        }

        .csb-ready-message {
          color: #26733e;
          font-size: 11.5px;
          font-weight: 600;
        }

        .csb-edit {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 34px;
          padding: 6px 11px;
          border: 1px solid #c9c9c9;
          border-radius: 8px;
          background: #fff;
          color: #303030;
          text-decoration: none;
          font-size: 11.5px;
          font-weight: 600;
          white-space: nowrap;
        }

        .csb-edit:hover {
          background: #f7f7f7;
        }

        .csb-empty {
          padding: 35px;
          border: 1px dashed #c9c9c9;
          border-radius: 12px;
          color: #616161;
          text-align: center;
          font-size: 13px;
        }

        @media (max-width: 1050px) {
          .csb-kpis {
            grid-template-columns:
              repeat(
                3,
                minmax(0, 1fr)
              );
          }

          .csb-product {
            grid-template-columns:
              1fr;
            gap: 12px;
          }

          .csb-edit {
            justify-self: start;
          }
        }

        @media (max-width: 700px) {
          .csb-toolbar {
            align-items: stretch;
            flex-direction: column;
          }

          .csb-search {
            width: 100%;
          }

          .csb-kpis {
            grid-template-columns:
              repeat(
                2,
                minmax(0, 1fr)
              );
          }
        }
      `}</style>

      <div className="csb-problems">

        <div className="csb-problems-heading">

          <h1 className="csb-problems-title">
            Diagnóstico de productos
          </h1>

          <p className="csb-problems-description">
            Detecta inmediatamente qué información o componente impide generar un bundle para cada PC.
          </p>

        </div>

        {/* =================================================
            KPI
        ================================================= */}

        <div className="csb-kpis">

          <div className="csb-kpi">
            <div className="csb-kpi__label">
              PC con stock
            </div>

            <div className="csb-kpi__value">
              {
                diagnostics.totalPcWithStock
              }
            </div>
          </div>

          <div className="csb-kpi">
            <div className="csb-kpi__label">
              Bundles posibles
            </div>

            <div className="csb-kpi__value">
              {
                diagnostics.bundlePossibleCount
              }
            </div>
          </div>

          <div className="csb-kpi">
            <div className="csb-kpi__label">
              Faltan datos
            </div>

            <div className="csb-kpi__value">
              {
                diagnostics.missingDataCount
              }
            </div>
          </div>

          <div className="csb-kpi">
            <div className="csb-kpi__label">
              Sin Wi-Fi informado
            </div>

            <div className="csb-kpi__value">
              {
                diagnostics.missingWifiCount
              }
            </div>
          </div>

          <div className="csb-kpi">
            <div className="csb-kpi__label">
              Sin salidas de video
            </div>

            <div className="csb-kpi__value">
              {
                diagnostics.missingVideoCount
              }
            </div>
          </div>

        </div>

        {/* =================================================
            FILTERS
        ================================================= */}

        <div className="csb-toolbar">

          <div className="csb-filters">

            {[
              [
                "attention",
                "Requieren atención",
              ],

              [
                "missing_data",
                "Faltan datos",
              ],

              [
                "missing_wifi",
                "Wi-Fi",
              ],

              [
                "missing_video",
                "Salidas de video",
              ],

              [
                "no_monitor",
                "Sin compatibilidad",
              ],

              [
                "ready",
                "Listos",
              ],

              [
                "all",
                "Todos",
              ],
            ].map(
              ([
                value,
                label,
              ]) => (
                <button
                  key={
                    value
                  }
                  type="button"
                  className={
                    filter ===
                    value
                      ? "csb-filter csb-filter--active"
                      : "csb-filter"
                  }
                  onClick={() =>
                    changeFilter(
                      value,
                    )
                  }
                >
                  {label}
                </button>
              ),
            )}

          </div>

          <input
            className="csb-search"
            type="search"
            value={
              search
            }
            placeholder="Buscar por producto o SKU"
            onChange={(
              event,
            ) =>
              setSearch(
                event.target.value,
              )
            }
          />

        </div>

        {/* =================================================
            LIST
        ================================================= */}

        {visibleProducts.length ===
        0 ? (
          <div className="csb-empty">
            No hay productos que coincidan con este filtro.
          </div>
        ) : (
          <div className="csb-list">

            {visibleProducts.map(
              (product) => {
                const ready =
                  product.bundlePossible;

                const editUrl =
                  `https://${shopDomain}/admin/products/${productNumericId(
                    product.id,
                  )}`;

                return (
                  <div
                    key={
                      product.id
                    }
                    className={
                      ready
                        ? "csb-product csb-product--ready"
                        : "csb-product csb-product--problem"
                    }
                  >

                    <div>

                      <div className="csb-product__title">
                        {
                          product.title
                        }
                      </div>

                      <div className="csb-product__sku">
                        SKU:{" "}
                        {
                          product.sku ??
                          "Sin SKU"
                        }
                      </div>

                      <div className="csb-meta">

                        <span className="csb-chip">
                          Stock{" "}
                          {
                            product.totalInventory
                          }
                        </span>

                        <span
                          className={
                            product.wifi ===
                            "Sin informar"
                              ? "csb-chip csb-chip--warning"
                              : "csb-chip"
                          }
                        >
                          Wi-Fi:{" "}
                          {
                            product.wifi
                          }
                        </span>

                        <span
                          className={
                            product.videoOutputs.length ===
                            0
                              ? "csb-chip csb-chip--warning"
                              : "csb-chip"
                          }
                        >
                          Salidas:{" "}
                          {product.videoOutputs.length >
                          0
                            ? product.videoOutputs.join(
                                ", ",
                              )
                            : "Sin informar"}
                        </span>

                        <span
                          className={
                            ready
                              ? "csb-chip csb-chip--success"
                              : "csb-chip csb-chip--warning"
                          }
                        >
                          {
                            getStatusLabel(
                              product,
                            )
                          }
                        </span>

                      </div>

                    </div>

                    <div>

                      {ready ? (
                        <div className="csb-ready-message">
                          ✓ Producto listo para generar bundle
                        </div>
                      ) : (
                        <ul className="csb-problem-list">

                          {product.problems.map(
                            (
                              problem,
                              index,
                            ) => (
                              <li
                                className="csb-problem"
                                key={`${product.id}-${index}`}
                              >
                                {
                                  problem
                                }
                              </li>
                            ),
                          )}

                        </ul>
                      )}

                    </div>

                    <a
                      className="csb-edit"
                      href={
                        editUrl
                      }
                      target="_top"
                    >
                      Editar producto
                    </a>

                  </div>
                );
              },
            )}

          </div>
        )}

      </div>

    </s-page>
  );
}

/* =========================================================
   HEADERS
========================================================= */

export const headers:
  HeadersFunction = (
    headersArgs,
  ) => {
    return boundary.headers(
      headersArgs,
    );
  };