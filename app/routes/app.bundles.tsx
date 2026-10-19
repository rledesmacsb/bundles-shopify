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
  loadCachedBundleReadiness,
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

    const [existingBundleMatches, readiness] = await Promise.all([
      loadCachedExistingBundleMatches(
        admin,
        session.shop,
        state.candidates,
      ),
      loadCachedBundleReadiness(
        admin,
        session.shop,
        state.candidates,
      ),
    ]);

    return {
      catalog,

      runtime,

      existingBundleMatches,

      readiness,
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
  | "review"
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

function getWorkflowStatusTone(
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
    return "info" as const;
  }

  if (
    isExistingStatus(
      status,
    )
  ) {
    return publishedAt
      ? "success" as const
      : "neutral" as const;
  }

  return "warning" as const;
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

function getProductStatusTone(
  status:
    | string
    | null
    | undefined,
) {
  switch (
    status
  ) {
    case "ACTIVE":
      return "success" as const;

    case "DRAFT":
      return "info" as const;

    case "ARCHIVED":
      return "critical" as const;

    case "UNLISTED":
      return "caution" as const;

    default:
      return "neutral" as const;
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

  // Shopify search indexes may not reflect a newly verified draft immediately.
  // A successful, audited create response is authoritative for this page session.
  const [
    recentlyCreated,
    setRecentlyCreated,
  ] = useState<
    Map<string, {
      productId: string;
      partial: boolean;
      message: string;
    }>
  >(new Map());

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
    const response = fetcher.data;
    if (
      !creatingCandidateId ||
      !response ||
      !("productId" in response) ||
      typeof response.productId !== "string" ||
      !(response.success || ("partial" in response && response.partial))
    ) {
      return;
    }

    setRecentlyCreated((previous) => {
      const next = new Map(previous);
      next.set(creatingCandidateId, {
        productId: response.productId as string,
        partial: !response.success,
        message: response.message,
      });
      return next;
    });
  }, [fetcher.data, creatingCandidateId]);

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

    if (
      result &&
      "productId" in result &&
      typeof result.productId === "string" &&
      (normalizedResult.success || normalizedResult.partial)
    ) {
      setRecentlyCreated((previous) => {
        const next = new Map(previous);
        next.set(bulkCurrentCandidateId, {
          productId: result.productId as string,
          partial: normalizedResult.partial,
          message: normalizedResult.message,
        });
        return next;
      });
    }

    // Fail closed: stop the batch after any failure or uncertain result.
    // Shopify can create a product before a subsequent configuration step
    // fails. Continuing automatically could hide a partially created item.
    if (!normalizedResult.success) {
      setBulkRunning(false);
      setBulkCurrentCandidateId(null);
      setSelectedCandidateIds(new Set());

      shopify.toast.show(
        normalizedResult.partial
          ? "Creación detenida: revisa el producto que Shopify pudo haber creado."
          : "Creación detenida: revisa el motivo del rechazo.",
      );

      revalidator.revalidate();
      return;
    }

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
    useMemo(() => {
      const matches = new Map(
        data.existingBundleMatches.matches.map((match) => [
          match.candidateId,
          match,
        ]),
      );

      for (const [candidateId, created] of recentlyCreated) {
        const serverMatch = matches.get(candidateId);
        if (!serverMatch) {
          continue;
        }

        // Do not hide a different product that Shopify has now identified.
        if (
          serverMatch.existingProduct?.id &&
          serverMatch.existingProduct.id !== created.productId
        ) {
          continue;
        }

        if (
          isExistingStatus(serverMatch.status) &&
          serverMatch.existingProduct?.id === created.productId
        ) {
          continue;
        }

        const candidate = state.candidates.find(
          (item) => item.id === candidateId,
        );

        matches.set(candidateId, {
          ...serverMatch,
          status: created.partial ? "lookup_error" : "existing_managed",
          existingProduct: {
            id: created.productId,
            title: candidate?.identity.title ?? "Bundles",
            handle: "",
            status: created.partial ? "UNKNOWN" : "DRAFT",
            productType: candidate?.identity.productType ?? "Bundles",
            publishedAt: null,
            sku: candidate?.identity.sku ?? null,
            managedBy: created.partial ? null : "csbyte-commerce-tools",
            template: candidate?.templateId ?? null,
            baseProductId: candidate?.baseProduct.id ?? null,
            componentProductIds: [],
            componentProducts: [],
          },
          message: created.partial
            ? `Shopify creó el producto, pero su configuración necesita revisión: ${created.message}`
            : "Borrador creado y verificado. Pendiente de publicación en Tienda online.",
        });
      }

      return matches;
    }, [data.existingBundleMatches.matches, recentlyCreated, state.candidates]);

  const allMatches = Array.from(matchByCandidateId.values());

  const readinessByCandidateId = useMemo(() => {
    const indexed = new Map<string, typeof data.readiness.issues>();
    for (const issue of data.readiness.issues) {
      const existing = indexed.get(issue.candidateId) ?? [];
      indexed.set(issue.candidateId, [...existing, issue]);
    }
    return indexed;
  }, [data.readiness.issues]);

  const readinessUnavailable = data.readiness.errors.length > 0;

  const needsComponentReview = (candidateId: string) =>
    readinessUnavailable ||
    (readinessByCandidateId.get(candidateId)?.length ?? 0) > 0;

  const isCandidateReady = (candidateId: string) =>
    matchByCandidateId.get(candidateId)?.status === "new" &&
    !needsComponentReview(candidateId);

  const needsCandidateReview = (candidateId: string) => {
    const match = matchByCandidateId.get(candidateId);
    return Boolean(
      match &&
      (isReviewStatus(match.status) ||
        (match.status === "new" && needsComponentReview(candidateId))),
    );
  };

  const createCount =
    allMatches.filter((match) => isCandidateReady(match.candidateId)).length;

  const reviewCount =
    allMatches.filter((match) => needsCandidateReview(match.candidateId)).length +
    state.multiVariantBaseProducts.length;

  const publishedCount =
    allMatches.filter(
      (match) =>
        isExistingStatus(match.status) &&
        Boolean(match.existingProduct?.publishedAt),
    ).length;

  const unpublishedCount =
    allMatches.filter(
      (match) =>
        isExistingStatus(match.status) &&
        !match.existingProduct?.publishedAt,
    ).length;

  const excludedCount =
    state.manuallyExcludedProducts.length +
    state.automaticallyExcludedProducts.length;

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

              if (view === "create" && !isCandidateReady(candidate.id)) {
                return false;
              }

              if (view === "review" && !needsCandidateReview(candidate.id)) {
                return false;
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
                candidate.identity.title,
                match.existingProduct?.title ?? "",
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

            return a.identity.title.localeCompare(
              b.identity.title,
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
          isCandidateReady(
            candidate.id,
          ),
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
          isCandidateReady(
            candidate.id,
          ),
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
    "review"
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
        fetcher.state !== "idle"
      ) {
        return;
      }

      if (
        selectedNewCandidateIds.length === 0
      ) {
        shopify.toast.show(
          "Selecciona al menos una propuesta de Bundles por crear.",
        );

        return;
      }

      void shopify.modal.show(
        "bundle-bulk-confirm-modal",
      );
    };

  const confirmBulkCreation =
    () => {
      if (
        bulkRunning ||
        fetcher.state !== "idle"
      ) {
        return;
      }

      const queue =
        selectedNewCandidateIds;

      if (
        queue.length === 0
      ) {
        void shopify.modal.hide(
          "bundle-bulk-confirm-modal",
        );

        return;
      }

      void shopify.modal.hide(
        "bundle-bulk-confirm-modal",
      );

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

  const failedBulkResults = bulkResults.filter(
    (item) => !item.success,
  );

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
        .csb-native-page {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding-bottom: 24px;
        }

        .csb-native-view-scroll {
          overflow-x: auto;
          scrollbar-width: none;
        }

        .csb-native-view-scroll::-webkit-scrollbar {
          display: none;
        }

        .csb-native-selection {
          padding: 12px;
          border-top: 1px solid #e1e3e5;
          border-bottom: 1px solid #e1e3e5;
          background: #f6f6f7;
        }

        .csb-native-selection-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
        }

        .csb-native-bundle-title {
          min-width: 0;
        }

        .csb-native-bundle-secondary {
          margin-top: 2px;
          color: #616161;
          font-size: 12px;
          line-height: 1.35;
        }

        .csb-native-warning {
          margin-top: 4px;
          color: #8a5a00;
          font-size: 11px;
          line-height: 1.35;
        }

        .csb-native-statuses {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }

        @media (max-width: 760px) {
          .csb-native-page {
            gap: 10px;
            padding-bottom: 16px;
          }

          .csb-native-selection-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div className="csb-native-page">

        <s-section>
          <s-stack gap="small">

            <s-paragraph>
              Revisa propuestas, estado del producto en Shopify y publicación en Tienda online.
            </s-paragraph>

            <s-stack
              direction="inline"
              gap="small"
              alignItems="center"
            >
              <s-text tone="neutral">
                Canal
              </s-text>

              <s-badge tone="info">
                Tienda online
              </s-badge>

              <s-text tone="neutral">
                Precio
              </s-text>

              <s-text>
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
              </s-text>
            </s-stack>

          </s-stack>
        </s-section>

        {systemErrors.length >
          0 && (
          <s-banner
            heading="No fue posible completar toda la lectura de Shopify"
            tone="critical"
          >
            {systemErrors.join(
              " · ",
            )}
          </s-banner>
        )}

        {readinessUnavailable && (
          <s-banner
            heading="No se pudo validar la información de los componentes"
            tone="critical"
          >
            <s-paragraph>
              Se bloqueó la creación preventiva de Bundles hasta comprobar el catálogo.
              {data.readiness.errors.join(" · ")}
            </s-paragraph>
          </s-banner>
        )}

        {state.issues.length >
          0 && (
          <s-banner
            heading="Hay configuraciones que requieren revisión"
            tone="warning"
          >
            {state.issues.join(
              " · ",
            )}
          </s-banner>
        )}

        <s-section
          padding="none"
          accessibilityLabel="Gestión de Bundles"
        >

          <s-box padding="small">

            <div className="csb-native-view-scroll">

              <s-stack
                direction="inline"
                gap="small"
              >

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
                    "review",
                    "Revisar",
                    reviewCount,
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
                    <s-button
                      key={value}
                      variant={
                        view ===
                        value
                          ? "primary"
                          : "secondary"
                      }
                      onClick={() =>
                        setView(
                          value,
                        )
                      }
                    >
                      {label}{" "}
                      {count}
                    </s-button>
                  ),
                )}

              </s-stack>

            </div>

          </s-box>

          {selectedNewCandidateIds.length >
            0 && (
            <div className="csb-native-selection">

              <div className="csb-native-selection-grid">

                <s-text>
                  {
                    selectedNewCandidateIds.length
                  }{" "}
                  propuesta(s) seleccionada(s)
                </s-text>

                <s-button
                  variant="primary"
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
                </s-button>

              </div>

            </div>
          )}

          {(bulkRunning || bulkResults.length > 0) && (
            <s-banner
              tone={
                bulkRunning
                  ? "info"
                  : failedBulkResults.length > 0
                    ? failedBulkResults.some((item) => item.partial)
                      ? "warning"
                      : "critical"
                    : "success"
              }
              heading={
                bulkRunning
                  ? "Creando Bundles"
                  : failedBulkResults.length > 0
                    ? "Creación detenida: requiere revisión"
                    : "Bundles creados correctamente"
              }
            >
              <s-stack gap="small">
                <s-paragraph>
                  {bulkRunning
                    ? `Procesando ${bulkResults.length + 1} de ${bulkQueue.length}. Cada propuesta se valida nuevamente antes de crearse.`
                    : `${bulkResults.filter((item) => item.success).length} creados · ${bulkResults.filter((item) => !item.success && !item.partial).length} omitidos · ${bulkResults.filter((item) => !item.success && item.partial).length} para revisar.`}
                </s-paragraph>

                {!bulkRunning &&
                  failedBulkResults.map((item) => {
                    const candidate = state.candidates.find(
                      (entry) => entry.id === item.candidateId,
                    );
                    return (
                      <s-stack key={item.candidateId} gap="small">
                        <s-text>
                          <strong>
                            {candidate?.identity.title ?? "Propuesta"}
                          </strong>
                        </s-text>
                        <s-paragraph>
                          {item.message}
                        </s-paragraph>
                        {item.partial && (
                          <s-text tone="warning">
                            Verifica primero si existe el producto en Shopify. No lo vuelvas a crear.
                          </s-text>
                        )}
                      </s-stack>
                    );
                  })}
              </s-stack>
            </s-banner>
          )}

          {fetcher.data?.success === false &&
            fetcher.data?.message && (
              <s-banner heading="La acción no se completó" tone="critical">
                <s-paragraph>{fetcher.data.message}</s-paragraph>
              </s-banner>
            )}

          {view !==
            "excluded" ? (
            <s-table
              paginate={
                filteredCandidates.length >
                PAGE_SIZE
              }
              hasPreviousPage={
                page >
                1
              }
              hasNextPage={
                page <
                totalPages
              }
              onPreviousPage={() =>
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
              onNextPage={() =>
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
              paginationLabel={`${resultCount} resultados · Página ${page} de ${totalPages}`}
            >

              <s-query-container slot="filters">

                <s-grid
                  gridTemplateColumns="@container (inline-size > 760px) minmax(0, 1fr) minmax(190px, 250px) minmax(170px, 220px), 1fr"
                  gap="small"
                >

                  <s-text-field
                    label="Buscar Bundles"
                    labelAccessibilityVisibility="exclusive"
                    icon="search"
                    placeholder="Buscar por modelo o SKU"
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
                    label="Tipo de Bundles"
                    labelAccessibilityVisibility="exclusive"
                    value={
                      templateFilter
                    }
                    onChange={(event) =>
                      setTemplateFilter(
                        event.currentTarget.value,
                      )
                    }
                  >
                    <s-option value="all">
                      Todos los tipos de Bundles
                    </s-option>

                    {state.summaries
                      .filter(
                        (summary) =>
                          summary.enabled,
                      )
                      .map(
                        (summary) => (
                          <s-option
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
                          </s-option>
                        ),
                      )}
                  </s-select>

                  <s-select
                    label="Ordenar Bundles"
                    labelAccessibilityVisibility="exclusive"
                    value={
                      sortMode
                    }
                    onChange={(event) =>
                      setSortMode(
                        event.currentTarget
                          .value as BundleSort,
                      )
                    }
                  >
                    <s-option value="stock_desc">
                      Mayor disponibilidad
                    </s-option>
                    <s-option value="price_asc">
                      Menor precio
                    </s-option>
                    <s-option value="savings_desc">
                      Mayor ahorro
                    </s-option>
                  </s-select>

                </s-grid>

              </s-query-container>

              <s-table-header-row>

                <s-table-header listSlot="primary">
                  {view ===
                    "create" &&
                    visibleNewCandidateIds.length >
                      0 ? (
                    <s-stack
                      direction="inline"
                      gap="small"
                      alignItems="center"
                    >
                      <s-checkbox
                        checked={
                          allVisibleNewSelected
                        }
                        onChange={
                          toggleVisibleNewSelection
                        }
                        disabled={
                          working
                        }
                        accessibilityLabel="Seleccionar propuestas visibles"
                      />
                      <s-text>
                        Bundles
                      </s-text>
                    </s-stack>
                  ) : (
                    "Bundles"
                  )}
                </s-table-header>

                <s-table-header
                  listSlot="labeled"
                  format="currency"
                >
                  Precio
                </s-table-header>

                <s-table-header
                  listSlot="labeled"
                  format="currency"
                >
                  Ahorro
                </s-table-header>

                <s-table-header
                  listSlot="labeled"
                  format="numeric"
                >
                  Disponibles
                </s-table-header>

                <s-table-header listSlot="inline">
                  Estado
                </s-table-header>

                <s-table-header listSlot="secondary">
                  Acción
                </s-table-header>

              </s-table-header-row>

              <s-table-body>

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
                      <s-table-row
                        key={
                          candidate.id
                        }
                        selected={
                          selected
                        }
                      >

                        <s-table-cell>

                          <s-stack
                            direction="inline"
                            gap="small"
                            alignItems="center"
                          >

                            {isCandidateReady(candidate.id) && (
                              <s-checkbox
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
                                accessibilityLabel="Seleccionar propuesta de Bundles"
                              />
                            )}

                            <div className="csb-native-bundle-title">

                              <s-text>
                                <strong>
                                  {match.existingProduct?.title || candidate.identity.title}
                                </strong>
                              </s-text>

                              <div className="csb-native-bundle-secondary">
                                SKU: {match.existingProduct?.sku || candidate.identity.sku}
                                {" · "}
                                PC + monitor + teclado y mouse
                                {candidate.wifiAdapter ? " + adaptador Wi-Fi" : ""}
                              </div>

                              {isReviewStatus(match.status) && (
                                <div className="csb-native-warning">
                                  {match.message}
                                </div>
                              )}

                              {match.status === "new" &&
                                needsComponentReview(candidate.id) && (
                                  <div className="csb-native-warning">
                                    {readinessUnavailable
                                      ? "No fue posible validar los componentes."
                                      : (readinessByCandidateId.get(candidate.id) ?? [])
                                          .map((issue) => issue.message)
                                          .join(" · ")}
                                    {" "}
                                    <s-link href="/app/problems?filter=component_data">
                                      Ver en Productos con problemas
                                    </s-link>
                                  </div>
                                )}

                            </div>

                          </s-stack>

                        </s-table-cell>

                        <s-table-cell>
                          {formatPrice(
                            price.finalPrice,
                            data.catalog.currencyCode,
                          )}
                        </s-table-cell>

                        <s-table-cell>
                          {price.savings >
                            0
                            ? formatPrice(
                                price.savings,
                                data.catalog.currencyCode,
                              )
                            : "—"}
                        </s-table-cell>

                        <s-table-cell>
                          {
                            getTemplateCandidateStock(
                              candidate,
                            )
                          }
                        </s-table-cell>

                        <s-table-cell>

                          {isExistingStatus(
                            match.status,
                          ) &&
                          match.existingProduct ? (
                            <div className="csb-native-statuses">

                              <s-badge
                                tone={
                                  getProductStatusTone(
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
                              </s-badge>

                              <s-badge
                                tone={
                                  match
                                    .existingProduct
                                    .publishedAt
                                    ? "success"
                                    : "neutral"
                                }
                              >
                                {match
                                  .existingProduct
                                  .publishedAt
                                  ? "Tienda online"
                                  : "Sin publicar"}
                              </s-badge>

                            </div>
                          ) : needsCandidateReview(candidate.id) &&
                            match.status === "new" ? (
                            <s-badge tone="warning">Faltan datos</s-badge>
                          ) : (
                            <s-badge
                              tone={
                                getWorkflowStatusTone(
                                  match.status,
                                  match.existingProduct?.publishedAt,
                                )
                              }
                            >
                              {getWorkflowStatusLabel(
                                match.status,
                                match.existingProduct?.publishedAt,
                              )}
                            </s-badge>
                          )}

                        </s-table-cell>

                        <s-table-cell>

                          <s-button
                            variant="tertiary"
                            onClick={() => {
                              setDetailCandidateId(
                                candidate.id,
                              );

                              shopify.modal.show(
                                "bundle-detail-modal",
                              );
                            }}
                          >
                            Ver detalle
                          </s-button>

                        </s-table-cell>

                      </s-table-row>
                    );
                  },
                )}

                {view ===
                  "review" &&
                  visibleMultiVariant.map(
                    (product) => (
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

                            <s-text tone="warning">
                              Tiene múltiples variantes. La creación automática permanece bloqueada.
                            </s-text>

                          </s-stack>

                        </s-table-cell>

                        <s-table-cell>
                          —
                        </s-table-cell>

                        <s-table-cell>
                          —
                        </s-table-cell>

                        <s-table-cell>
                          {
                            product.totalInventory
                          }
                        </s-table-cell>

                        <s-table-cell>
                          <s-badge tone="warning">
                            Varias variantes
                          </s-badge>
                        </s-table-cell>

                        <s-table-cell />

                      </s-table-row>
                    ),
                  )}

              </s-table-body>

            </s-table>
          ) : (
            <s-table>

              <s-text-field
                slot="filters"
                label="Buscar productos excluidos"
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

                <s-table-header listSlot="inline">
                  Estado
                </s-table-header>

                <s-table-header listSlot="secondary">
                  Acción
                </s-table-header>

              </s-table-header-row>

              <s-table-body>

                {visibleManualExcluded.map(
                  (product) => (
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
                            {
                              getFirstTemplateVariant(
                                product,
                              )?.sku ??
                              "Sin SKU"
                            }
                          </s-text>

                        </s-stack>

                      </s-table-cell>

                      <s-table-cell>
                        {
                          product.totalInventory
                        }
                      </s-table-cell>

                      <s-table-cell>
                        <s-badge tone="warning">
                          Excluido manual
                        </s-badge>
                      </s-table-cell>

                      <s-table-cell>

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

                          <s-button
                            type="submit"
                            variant="tertiary"
                            disabled={
                              working
                            }
                          >
                            Incluir
                          </s-button>

                        </fetcher.Form>

                      </s-table-cell>

                    </s-table-row>
                  ),
                )}

                {visibleAutomaticExcluded.map(
                  (product) => (
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
                            Exclusión automática por producto “Arma a tu medida”.
                          </s-text>

                        </s-stack>

                      </s-table-cell>

                      <s-table-cell>
                        {
                          product.totalInventory
                        }
                      </s-table-cell>

                      <s-table-cell>
                        <s-badge tone="neutral">
                          Automático
                        </s-badge>
                      </s-table-cell>

                      <s-table-cell />

                    </s-table-row>
                  ),
                )}

              </s-table-body>

            </s-table>
          )}

          {resultCount ===
            0 && (
            <s-box padding="large">

              <s-stack
                alignItems="center"
                gap="small"
              >

                <s-text>
                  No hay resultados para esta vista.
                </s-text>

              </s-stack>

            </s-box>
          )}

          <s-box padding="small">

            <s-text tone="neutral">
              {resultCount} resultado(s)
              {view ===
                "create"
                ? " · Propuestas pendientes de creación"
                : ""}
            </s-text>

          </s-box>

        </s-section>

      </div>

      <s-modal
        id="bundle-bulk-confirm-modal"
        heading="Crear Bundles como borradores"
        accessibilityLabel="Confirmar creación de Bundles"
        size="small"
      >
        <s-stack gap="base">
          <s-paragraph>
            Se crearán {selectedNewCandidateIds.length} Bundles, uno por uno.
            Cada propuesta se validará nuevamente antes de crearla.
          </s-paragraph>

          <s-paragraph>
            Los productos quedarán como borradores y no se publicarán en
            Tienda online.
          </s-paragraph>
        </s-stack>

        <s-button
          slot="secondary-actions"
          variant="secondary"
          commandFor="bundle-bulk-confirm-modal"
          command="--hide"
        >
          Cancelar
        </s-button>

        <s-button
          slot="primary-action"
          variant="primary"
          disabled={bulkRunning || fetcher.state !== "idle"}
          onClick={confirmBulkCreation}
        >
          Crear borradores ({selectedNewCandidateIds.length})
        </s-button>
      </s-modal>

      <s-modal
        id="bundle-detail-modal"
        heading="Detalle de Bundles"
        accessibilityLabel="Detalle de Bundles"
        size="large"
        onHide={() =>
          setDetailCandidateId(
            null,
          )
        }
      >

        {detailCandidate &&
          detailMatch &&
          detailPrice && (
          <s-stack gap="base">

            <s-section heading="Producto">

              <s-stack gap="small">

                <s-heading>
                  {detailMatch.existingProduct?.title || detailCandidate.identity.title}
                </s-heading>

                <s-text tone="neutral">
                  SKU:{" "}
                  {
                    detailCandidate
                      .identity
                      .sku
                  }
                </s-text>

              </s-stack>

            </s-section>

            <s-section heading="Estado">

              <s-stack gap="small">

                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="small"
                >
                  <s-text tone="neutral">
                    Flujo
                  </s-text>
                  <s-badge
                    tone={
                      getWorkflowStatusTone(
                        detailMatch.status,
                        detailMatch
                          .existingProduct
                          ?.publishedAt,
                      )
                    }
                  >
                    {
                      getWorkflowStatusLabel(
                        detailMatch.status,
                        detailMatch
                          .existingProduct
                          ?.publishedAt,
                      )
                    }
                  </s-badge>
                </s-grid>

                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="small"
                >
                  <s-text tone="neutral">
                    Estado Shopify
                  </s-text>

                  <s-badge
                    tone={
                      getProductStatusTone(
                        detailMatch
                          .existingProduct
                          ?.status,
                      )
                    }
                  >
                    {
                      getProductStatusLabel(
                        detailMatch
                          .existingProduct
                          ?.status,
                      )
                    }
                  </s-badge>
                </s-grid>

                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="small"
                >
                  <s-text tone="neutral">
                    Tienda online
                  </s-text>

                  <s-badge
                    tone={
                      detailMatch
                        .existingProduct
                        ?.publishedAt
                        ? "success"
                        : "neutral"
                    }
                  >
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
                  </s-badge>
                </s-grid>

                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="small"
                >
                  <s-text tone="neutral">
                    Plantilla
                  </s-text>
                  <s-text>
                    {
                      detailCandidate
                        .templateName
                    }
                  </s-text>
                </s-grid>

              </s-stack>

            </s-section>

            <s-section heading="Componentes">

              <s-stack gap="small">

                <s-text>
                  <strong>PC:</strong>{" "}
                  {
                    detailCandidate
                      .baseProduct
                      .title
                  }
                </s-text>

                <s-text>
                  <strong>Monitor:</strong>{" "}
                  {
                    detailCandidate
                      .monitor
                      .title
                  }
                </s-text>

                <s-text>
                  <strong>Teclado y mouse:</strong>{" "}
                  {
                    detailCandidate
                      .keyboardMouse
                      .title
                  }
                </s-text>

                <s-text>
                  <strong>Wi-Fi:</strong>{" "}
                  {
                    detailCandidate
                      .wifiAdapter
                      ?.title ??
                    "Wi-Fi integrado · no requiere adaptador"
                  }
                </s-text>

              </s-stack>

            </s-section>

            <s-section heading="Compatibilidad">

              <s-stack gap="small">

                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="small"
                >
                  <s-text tone="neutral">
                    Conexión de video
                  </s-text>
                  <s-text>
                    {
                      detailCandidate
                        .commonVideoPorts
                        .join(
                          ", ",
                        ) ||
                      "Sin coincidencia"
                    }
                  </s-text>
                </s-grid>

                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="small"
                >
                  <s-text tone="neutral">
                    Disponibles
                  </s-text>
                  <s-text>
                    {
                      getTemplateCandidateStock(
                        detailCandidate,
                      )
                    }
                  </s-text>
                </s-grid>

              </s-stack>

            </s-section>

            <s-section heading="Precio">

              <s-stack gap="small">

                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="small"
                >
                  <s-text tone="neutral">
                    Suma individual
                  </s-text>
                  <s-text>
                    {formatPrice(
                      detailPrice.componentPrice,
                      data.catalog.currencyCode,
                    )}
                  </s-text>
                </s-grid>

                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="small"
                >
                  <s-text tone="neutral">
                    Ahorro
                  </s-text>
                  <s-text tone="success">
                    {formatPrice(
                      detailPrice.savings,
                      data.catalog.currencyCode,
                    )}
                  </s-text>
                </s-grid>

                <s-divider />

                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="small"
                >
                  <s-text>
                    Precio de Bundles
                  </s-text>
                  <s-heading>
                    {formatPrice(
                      detailPrice.finalPrice,
                      data.catalog.currencyCode,
                    )}
                  </s-heading>
                </s-grid>

              </s-stack>

            </s-section>

            <s-section heading="Acciones">

              <s-stack gap="small">

                {detailMatch.status === "new" &&
                  needsComponentReview(detailCandidate.id) && (
                    <s-banner heading="Faltan datos para crear este Bundles" tone="warning">
                      <s-stack gap="small">
                        {(readinessByCandidateId.get(detailCandidate.id) ?? [])
                          .map((issue, index) => (
                            <s-paragraph key={index}>
                              {issue.message}: {issue.componentTitle}
                            </s-paragraph>
                          ))}
                        {readinessUnavailable && (
                          <s-paragraph>
                            No se pudo consultar Shopify para verificar los componentes.
                          </s-paragraph>
                        )}
                        <s-link href="/app/problems?filter=component_data">
                          Ir a Productos con problemas
                        </s-link>
                      </s-stack>
                    </s-banner>
                  )}

                {isCandidateReady(detailCandidate.id) && (
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

                    <s-button
                      variant="primary"
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
                    </s-button>

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

                    <s-button
                      variant="secondary"
                      type="submit"
                      disabled={
                        working
                      }
                    >
                      Excluir este PC de todas las propuestas
                    </s-button>

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

                    <s-button
                      variant="secondary"
                      type="submit"
                      disabled={
                        working
                      }
                    >
                      Actualizar peso
                    </s-button>

                  </fetcher.Form>
                )}

                {detailMatch
                  .existingProduct && (
                  <s-link
                    href={
                      getShopifyAdminProductHref(
                        detailMatch
                          .existingProduct
                          .id,
                      )
                    }
                  >
                    Abrir producto en Shopify
                  </s-link>
                )}

              </s-stack>

            </s-section>

          </s-stack>
        )}

        <s-button
          slot="secondary-actions"
          variant="secondary"
          commandFor="bundle-detail-modal"
          command="--hide"
        >
          Cerrar
        </s-button>

      </s-modal>

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