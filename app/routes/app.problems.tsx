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
  type ProductDiagnostic,
} from "../lib/bundle-diagnostics.server";

import {
  loadCachedBundleDiagnostics,
  loadCachedBundleReadiness,
  loadCachedBundleRuntimeSettings,
  loadCachedBundleTemplateCatalog,
} from "../lib/bundle-cache.server";

import { buildTemplateBundleState } from "../lib/bundle-template-engine";

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

    const [diagnostics, catalog, runtime] = await Promise.all([
      loadCachedBundleDiagnostics(admin, session.shop),
      loadCachedBundleTemplateCatalog(admin, session.shop),
      loadCachedBundleRuntimeSettings(admin, session.shop),
    ]);

    const state = buildTemplateBundleState(
      catalog.products,
      catalog.templates,
      runtime.componentConfig,
    );

    const additionalComponents = [
      ...state.eligibleBaseProducts.map((product) => ({
        id: product.id, role: "PC",
      })),
      ...state.multiVariantBaseProducts.map((product) => ({
        id: product.id, role: "PC",
      })),
      ...runtime.componentConfig.selectedMonitorIds.map((id) => ({
        id, role: "Monitor",
      })),
      ...runtime.componentConfig.selectedKeyboardMouseIds.map((id) => ({
        id, role: "Teclado y mouse",
      })),
      ...runtime.componentConfig.selectedWifiAdapterIds.map((id) => ({
        id, role: "Adaptador Wi-Fi",
      })),
    ];

    const readiness = await loadCachedBundleReadiness(
      admin,
      session.shop,
      state.candidates,
      additionalComponents,
    );

    return {
      diagnostics,
      readiness,
      shopDomain: session.shop,
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
    return "Sin Bundles";
  }

  return "Listo";
}

/* =========================================================
   COMPONENT
========================================================= */

