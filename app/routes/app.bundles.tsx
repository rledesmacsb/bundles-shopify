import {
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";

import {
  useFetcher,
  useLoaderData,
} from "react-router";

import {
  boundary,
} from "@shopify/shopify-app-react-router/server";

import {
  useAppBridge,
} from "@shopify/app-bridge-react";

import {
  authenticate,
} from "../shopify.server";

import {
  formatPrice,
} from "../lib/bundle-engine";

import {
  buildTemplateBundleState,
  calculateTemplateCandidatePrice,
  getFirstTemplateVariant,
  getTemplateCandidateStock,
} from "../lib/bundle-template-engine";

import {
  loadBundleTemplateCatalog,
} from "../lib/bundle-template-catalog.server";

import {
  loadBundleRuntimeSettings,
} from "../lib/bundle-runtime-settings.server";

import {
  loadExistingPcMonitorBundleMatches,
  type ExistingBundleLookupStatus,
} from "../lib/bundle-existing.server";

import {
  loadPcMonitorManualExcludedProductIds,
  savePcMonitorManualExcludedProductIds,
} from "../lib/bundle-data.server";

import {
  createDraftBundleFromCandidate,
} from "../lib/bundle-create.server";

/* =========================================================
   LOADER
========================================================= */

export const loader =
  async ({
    request,
  }: LoaderFunctionArgs) => {
    const {
      admin,
    } =
      await authenticate.admin(
        request,
      );

    /*
     * Sequential intentionally.
     */
    const catalog =
      await loadBundleTemplateCatalog(
        admin,
      );

    const runtime =
      await loadBundleRuntimeSettings(
        admin,
      );

    const state =
      buildTemplateBundleState(
        catalog.products,
        catalog.templates,
        runtime.componentConfig,
      );

    const existingBundleMatches =
      await loadExistingPcMonitorBundleMatches(
        admin,
        state.candidates,
      );

    return {
      catalog,

      runtime,

      existingBundleMatches,
    };
  };

/* =========================================================
   ACTION
========================================================= */

export const action =
  async ({
    request,
  }: ActionFunctionArgs) => {
    const {
      admin,
    } =
      await authenticate.admin(
        request,
      );

    const formData =
      await request.formData();

    const intent =
      String(
        formData.get(
          "intent",
        ) ??
          "",
      );

    /* -----------------------------------------------------
       CREATE ONE DRAFT

       The browser sends only candidateId.
       The server rebuilds and validates the candidate before
       any Shopify mutation is allowed.
    ----------------------------------------------------- */

    if (
      intent ===
      "create_draft"
    ) {
      const candidateId =
        String(
          formData.get(
            "candidateId",
          ) ??
            "",
        ).trim();

      if (
        !candidateId
      ) {
        return {
          success:
            false,

          message:
            "No se recibió la propuesta a crear.",
        };
      }

      return createDraftBundleFromCandidate(
        admin,
        candidateId,
      );
    }

    /* -----------------------------------------------------
       MANUAL BASE-PC EXCLUSION
    ----------------------------------------------------- */

    if (
      intent !==
        "exclude" &&
      intent !==
        "include"
    ) {
      return {
        success:
          false,

        message:
          "Acción no válida.",
      };
    }

    const productId =
      String(
        formData.get(
          "productId",
        ) ??
          "",
      ).trim();

    if (
      !productId
    ) {
      return {
        success:
          false,

        message:
          "No se recibió el producto.",
      };
    }

    const currentIds =
      await loadPcMonitorManualExcludedProductIds(
        admin,
      );

    const nextIds =
      new Set(
        currentIds,
      );

    if (
      intent ===
      "exclude"
    ) {
      nextIds.add(
        productId,
      );
    } else {
      nextIds.delete(
        productId,
      );
    }

    const result =
      await savePcMonitorManualExcludedProductIds(
        admin,
        Array.from(
          nextIds,
        ),
      );

    if (
      !result.success
    ) {
      return result;
    }

    return {
      success:
        true,

      message:
        intent ===
        "exclude"
          ? "Producto excluido de todas las plantillas."
          : "Producto incluido nuevamente.",
    };
  };

/* =========================================================
   FILTER
========================================================= */

type BundleFilter =
  | "all"
  | "new"
  | "existing"
  | "review"
  | "excluded"
  | `template:${string}`;

/* =========================================================
   STATUS
========================================================= */

function getStatusLabel(
  status:
    ExistingBundleLookupStatus,
) {
  switch (
    status
  ) {
    case "new":
      return "Nuevo";

    case "existing_managed":
      return "Ya existe";

    case "existing_legacy":
      return "Existente legado";

    case "sku_conflict":
      return "Conflicto SKU";

    case "missing_base_sku":
      return "Falta SKU";

    case "lookup_error":
      return "Error";

    default:
      return "Revisar";
  }
}

function getStatusClass(
  status:
    ExistingBundleLookupStatus,
) {
  switch (
    status
  ) {
    case "new":
      return "csb-status csb-status--new";

    case "existing_managed":
      return "csb-status csb-status--existing";

    case "existing_legacy":
      return "csb-status csb-status--legacy";

    case "sku_conflict":
    case "missing_base_sku":
      return "csb-status csb-status--warning";

    case "lookup_error":
      return "csb-status csb-status--error";

    default:
      return "csb-status";
  }
}

function isReviewStatus(
  status:
    ExistingBundleLookupStatus,
) {
  return (
    status ===
      "sku_conflict" ||
    status ===
      "missing_base_sku" ||
    status ===
      "lookup_error"
  );
}

/* =========================================================
   COMPONENT
========================================================= */

export default function Bundles() {
  const data =
    useLoaderData<
      typeof loader
    >();

  const fetcher =
    useFetcher<
      typeof action
    >();

  const shopify =
    useAppBridge();

  const [
    search,
    setSearch,
  ] =
    useState(
      "",
    );

  const [
    filter,
    setFilter,
  ] =
    useState<
      BundleFilter
    >(
      "all",
    );

  useEffect(() => {
    if (
      fetcher.data?.message
    ) {
      shopify.toast.show(
        fetcher.data.message,
      );
    }
  }, [
    fetcher.data,
    shopify,
  ]);

  /* =======================================================
     GENERIC TEMPLATE ENGINE
  ======================================================= */

  const state =
    useMemo(
      () =>
        buildTemplateBundleState(
          data.catalog.products,
          data.catalog.templates,
          data.runtime.componentConfig,
        ),
      [
        data.catalog.products,
        data.catalog.templates,
        data.runtime.componentConfig,
      ],
    );

  const matchByCandidateId =
    useMemo(
      () =>
        new Map(
          data
            .existingBundleMatches
            .matches
            .map(
              (match) => [
                match.candidateId,
                match,
              ],
            ),
        ),
      [
        data
          .existingBundleMatches
          .matches,
      ],
    );

  /* =======================================================
     SORT BY FINAL COMMERCIAL PRICE
  ======================================================= */

  const sortedCandidates =
    useMemo(
      () =>
        [
          ...state.candidates,
        ].sort(
          (
            a,
            b,
          ) => {
            const priceA =
              calculateTemplateCandidatePrice(
                a,
                data.runtime.priceConfig,
              ).finalPrice;

            const priceB =
              calculateTemplateCandidatePrice(
                b,
                data.runtime.priceConfig,
              ).finalPrice;

            if (
              priceA !==
              priceB
            ) {
              return (
                priceA -
                priceB
              );
            }

            return a.identity.title.localeCompare(
              b.identity.title,
              "es",
            );
          },
        ),
      [
        state.candidates,
        data.runtime.priceConfig,
      ],
    );

  /* =======================================================
     COUNTS
  ======================================================= */

  const newCount =
    data
      .existingBundleMatches
      .matches
      .filter(
        (match) =>
          match.status ===
          "new",
      )
      .length;

  const existingCount =
    data
      .existingBundleMatches
      .matches
      .filter(
        (match) =>
          match.status ===
            "existing_managed" ||
          match.status ===
            "existing_legacy",
      )
      .length;

  const reviewMatchCount =
    data
      .existingBundleMatches
      .matches
      .filter(
        (match) =>
          isReviewStatus(
            match.status,
          ),
      )
      .length;

  const reviewCount =
    reviewMatchCount +
    state
      .multiVariantBaseProducts
      .length;

  const excludedCount =
    state
      .manuallyExcludedProducts
      .length +
    state
      .automaticallyExcludedProducts
      .length;

  /* =======================================================
     VISIBLE CANDIDATES
  ======================================================= */

  const visibleCandidates =
    useMemo(
      () => {
        if (
          filter ===
          "excluded"
        ) {
          return [];
        }

        const query =
          search
            .trim()
            .toLocaleLowerCase(
              "es",
            );

        return sortedCandidates.filter(
          (candidate) => {
            const match =
              matchByCandidateId.get(
                candidate.id,
              );

            if (
              !match
            ) {
              return false;
            }

            if (
              filter ===
                "new" &&
              match.status !==
                "new"
            ) {
              return false;
            }

            if (
              filter ===
                "existing" &&
              match.status !==
                "existing_managed" &&
              match.status !==
                "existing_legacy"
            ) {
              return false;
            }

            if (
              filter ===
                "review" &&
              !isReviewStatus(
                match.status,
              )
            ) {
              return false;
            }

            if (
              filter.startsWith(
                "template:",
              )
            ) {
              const templateId =
                filter.slice(
                  "template:".length,
                );

              if (
                candidate.templateId !==
                templateId
              ) {
                return false;
              }
            }

            if (
              !query
            ) {
              return true;
            }

            const baseSku =
              getFirstTemplateVariant(
                candidate.baseProduct,
              )?.sku ??
              "";

            const monitorSku =
              getFirstTemplateVariant(
                candidate.monitor,
              )?.sku ??
              "";

            return (
              candidate.identity.title
                .toLocaleLowerCase(
                  "es",
                )
                .includes(
                  query,
                ) ||
              candidate.identity.sku
                .toLocaleLowerCase(
                  "es",
                )
                .includes(
                  query,
                ) ||
              candidate.templateName
                .toLocaleLowerCase(
                  "es",
                )
                .includes(
                  query,
                ) ||
              baseSku
                .toLocaleLowerCase(
                  "es",
                )
                .includes(
                  query,
                ) ||
              monitorSku
                .toLocaleLowerCase(
                  "es",
                )
                .includes(
                  query,
                )
            );
          },
        );
      },
      [
        sortedCandidates,
        matchByCandidateId,
        search,
        filter,
      ],
    );

  /* =======================================================
     REVIEW: MULTI VARIANT
  ======================================================= */

  const visibleMultiVariant =
    useMemo(
      () => {
        if (
          filter !==
            "all" &&
          filter !==
            "review"
        ) {
          return [];
        }

        const query =
          search
            .trim()
            .toLocaleLowerCase(
              "es",
            );

        return state
          .multiVariantBaseProducts
          .filter(
            (product) =>
              !query ||
              product.title
                .toLocaleLowerCase(
                  "es",
                )
                .includes(
                  query,
                ),
          );
      },
      [
        state
          .multiVariantBaseProducts,
        search,
        filter,
      ],
    );

  /* =======================================================
     EXCLUDED
  ======================================================= */

  const visibleManualExcluded =
    useMemo(
      () => {
        if (
          filter !==
          "excluded"
        ) {
          return [];
        }

        const query =
          search
            .trim()
            .toLocaleLowerCase(
              "es",
            );

        return state
          .manuallyExcludedProducts
          .filter(
            (product) => {
              const sku =
                getFirstTemplateVariant(
                  product,
                )?.sku ??
                "";

              return (
                !query ||
                product.title
                  .toLocaleLowerCase(
                    "es",
                  )
                  .includes(
                    query,
                  ) ||
                sku
                  .toLocaleLowerCase(
                    "es",
                  )
                  .includes(
                    query,
                  )
              );
            },
          );
      },
      [
        state
          .manuallyExcludedProducts,
        search,
        filter,
      ],
    );

  const visibleAutomaticExcluded =
    useMemo(
      () => {
        if (
          filter !==
          "excluded"
        ) {
          return [];
        }

        const query =
          search
            .trim()
            .toLocaleLowerCase(
              "es",
            );

        return state
          .automaticallyExcludedProducts
          .filter(
            (product) =>
              !query ||
              product.title
                .toLocaleLowerCase(
                  "es",
                )
                .includes(
                  query,
                ),
          );
      },
      [
        state
          .automaticallyExcludedProducts,
        search,
        filter,
      ],
    );

  /* =======================================================
     ERRORS
  ======================================================= */

  const systemErrors =
    Array.from(
      new Set([
        ...data.catalog.errors,

        ...data.runtime.errors,

        ...data
          .existingBundleMatches
          .errors,
      ]),
    );

  const working =
    fetcher.state !==
    "idle";

  return (
    <s-page heading="Bundles">

      <style>{`
        .csb-page,
        .csb-page *,
        .csb-page *::before,
        .csb-page *::after {
          box-sizing: border-box;
        }

        .csb-page {
          max-width: 1450px;
          margin: 0 auto;
        }

        .csb-title {
          margin: 0 0 5px;
          font-size: 24px;
          font-weight: 700;
          color: #303030;
        }

        .csb-description {
          margin: 0 0 18px;
          color: #616161;
          font-size: 13px;
        }

        .csb-kpis {
          display: grid;
          grid-template-columns:
            repeat(
              6,
              minmax(0, 1fr)
            );
          margin-bottom: 16px;
          border: 1px solid #e3e3e3;
          border-radius: 14px;
          overflow: hidden;
          background: #fff;
        }

        .csb-kpi {
          min-width: 0;
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
          font-size: 23px;
          font-weight: 700;
        }

        .csb-kpi--new {
          background: #fbfefb;
        }

        .csb-kpi--warning {
          background: #fffaf2;
        }

        .csb-kpi--excluded {
          background: #fafafa;
        }

        .csb-price-status {
          display: flex;
          justify-content: space-between;
          gap: 15px;
          margin-bottom: 14px;
          padding: 12px 14px;
          border: 1px solid #e3e3e3;
          border-radius: 11px;
          background: #fafafa;
          color: #616161;
          font-size: 11px;
        }

        .csb-price-status strong {
          color: #303030;
        }

        .csb-template-summary {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          margin-bottom: 14px;
        }

        .csb-template-summary__item {
          padding: 7px 10px;
          border: 1px solid #e2e2e2;
          border-radius: 9px;
          background: #fff;
          color: #555;
          font-size: 10.5px;
        }

        .csb-template-summary__item strong {
          color: #303030;
        }

        .csb-error-banner {
          margin-bottom: 14px;
          padding: 13px 15px;
          border: 1px solid #e6b7b7;
          border-radius: 11px;
          background: #fff5f5;
          color: #8f2525;
          font-size: 11.5px;
          line-height: 1.45;
        }

        .csb-warning-banner {
          margin-bottom: 14px;
          padding: 13px 15px;
          border: 1px solid #e7cea0;
          border-radius: 11px;
          background: #fffaf2;
          color: #73510c;
          font-size: 11px;
          line-height: 1.5;
        }

        .csb-warning-banner ul {
          margin: 7px 0 0;
          padding-left: 18px;
        }

        .csb-toolbar {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 14px;
          padding: 11px;
          border: 1px solid #e3e3e3;
          border-radius: 12px;
          background: #fff;
        }

        .csb-filters {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }

        .csb-filter {
          border: 1px solid transparent;
          border-radius: 8px;
          padding: 6px 10px;
          background: transparent;
          color: #303030;
          font: inherit;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }

        .csb-filter--active {
          background: #f4f0ff;
          border-color: #d0c3fa;
          color: #5c35d5;
        }

        .csb-search {
          width: 270px;
          min-height: 35px;
          padding: 6px 10px;
          border: 1px solid #c9c9c9;
          border-radius: 8px;
          font: inherit;
          font-size: 11.5px;
        }

        .csb-list {
          display: flex;
          flex-direction: column;
          gap: 9px;
        }

        .csb-bundle {
          display: grid;
          grid-template-columns:
            minmax(0, 2fr)
            115px
            125px
            65px
            120px
            132px;
          gap: 14px;
          align-items: center;
          padding: 15px 17px;
          border: 1px solid #e3e3e3;
          border-radius: 12px;
          background: #fff;
        }

        .csb-bundle--review {
          border-color: #e7cea0;
          background: #fffdf8;
        }

        .csb-bundle--legacy {
          border-color: #d5c8f6;
          background: #fcfaff;
        }

        .csb-bundle__title {
          margin-bottom: 4px;
          color: #303030;
          font-size: 12.5px;
          line-height: 1.4;
          font-weight: 650;
        }

        .csb-bundle__sku {
          color: #616161;
          font-size: 10px;
          font-family: monospace;
        }

        .csb-bundle__message {
          margin-top: 5px;
          color: #777;
          font-size: 10.5px;
          line-height: 1.4;
        }

        .csb-template-badge {
          display: inline-flex;
          margin-top: 7px;
          padding: 3px 7px;
          border-radius: 999px;
          background: #f1ebff;
          color: #6842a7;
          font-size: 9.5px;
          font-weight: 650;
        }

        .csb-existing-product {
          margin-top: 5px;
          color: #6842a7;
          font-size: 10px;
        }

        .csb-value-label {
          display: block;
          margin-bottom: 3px;
          color: #8a8a8a;
          font-size: 9px;
          text-transform: uppercase;
        }

        .csb-component-price {
          color: #777;
          font-size: 10.5px;
          text-decoration: line-through;
        }

        .csb-final-price {
          color: #303030;
          font-size: 12.5px;
          font-weight: 700;
        }

        .csb-saving {
          margin-top: 3px;
          color: #26733e;
          font-size: 10px;
          font-weight: 600;
        }

        .csb-status {
          display: inline-flex;
          justify-content: center;
          padding: 5px 10px;
          border-radius: 999px;
          background: #ededed;
          color: #555;
          font-size: 10px;
          font-weight: 650;
          white-space: nowrap;
        }

        .csb-status--new {
          background: #eaf8ee;
          color: #26733e;
        }

        .csb-status--existing {
          background: #eaf0ff;
          color: #3850a2;
        }

        .csb-status--legacy {
          background: #f1ebff;
          color: #6842a7;
        }

        .csb-status--warning {
          background: #fff2d8;
          color: #835800;
        }

        .csb-status--error {
          background: #fdeaea;
          color: #a32828;
        }

        .csb-actions {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .csb-action-button {
          width: 100%;
          min-height: 32px;
          padding: 5px 8px;
          border: 1px solid #c9c9c9;
          border-radius: 8px;
          background: #fff;
          color: #303030;
          font: inherit;
          font-size: 10.5px;
          font-weight: 600;
          cursor: pointer;
        }

        .csb-action-button:hover {
          background: #f5f5f5;
        }

        .csb-action-button--primary {
          border-color: #303030;
          background: #303030;
          color: #fff;
        }

        .csb-action-button--primary:hover {
          background: #1f1f1f;
        }

        .csb-action-button:disabled {
          opacity: .5;
          cursor: default;
        }

        .csb-excluded {
          display: grid;
          grid-template-columns:
            minmax(0, 1fr)
            170px
            150px;
          gap: 16px;
          align-items: center;
          padding: 15px 17px;
          border: 1px solid #e3e3e3;
          border-radius: 12px;
          background: #fafafa;
        }

        .csb-notice {
          margin-top: 16px;
          padding: 14px;
          border: 1px solid #e3e3e3;
          border-radius: 12px;
          background: #fafafa;
          color: #616161;
          font-size: 11.5px;
          line-height: 1.5;
        }

        .csb-empty {
          padding: 35px;
          border: 1px dashed #c9c9c9;
          border-radius: 12px;
          color: #616161;
          text-align: center;
          font-size: 12px;
        }

        @media (max-width: 1100px) {
          .csb-kpis {
            grid-template-columns:
              repeat(
                3,
                1fr
              );
          }

          .csb-bundle {
            grid-template-columns:
              1fr
              1fr
              1fr;
          }
        }

        @media (max-width: 700px) {
          .csb-kpis {
            grid-template-columns:
              1fr
              1fr;
          }

          .csb-toolbar,
          .csb-price-status {
            flex-direction: column;
          }

          .csb-search {
            width: 100%;
          }

          .csb-bundle,
          .csb-excluded {
            grid-template-columns:
              1fr;
          }
        }
      `}</style>

      <div className="csb-page">

        <h1 className="csb-title">
          Bundles
        </h1>

        <p className="csb-description">
          Las propuestas ahora se generan desde las reglas configuradas en Plantillas.
        </p>

        {/* KPIS */}

        <div className="csb-kpis">

          <div className="csb-kpi">

            <div className="csb-kpi__label">
              PC elegibles
            </div>

            <div className="csb-kpi__value">
              {
                state
                  .eligibleBaseProducts
                  .length
              }
            </div>

          </div>

          <div className="csb-kpi">

            <div className="csb-kpi__label">
              Bundles posibles
            </div>

            <div className="csb-kpi__value">
              {
                state
                  .candidates
                  .length
              }
            </div>

          </div>

          <div className="csb-kpi csb-kpi--new">

            <div className="csb-kpi__label">
              Nuevos
            </div>

            <div className="csb-kpi__value">
              {
                newCount
              }
            </div>

          </div>

          <div className="csb-kpi">

            <div className="csb-kpi__label">
              Ya existentes
            </div>

            <div className="csb-kpi__value">
              {
                existingCount
              }
            </div>

          </div>

          <div
            className={
              reviewCount >
              0
                ? "csb-kpi csb-kpi--warning"
                : "csb-kpi"
            }
          >

            <div className="csb-kpi__label">
              Revisar
            </div>

            <div className="csb-kpi__value">
              {
                reviewCount
              }
            </div>

          </div>

          <div className="csb-kpi csb-kpi--excluded">

            <div className="csb-kpi__label">
              Excluidos
            </div>

            <div className="csb-kpi__value">
              {
                excludedCount
              }
            </div>

          </div>

        </div>

        {/* PRICE */}

        <div className="csb-price-status">

          <span>
            Precio comercial
          </span>

          <strong>

            {data.runtime.priceConfig.mode ===
            "percentage"
              ? `${data.runtime.priceConfig.percentage}% de descuento sobre el PC`
              : data.runtime.priceConfig.mode ===
                  "fixed"
                ? `${formatPrice(
                    data.runtime.priceConfig.fixedAmount,
                    data.catalog.currencyCode,
                  )} de descuento sobre el PC`
                : "Sin descuento"}

            {data.runtime.priceConfig
              .rounding ===
            "x900"
              ? " · Termina en $900"
              : ""}

          </strong>

        </div>

        {/* TEMPLATE SUMMARY */}

        <div className="csb-template-summary">

          {state.summaries
            .filter(
              (summary) =>
                summary.enabled,
            )
            .map(
              (summary) => (
                <div
                  className="csb-template-summary__item"
                  key={
                    summary.templateId
                  }
                >
                  <strong>
                    {
                      summary.templateName
                    }
                  </strong>

                  {" · "}

                  {
                    summary.candidatesCount
                  }{" "}

                  propuesta(s)

                </div>
              ),
            )}

        </div>

        {/* API ERRORS */}

        {systemErrors.length >
          0 && (
          <div className="csb-error-banner">

            <strong>
              La lectura del generador no pudo completarse correctamente.
            </strong>

            <br />

            {
              systemErrors.join(
                " | ",
              )
            }

          </div>
        )}

        {/* TEMPLATE ISSUES */}

        {state.issues.length >
          0 && (
          <div className="csb-warning-banner">

            <strong>
              Revisa la configuración de Plantillas:
            </strong>

            <ul>

              {state.issues.map(
                (issue) => (
                  <li key={issue}>
                    {issue}
                  </li>
                ),
              )}

            </ul>

          </div>
        )}

        {/* TOOLBAR */}

        <div className="csb-toolbar">

          <div className="csb-filters">

            <button
              type="button"
              className={
                filter ===
                "all"
                  ? "csb-filter csb-filter--active"
                  : "csb-filter"
              }
              onClick={() =>
                setFilter(
                  "all",
                )
              }
            >
              Todos
            </button>

            <button
              type="button"
              className={
                filter ===
                "new"
                  ? "csb-filter csb-filter--active"
                  : "csb-filter"
              }
              onClick={() =>
                setFilter(
                  "new",
                )
              }
            >
              Nuevos ({newCount})
            </button>

            {state.summaries
              .filter(
                (summary) =>
                  summary.enabled,
              )
              .map(
                (summary) => {
                  const value =
                    `template:${summary.templateId}` as BundleFilter;

                  return (
                    <button
                      type="button"
                      key={
                        summary.templateId
                      }
                      className={
                        filter ===
                        value
                          ? "csb-filter csb-filter--active"
                          : "csb-filter"
                      }
                      onClick={() =>
                        setFilter(
                          value,
                        )
                      }
                    >
                      {
                        summary.templateName
                      }{" "}
                      ({
                        summary.candidatesCount
                      })
                    </button>
                  );
                },
              )}

            <button
              type="button"
              className={
                filter ===
                "existing"
                  ? "csb-filter csb-filter--active"
                  : "csb-filter"
              }
              onClick={() =>
                setFilter(
                  "existing",
                )
              }
            >
              Ya existen ({existingCount})
            </button>

            <button
              type="button"
              className={
                filter ===
                "review"
                  ? "csb-filter csb-filter--active"
                  : "csb-filter"
              }
              onClick={() =>
                setFilter(
                  "review",
                )
              }
            >
              Revisar ({reviewCount})
            </button>

            <button
              type="button"
              className={
                filter ===
                "excluded"
                  ? "csb-filter csb-filter--active"
                  : "csb-filter"
              }
              onClick={() =>
                setFilter(
                  "excluded",
                )
              }
            >
              Excluidos ({excludedCount})
            </button>

          </div>

          <input
            className="csb-search"
            type="search"
            placeholder="Buscar producto o SKU"
            value={
              search
            }
            onChange={(event) =>
              setSearch(
                event.target.value,
              )
            }
          />

        </div>

        {/* LIST */}

        <div className="csb-list">

          {visibleCandidates.map(
            (candidate) => {
              const match =
                matchByCandidateId.get(
                  candidate.id,
                );

              if (
                !match
              ) {
                return null;
              }

              const price =
                calculateTemplateCandidatePrice(
                  candidate,
                  data.runtime.priceConfig,
                );

              const needsReview =
                isReviewStatus(
                  match.status,
                );

              const isLegacy =
                match.status ===
                "existing_legacy";

              let className =
                "csb-bundle";

              if (
                needsReview
              ) {
                className +=
                  " csb-bundle--review";
              }

              if (
                isLegacy
              ) {
                className +=
                  " csb-bundle--legacy";
              }

              return (
                <div
                  className={
                    className
                  }
                  key={
                    candidate.id
                  }
                >

                  {/* PRODUCT */}

                  <div>

                    <div className="csb-bundle__title">
                      {
                        candidate
                          .identity
                          .title
                      }
                    </div>

                    <div className="csb-bundle__sku">
                      {
                        candidate
                          .identity
                          .sku
                      }
                    </div>

                    <div className="csb-bundle__message">
                      {
                        match.message
                      }
                    </div>

                    <span className="csb-template-badge">
                      {
                        candidate
                          .templateName
                      }
                    </span>

                    {match
                      .existingProduct && (
                      <div className="csb-existing-product">

                        Shopify:{" "}

                        <strong>
                          {
                            match
                              .existingProduct
                              .title
                          }
                        </strong>

                      </div>
                    )}

                  </div>

                  {/* INDIVIDUAL */}

                  <div>

                    <span className="csb-value-label">
                      Individual
                    </span>

                    <div className="csb-component-price">
                      {formatPrice(
                        price.componentPrice,
                        data.catalog.currencyCode,
                      )}
                    </div>

                  </div>

                  {/* BUNDLE */}

                  <div>

                    <span className="csb-value-label">
                      Bundle
                    </span>

                    <div className="csb-final-price">
                      {formatPrice(
                        price.finalPrice,
                        data.catalog.currencyCode,
                      )}
                    </div>

                    {price.savings >
                      0 && (
                      <div className="csb-saving">

                        Ahorra{" "}

                        {formatPrice(
                          price.savings,
                          data.catalog.currencyCode,
                        )}

                      </div>
                    )}

                  </div>

                  {/* STOCK */}

                  <div>

                    <span className="csb-value-label">
                      Stock
                    </span>

                    {
                      getTemplateCandidateStock(
                        candidate,
                      )
                    }

                  </div>

                  {/* STATUS */}

                  <div>

                    <span
                      className={
                        getStatusClass(
                          match.status,
                        )
                      }
                    >
                      {
                        getStatusLabel(
                          match.status,
                        )
                      }
                    </span>

                  </div>

                  {/* ACTIONS */}

                  <div className="csb-actions">

                    {match.status ===
                      "new" && (
                      <>

                        <fetcher.Form method="post">

                          <input
                            type="hidden"
                            name="intent"
                            value="create_draft"
                          />

                          <input
                            type="hidden"
                            name="candidateId"
                            value={
                              candidate.id
                            }
                          />

                          <button
                            className="csb-action-button csb-action-button--primary"
                            type="submit"
                            disabled={
                              working
                            }
                          >
                            {working
                              ? "Procesando..."
                              : "Crear borrador"}
                          </button>

                        </fetcher.Form>

                        <fetcher.Form method="post">

                          <input
                            type="hidden"
                            name="intent"
                            value="exclude"
                          />

                          <input
                            type="hidden"
                            name="productId"
                            value={
                              candidate
                                .baseProduct
                                .id
                            }
                          />

                          <button
                            className="csb-action-button"
                            type="submit"
                            disabled={
                              working
                            }
                          >
                            Excluir PC
                          </button>

                        </fetcher.Form>

                      </>
                    )}

                  </div>

                </div>
              );
            },
          )}

          {/* MULTI VARIANT */}

          {visibleMultiVariant.map(
            (product) => (
              <div
                className="csb-bundle csb-bundle--review"
                key={
                  product.id
                }
              >

                <div>

                  <div className="csb-bundle__title">
                    {
                      product.title
                    }
                  </div>

                  <div className="csb-bundle__message">
                    Tiene múltiples variantes. La creación automática permanece bloqueada por seguridad.
                  </div>

                </div>

                <div />
                <div />

                <div>
                  {
                    product.totalInventory
                  }
                </div>

                <div>

                  <span className="csb-status csb-status--warning">
                    Varias variantes
                  </span>

                </div>

                <div />

              </div>
            ),
          )}

          {/* MANUAL EXCLUDED */}

          {visibleManualExcluded.map(
            (product) => (
              <div
                className="csb-excluded"
                key={
                  product.id
                }
              >

                <div>

                  <div className="csb-bundle__title">
                    {
                      product.title
                    }
                  </div>

                  <div className="csb-bundle__sku">
                    {
                      getFirstTemplateVariant(
                        product,
                      )?.sku ??
                      "Sin SKU"
                    }
                  </div>

                  <div className="csb-bundle__message">
                    Exclusión manual. Este PC no participa en ninguna plantilla.
                  </div>

                </div>

                <span className="csb-status csb-status--warning">
                  Excluido manual
                </span>

                <fetcher.Form method="post">

                  <input
                    type="hidden"
                    name="intent"
                    value="include"
                  />

                  <input
                    type="hidden"
                    name="productId"
                    value={
                      product.id
                    }
                  />

                  <button
                    className="csb-action-button"
                    type="submit"
                    disabled={
                      working
                    }
                  >
                    Incluir nuevamente
                  </button>

                </fetcher.Form>

              </div>
            ),
          )}

          {/* AUTOMATIC EXCLUDED */}

          {visibleAutomaticExcluded.map(
            (product) => (
              <div
                className="csb-excluded"
                key={
                  product.id
                }
              >

                <div>

                  <div className="csb-bundle__title">
                    {
                      product.title
                    }
                  </div>

                  <div className="csb-bundle__message">
                    Los productos “¡Arma a tu medida!” permanecen excluidos automáticamente durante esta migración.
                  </div>

                </div>

                <span className="csb-status">
                  Automático
                </span>

                <div />

              </div>
            ),
          )}

          {/* EMPTY */}

          {visibleCandidates.length ===
            0 &&
            visibleMultiVariant.length ===
              0 &&
            visibleManualExcluded.length ===
              0 &&
            visibleAutomaticExcluded.length ===
              0 && (
              <div className="csb-empty">
                No hay productos para este filtro.
              </div>
            )}

        </div>

        <div className="csb-notice">

          <strong>
            Generador conectado a Plantillas.
          </strong>

          {" "}

          Cambiar condiciones, tipos de producto, metacampos, prefijos, sufijos, SKU, proveedor o tipo de producto generado en Plantillas ahora modifica las propuestas de esta pantalla sin editar el motor.

          <br />
          <br />

          La creación individual está habilitada solo para propuestas con estado Nuevo. Cada intento se vuelve a validar en el servidor y el producto se crea en Shopify como Borrador. La creación masiva continúa desactivada.

        </div>

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