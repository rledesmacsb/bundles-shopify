import { useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  loadCachedBundleDiagnostics,
  loadCachedBundleReadiness,
  loadCachedBundleRuntimeSettings,
  loadCachedBundleTemplateCatalog,
} from "../lib/bundle-cache.server";
import { buildTemplateBundleState } from "../lib/bundle-template-engine";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

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
      id: product.id,
      role: "PC",
    })),
    ...state.multiVariantBaseProducts.map((product) => ({
      id: product.id,
      role: "PC",
    })),
    ...runtime.componentConfig.selectedMonitorIds.map((id) => ({
      id,
      role: "Monitor",
    })),
    ...runtime.componentConfig.selectedKeyboardMouseIds.map((id) => ({
      id,
      role: "Teclado y mouse",
    })),
    ...runtime.componentConfig.selectedWifiAdapterIds.map((id) => ({
      id,
      role: "Adaptador Wi-Fi",
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
    candidateIds: state.candidates.map((candidate) => candidate.id),
  };
};

type ProblemRow = {
  id: string;
  title: string;
  sku: string | null;
  role: string;
  stock: number | null;
  codes: string[];
  messages: string[];
  hasPcDiagnostic: boolean;
};

const DATA_CODES = [
  "missing_wifi",
  "missing_video",
  "missing_weight",
  "missing_sku",
  "missing_price",
];

const FILTERS = [
  "attention",
  "missing_data",
  "missing_weight",
  "missing_wifi",
  "missing_video",
  "component_data",
  "no_monitor",
  "ready",
  "all",
] as const;

type ProblemFilter = (typeof FILTERS)[number];

function productNumericId(gid: string) {
  return gid.split("/").pop() ?? "";
}

export default function Problems() {
  const { diagnostics, readiness, candidateIds } =
    useLoaderData<typeof loader>();

  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("q") ?? "");

  const filterValue = searchParams.get("filter") ?? "attention";
  const filter: ProblemFilter = FILTERS.includes(filterValue as ProblemFilter)
    ? (filterValue as ProblemFilter)
    : "attention";

  // Join product-level diagnostic data and bundle component validation
  // by Shopify product ID. One product occupies exactly one row.
  const rows = useMemo(() => {
    const mapped = new Map<string, {
      id: string;
      title: string;
      sku: string | null;
      role: string;
      stock: number | null;
      codes: Set<string>;
      messages: Set<string>;
      hasPcDiagnostic: boolean;
    }>();

    for (const product of diagnostics.products) {
      mapped.set(product.id, {
        id: product.id,
        title: product.title,
        sku: product.sku,
        role: "PC",
        stock: product.totalInventory,
        codes: new Set(product.problemCodes),
        messages: new Set(product.problems),
        hasPcDiagnostic: true,
      });
    }

    for (const issue of readiness.productIssues) {
      // Stock is an availability constraint, not incomplete product data.
      // Keep this check in readiness/creation; do not label it a problem.
      if (issue.code === "out_of_stock") continue;

      const previous = mapped.get(issue.componentId);
      if (previous) {
        previous.codes.add(issue.code);
        previous.messages.add(issue.message);
        if (!previous.sku && issue.componentSku) {
          previous.sku = issue.componentSku;
        }
        if (previous.stock == null) {
          previous.stock = issue.componentStock;
        }
      } else {
        mapped.set(issue.componentId, {
          id: issue.componentId,
          title: issue.componentTitle,
          sku: issue.componentSku,
          role: issue.role,
          stock: issue.componentStock,
          codes: new Set([issue.code]),
          messages: new Set([issue.message]),
          hasPcDiagnostic: false,
        });
      }
    }

    return Array.from(mapped.values())
      .map((product): ProblemRow => ({
        ...product,
        codes: [...product.codes],
        messages: [...product.messages],
      }))
      .sort((a, b) => {
        const difference = Number(b.messages.length > 0) -
          Number(a.messages.length > 0);
        return difference || a.title.localeCompare(b.title, "es");
      });
  }, [diagnostics.products, readiness.productIssues]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("es");
    return rows.filter((row) => {
      const codes = row.codes;
      const hasProblems = row.messages.length > 0;
      const filterMatches = (() => {
        switch (filter) {
          case "attention":
            return hasProblems;
          case "missing_data":
            return codes.some((code) => DATA_CODES.includes(code));
          case "missing_weight":
            return codes.includes("missing_weight");
          case "missing_wifi":
            return codes.includes("missing_wifi");
          case "missing_video":
            return codes.includes("missing_video");
          case "component_data":
            return readiness.productIssues.some(
              (issue) =>
                issue.componentId === row.id &&
                issue.code !== "out_of_stock",
            );
          case "no_monitor":
            return codes.includes("no_compatible_monitor");
          case "ready":
            return row.hasPcDiagnostic && !hasProblems;
          default:
            return true;
        }
      })();

      if (!filterMatches) return false;
      if (!query) return true;
      return [
        row.title,
        row.sku ?? "",
        row.role,
        ...row.messages,
      ].some((text) => text.toLocaleLowerCase("es").includes(query));
    });
  }, [rows, filter, search, readiness.productIssues]);

  const missingDataCount = rows.filter((row) =>
    row.codes.some((code) => DATA_CODES.includes(code)),
  ).length;

  const missingWeightCount = rows.filter((row) =>
    row.codes.includes("missing_weight"),
  ).length;

  const blockedCandidateIds = new Set(
    readiness.issues.map((issue) => issue.candidateId),
  );

  const readyBundleCount = readiness.errors.length > 0
    ? 0
    : candidateIds.filter((id) => !blockedCandidateIds.has(id)).length;

  function changeFilter(nextFilter: string) {
    const next = new URLSearchParams(searchParams);
    next.set("filter", nextFilter);
    setSearchParams(next);
  }

  return (
    <s-page heading="Productos con problemas" inlineSize="large">
      <s-stack gap="base">
        <style>{`
          .csb-problems-metrics {
            display: grid;
            grid-template-columns: repeat(6, minmax(0, 1fr));
            gap: 12px;
          }
          .csb-problems-metric {
            min-width: 0;
            min-height: 92px;
            padding: 15px 16px;
            border: 1px solid #e3e3e3;
            border-radius: 10px;
            background: var(--p-color-bg-surface, #fff);
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            gap: 14px;
          }
          .csb-problems-metric-label {
            color: var(--p-color-text-secondary, #626262);
            font-size: 13px;
            line-height: 1.35;
          }
          .csb-problems-metric-value {
            color: var(--p-color-text, #303030);
            font-size: 24px;
            line-height: 1;
            font-weight: 650;
            font-variant-numeric: tabular-nums;
          }
          .csb-problems-filters {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(210px, 265px);
            gap: 12px;
            align-items: end;
          }
          .csb-problems-filters > * {
            min-width: 0;
            width: 100%;
          }
          .csb-problems-product {
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 5px;
          }
          .csb-problems-issues {
            display: flex;
            flex-direction: column;
            gap: 5px;
          }
          @media (max-width: 1220px) {
            .csb-problems-metrics {
              grid-template-columns: repeat(3, minmax(0, 1fr));
            }
          }
          @media (max-width: 680px) {
            .csb-problems-metrics {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
            .csb-problems-filters {
              grid-template-columns: 1fr;
            }
          }
          @media (max-width: 360px) {
            .csb-problems-metrics {
              grid-template-columns: 1fr;
            }
          }
        `}</style>

        <s-section>
          <s-paragraph>
            Revisa en una sola lista la información que impide crear Bundles.
            Cada producto aparece una vez, con los problemas pendientes y
            acceso directo para corregirlo en Shopify.
          </s-paragraph>
        </s-section>

        <div className="csb-problems-metrics" aria-label="Resumen de problemas">
          {([
            ["PC con stock", diagnostics.totalPcWithStock],
            ["Bundles listos", readyBundleCount],
            ["Faltan datos", missingDataCount],
            ["Sin peso", missingWeightCount],
            ["Wi-Fi sin informar", diagnostics.missingWifiCount],
            ["Salidas sin informar", diagnostics.missingVideoCount],
          ] as Array<[string, number]>).map(([label, value]) => (
            <div className="csb-problems-metric" key={label}>
              <span className="csb-problems-metric-label">{label}</span>
              <span className="csb-problems-metric-value">{value}</span>
            </div>
          ))}
        </div>

        <div className="csb-problems-filters">
          <s-text-field
            label="Buscar producto"
            labelAccessibilityVisibility="exclusive"
            icon="search"
            placeholder="Buscar por producto o SKU"
            value={search}
            onInput={(event) => setSearch(event.currentTarget.value)}
          />
          <s-select
            label="Filtrar por estado"
            labelAccessibilityVisibility="exclusive"
            value={filter}
            onChange={(event) => changeFilter(event.currentTarget.value)}
          >
            <s-option value="attention">Requieren atención</s-option>
            <s-option value="missing_data">Faltan datos</s-option>
            <s-option value="missing_weight">Falta peso</s-option>
            <s-option value="missing_wifi">Wi-Fi</s-option>
            <s-option value="missing_video">Salidas de video</s-option>
            <s-option value="component_data">Datos de componentes</s-option>
            <s-option value="no_monitor">Sin compatibilidad</s-option>
            <s-option value="ready">Listos</s-option>
            <s-option value="all">Todos</s-option>
          </s-select>
        </div>

        {readiness.errors.length > 0 && (
          <s-banner
            heading="No se pudo verificar el estado de los componentes"
            tone="critical"
          >
            <s-paragraph>
              No se considerarán listos los Bundles hasta validar esta información.
              {readiness.errors.join(" · ")}
            </s-paragraph>
          </s-banner>
        )}

        <s-section padding="none" accessibilityLabel="Diagnóstico de productos">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Producto</s-table-header>
              <s-table-header listSlot="labeled">Tipo</s-table-header>
              <s-table-header listSlot="labeled" format="numeric">Stock</s-table-header>
              <s-table-header listSlot="labeled">Problemas detectados</s-table-header>
              <s-table-header listSlot="inline">Estado</s-table-header>
              <s-table-header listSlot="secondary">Acción</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {visibleRows.map((product) => {
                const needsAttention = product.messages.length > 0;
                return (
                  <s-table-row key={product.id}>
                    <s-table-cell>
                      <div className="csb-problems-product">
                        <s-text>{product.title}</s-text>
                        <s-text tone="neutral">
                          SKU: {product.sku || "Sin SKU"}
                        </s-text>
                      </div>
                    </s-table-cell>

                    <s-table-cell>{product.role}</s-table-cell>

                    <s-table-cell>
                      {product.stock === null ? "—" : product.stock}
                    </s-table-cell>

                    <s-table-cell>
                      {needsAttention ? (
                        <div className="csb-problems-issues">
                          {product.messages.map((message, index) => (
                            <s-text key={index} tone="warning">
                              {message}
                            </s-text>
                          ))}
                        </div>
                      ) : (
                        <s-text tone="neutral">Sin problemas detectados</s-text>
                      )}
                    </s-table-cell>

                    <s-table-cell>
                      <s-badge tone={needsAttention ? "warning" : "success"}>
                        {needsAttention ? "Requiere corrección" : "Listo"}
                      </s-badge>
                    </s-table-cell>

                    <s-table-cell>
                      <s-button
                        variant="tertiary"
                        href={`shopify:admin/products/${productNumericId(product.id)}`}
                      >
                        Editar en Shopify
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>

          {visibleRows.length === 0 && (
            <s-box padding="large">
              <s-text tone="neutral">
                {readiness.errors.length > 0
                  ? "No se pudo completar la revisión de los componentes."
                  : "No hay productos que coincidan con este filtro."}
              </s-text>
            </s-box>
          )}

          <s-box padding="small">
            <s-text tone="neutral">
              {visibleRows.length} producto(s)
            </s-text>
          </s-box>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
