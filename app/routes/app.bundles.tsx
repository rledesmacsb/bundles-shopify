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
  type ExistingBundleLookupStatus,
} from "../lib/bundle-existing.server";

import {
  invalidateShopBundleCache,
  loadCachedBundleRuntimeSettings,
  loadCachedBundleTemplateCatalog,
  loadCachedExistingBundleMatches,
} from "../lib/bundle-cache.server";

import {
  loadPcMonitorManualExcludedProductIds,
  savePcMonitorManualExcludedProductIds,
} from "../lib/bundle-data.server";

import {
  createDraftBundleFromCandidate,
  syncExistingBundleWeightFromCandidate,
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
      session,
    } =
      await authenticate.admin(
        request,
      );

    const [
      catalog,
      runtime,
    ] =
      await Promise.all([
        loadCachedBundleTemplateCatalog(
          admin,
          session.shop,
        ),

        loadCachedBundleRuntimeSettings(
          admin,
          session.shop,
        ),
      ]);

    const state =
      buildTemplateBundleState(
        catalog.products,
        catalog.templates,
        runtime.componentConfig,
      );

    const existingBundleMatches =
      await loadCachedExistingBundleMatches(
        admin,
        session.shop,
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
      session,
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

      const result =
        await createDraftBundleFromCandidate(
          admin,
          candidateId,
        );

      if (
        result.success ||
        (
          "partial" in
            result &&
          Boolean(
            result.partial,
          )
        )
      ) {
        invalidateShopBundleCache(
          session.shop,
        );
      }

      return result;
    }

    /* -----------------------------------------------------
       SYNC WEIGHT ON AN EXISTING BUNDLES PRODUCT
    ----------------------------------------------------- */

    if (
      intent ===
      "sync_weight"
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
            "No se recibió la propuesta a actualizar.",
        };
      }

      const result =
        await syncExistingBundleWeightFromCandidate(
          admin,
          candidateId,
        );

      if (
        result.success
      ) {
        invalidateShopBundleCache(
          session.shop,
        );
      }

      return result;
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

    invalidateShopBundleCache(
      session.shop,
    );

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
   WORKFLOW VIEWS
========================================================= */

type BundleView =
  | "create"
  | "published"
  | "unpublished"
  | "excluded";

type BundleSort =
  | "stock_desc"
  | "price_asc"
  | "savings_desc";

type BulkCreationResult = {
  candidateId: string;
  success: boolean;
  partial: boolean;
  message: string;
};

const PAGE_SIZE =
  25;