export default function Problems() {
  const {
    diagnostics,
    readiness,
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
      "component_data",
      "missing_weight",
      "no_monitor",
      "ready",
    ].includes(
      rawFilter,
    )
      ? rawFilter
      : "attention";

  const componentProblems = useMemo(() => {
    const grouped = new Map<string, {
      id: string;
      title: string;
      role: string;
      messages: string[];
      codes: string[];
      affectedPcIds: Set<string>;
    }>();

    // Count affected PC proposals separately from the product itself.
    const affectedByComponent = new Map<string, Set<string>>();
    for (const issue of readiness.issues) {
      const bases = affectedByComponent.get(issue.componentId) ?? new Set<string>();
      bases.add(issue.baseProductId);
      affectedByComponent.set(issue.componentId, bases);
    }

    for (const issue of readiness.productIssues) {
      const existing = grouped.get(issue.componentId) ?? {
        id: issue.componentId,
        title: issue.componentTitle,
        role: issue.role,
        messages: [],
        codes: [],
        affectedPcIds: affectedByComponent.get(issue.componentId) ?? new Set<string>(),
      };

      if (!existing.messages.includes(issue.message)) {
        existing.messages.push(issue.message);
      }
      if (!existing.codes.includes(issue.code)) {
        existing.codes.push(issue.code);
      }
      grouped.set(issue.componentId, existing);
    }

    return Array.from(grouped.values()).sort((a, b) =>
      a.title.localeCompare(b.title, "es"),
    );
  }, [readiness.productIssues, readiness.issues]);

  const visibleComponentProblems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("es");
    return componentProblems.filter((item) => {
      if (filter === "missing_weight" && !item.codes.includes("missing_weight")) {
        return false;
      }

      if (
        filter === "missing_data" &&
        !item.codes.some((code) =>
          ["missing_weight", "missing_sku", "missing_price"].includes(code),
        )
      ) {
        return false;
      }

      return (
        !query ||
        item.title.toLocaleLowerCase("es").includes(query) ||
        item.role.toLocaleLowerCase("es").includes(query) ||
        item.messages.some((message) =>
          message.toLocaleLowerCase("es").includes(query),
        )
      );
    });
  }, [componentProblems, filter, search]);

  const showComponentProblems =
    ["attention", "all", "component_data", "missing_data", "missing_weight"].includes(filter);

  const missingInformationCount = new Set([
    ...diagnostics.products
      .filter((product) => product.status === "missing_data")
      .map((product) => product.id),
    ...componentProblems
      .filter((product) => product.codes.some((code) =>
        ["missing_weight", "missing_sku", "missing_price"].includes(code),
      ))
      .map((product) => product.id),
  ]).size;

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
        "component_data"
      ) {
        result = [];
      }

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
    <s-page
      heading="Productos con problemas"
      inlineSize="large"
    >

      <s-stack gap="base">

        <s-section>

          <s-paragraph>
            Detecta qué información o componente impide generar Bundles para cada PC.
          </s-paragraph>

        </s-section>

        <s-query-container>

          <s-grid
            gridTemplateColumns="@container (inline-size > 1050px) repeat(5, 1fr), @container (inline-size > 620px) repeat(3, 1fr), repeat(2, 1fr)"
            gap="base"
          >

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
                  Bundles posibles
                </s-text>
                <s-heading>
                  {
                    diagnostics.bundlePossibleCount
                  }
                </s-heading>
              </s-stack>
            </s-section>

            <s-section>
              <s-stack gap="small">
                <s-text tone="neutral">
                  Faltan datos
                </s-text>
                <s-heading>
                  {
                    missingInformationCount
                  }
                </s-heading>
              </s-stack>
            </s-section>

            <s-section>
              <s-stack gap="small">
                <s-text tone="neutral">
                  Sin Wi-Fi informado
                </s-text>
                <s-heading>
                  {
                    diagnostics.missingWifiCount
                  }
                </s-heading>
              </s-stack>
            </s-section>

            <s-section>
              <s-stack gap="small">
                <s-text tone="neutral">
                  Sin salidas de video
                </s-text>
                <s-heading>
                  {
                    diagnostics.missingVideoCount
                  }
                </s-heading>
              </s-stack>
            </s-section>

          </s-grid>

        </s-query-container>

            <s-query-container >

              <s-grid
                gridTemplateColumns="@container (inline-size > 700px) minmax(0, 1fr) minmax(190px, 250px), 1fr"
                gap="small"
              >

                <s-text-field
                  label="Buscar producto"
                  labelAccessibilityVisibility="exclusive"
                  icon="search"
                  placeholder="Buscar por producto o SKU"
                  value={
                    search
                  }
                  onInput={(event) =>
                    setSearch(
                      event.currentTarget.value,
                    )
                  }
                />

                <s-select
                  label="Filtrar por estado"
                  labelAccessibilityVisibility="exclusive"
                  value={
                    filter
                  }
                  onChange={(event) =>
                    changeFilter(
                      event.currentTarget.value,
                    )
                  }
                >
                  <s-option value="attention">
                    Requieren atención
                  </s-option>
                  <s-option value="missing_data">
                    Faltan datos
                  </s-option>
                  <s-option value="missing_wifi">
                    Wi-Fi
                  </s-option>
                  <s-option value="missing_video">
                    Salidas de video
                  </s-option>
                  <s-option value="component_data">
                    Datos de componentes
                  </s-option>
                  <s-option value="missing_weight">
                    Falta peso
                  </s-option>
                  <s-option value="no_monitor">
                    Sin compatibilidad
                  </s-option>
                  <s-option value="ready">
                    Listos
                  </s-option>
                  <s-option value="all">
                    Todos
                  </s-option>
                </s-select>

              </s-grid>

            </s-query-container>

        {readiness.errors.length > 0 && (
          <s-banner heading="No se pudo verificar el estado de los componentes" tone="critical">
            <s-paragraph>
              No se considerarán listos los Bundles hasta validar esta información.
              {readiness.errors.join(" · ")}
            </s-paragraph>
          </s-banner>
        )}

        {showComponentProblems && (
          <s-section heading={`Productos que requieren corrección (${visibleComponentProblems.length})`}>
            <s-stack gap="base">
              <s-paragraph>
                Información que impide crear Bundles. Se revisan los PC elegibles y
                los componentes autorizados, incluso si aún no existe una propuesta.
                Corrige cada producto directamente en Shopify.
              </s-paragraph>
              {visibleComponentProblems.length > 0 ? (
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Componente</s-table-header>
                    <s-table-header listSlot="labeled">Problema</s-table-header>
                    <s-table-header listSlot="labeled" format="numeric">PC afectados</s-table-header>
                    <s-table-header listSlot="secondary">Acción</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {visibleComponentProblems.map((item) => (
                      <s-table-row key={item.id}>
                        <s-table-cell>
                          <s-stack gap="small">
                            <s-text>{item.title}</s-text>
                            <s-text tone="neutral">{item.role}</s-text>
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell>
                          <s-text tone="warning">
                            {item.messages.join(" · ")}
                          </s-text>
                        </s-table-cell>
                        <s-table-cell>{item.affectedPcIds.size || "—"}</s-table-cell>
                        <s-table-cell>
                          <s-button
                            variant="tertiary"
                            href={`shopify:admin/products/${productNumericId(item.id)}`}
                          >
                            Corregir en Shopify
                          </s-button>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              ) : (
                <s-text tone="neutral">
                  {readiness.errors.length > 0
                    ? "No fue posible comprobar los componentes."
                    : "No hay componentes con información faltante."}
                </s-text>
              )}
            </s-stack>
          </s-section>
        )}

        {filter !== "component_data" && filter !== "missing_weight" && (
        <s-section
          padding="none"
          accessibilityLabel="Diagnóstico de productos"
        >

          <s-table>



            <s-table-header-row>

              <s-table-header listSlot="primary">
                Producto
              </s-table-header>

              <s-table-header
                listSlot="labeled"
                format="numeric"
              >
                Stock
              </s-table-header>

              <s-table-header listSlot="labeled">
                Wi-Fi
              </s-table-header>

              <s-table-header listSlot="labeled">
                Salidas
              </s-table-header>

              <s-table-header listSlot="inline">
                Estado
              </s-table-header>

              <s-table-header listSlot="secondary">
                Acción
              </s-table-header>

            </s-table-header-row>

            <s-table-body>

              {visibleProducts.map(
                (product) => {
                  const ready =
                    product.bundlePossible;

                  const editUrl =
                    `shopify:admin/products/${productNumericId(
                      product.id,
                    )}`;

                  return (
                    <s-table-row
                      key={
                        product.id
                      }
                    >

                      <s-table-cell>

                        <s-stack gap="small">

                          <s-text>
                            {
                              product.title
                            }
                          </s-text>

                          <s-text tone="neutral">
                            SKU:{" "}
                            {
                              product.sku ??
                              "Sin SKU"
                            }
                          </s-text>

                          {!ready &&
                            product.problems.length >
                              0 && (
                            <s-text tone="warning">
                              {
                                product.problems.join(
                                  " · ",
                                )
                              }
                            </s-text>
                          )}

                        </s-stack>

                      </s-table-cell>

                      <s-table-cell>
                        {
                          product.totalInventory
                        }
                      </s-table-cell>

                      <s-table-cell>
                        <s-badge
                          tone={
                            product.wifi ===
                            "Sin informar"
                              ? "warning"
                              : "neutral"
                          }
                        >
                          {
                            product.wifi
                          }
                        </s-badge>
                      </s-table-cell>

                      <s-table-cell>
                        {product.videoOutputs.length >
                        0
                          ? product.videoOutputs.join(
                              ", ",
                            )
                          : (
                            <s-badge tone="warning">
                              Sin informar
                            </s-badge>
                          )}
                      </s-table-cell>

                      <s-table-cell>
                        <s-badge
                          tone={
                            ready
                              ? "success"
                              : "warning"
                          }
                        >
                          {
                            getStatusLabel(
                              product,
                            )
                          }
                        </s-badge>
                      </s-table-cell>

                      <s-table-cell>

                        <s-button
                          variant="tertiary"
                          href={
                            editUrl
                          }
                        >
                          Editar
                        </s-button>

                      </s-table-cell>

                    </s-table-row>
                  );
                },
              )}

            </s-table-body>

          </s-table>

          {visibleProducts.length ===
            0 && (
            <s-box padding="large">

              <s-stack
                alignItems="center"
                gap="small"
              >
                <s-text>
                  No hay productos que coincidan con este filtro.
                </s-text>
              </s-stack>

            </s-box>
          )}

          <s-box padding="small">
            <s-text tone="neutral">
              {visibleProducts.length} producto(s)
            </s-text>
          </s-box>

        </s-section>
        )}

      </s-stack>

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