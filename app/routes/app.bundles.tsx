import {
  useEffect,
  useMemo,
  useRef,
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
  useRevalidator,
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

/*
 * La creación masiva reutiliza la misma acción segura de una
 * sola propuesta. Durante el lote evitamos recargar este loader
 * completo después de cada bundle y lo actualizamos una vez al final.
 */
export const shouldRevalidate = ({
  formData,
  defaultShouldRevalidate,
}: any) => {
  if (
    formData?.get(
      "skipRevalidate",
    ) ===
    "true"
  ) {
    return false;
  }

  return defaultShouldRevalidate;
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

function getShopifyAdminProductHref(
  productId:
    string,
) {
  const numericId =
    productId
      .split("/")
      .filter(
        Boolean,
      )
      .at(
        -1,
      );

  return numericId
    ? `shopify:admin/products/${numericId}`
    : "shopify:admin/products";
}

type BulkCreationResult = {
  candidateId: string;
  success: boolean;
  partial: boolean;
  message: string;
};

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

  const bulkFetcher =
    useFetcher<
      typeof action
    >();

  const revalidator =
    useRevalidator();

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

  const [
    creatingCandidateId,
    setCreatingCandidateId,
  ] =
    useState<
      string | null
    >(
      null,
    );

  const [
    selectedCandidateIds,
    setSelectedCandidateIds,
  ] =
    useState<
      Set<string>
    >(
      new Set(),
    );

  const [
    bulkQueue,
    setBulkQueue,
  ] =
    useState<
      string[]
    >(
      [],
    );

  const [
    bulkCurrentCandidateId,
    setBulkCurrentCandidateId,
  ] =
    useState<
      string | null
    >(
      null,
    );

  const [
    bulkResults,
    setBulkResults,
  ] =
    useState<
      BulkCreationResult[]
    >(
      [],
    );

  const [
    bulkRunning,
    setBulkRunning,
  ] =
    useState(
      false,
    );

  const bulkWasBusyRef =
    useRef(
      false,
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

  useEffect(() => {
    if (
      fetcher.state ===
      "idle"
    ) {
      setCreatingCandidateId(
        null,
      );
    }
  }, [
    fetcher.state,
  ]);

  useEffect(() => {
    if (
      bulkFetcher.state !==
      "idle"
    ) {
      bulkWasBusyRef.current =
        true;

      return;
    }

    if (
      !bulkRunning ||
      !bulkCurrentCandidateId ||
      !bulkWasBusyRef.current
    ) {
      return;
    }

    bulkWasBusyRef.current =
      false;

    const result =
      bulkFetcher.data;

    const normalizedResult:
      BulkCreationResult = {
      candidateId:
        bulkCurrentCandidateId,

      success:
        Boolean(
          result?.success,
        ),

      partial:
        Boolean(
          result &&
          "partial" in
            result &&
          result.partial,
        ),

      message:
        result?.message ??
        "La solicitud terminó sin una respuesta válida.",
    };

    const nextResults = [
      ...bulkResults,
      normalizedResult,
    ];

    setBulkResults(
      nextResults,
    );

    const currentIndex =
      bulkQueue.indexOf(
        bulkCurrentCandidateId,
      );

    const nextCandidateId =
      currentIndex >=
        0
        ? bulkQueue[
            currentIndex +
              1
          ] ??
          null
        : null;

    if (
      nextCandidateId
    ) {
      setBulkCurrentCandidateId(
        nextCandidateId,
      );

      bulkFetcher.submit(
        {
          intent:
            "create_draft",

          candidateId:
            nextCandidateId,

          skipRevalidate:
            "true",
        },
        {
          method:
            "post",
        },
      );

      return;
    }

    setBulkRunning(
      false,
    );

    setBulkCurrentCandidateId(
      null,
    );

    setSelectedCandidateIds(
      new Set(),
    );

    const created =
      nextResults.filter(
        (item) =>
          item.success,
      ).length;

    const review =
      nextResults.filter(
        (item) =>
          !item.success &&
          item.partial,
      ).length;

    const skipped =
      nextResults.length -
      created -
      review;

    shopify.toast.show(
      "Proceso terminado: " +
      created +
      " creados, " +
      skipped +
      " omitidos y " +
      review +
      " para revisar.",
    );

    revalidator.revalidate();
  }, [
    bulkFetcher.state,
    bulkFetcher.data,
    bulkRunning,
    bulkCurrentCandidateId,
    bulkQueue,
    bulkResults,
    shopify,
    revalidator,
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

  const visibleNewCandidateIds =
    useMemo(
      () =>
        visibleCandidates
          .filter(
            (candidate) =>
              matchByCandidateId.get(
                candidate.id,
              )?.status ===
              "new",
          )
          .map(
            (candidate) =>
              candidate.id,
          ),
      [
        visibleCandidates,
        matchByCandidateId,
      ],
    );

  const selectedNewCandidateIds =
    useMemo(
      () =>
        sortedCandidates
          .filter(
            (candidate) =>
              selectedCandidateIds.has(
                candidate.id,
              ) &&
              matchByCandidateId.get(
                candidate.id,
              )?.status ===
                "new",
          )
          .map(
            (candidate) =>
              candidate.id,
          ),
      [
        sortedCandidates,
        selectedCandidateIds,
        matchByCandidateId,
      ],
    );

  const allVisibleNewSelected =
    visibleNewCandidateIds.length >
      0 &&
    visibleNewCandidateIds.every(
      (candidateId) =>
        selectedCandidateIds.has(
          candidateId,
        ),
    );

  const toggleCandidateSelection =
    (
      candidateId:
        string,
    ) => {
      if (
        bulkRunning
      ) {
        return;
      }

      setSelectedCandidateIds(
        (current) => {
          const next =
            new Set(
              current,
            );

          if (
            next.has(
              candidateId,
            )
          ) {
            next.delete(
              candidateId,
            );
          } else {
            next.add(
              candidateId,
            );
          }

          return next;
        },
      );
    };

  const toggleVisibleNewSelection =
    () => {
      if (
        bulkRunning
      ) {
        return;
      }

      setSelectedCandidateIds(
        (current) => {
          const next =
            new Set(
              current,
            );

          if (
            allVisibleNewSelected
          ) {
            for (
              const candidateId
              of visibleNewCandidateIds
            ) {
              next.delete(
                candidateId,
              );
            }
          } else {
            for (
              const candidateId
              of visibleNewCandidateIds
            ) {
              next.add(
                candidateId,
              );
            }
          }

          return next;
        },
      );
    };

  const startBulkCreation =
    () => {
      if (
        bulkRunning ||
        fetcher.state !==
          "idle"
      ) {
        return;
      }

      const queue =
        selectedNewCandidateIds;

      if (
        queue.length ===
        0
      ) {
        shopify.toast.show(
          "Selecciona al menos un bundle nuevo.",
        );

        return;
      }

      const confirmed =
        window.confirm(
          "Se crearán " +
          queue.length +
          " bundles como borrador, uno por uno. Cada propuesta se volverá a validar antes de crearla. ¿Continuar?",
        );

      if (
        !confirmed
      ) {
        return;
      }

      setBulkQueue(
        queue,
      );

      setBulkResults(
        [],
      );

      setBulkRunning(
        true,
      );

      const firstCandidateId =
        queue[0];

      setBulkCurrentCandidateId(
        firstCandidateId,
      );

      bulkFetcher.submit(
        {
          intent:
            "create_draft",

          candidateId:
            firstCandidateId,

          skipRevalidate:
            "true",
        },
        {
          method:
            "post",
        },
      );
    };

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
      "idle" ||
    bulkRunning;

  return (
    <s-page heading="Bundles" inlineSize="large">

      <style>{`
        .csb-page,
        .csb-page *,
        .csb-page *::before,
        .csb-page *::after {
          box-sizing: border-box;
        }

        .csb-page {
          width: 100%;
          max-width: none;
          margin: 0;
          padding-bottom: 24px;
        }

        .csb-hero {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 24px;
          margin-bottom: 18px;
          padding: 4px 2px 0;
        }

        .csb-eyebrow {
          margin-bottom: 5px;
          color: #0c62f2;
          font-size: 10px;
          font-weight: 750;
          letter-spacing: .08em;
          text-transform: uppercase;
        }

        .csb-title {
          margin: 0 0 5px;
          font-size: 21px;
          line-height: 1.2;
          font-weight: 720;
          color: #202223;
        }

        .csb-description {
          margin: 0;
          max-width: 720px;
          color: #616161;
          font-size: 12px;
          line-height: 1.5;
        }

        .csb-hero__status {
          display: flex;
          align-items: baseline;
          gap: 7px;
          flex: 0 0 auto;
          padding: 10px 13px;
          border: 1px solid #dbe7fb;
          border-radius: 12px;
          background: #f5f9ff;
          color: #52606d;
          font-size: 10.5px;
        }

        .csb-hero__status strong {
          color: #0c62f2;
          font-size: 18px;
          line-height: 1;
        }

        .csb-kpis {
          display: grid;
          grid-template-columns:
            repeat(
              6,
              minmax(0, 1fr)
            );
          gap: 12px;
          margin-bottom: 14px;
        }

        .csb-kpi {
          position: relative;
          min-width: 0;
          min-height: 94px;
          padding: 16px 17px;
          overflow: hidden;
          border: 1px solid #e4e9f0;
          border-radius: 16px;
          background:
            linear-gradient(
              145deg,
              #ffffff 0%,
              #fbfdff 100%
            );
          box-shadow:
            0 1px 2px rgba(31, 33, 36, .04),
            0 7px 20px rgba(31, 33, 36, .035);
        }

        .csb-kpi::after {
          content: "";
          position: absolute;
          top: -24px;
          right: -22px;
          width: 74px;
          height: 74px;
          border-radius: 50%;
          background: #eef5ff;
        }

        .csb-kpi__label {
          position: relative;
          z-index: 1;
          margin-bottom: 8px;
          color: #69727d;
          font-size: 10.5px;
          font-weight: 580;
        }

        .csb-kpi__value {
          position: relative;
          z-index: 1;
          color: #202223;
          font-size: 26px;
          line-height: 1;
          font-weight: 740;
          letter-spacing: -.025em;
        }

        .csb-kpi--new {
          border-color: #cfe9d6;
          background:
            linear-gradient(
              145deg,
              #ffffff 0%,
              #f4fbf6 100%
            );
        }

        .csb-kpi--new::after {
          background: #e4f6e9;
        }

        .csb-kpi--warning {
          border-color: #f0dcb6;
          background:
            linear-gradient(
              145deg,
              #ffffff 0%,
              #fff9ee 100%
            );
        }

        .csb-kpi--warning::after {
          background: #fff0d2;
        }

        .csb-kpi--excluded {
          background:
            linear-gradient(
              145deg,
              #ffffff 0%,
              #f7f8fa 100%
            );
        }

        .csb-kpi--excluded::after {
          background: #eef0f3;
        }

        .csb-context-grid {
          display: grid;
          grid-template-columns:
            minmax(260px, .9fr)
            minmax(360px, 1.6fr);
          gap: 12px;
          margin-bottom: 16px;
        }

        .csb-price-status {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 7px;
          min-height: 76px;
          margin: 0;
          padding: 14px 16px;
          border: 1px solid #dce7f7;
          border-radius: 14px;
          background: #f7faff;
          color: #69727d;
          font-size: 10.5px;
        }

        .csb-price-status strong {
          color: #202223;
          font-size: 12px;
          line-height: 1.45;
        }

        .csb-template-summary {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          min-height: 76px;
          margin: 0;
          padding: 12px 14px;
          border: 1px solid #e4e9f0;
          border-radius: 14px;
          background: #fff;
        }

        .csb-template-summary__item {
          padding: 8px 10px;
          border: 1px solid #dfe5ec;
          border-radius: 10px;
          background: #fbfcfe;
          color: #66717d;
          font-size: 10.5px;
        }

        .csb-template-summary__item strong {
          color: #202223;
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

        .csb-section-head {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 16px;
          margin: 4px 2px 10px;
        }

        .csb-section-head h2 {
          margin: 0 0 3px;
          color: #202223;
          font-size: 15px;
          font-weight: 700;
        }

        .csb-section-head p {
          margin: 0;
          color: #77808a;
          font-size: 10.5px;
        }

        .csb-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
          padding: 10px;
          border: 1px solid #e4e9f0;
          border-radius: 14px;
          background: #fff;
          box-shadow: 0 1px 2px rgba(31, 33, 36, .03);
        }

        .csb-filters {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }

        .csb-filter {
          min-height: 32px;
          border: 1px solid transparent;
          border-radius: 9px;
          padding: 6px 10px;
          background: transparent;
          color: #4b5560;
          font: inherit;
          font-size: 10.5px;
          font-weight: 620;
          cursor: pointer;
          transition:
            background .15s ease,
            border-color .15s ease,
            color .15s ease;
        }

        .csb-filter:hover {
          background: #f6f7f9;
        }

        .csb-filter--active {
          background: #eef5ff;
          border-color: #cfe0fb;
          color: #0c62f2;
        }

        .csb-search {
          width: clamp(240px, 25vw, 360px);
          height: 36px;
          min-height: 36px;
          padding: 0 12px;
          border: 1px solid #d4d9df;
          border-radius: 10px;
          background: #fbfcfd;
          color: #202223;
          font: inherit;
          font-size: 11px;
          outline: none;
          appearance: none;
        }

        .csb-search:focus {
          border-color: #8db5f6;
          box-shadow: 0 0 0 3px rgba(12, 98, 242, .09);
          background: #fff;
        }

        .csb-bulk-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
          padding: 11px 12px;
          border: 1px solid #d8e5f8;
          border-radius: 14px;
          background:
            linear-gradient(
              90deg,
              #f7faff 0%,
              #fbfdff 100%
            );
        }

        .csb-bulk-bar__left,
        .csb-bulk-bar__right {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .csb-bulk-info {
          color: #616161;
          font-size: 11px;
        }

        .csb-bulk-button {
          min-height: 34px;
          padding: 6px 11px;
          border: 1px solid #c9c9c9;
          border-radius: 8px;
          background: #fff;
          color: #303030;
          font: inherit;
          font-size: 10.5px;
          font-weight: 650;
          cursor: pointer;
        }

        .csb-bulk-button--primary {
          border-color: #0c62f2;
          background: #0c62f2;
          color: #fff;
          box-shadow: 0 3px 8px rgba(12, 98, 242, .16);
        }

        .csb-bulk-button--primary:hover {
          background: #0a56d5;
          border-color: #0a56d5;
        }

        .csb-bulk-button:disabled {
          opacity: .5;
          cursor: default;
        }

        .csb-bulk-progress {
          margin-bottom: 14px;
          padding: 12px 14px;
          border: 1px solid #d7caef;
          border-radius: 11px;
          background: #faf7ff;
          color: #5c35d5;
          font-size: 11px;
          line-height: 1.5;
        }

        .csb-product-cell {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          min-width: 0;
        }

        .csb-product-select {
          margin-top: 2px;
          flex: 0 0 auto;
        }

        .csb-product-content {
          min-width: 0;
        }

        .csb-list-header {
          display: grid;
          grid-template-columns:
            minmax(380px, 2.5fr)
            120px
            130px
            72px
            120px
            150px;
          gap: 16px;
          align-items: center;
          margin: 0 4px 7px;
          padding: 0 16px;
          color: #8a939d;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: .055em;
          text-transform: uppercase;
        }

        .csb-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .csb-bundle {
          display: grid;
          grid-template-columns:
            minmax(380px, 2.5fr)
            120px
            130px
            72px
            120px
            150px;
          gap: 16px;
          align-items: center;
          padding: 15px 16px;
          border: 1px solid #e4e9f0;
          border-radius: 14px;
          background: #fff;
          box-shadow: 0 1px 2px rgba(31, 33, 36, .025);
          transition:
            border-color .15s ease,
            box-shadow .15s ease,
            transform .15s ease;
        }

        .csb-bundle:hover {
          border-color: #d5dce5;
          box-shadow: 0 6px 18px rgba(31, 33, 36, .045);
        }

        .csb-bundle:has(.csb-product-select:checked) {
          border-color: #a9c8f8;
          background: #f8fbff;
          box-shadow: 0 0 0 2px rgba(12, 98, 242, .055);
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
          color: #202223;
          font-size: 12.5px;
          line-height: 1.4;
          font-weight: 680;
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

        .csb-badge-row {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin-top: 7px;
        }

        .csb-template-badge,
        .csb-wifi-badge {
          display: inline-flex;
          padding: 3px 7px;
          border-radius: 999px;
          font-size: 9.5px;
          font-weight: 650;
        }

        .csb-template-badge {
          background: #f1ebff;
          color: #6842a7;
        }

        .csb-wifi-badge--yes {
          background: #eaf8ee;
          color: #26733e;
        }

        .csb-wifi-badge--no {
          background: #fff2d8;
          color: #835800;
        }

        .csb-existing-product {
          margin-top: 5px;
          color: #6842a7;
          font-size: 10px;
        }

        .csb-existing-product__link {
          color: #6842a7;
          font-weight: 650;
          text-decoration: none;
        }

        .csb-existing-product__link:hover {
          text-decoration: underline;
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
          border-color: #0c62f2;
          background: #0c62f2;
          color: #fff;
        }

        .csb-action-button--primary:hover {
          border-color: #0a56d5;
          background: #0a56d5;
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

        @media (max-width: 1280px) {
          .csb-kpis {
            grid-template-columns:
              repeat(
                3,
                1fr
              );
          }

          .csb-context-grid {
            grid-template-columns:
              1fr;
          }

          .csb-list-header {
            display: none;
          }

          .csb-bundle {
            grid-template-columns:
              minmax(0, 2fr)
              1fr
              1fr;
          }
        }

        @media (max-width: 700px) {
          .csb-hero {
            align-items: stretch;
            flex-direction: column;
          }

          .csb-hero__status {
            justify-content: space-between;
          }

          .csb-kpis {
            grid-template-columns:
              1fr
              1fr;
          }

          .csb-toolbar,
          .csb-price-status,
          .csb-bulk-bar {
            flex-direction: column;
            align-items: stretch;
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

        <div className="csb-hero">

          <div>

            <div className="csb-eyebrow">
              Generador automático
            </div>

            <h2 className="csb-title">
              Resumen de bundles
            </h2>

            <p className="csb-description">
              Revisa propuestas, compatibilidad, precio y stock antes de crear los bundles en Shopify.
            </p>

          </div>

          <div className="csb-hero__status">

            <strong>
              {newCount}
            </strong>

            <span>
              nuevos por crear
            </span>

          </div>

        </div>

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

        <div className="csb-context-grid">

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

        <div className="csb-section-head">

          <div>

            <h2>
              Propuestas
            </h2>

            <p>
              Filtra, compara y selecciona únicamente los bundles que quieras crear.
            </p>

          </div>

        </div>

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

        {/* BULK CREATION */}

        <div className="csb-bulk-bar">

          <div className="csb-bulk-bar__left">

            <button
              type="button"
              className="csb-bulk-button"
              onClick={
                toggleVisibleNewSelection
              }
              disabled={
                bulkRunning ||
                visibleNewCandidateIds.length ===
                  0
              }
            >
              {
                allVisibleNewSelected
                  ? "Quitar selección visible"
                  : "Seleccionar nuevos visibles"
              }
            </button>

            <span className="csb-bulk-info">
              {
                selectedNewCandidateIds.length
              }{" "}
              seleccionado(s)
            </span>

          </div>

          <div className="csb-bulk-bar__right">

            <button
              type="button"
              className="csb-bulk-button csb-bulk-button--primary"
              onClick={
                startBulkCreation
              }
              disabled={
                bulkRunning ||
                fetcher.state !==
                  "idle" ||
                selectedNewCandidateIds.length ===
                  0
              }
            >
              {
                bulkRunning
                  ? "Creando..."
                  : "Crear seleccionados (" +
                    selectedNewCandidateIds.length +
                    ")"
              }
            </button>

          </div>

        </div>

        {(bulkRunning ||
          bulkResults.length >
            0) && (
          <div className="csb-bulk-progress">

            {bulkRunning ? (
              <>
                Procesando{" "}
                {
                  bulkResults.length +
                  1
                }{" "}
                de{" "}
                {
                  bulkQueue.length
                }
                . Cada bundle se crea de forma secuencial y se valida nuevamente en el servidor.
              </>
            ) : (
              <>
                Último proceso:{" "}
                {
                  bulkResults.filter(
                    (item) =>
                      item.success,
                  ).length
                }{" "}
                creados ·{" "}
                {
                  bulkResults.filter(
                    (item) =>
                      !item.success &&
                      !item.partial,
                  ).length
                }{" "}
                omitidos ·{" "}
                {
                  bulkResults.filter(
                    (item) =>
                      !item.success &&
                      item.partial,
                  ).length
                }{" "}
                para revisar.
              </>
            )}

          </div>
        )}

        {/* LIST */}

        {visibleCandidates.length >
          0 && (
          <div className="csb-list-header">

            <div>
              Propuesta
            </div>

            <div>
              Individual
            </div>

            <div>
              Bundle
            </div>

            <div>
              Stock
            </div>

            <div>
              Estado
            </div>

            <div>
              Acciones
            </div>

          </div>
        )}

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

                  <div className="csb-product-cell">

                    {match.status ===
                      "new" && (
                      <input
                        className="csb-product-select"
                        type="checkbox"
                        aria-label="Seleccionar bundle"
                        checked={
                          selectedCandidateIds.has(
                            candidate.id,
                          )
                        }
                        onChange={() =>
                          toggleCandidateSelection(
                            candidate.id,
                          )
                        }
                        disabled={
                          working
                        }
                      />
                    )}

                    <div className="csb-product-content">

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

                    <div className="csb-badge-row">

                      <span className="csb-template-badge">
                        {
                          candidate
                            .templateName
                        }
                      </span>

                      <span
                        className={
                          candidate
                            .wifiAdapter
                            ? "csb-wifi-badge csb-wifi-badge--no"
                            : "csb-wifi-badge csb-wifi-badge--yes"
                        }
                      >
                        {
                          candidate
                            .wifiAdapter
                            ? "Sin Wi-Fi · agrega adaptador"
                            : "Wi-Fi integrado"
                        }
                      </span>

                    </div>

                    {match
                      .existingProduct && (
                      <div className="csb-existing-product">

                        Shopify:{" "}

                        <a
                          className="csb-existing-product__link"
                          href={
                            getShopifyAdminProductHref(
                              match
                                .existingProduct
                                .id,
                            )
                          }
                        >
                          {
                            match
                              .existingProduct
                              .title
                          }
                        </a>

                      </div>
                    )}

                    </div>

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

                        <fetcher.Form
                          method="post"
                          onSubmit={() =>
                            setCreatingCandidateId(
                              candidate.id,
                            )
                          }
                        >

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
                            {working &&
                            creatingCandidateId ===
                              candidate.id
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