function isExistingStatus(
  status:
    ExistingBundleLookupStatus,
) {
  return (
    status ===
      "existing_managed" ||
    status ===
      "existing_legacy"
  );
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

function getWorkflowStatusLabel(
  status:
    ExistingBundleLookupStatus,

  publishedAt:
    | string
    | null
    | undefined,
) {
  if (
    status ===
    "new"
  ) {
    return "Por crear";
  }

  if (
    isExistingStatus(
      status,
    )
  ) {
    return publishedAt
      ? "Publicado"
      : "Sin publicar";
  }

  switch (
    status
  ) {
    case "sku_conflict":
      return "Conflicto SKU";

    case "missing_base_sku":
      return "Falta SKU";

    case "lookup_error":
      return "Revisar";

    default:
      return "Revisar";
  }
}

function getWorkflowStatusClass(
  status:
    ExistingBundleLookupStatus,

  publishedAt:
    | string
    | null
    | undefined,
) {
  if (
    status ===
    "new"
  ) {
    return "csb-status csb-status--create";
  }

  if (
    isExistingStatus(
      status,
    )
  ) {
    return publishedAt
      ? "csb-status csb-status--published"
      : "csb-status csb-status--unpublished";
  }

  return "csb-status csb-status--warning";
}

function getProductStatusLabel(
  status:
    | string
    | null
    | undefined,
) {
  switch (
    status
  ) {
    case "ACTIVE":
      return "Activo";

    case "DRAFT":
      return "Borrador";

    case "ARCHIVED":
      return "Archivado";

    case "UNLISTED":
      return "No listado";

    default:
      return status
        ? status
        : "No creado";
  }
}

function getProductStatusClass(
  status:
    | string
    | null
    | undefined,
) {
  switch (
    status
  ) {
    case "ACTIVE":
      return "csb-status csb-status--product-active";

    case "DRAFT":
      return "csb-status csb-status--product-draft";

    case "ARCHIVED":
      return "csb-status csb-status--product-archived";

    default:
      return "csb-status csb-status--unpublished";
  }
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
    view,
    setView,
  ] =
    useState<
      BundleView
    >(
      "create",
    );

  const [
    templateFilter,
    setTemplateFilter,
  ] =
    useState(
      "all",
    );

  const [
    sortMode,
    setSortMode,
  ] =
    useState<
      BundleSort
    >(
      "stock_desc",
    );

  const [
    page,
    setPage,
  ] =
    useState(
      1,
    );

  const [
    detailCandidateId,
    setDetailCandidateId,
  ] =
    useState<
      string | null
    >(
      null,
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
    const handleKeyDown =
      (
        event:
          KeyboardEvent,
      ) => {
        if (
          event.key ===
          "Escape"
        ) {
          setDetailCandidateId(
            null,
          );
        }
      };

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () =>
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
  }, []);

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

  const createCount =
    newCount +
    reviewMatchCount +
    state
      .multiVariantBaseProducts
      .length;

  const publishedCount =
    data
      .existingBundleMatches
      .matches
      .filter(
        (match) =>
          isExistingStatus(
            match.status,
          ) &&
          Boolean(
            match
              .existingProduct
              ?.publishedAt,
          ),
      )
      .length;

  const unpublishedCount =
    data
      .existingBundleMatches
      .matches
      .filter(
        (match) =>
          isExistingStatus(
            match.status,
          ) &&
          !match
            .existingProduct
            ?.publishedAt,
      )
      .length;

  const excludedCount =
    state
      .manuallyExcludedProducts
      .length +
    state
      .automaticallyExcludedProducts
      .length;

  const filteredCandidates =
    useMemo(
      () => {
        const query =
          search
            .trim()
            .toLocaleLowerCase(
              "es",
            );

        const candidates =
          state.candidates.filter(
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
                view ===
                "create"
              ) {
                if (
                  match.status !==
                    "new" &&
                  !isReviewStatus(
                    match.status,
                  )
                ) {
                  return false;
                }
              }

              if (
                view ===
                "published"
              ) {
                if (
                  !isExistingStatus(
                    match.status,
                  ) ||
                  !match
                    .existingProduct
                    ?.publishedAt
                ) {
                  return false;
                }
              }

              if (
                view ===
                "unpublished"
              ) {
                if (
                  !isExistingStatus(
                    match.status,
                  ) ||
                  match
                    .existingProduct
                    ?.publishedAt
                ) {
                  return false;
                }
              }

              if (
                view ===
                "excluded"
              ) {
                return false;
              }

              if (
                templateFilter !==
                  "all" &&
                candidate.templateId !==
                  templateFilter
              ) {
                return false;
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

              return [
                candidate
                  .baseProduct
                  .title,
                candidate
                  .monitor
                  .title,
                candidate
                  .identity
                  .sku,
                baseSku,
                monitorSku,
              ].some(
                (value) =>
                  value
                    .toLocaleLowerCase(
                      "es",
                    )
                    .includes(
                      query,
                    ),
              );
            },
          );

        return [
          ...candidates,
        ].sort(
          (
            a,
            b,
          ) => {
            const priceA =
              calculateTemplateCandidatePrice(
                a,
                data.runtime.priceConfig,
              );

            const priceB =
              calculateTemplateCandidatePrice(
                b,
                data.runtime.priceConfig,
              );

            if (
              sortMode ===
              "price_asc"
            ) {
              return (
                priceA.finalPrice -
                priceB.finalPrice
              );
            }

            if (
              sortMode ===
              "savings_desc"
            ) {
              return (
                priceB.savings -
                priceA.savings
              );
            }

            const stockDifference =
              getTemplateCandidateStock(
                b,
              ) -
              getTemplateCandidateStock(
                a,
              );

            if (
              stockDifference !==
              0
            ) {
              return stockDifference;
            }

            return a
              .baseProduct
              .title
              .localeCompare(
                b
                  .baseProduct
                  .title,
                "es",
              );
          },
        );
      },
      [
        state.candidates,
        matchByCandidateId,
        search,
        view,
        templateFilter,
        sortMode,
        data.runtime.priceConfig,
      ],
    );

  useEffect(() => {
    setPage(
      1,
    );
  }, [
    search,
    view,
    templateFilter,
    sortMode,
  ]);

  useEffect(() => {
    if (
      !bulkRunning
    ) {
      setSelectedCandidateIds(
        new Set(),
      );
    }

    setDetailCandidateId(
      null,
    );
  }, [
    view,
    templateFilter,
    bulkRunning,
  ]);

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        filteredCandidates.length /
        PAGE_SIZE,
      ),
    );

  useEffect(() => {
    if (
      page >
      totalPages
    ) {
      setPage(
        totalPages,
      );
    }
  }, [
    page,
    totalPages,
  ]);

  const pagedCandidates =
    filteredCandidates.slice(
      (
        page -
        1
      ) *
        PAGE_SIZE,

      page *
        PAGE_SIZE,
    );

  const visibleNewCandidateIds =
    pagedCandidates
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
      );

  const selectedNewCandidateIds =
    state.candidates
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

  const visibleMultiVariant =
    view ===
    "create"
      ? state
          .multiVariantBaseProducts
          .filter(
            (product) => {
              const query =
                search
                  .trim()
                  .toLocaleLowerCase(
                    "es",
                  );

              return (
                !query ||
                product
                  .title
                  .toLocaleLowerCase(
                    "es",
                  )
                  .includes(
                    query,
                  )
              );
            },
          )
      : [];

  const excludedQuery =
    search
      .trim()
      .toLocaleLowerCase(
        "es",
      );

  const visibleManualExcluded =
    view ===
    "excluded"
      ? state
          .manuallyExcludedProducts
          .filter(
            (product) =>
              !excludedQuery ||
              product
                .title
                .toLocaleLowerCase(
                  "es",
                )
                .includes(
                  excludedQuery,
                ) ||
              (
                getFirstTemplateVariant(
                  product,
                )?.sku ??
                ""
              )
                .toLocaleLowerCase(
                  "es",
                )
                .includes(
                  excludedQuery,
                ),
          )
      : [];

  const visibleAutomaticExcluded =
    view ===
    "excluded"
      ? state
          .automaticallyExcludedProducts
          .filter(
            (product) =>
              !excludedQuery ||
              product
                .title
                .toLocaleLowerCase(
                  "es",
                )
                .includes(
                  excludedQuery,
                ),
          )
      : [];

  const detailCandidate =
    detailCandidateId
      ? state.candidates.find(
          (candidate) =>
            candidate.id ===
            detailCandidateId,
        ) ??
        null
      : null;

  const detailMatch =
    detailCandidate
      ? matchByCandidateId.get(
          detailCandidate.id,
        ) ??
        null
      : null;

  const detailPrice =
    detailCandidate
      ? calculateTemplateCandidatePrice(
          detailCandidate,
          data.runtime.priceConfig,
        )
      : null;

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

          for (
            const candidateId
            of visibleNewCandidateIds
          ) {
            if (
              allVisibleNewSelected
            ) {
              next.delete(
                candidateId,
              );
            } else {
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
          "Selecciona al menos una propuesta de Bundles por crear.",
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

  const resultCount =
    view ===
    "excluded"
      ? visibleManualExcluded.length +
        visibleAutomaticExcluded.length
      : filteredCandidates.length +
        visibleMultiVariant.length;

  return (
    <s-page
      heading="Bundles"
      inlineSize="large"
    >

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
          padding-bottom: 28px;
          color: #202223;
        }

        .csb-hero {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 24px;
          margin-bottom: 18px;
          padding: 4px 2px 0;
        }

        .csb-title {
          margin: 0 0 5px;
          font-size: 21px;
          line-height: 1.2;
          font-weight: 720;
        }

        .csb-description {
          max-width: 760px;
          margin: 0;
          color: #69727d;
          font-size: 12px;
          line-height: 1.5;
        }

        .csb-hero-meta {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
          justify-content: flex-end;
          color: #69727d;
          font-size: 10.5px;
        }

        .csb-meta-item {
          white-space: nowrap;
        }

        .csb-meta-item strong {
          color: #202223;
          font-weight: 650;
        }

        .csb-error-banner,
        .csb-warning-banner {
          margin-bottom: 12px;
          padding: 12px 14px;
          border-radius: 12px;
          font-size: 11px;
          line-height: 1.5;
        }

        .csb-error-banner {
          border: 1px solid #e6b7b7;
          background: #fff5f5;
          color: #8f2525;
        }

        .csb-warning-banner {
          border: 1px solid #eed5a7;
          background: #fffaf2;
          color: #73510c;
        }

        .csb-warning-banner ul {
          margin: 7px 0 0;
          padding-left: 18px;
        }

        .csb-index {
          border: 1px solid #dfe5ec;
          border-radius: 12px;
          background: #fff;
        }

        .csb-views {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 12px 14px;
          border-bottom: 1px solid #edf0f3;
          overflow-x: auto;
        }

        .csb-view {
          flex: 0 0 auto;
          min-height: 34px;
          padding: 6px 11px;
          border: 1px solid transparent;
          border-radius: 9px;
          background: transparent;
          color: #53606d;
          font: inherit;
          font-size: 11px;
          font-weight: 650;
          cursor: pointer;
        }

        .csb-view:hover {
          background: #f6f8fa;
        }

        .csb-view--active {
          border-color: #cfe0fb;
          background: #eef5ff;
          color: #0c62f2;
        }

        .csb-controls {
          display: grid;
          grid-template-columns:
            minmax(260px, 1fr)
            minmax(190px, 260px)
            minmax(170px, 220px);
          gap: 10px;
          padding: 12px 14px;
          border-bottom: 1px solid #edf0f3;
          background: #fbfcfd;
        }

        .csb-control {
          width: 100%;
          height: 38px;
          min-width: 0;
          padding: 0 11px;
          border: 1px solid #d4d9df;
          border-radius: 9px;
          background: #fff;
          color: #202223;
          font: inherit;
          font-size: 11px;
          outline: none;
        }

        .csb-control:focus {
          border-color: #8db5f6;
          box-shadow: 0 0 0 3px rgba(12, 98, 242, .08);
        }

        .csb-selection-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 10px 14px;
          border-bottom: 1px solid #d8e5f8;
          background: #f5f9ff;
        }

        .csb-selection-info {
          color: #53606d;
          font-size: 11px;
        }

        .csb-selection-info strong {
          color: #0c62f2;
        }

        .csb-primary-button,
        .csb-secondary-button,
        .csb-link-button {
          appearance: none;
          min-height: 34px;
          padding: 6px 11px;
          border-radius: 8px;
          font: inherit;
          font-size: 10.5px;
          font-weight: 650;
          cursor: pointer;
        }

        .csb-primary-button {
          border: 1px solid #0c62f2;
          background: #0c62f2;
          color: #fff;
        }

        .csb-primary-button:hover {
          border-color: #0a56d5;
          background: #0a56d5;
        }

        .csb-secondary-button {
          border: 1px solid #d4d9df;
          background: #fff;
          color: #30363d;
        }

        .csb-link-button {
          border: 0;
          background: transparent;
          color: #0c62f2;
        }

        .csb-primary-button:disabled,
        .csb-secondary-button:disabled,
        .csb-link-button:disabled {
          opacity: .5;
          cursor: default;
        }

        .csb-bulk-progress {
          padding: 10px 14px;
          border-bottom: 1px solid #d8e5f8;
          background: #f8fbff;
          color: #42628d;
          font-size: 10.5px;
        }

        .csb-table-header,
        .csb-table-row {
          display: grid;
          grid-template-columns:
            38px
            minmax(330px, 2.4fr)
            118px
            108px
            90px
            125px
            96px;
          gap: 14px;
          align-items: center;
        }

        .csb-table-header {
          position: sticky;
          top: 0;
          z-index: 3;
          min-height: 40px;
          padding: 0 14px;
          border-bottom: 1px solid #dfe5ec;
          background: rgba(255, 255, 255, .98);
          color: #7b8590;
          font-size: 9px;
          font-weight: 720;
          letter-spacing: .055em;
          text-transform: uppercase;
        }

        .csb-table-header--right {
          text-align: right;
        }

        .csb-table-row {
          min-height: 72px;
          padding: 12px 14px;
          border-bottom: 1px solid #edf0f3;
          transition: background .12s ease;
        }

        .csb-table-row:last-child {
          border-bottom: 0;
        }

        .csb-table-row:hover {
          background: #fbfdff;
        }

        .csb-table-row--selected {
          background: #f7faff;
          box-shadow: inset 3px 0 0 #0c62f2;
        }

        .csb-table-row--warning {
          background: #fffdf7;
        }

        .csb-check-cell {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 24px;
        }

        .csb-checkbox {
          width: 15px;
          height: 15px;
          accent-color: #0c62f2;
          cursor: pointer;
        }

        .csb-bundle-cell {
          min-width: 0;
        }

        .csb-base-title {
          overflow: hidden;
          margin-bottom: 3px;
          color: #202223;
          font-size: 12.5px;
          line-height: 1.35;
          font-weight: 680;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .csb-monitor-title {
          overflow: hidden;
          color: #66717d;
          font-size: 10.5px;
          line-height: 1.35;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .csb-row-warning {
          margin-top: 5px;
          color: #8a5a00;
          font-size: 9.5px;
          line-height: 1.35;
        }

        .csb-number {
          color: #202223;
          font-size: 11.5px;
          font-weight: 650;
          text-align: right;
          white-space: nowrap;
        }

        .csb-saving {
          color: #26733e;
          font-size: 11px;
          font-weight: 650;
          text-align: right;
          white-space: nowrap;
        }

        .csb-muted {
          color: #8a939d;
          font-size: 10.5px;
        }

        .csb-status {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 25px;
          padding: 4px 8px;
          border-radius: 999px;
          font-size: 9.5px;
          font-weight: 680;
          white-space: nowrap;
        }

        .csb-status--create {
          background: #eef5ff;
          color: #0c62f2;
        }

        .csb-status--published {
          background: #eaf8ee;
          color: #26733e;
        }

        .csb-status--unpublished {
          background: #eef0f3;
          color: #59636e;
        }

        .csb-status--warning {
          background: #fff1d7;
          color: #835800;
        }

        .csb-status--product-active {
          background: #eaf8ee;
          color: #26733e;
        }

        .csb-status--product-draft {
          background: #eef0f3;
          color: #59636e;
        }

        .csb-status--product-archived {
          background: #f3f0f0;
          color: #765454;
        }

        .csb-status-stack {
          display: flex;
          align-items: flex-start;
          flex-direction: column;
          gap: 4px;
        }

        .csb-status-note {
          color: #8a939d;
          font-size: 9px;
          line-height: 1.25;
        }

        .csb-row-action {
          display: flex;
          justify-content: flex-end;
        }

        .csb-row-action button,
        .csb-row-action a {
          color: #0c62f2;
          font-size: 10.5px;
          font-weight: 620;
          text-decoration: none;
        }

        .csb-excluded-row {
          display: grid;
          grid-template-columns:
            38px
            minmax(330px, 2.4fr)
            118px
            108px
            90px
            125px
            96px;
          gap: 14px;
          align-items: center;
          min-height: 68px;
          padding: 12px 14px;
          border-bottom: 1px solid #edf0f3;
        }

        .csb-empty {
          padding: 52px 18px;
          color: #69727d;
          text-align: center;
          font-size: 12px;
        }

        .csb-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          min-height: 48px;
          padding: 8px 14px;
          border-top: 1px solid #edf0f3;
          background: #fbfcfd;
          border-radius: 0 0 16px 16px;
          color: #69727d;
          font-size: 10.5px;
        }

        .csb-pagination {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .csb-pagination button {
          min-height: 30px;
          padding: 4px 9px;
          border: 1px solid #d4d9df;
          border-radius: 8px;
          background: #fff;
          color: #30363d;
          font: inherit;
          font-size: 10px;
          cursor: pointer;
        }

        .csb-pagination button:disabled {
          opacity: .45;
          cursor: default;
        }

        .csb-drawer-backdrop {
          position: fixed;
          inset: 0;
          z-index: 999;
          background: rgba(24, 29, 35, .3);
          backdrop-filter: blur(1px);
        }

        .csb-drawer {
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          z-index: 1000;
          width: min(460px, 94vw);
          overflow-y: auto;
          border-left: 1px solid #dfe5ec;
          background: #fff;
          box-shadow: -18px 0 42px rgba(31, 33, 36, .14);
        }

        .csb-drawer__header {
          position: sticky;
          top: 0;
          z-index: 2;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          padding: 18px;
          border-bottom: 1px solid #edf0f3;
          background: rgba(255, 255, 255, .98);
          backdrop-filter: blur(8px);
        }

        .csb-drawer__eyebrow {
          margin-bottom: 5px;
          color: #0c62f2;
          font-size: 9px;
          font-weight: 740;
          letter-spacing: .07em;
          text-transform: uppercase;
        }

        .csb-drawer__title {
          margin: 0;
          color: #202223;
          font-size: 16px;
          line-height: 1.35;
          font-weight: 720;
        }

        .csb-close {
          width: 32px;
          height: 32px;
          flex: 0 0 auto;
          border: 1px solid #dfe5ec;
          border-radius: 8px;
          background: #fff;
          color: #53606d;
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
        }

        .csb-drawer__body {
          padding: 18px;
        }

        .csb-detail-section {
          margin-bottom: 20px;
          padding-bottom: 18px;
          border-bottom: 1px solid #edf0f3;
        }

        .csb-detail-section:last-child {
          border-bottom: 0;
        }

        .csb-detail-heading {
          margin: 0 0 10px;
          color: #202223;
          font-size: 11px;
          font-weight: 720;
        }

        .csb-detail-row {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 8px;
          color: #68737f;
          font-size: 10.5px;
          line-height: 1.45;
        }

        .csb-detail-row:last-child {
          margin-bottom: 0;
        }

        .csb-detail-row strong {
          max-width: 65%;
          color: #202223;
          text-align: right;
          font-weight: 650;
          overflow-wrap: anywhere;
        }

        .csb-detail-component {
          padding: 10px 0;
          border-bottom: 1px solid #f0f2f4;
        }

        .csb-detail-component:last-child {
          border-bottom: 0;
        }

        .csb-detail-component__role {
          margin-bottom: 3px;
          color: #8a939d;
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
        }

        .csb-detail-component__name {
          color: #202223;
          font-size: 11px;
          line-height: 1.4;
          font-weight: 620;
        }

        .csb-detail-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .csb-detail-actions form,
        .csb-detail-actions button,
        .csb-detail-actions a {
          width: 100%;
        }

        .csb-detail-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 36px;
          border: 1px solid #d4d9df;
          border-radius: 8px;
          background: #fff;
          color: #0c62f2;
          font-size: 10.5px;
          font-weight: 650;
          text-decoration: none;
        }

        @media (max-width: 1180px) {
          .csb-table-header {
            display: none;
          }

          .csb-table-row,
          .csb-excluded-row {
            grid-template-columns:
              34px
              minmax(0, 1.8fr)
              1fr
              1fr;
          }

          .csb-table-row > :nth-child(5),
          .csb-table-row > :nth-child(7),
          .csb-excluded-row > :nth-child(5),
          .csb-excluded-row > :nth-child(7) {
            grid-column: auto;
          }
        }

        @media (max-width: 760px) {
          .csb-page {
            padding-bottom: 16px;
          }

          .csb-hero {
            align-items: stretch;
            flex-direction: column;
            gap: 10px;
            margin-bottom: 14px;
          }

          .csb-title {
            font-size: 19px;
          }

          .csb-description {
            font-size: 11.5px;
          }

          .csb-hero-meta {
            display: grid;
            grid-template-columns: 1fr;
            gap: 5px;
            justify-content: stretch;
            font-size: 10px;
          }

          .csb-index {
            margin-inline: -2px;
            border-radius: 10px;
          }

          .csb-views {
            gap: 4px;
            padding: 9px 10px;
            scrollbar-width: none;
            scroll-snap-type: x proximity;
          }

          .csb-views::-webkit-scrollbar {
            display: none;
          }

          .csb-view {
            min-height: 38px;
            padding: 7px 11px;
            scroll-snap-align: start;
          }

          .csb-controls {
            grid-template-columns: 1fr;
            gap: 8px;
            padding: 10px;
          }

          .csb-control {
            height: 42px;
            font-size: 12px;
          }

          .csb-selection-bar {
            position: sticky;
            bottom: 0;
            z-index: 20;
            align-items: stretch;
            flex-direction: column;
            gap: 8px;
            padding: 10px;
            box-shadow: 0 -3px 10px rgba(31, 33, 36, .07);
          }

          .csb-primary-button,
          .csb-secondary-button {
            min-height: 42px;
          }

          .csb-bulk-progress {
            padding: 10px;
          }

          .csb-table-row,
          .csb-excluded-row {
            grid-template-columns:
              24px
              minmax(0, 1fr);
            gap: 8px 10px;
            min-height: 0;
            padding: 13px 10px;
          }

          .csb-table-row > :nth-child(n+3),
          .csb-excluded-row > :nth-child(n+3) {
            grid-column: 2;
            display: grid;
            grid-template-columns:
              82px
              minmax(0, 1fr);
            gap: 8px;
            align-items: center;
            text-align: left;
          }

          .csb-table-row > :nth-child(3)::before {
            content: "Precio";
          }

          .csb-table-row > :nth-child(4)::before {
            content: "Ahorro";
          }

          .csb-table-row > :nth-child(5)::before,
          .csb-excluded-row > :nth-child(5)::before {
            content: "Disponibles";
          }

          .csb-table-row > :nth-child(6)::before,
          .csb-excluded-row > :nth-child(6)::before {
            content: "Estado";
          }

          .csb-table-row > :nth-child(7)::before,
          .csb-excluded-row > :nth-child(7)::before {
            content: "Acción";
          }

          .csb-table-row > :nth-child(n+3)::before,
          .csb-excluded-row > :nth-child(n+3)::before {
            color: #8a939d;
            font-size: 9px;
            font-weight: 700;
            letter-spacing: .035em;
            text-transform: uppercase;
          }

          .csb-excluded-row > :nth-child(3),
          .csb-excluded-row > :nth-child(4) {
            display: none;
          }

          .csb-base-title {
            white-space: normal;
            font-size: 12px;
          }

          .csb-monitor-title {
            white-space: normal;
            font-size: 10.5px;
          }

          .csb-number,
          .csb-saving {
            text-align: left;
          }

          .csb-row-action {
            justify-content: flex-start;
          }

          .csb-row-action .csb-link-button {
            min-height: 36px;
            padding: 5px 0;
            text-align: left;
          }

          .csb-footer {
            align-items: stretch;
            flex-direction: column;
            gap: 8px;
            padding: 10px;
          }

          .csb-pagination {
            justify-content: space-between;
          }

          .csb-pagination button {
            min-height: 38px;
            padding-inline: 12px;
          }

          .csb-drawer {
            left: 0;
            width: 100vw;
            border-left: 0;
          }

          .csb-drawer__header {
            padding: 14px;
          }

          .csb-drawer__body {
            padding: 14px;
          }

          .csb-close {
            width: 38px;
            height: 38px;
          }

          .csb-detail-actions button,
          .csb-detail-actions a {
            min-height: 42px;
          }
        }
      `}</style>

      <div className="csb-page">

        <div className="csb-hero">

          <div>

            <h2 className="csb-title">
              Bundles
            </h2>

            <p className="csb-description">
              Revisa las propuestas y distingue el estado del producto en Shopify de su publicación en Tienda online.
            </p>

          </div>

          <div className="csb-hero-meta">

            <span className="csb-meta-item">
              Canal:{" "}
              <strong>
                Tienda online
              </strong>
            </span>

            <span className="csb-meta-item">
              Precio:{" "}
              <strong>
                {data.runtime.priceConfig.mode ===
                "percentage"
                  ? `${data.runtime.priceConfig.percentage}% sobre el PC`
                  : data.runtime.priceConfig.mode ===
                      "fixed"
                    ? `${formatPrice(
                        data.runtime.priceConfig.fixedAmount,
                        data.catalog.currencyCode,
                      )} sobre el PC`
                    : "Sin descuento"}
              </strong>
            </span>

          </div>

        </div>

        {systemErrors.length >
          0 && (
          <div className="csb-error-banner">
            <strong>
              No fue posible completar toda la lectura de Shopify.
            </strong>
            {" "}
            {systemErrors.join(
              " | ",
            )}
          </div>
        )}

        {state.issues.length >
          0 && (
          <div className="csb-warning-banner">
            <strong>
              Hay configuraciones que requieren revisión:
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

        <div className="csb-index">

          <div className="csb-views">

            {([
              [
                "create",
                "Por crear",
                createCount,
              ],
              [
                "published",
                "Publicados",
                publishedCount,
              ],
              [
                "unpublished",
                "Sin publicar",
                unpublishedCount,
              ],
              [
                "excluded",
                "Excluidos",
                excludedCount,
              ],
            ] as Array<
              [
                BundleView,
                string,
                number,
              ]
            >).map(
              (
                [
                  value,
                  label,
                  count,
                ],
              ) => (
                <button
                  key={value}
                  type="button"
                  className={
                    view ===
                    value
                      ? "csb-view csb-view--active"
                      : "csb-view"
                  }
                  onClick={() =>
                    setView(
                      value,
                    )
                  }
                >
                  {label}{" "}
                  {count}
                </button>
              ),
            )}

          </div>

          <div className="csb-controls">

            <input
              className="csb-control"
              type="search"
              placeholder="Buscar por modelo o SKU..."
              value={
                search
              }
              onChange={(event) =>
                setSearch(
                  event.target.value,
                )
              }
            />

            <select
              className="csb-control"
              value={
                templateFilter
              }
              disabled={
                view ===
                "excluded"
              }
              onChange={(event) =>
                setTemplateFilter(
                  event.target.value,
                )
              }
            >
              <option value="all">
                Todos los tipos de Bundles
              </option>

              {state.summaries
                .filter(
                  (summary) =>
                    summary.enabled,
                )
                .map(
                  (summary) => (
                    <option
                      key={
                        summary.templateId
                      }
                      value={
                        summary.templateId
                      }
                    >
                      {
                        summary.templateName
                      }
                    </option>
                  ),
                )}
            </select>

            <select
              className="csb-control"
              value={
                sortMode
              }
              disabled={
                view ===
                "excluded"
              }
              onChange={(event) =>
                setSortMode(
                  event.target
                    .value as BundleSort,
                )
              }
            >
              <option value="stock_desc">
                Mayor disponibilidad
              </option>
              <option value="price_asc">
                Menor precio
              </option>
              <option value="savings_desc">
                Mayor ahorro
              </option>
            </select>

          </div>

          {selectedNewCandidateIds.length >
            0 && (
            <div className="csb-selection-bar">

              <div className="csb-selection-info">
                <strong>
                  {
                    selectedNewCandidateIds.length
                  }
                </strong>
                {" "}
                propuesta(s) seleccionada(s)
              </div>

              <button
                type="button"
                className="csb-primary-button"
                disabled={
                  working
                }
                onClick={
                  startBulkCreation
                }
              >
                {bulkRunning
                  ? "Creando borradores..."
                  : `Crear borradores (${selectedNewCandidateIds.length})`}
              </button>

            </div>
          )}

          {(bulkRunning ||
            bulkResults.length >
              0) && (
            <div className="csb-bulk-progress">

              {bulkRunning
                ? `Procesando ${bulkResults.length + 1} de ${bulkQueue.length}. Cada propuesta se valida nuevamente antes de crearse.`
                : `Último proceso: ${bulkResults.filter((item) => item.success).length} creados · ${bulkResults.filter((item) => !item.success && !item.partial).length} omitidos · ${bulkResults.filter((item) => !item.success && item.partial).length} para revisar.`}

            </div>
          )}

          {view !==
            "excluded" && (
            <div className="csb-table-header">

              <div className="csb-check-cell">
                {view ===
                  "create" &&
                  visibleNewCandidateIds.length >
                    0 && (
                  <input
                    className="csb-checkbox"
                    type="checkbox"
                    aria-label="Seleccionar propuestas visibles"
                    checked={
                      allVisibleNewSelected
                    }
                    onChange={
                      toggleVisibleNewSelection
                    }
                    disabled={
                      working
                    }
                  />
                )}
              </div>

              <div>
                Bundles
              </div>

              <div className="csb-table-header--right">
                Precio
              </div>

              <div className="csb-table-header--right">
                Ahorro
              </div>

              <div className="csb-table-header--right">
                Disponibles
              </div>

              <div>
                Estado
              </div>

              <div />

            </div>
          )}

          {view ===
            "excluded" && (
            <div className="csb-table-header">

              <div />

              <div>
                Producto
              </div>

              <div />

              <div />

              <div className="csb-table-header--right">
                Stock
              </div>

              <div>
                Estado
              </div>

              <div />

            </div>
          )}

          {pagedCandidates.map(
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

              const selected =
                selectedCandidateIds.has(
                  candidate.id,
                );

              return (
                <div
                  key={
                    candidate.id
                  }
                  className={[
                    "csb-table-row",
                    selected
                      ? "csb-table-row--selected"
                      : "",
                    isReviewStatus(
                      match.status,
                    )
                      ? "csb-table-row--warning"
                      : "",
                  ]
                    .filter(
                      Boolean,
                    )
                    .join(
                      " ",
                    )}
                >

                  <div className="csb-check-cell">
                    {match.status ===
                      "new" && (
                      <input
                        className="csb-checkbox"
                        type="checkbox"
                        aria-label="Seleccionar propuesta de Bundles"
                        checked={
                          selected
                        }
                        disabled={
                          working
                        }
                        onChange={() =>
                          toggleCandidateSelection(
                            candidate.id,
                          )
                        }
                      />
                    )}
                  </div>

                  <div className="csb-bundle-cell">

                    <div className="csb-base-title">
                      {
                        candidate
                          .baseProduct
                          .title
                      }
                    </div>

                    <div className="csb-monitor-title">
                      {
                        candidate
                          .monitor
                          .title
                      }
                    </div>

                    {isReviewStatus(
                      match.status,
                    ) && (
                      <div className="csb-row-warning">
                        {
                          match.message
                        }
                      </div>
                    )}

                  </div>

                  <div className="csb-number">
                    {formatPrice(
                      price.finalPrice,
                      data.catalog.currencyCode,
                    )}
                  </div>

                  <div className="csb-saving">
                    {price.savings >
                      0
                      ? formatPrice(
                          price.savings,
                          data.catalog.currencyCode,
                        )
                      : "—"}
                  </div>

                  <div className="csb-number">
                    {
                      getTemplateCandidateStock(
                        candidate,
                      )
                    }
                  </div>

                  <div>
                    {isExistingStatus(
                      match.status,
                    ) &&
                    match.existingProduct ? (
                      <div className="csb-status-stack">

                        <span
                          className={
                            getProductStatusClass(
                              match
                                .existingProduct
                                .status,
                            )
                          }
                        >
                          {
                            getProductStatusLabel(
                              match
                                .existingProduct
                                .status,
                            )
                          }
                        </span>

                        <span
                          className={
                            match
                              .existingProduct
                              .publishedAt
                              ? "csb-status csb-status--published"
                              : "csb-status csb-status--unpublished"
                          }
                        >
                          {match
                            .existingProduct
                            .publishedAt
                            ? "Tienda online"
                            : "Sin publicar"}
                        </span>

                      </div>
                    ) : (
                      <span
                        className={
                          getWorkflowStatusClass(
                            match.status,
                            match
                              .existingProduct
                              ?.publishedAt,
                          )
                        }
                      >
                        {
                          getWorkflowStatusLabel(
                            match.status,
                            match
                              .existingProduct
                              ?.publishedAt,
                          )
                        }
                      </span>
                    )}
                  </div>

                  <div className="csb-row-action">
                    <button
                      type="button"
                      className="csb-link-button"
                      onClick={() =>
                        setDetailCandidateId(
                          candidate.id,
                        )
                      }
                    >
                      Ver detalle
                    </button>
                  </div>

                </div>
              );
            },
          )}

          {view ===
            "create" &&
            visibleMultiVariant.map(
              (product) => (
                <div
                  className="csb-table-row csb-table-row--warning"
                  key={
                    product.id
                  }
                >

                  <div className="csb-check-cell" />

                  <div className="csb-bundle-cell">
                    <div className="csb-base-title">
                      {
                        product.title
                      }
                    </div>
                    <div className="csb-row-warning">
                      Tiene múltiples variantes. La creación automática permanece bloqueada.
                    </div>
                  </div>

                  <div className="csb-muted">
                    —
                  </div>

                  <div className="csb-muted">
                    —
                  </div>

                  <div className="csb-number">
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

          {view ===
            "excluded" &&
            visibleManualExcluded.map(
              (product) => (
                <div
                  className="csb-excluded-row"
                  key={
                    product.id
                  }
                >

                  <div />

                  <div className="csb-bundle-cell">
                    <div className="csb-base-title">
                      {
                        product.title
                      }
                    </div>
                    <div className="csb-monitor-title">
                      {
                        getFirstTemplateVariant(
                          product,
                        )?.sku ??
                        "Sin SKU"
                      }
                    </div>
                  </div>

                  <div />
                  <div />

                  <div className="csb-number">
                    {
                      product.totalInventory
                    }
                  </div>

                  <div>
                    <span className="csb-status csb-status--warning">
                      Excluido manual
                    </span>
                  </div>

                  <div className="csb-row-action">
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
                        type="submit"
                        className="csb-link-button"
                        disabled={
                          working
                        }
                      >
                        Incluir
                      </button>
                    </fetcher.Form>
                  </div>

                </div>
              ),
            )}

          {view ===
            "excluded" &&
            visibleAutomaticExcluded.map(
              (product) => (
                <div
                  className="csb-excluded-row"
                  key={
                    product.id
                  }
                >

                  <div />

                  <div className="csb-bundle-cell">
                    <div className="csb-base-title">
                      {
                        product.title
                      }
                    </div>
                    <div className="csb-monitor-title">
                      Exclusión automática por producto “Arma a tu medida”.
                    </div>
                  </div>

                  <div />
                  <div />

                  <div className="csb-number">
                    {
                      product.totalInventory
                    }
                  </div>

                  <div>
                    <span className="csb-status csb-status--unpublished">
                      Automático
                    </span>
                  </div>

                  <div />

                </div>
              ),
            )}

          {resultCount ===
            0 && (
            <div className="csb-empty">
              No hay resultados para esta vista.
            </div>
          )}

          <div className="csb-footer">

            <span>
              {resultCount} resultado(s)
              {view ===
                "create"
                ? " · Propuestas pendientes de creación"
                : ""}
            </span>

            {view !==
              "excluded" &&
              filteredCandidates.length >
                PAGE_SIZE && (
              <div className="csb-pagination">

                <button
                  type="button"
                  disabled={
                    page <=
                    1
                  }
                  onClick={() =>
                    setPage(
                      (
                        current,
                      ) =>
                        Math.max(
                          1,
                          current -
                            1,
                        ),
                    )
                  }
                >
                  Anterior
                </button>

                <span>
                  Página {page} de{" "}
                  {totalPages}
                </span>

                <button
                  type="button"
                  disabled={
                    page >=
                    totalPages
                  }
                  onClick={() =>
                    setPage(
                      (
                        current,
                      ) =>
                        Math.min(
                          totalPages,
                          current +
                            1,
                        ),
                    )
                  }
                >
                  Siguiente
                </button>

              </div>
            )}

          </div>

        </div>

      </div>

      {detailCandidate &&
        detailMatch &&
        detailPrice && (
        <>

          <div
            className="csb-drawer-backdrop"
            onClick={() =>
              setDetailCandidateId(
                null,
              )
            }
          />

          <aside
            className="csb-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Detalle de Bundles"
          >

            <div className="csb-drawer__header">

              <div>

                <div className="csb-drawer__eyebrow">
                  Detalle de Bundles
                </div>

                <h3 className="csb-drawer__title">
                  {
                    detailCandidate
                      .baseProduct
                      .title
                  }
                </h3>

              </div>

              <button
                className="csb-close"
                type="button"
                aria-label="Cerrar detalle"
                onClick={() =>
                  setDetailCandidateId(
                    null,
                  )
                }
              >
                ×
              </button>

            </div>

            <div className="csb-drawer__body">

              <div className="csb-detail-section">

                <div className="csb-detail-heading">
                  Estado
                </div>

                <div className="csb-detail-row">
                  <span>
                    Flujo
                  </span>
                  <strong>
                    {
                      getWorkflowStatusLabel(
                        detailMatch.status,
                        detailMatch
                          .existingProduct
                          ?.publishedAt,
                      )
                    }
                  </strong>
                </div>

                <div className="csb-detail-row">
                  <span>
                    Plantilla
                  </span>
                  <strong>
                    {
                      detailCandidate
                        .templateName
                    }
                  </strong>
                </div>

                <div className="csb-detail-row">
                  <span>
                    SKU generado
                  </span>
                  <strong>
                    {
                      detailCandidate
                        .identity
                        .sku
                    }
                  </strong>
                </div>

                <div className="csb-detail-row">
                  <span>
                    Estado Shopify
                  </span>
                  <strong>
                    {
                      getProductStatusLabel(
                        detailMatch
                          .existingProduct
                          ?.status,
                      )
                    }
                  </strong>
                </div>

                <div className="csb-detail-row">
                  <span>
                    Tienda online
                  </span>
                  <strong>
                    {
                      detailMatch
                        .existingProduct
                        ?.publishedAt
                        ? "Publicado"
                        : detailMatch
                              .existingProduct
                          ? "Sin publicar"
                          : "Aún no creado"
                    }
                  </strong>
                </div>

              </div>

              <div className="csb-detail-section">

                <div className="csb-detail-heading">
                  Componentes
                </div>

                <div className="csb-detail-component">
                  <div className="csb-detail-component__role">
                    PC
                  </div>
                  <div className="csb-detail-component__name">
                    {
                      detailCandidate
                        .baseProduct
                        .title
                    }
                  </div>
                </div>

                <div className="csb-detail-component">
                  <div className="csb-detail-component__role">
                    Monitor
                  </div>
                  <div className="csb-detail-component__name">
                    {
                      detailCandidate
                        .monitor
                        .title
                    }
                  </div>
                </div>

                <div className="csb-detail-component">
                  <div className="csb-detail-component__role">
                    Teclado y mouse
                  </div>
                  <div className="csb-detail-component__name">
                    {
                      detailCandidate
                        .keyboardMouse
                        .title
                    }
                  </div>
                </div>

                <div className="csb-detail-component">
                  <div className="csb-detail-component__role">
                    Wi-Fi
                  </div>
                  <div className="csb-detail-component__name">
                    {
                      detailCandidate
                        .wifiAdapter
                        ?.title ??
                      "Wi-Fi integrado · no requiere adaptador"
                    }
                  </div>
                </div>

              </div>

              <div className="csb-detail-section">

                <div className="csb-detail-heading">
                  Compatibilidad
                </div>

                <div className="csb-detail-row">
                  <span>
                    Conexión de video
                  </span>
                  <strong>
                    {
                      detailCandidate
                        .commonVideoPorts
                        .join(
                          ", ",
                        ) ||
                      "Sin coincidencia"
                    }
                  </strong>
                </div>

                <div className="csb-detail-row">
                  <span>
                    Disponibles
                  </span>
                  <strong>
                    {
                      getTemplateCandidateStock(
                        detailCandidate,
                      )
                    }
                  </strong>
                </div>

              </div>

              <div className="csb-detail-section">

                <div className="csb-detail-heading">
                  Precio
                </div>

                <div className="csb-detail-row">
                  <span>
                    Suma individual
                  </span>
                  <strong>
                    {formatPrice(
                      detailPrice.componentPrice,
                      data.catalog.currencyCode,
                    )}
                  </strong>
                </div>

                <div className="csb-detail-row">
                  <span>
                    Ahorro
                  </span>
                  <strong>
                    {formatPrice(
                      detailPrice.savings,
                      data.catalog.currencyCode,
                    )}
                  </strong>
                </div>

                <div className="csb-detail-row">
                  <span>
                    Precio de Bundles
                  </span>
                  <strong>
                    {formatPrice(
                      detailPrice.finalPrice,
                      data.catalog.currencyCode,
                    )}
                  </strong>
                </div>

              </div>

              <div className="csb-detail-actions">

                {detailMatch.status ===
                  "new" && (
                  <fetcher.Form
                    method="post"
                    onSubmit={() =>
                      setCreatingCandidateId(
                        detailCandidate.id,
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
                        detailCandidate.id
                      }
                    />

                    <button
                      className="csb-primary-button"
                      type="submit"
                      disabled={
                        working
                      }
                    >
                      {working &&
                      creatingCandidateId ===
                        detailCandidate.id
                        ? "Creando..."
                        : "Crear borrador"}
                    </button>

                  </fetcher.Form>
                )}

                {detailMatch.status ===
                  "new" && (
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
                        detailCandidate
                          .baseProduct
                          .id
                      }
                    />

                    <button
                      className="csb-secondary-button"
                      type="submit"
                      disabled={
                        working
                      }
                    >
                      Excluir este PC de todas las propuestas
                    </button>

                  </fetcher.Form>
                )}

                {detailMatch
                  .existingProduct && (
                  <fetcher.Form method="post">

                    <input
                      type="hidden"
                      name="intent"
                      value="sync_weight"
                    />

                    <input
                      type="hidden"
                      name="candidateId"
                      value={
                        detailCandidate.id
                      }
                    />

                    <button
                      className="csb-secondary-button"
                      type="submit"
                      disabled={
                        working
                      }
                    >
                      Actualizar peso
                    </button>

                  </fetcher.Form>
                )}

                {detailMatch
                  .existingProduct && (
                  <a
                    className="csb-detail-link"
                    href={
                      getShopifyAdminProductHref(
                        detailMatch
                          .existingProduct
                          .id,
                      )
                    }
                  >
                    Abrir producto en Shopify
                  </a>
                )}

              </div>

            </div>

          </aside>

        </>
      )}

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