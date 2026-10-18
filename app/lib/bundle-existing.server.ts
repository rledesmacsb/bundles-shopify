import type {
  TemplateBundleCandidate,
} from "./bundle-template-engine";

import type {
  TemplateCatalogMetafield,
  TemplateCatalogProduct,
} from "./bundle-rule-engine";

import {
  productMatchesRule,
} from "./bundle-rule-engine";

/* =========================================================
   CLIENT
========================================================= */

type AdminClient = {
  graphql: (
    query: string,
    options?: any,
  ) => Promise<any>;
};

/* =========================================================
   INTERNAL METADATA
========================================================= */

export const BUNDLE_META_NAMESPACE =
  "csbyte_bundle";

export const BUNDLE_MANAGED_BY_KEY =
  "managed_by";

export const BUNDLE_TEMPLATE_KEY =
  "template";

export const BUNDLE_BASE_PRODUCT_ID_KEY =
  "base_product_id";

export const BUNDLE_MANAGED_BY_VALUE =
  "csbyte-commerce-tools";

const OLD_TEMPLATE_PC_MONITOR =
  "pc_monitor";

/* =========================================================
   SAFETY LIMITS
========================================================= */

/*
 * Small page because bundleComponents is a nested
 * connection.
 */
const BUNDLE_PAGE_SIZE =
  5;

const BUNDLE_COMPONENT_LIMIT =
  10;

const MAX_CLASSIFICATION_METAFIELDS =
  8;

/*
 * SKU queries remain intentionally small.
 *
 * This is NOT a dynamic alias query.
 * It's one productVariants search using Shopify's normal
 * search syntax.
 */
const SKU_BATCH_SIZE =
  8;

const SKU_RESULT_LIMIT =
  50;

/* =========================================================
   TYPES
========================================================= */

export type ExistingBundleLookupStatus =
  | "new"
  | "existing_managed"
  | "existing_legacy"
  | "sku_conflict"
  | "missing_base_sku"
  | "lookup_error";

export type ExistingBundleProduct = {
  id: string;

  title: string;

  handle: string;

  status: string;

  productType: string;

  publishedAt:
    | string
    | null;

  sku:
    | string
    | null;

  managedBy:
    | string
    | null;

  template:
    | string
    | null;

  baseProductId:
    | string
    | null;

  componentProductIds:
    string[];

  componentProducts:
    TemplateCatalogProduct[];
};

export type ExistingBundleMatch = {
  candidateId: string;

  baseProductId: string;

  templateId: string;

  expectedSku:
    | string
    | null;

  status:
    ExistingBundleLookupStatus;

  existingProduct:
    | ExistingBundleProduct
    | null;

  message: string;
};

export type ExistingBundleLookupResult = {
  matches:
    ExistingBundleMatch[];

  errors:
    string[];
};

/* =========================================================
   GRAPHQL TYPES
========================================================= */

type BundleComponentProductNode = {
  id: string;

  title: string;

  status: string;

  productType: string;

  vendor: string;

  tags: string[];

  totalInventory: number;

  variants: {
    nodes: Array<{
      id: string;

      title: string;

      sku:
        | string
        | null;

      price: string;

      inventoryQuantity:
        | number
        | null;
    }>;
  };

  templateMetafields?:
    | {
        nodes:
          TemplateCatalogMetafield[];
      }
    | null;
};

type BundleShellNode = {
  id: string;

  title: string;

  handle: string;

  status: string;

  productType: string;

  publishedAt:
    | string
    | null;

  variants: {
    nodes: Array<{
      id: string;

      sku:
        | string
        | null;
    }>;
  };

  managedByMeta:
    | {
        value: string;
      }
    | null;

  templateMeta:
    | {
        value: string;
      }
    | null;

  baseProductIdMeta:
    | {
        value: string;
      }
    | null;

  bundleComponents: {
    nodes: Array<{
      componentProduct:
        BundleComponentProductNode;
    }>;

    pageInfo: {
      hasNextPage:
        boolean;
    };
  };
};

type SkuVariantNode = {
  id: string;

  sku:
    | string
    | null;

  product: {
    id: string;

    title: string;

    handle: string;

    status: string;

    productType: string;

    publishedAt:
      | string
      | null;
  };
};

/* =========================================================
   HELPERS
========================================================= */

function getGraphqlErrors(
  json: {
    errors?: Array<{
      message: string;
    }>;
  },
) {
  return (
    json.errors?.map(
      (error) =>
        error.message,
    ) ??
    []
  );
}

function normalizeSku(
  value:
    | string
    | null
    | undefined,
) {
  return (
    value ??
    ""
  )
    .trim()
    .toUpperCase();
}

function parseStoredString(
  value:
    | string
    | null
    | undefined,
) {
  if (
    !value
  ) {
    return null;
  }

  try {
    const parsed =
      JSON.parse(
        value,
      );

    return typeof parsed ===
      "string"
      ? parsed
      : value;
  } catch {
    return value;
  }
}

function escapeSearchValue(
  value: string,
) {
  return value
    .replace(
      /\\/g,
      "\\\\",
    )
    .replace(
      /"/g,
      '\\"',
    );
}

function getExpectedSku(
  candidate:
    TemplateBundleCandidate,
) {
  const sku =
    candidate
      .identity
      .sku
      .trim();

  if (
    !sku ||
    sku ===
      "SKU pendiente"
  ) {
    return null;
  }

  return sku;
}

function chunkArray<T>(
  values:
    T[],

  size:
    number,
) {
  const chunks:
    T[][] =
    [];

  for (
    let index = 0;
    index <
    values.length;
    index +=
      size
  ) {
    chunks.push(
      values.slice(
        index,
        index +
          size,
      ),
    );
  }

  return chunks;
}

/* =========================================================
   METAFIELDS NEEDED TO CLASSIFY OLD MONITORS
========================================================= */

function collectMonitorClassificationKeys(
  candidates:
    TemplateBundleCandidate[],
) {
  const keys =
    new Set<string>();

  for (
    const candidate
    of candidates
  ) {
    for (
      const condition
      of candidate
        .template
        .monitorRule
        .conditions
    ) {
      if (
        condition.source !==
          "metafield" ||
        !condition.metafield
      ) {
        continue;
      }

      const namespace =
        condition
          .metafield
          .namespace
          .trim();

      const key =
        condition
          .metafield
          .key
          .trim();

      if (
        !namespace ||
        !key
      ) {
        continue;
      }

      keys.add(
        `${namespace}.${key}`,
      );
    }
  }

  return Array.from(
    keys,
  );
}

/* =========================================================
   COMPONENT ADAPTER
========================================================= */

function componentToRuntimeProduct(
  source:
    BundleComponentProductNode,
): TemplateCatalogProduct {
  return {
    id:
      source.id,

    title:
      source.title,

    status:
      source.status,

    productType:
      source.productType,

    vendor:
      source.vendor,

    tags:
      source.tags ??
      [],

    totalInventory:
      source.totalInventory,

    featuredImage:
      null,

    variants: {
      nodes:
        source
          .variants
          .nodes,
    },

    templateMetafields:
      source
        .templateMetafields
        ?.nodes ??
      [],
  };
}

/* =========================================================
   EXISTING BUNDLES

   Bundle shell + components are now loaded in the SAME
   query.
========================================================= */

async function fetchExistingBundles(
  admin:
    AdminClient,

  candidates:
    TemplateBundleCandidate[],
) {
  const classificationKeys =
    collectMonitorClassificationKeys(
      candidates,
    );

  if (
    classificationKeys.length >
    MAX_CLASSIFICATION_METAFIELDS
  ) {
    return {
      products:
        [] as ExistingBundleProduct[],

      errors: [
        `Las plantillas utilizan ${classificationKeys.length} metacampos para clasificar componentes de bundles existentes. El límite preventivo es ${MAX_CLASSIFICATION_METAFIELDS}.`,
      ],
    };
  }

  const products:
    ExistingBundleProduct[] =
    [];

  const errors:
    string[] =
    [];

  const needsMetafields =
    classificationKeys.length >
    0;

  const metafieldVariables =
    needsMetafields
      ? `
        $metafieldKeys: [String!]!
        $metafieldCount: Int!
      `
      : "";

  const metafieldSelection =
    needsMetafields
      ? `
        templateMetafields: metafields(
          first: $metafieldCount
          keys: $metafieldKeys
        ) {
          nodes {
            namespace
            key
            type
            value
          }
        }
      `
      : "";

  let after:
    | string
    | null =
    null;

  let hasNextPage =
    true;

  while (
    hasNextPage
  ) {
    const variables:
      Record<
        string,
        any
      > = {
        after,

        query:
          "bundles:true AND status:active,draft,archived,unlisted",
      };

    if (
      needsMetafields
    ) {
      variables.metafieldKeys =
        classificationKeys;

      variables.metafieldCount =
        classificationKeys.length;
    }

    try {
      const response =
        await admin.graphql(
          `#graphql
            query CsbyteExistingBundlesOptimized(
              $after: String
              $query: String!
              ${metafieldVariables}
            ) {
              products(
                first: ${BUNDLE_PAGE_SIZE}
                after: $after
                query: $query
                sortKey: TITLE
              ) {
                nodes {
                  id
                  title
                  handle
                  status
                  productType
                  publishedAt

                  variants(
                    first: 1
                  ) {
                    nodes {
                      id
                      sku
                    }
                  }

                  managedByMeta: metafield(
                    namespace: "${BUNDLE_META_NAMESPACE}"
                    key: "${BUNDLE_MANAGED_BY_KEY}"
                  ) {
                    value
                  }

                  templateMeta: metafield(
                    namespace: "${BUNDLE_META_NAMESPACE}"
                    key: "${BUNDLE_TEMPLATE_KEY}"
                  ) {
                    value
                  }

                  baseProductIdMeta: metafield(
                    namespace: "${BUNDLE_META_NAMESPACE}"
                    key: "${BUNDLE_BASE_PRODUCT_ID_KEY}"
                  ) {
                    value
                  }

                  bundleComponents(
                    first: ${BUNDLE_COMPONENT_LIMIT}
                  ) {
                    nodes {
                      componentProduct {
                        id
                        title
                        status
                        productType
                        vendor
                        tags
                        totalInventory

                        variants(
                          first: 2
                        ) {
                          nodes {
                            id
                            title
                            sku
                            price
                            inventoryQuantity
                          }
                        }

                        ${metafieldSelection}
                      }
                    }

                    pageInfo {
                      hasNextPage
                    }
                  }
                }

                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          `,
          {
            variables,
          },
        );

      const json =
        (await response.json()) as {
          data?: {
            products?: {
              nodes:
                BundleShellNode[];

              pageInfo: {
                hasNextPage:
                  boolean;

                endCursor:
                  | string
                  | null;
              };
            };
          };

          errors?: Array<{
            message:
              string;
          }>;
        };

      const pageErrors =
        getGraphqlErrors(
          json,
        );

      if (
        pageErrors.length >
        0
      ) {
        errors.push(
          ...pageErrors,
        );

        break;
      }

      const connection =
        json.data
          ?.products;

      if (
        !connection
      ) {
        errors.push(
          "Shopify no devolvió la lista de bundles existentes.",
        );

        break;
      }

      for (
        const product
        of connection.nodes
      ) {
        /*
         * We refuse to classify a bundle if its component
         * connection was truncated.
         */
        if (
          product
            .bundleComponents
            .pageInfo
            .hasNextPage
        ) {
          errors.push(
            `El producto de Bundles "${product.title}" tiene más de ${BUNDLE_COMPONENT_LIMIT} componentes. No se continuará hasta aumentar el límite de forma controlada.`,
          );

          break;
        }

        const componentProducts =
          product
            .bundleComponents
            .nodes
            .map(
              (component) =>
                componentToRuntimeProduct(
                  component.componentProduct,
                ),
            );

        products.push({
          id:
            product.id,

          title:
            product.title,

          handle:
            product.handle,

          status:
            product.status,

          productType:
            product.productType,

          publishedAt:
            product.publishedAt,

          sku:
            product
              .variants
              .nodes[0]
              ?.sku ??
            null,

          managedBy:
            parseStoredString(
              product
                .managedByMeta
                ?.value,
            ),

          template:
            parseStoredString(
              product
                .templateMeta
                ?.value,
            ),

          baseProductId:
            parseStoredString(
              product
                .baseProductIdMeta
                ?.value,
            ),

          componentProductIds:
            componentProducts.map(
              (component) =>
                component.id,
            ),

          componentProducts,
        });
      }

      if (
        errors.length >
        0
      ) {
        break;
      }

      hasNextPage =
        connection
          .pageInfo
          .hasNextPage;

      after =
        connection
          .pageInfo
          .endCursor;

      if (
        hasNextPage &&
        !after
      ) {
        errors.push(
          "Shopify indicó que existen más bundles pero no devolvió cursor.",
        );

        break;
      }
    } catch (
      error
    ) {
      errors.push(
        error instanceof Error
          ? error.message
          : "No fue posible consultar los bundles existentes.",
      );

      break;
    }
  }

  return {
    products,

    errors,
  };
}

/* =========================================================
   MANAGED MATCH
========================================================= */

function findManagedBundle(
  candidate:
    TemplateBundleCandidate,

  products:
    ExistingBundleProduct[],
) {
  return (
    products.find(
      (product) => {
        if (
          product.managedBy !==
          BUNDLE_MANAGED_BY_VALUE
        ) {
          return false;
        }

        if (
          product.baseProductId !==
          candidate
            .baseProduct
            .id
        ) {
          return false;
        }

        if (
          product.template ===
          candidate.templateId
        ) {
          return true;
        }

        if (
          candidate.templateId ===
            "pc_monitor_new" &&
          product.template ===
            OLD_TEMPLATE_PC_MONITOR
        ) {
          return true;
        }

        return false;
      },
    ) ??
    null
  );
}

/* =========================================================
   BASE PRODUCT MATCH
========================================================= */

function bundleContainsBaseProduct(
  bundle:
    ExistingBundleProduct,

  candidate:
    TemplateBundleCandidate,
) {
  if (
    bundle.baseProductId ===
    candidate
      .baseProduct
      .id
  ) {
    return true;
  }

  return bundle
    .componentProductIds
    .includes(
      candidate
        .baseProduct
        .id,
    );
}

/* =========================================================
   SAME TEMPLATE FAMILY

   Existing monitor does not need to be today's cheapest
   monitor.

   It only needs to satisfy the current monitor rules of
   that template.
========================================================= */

function findBundleForTemplateFamily(
  candidate:
    TemplateBundleCandidate,

  products:
    ExistingBundleProduct[],
) {
  const baseBundles =
    products.filter(
      (bundle) =>
        bundleContainsBaseProduct(
          bundle,
          candidate,
        ),
    );

  /*
   * Strongest legacy check:
   * exact same monitor.
   */
  const exact =
    baseBundles.find(
      (bundle) =>
        bundle
          .componentProductIds
          .includes(
            candidate
              .monitor
              .id,
          ),
    );

  if (
    exact
  ) {
    return exact;
  }

  /*
   * Otherwise classify components using current template.
   */
  for (
    const bundle
    of baseBundles
  ) {
    const matchesTemplate =
      bundle
        .componentProducts
        .filter(
          (component) =>
            component.id !==
            candidate
              .baseProduct
              .id,
        )
        .some(
          (component) =>
            productMatchesRule(
              component,
              candidate
                .template
                .monitorRule,
            ),
        );

    if (
      matchesTemplate
    ) {
      return bundle;
    }
  }

  return null;
}

/* =========================================================
   SKU BATCH SEARCH

   Example query:

   (
     sku:"BND-PC001"
     OR sku:"BND-PC002"
     OR sku:"BND-R-PC001"
   )

   This uses Shopify's normal search syntax, not GraphQL
   aliases.
========================================================= */

async function searchExactSkuBatch(
  admin:
    AdminClient,

  skus:
    string[],
) {
  const productBySku =
    new Map<
      string,
      ExistingBundleProduct
    >();

  if (
    skus.length ===
    0
  ) {
    return {
      productBySku,

      errors:
        [] as string[],
    };
  }

  const terms =
    skus.map(
      (sku) =>
        `sku:"${escapeSearchValue(
          sku,
        )}"`,
    );

  const query =
    `(${terms.join(
      " OR ",
    )})`;

  try {
    const response =
      await admin.graphql(
        `#graphql
          query CsbyteBundleSkuBatch(
            $query: String!
          ) {
            productVariants(
              first: ${SKU_RESULT_LIMIT}
              query: $query
            ) {
              nodes {
                id
                sku

                product {
                  id
                  title
                  handle
                  status
                  productType
                  publishedAt
                }
              }
            }
          }
        `,
        {
          variables: {
            query,
          },
        },
      );

    const json =
      (await response.json()) as {
        data?: {
          productVariants?: {
            nodes:
              SkuVariantNode[];
          };
        };

        errors?: Array<{
          message:
            string;
        }>;
      };

    const pageErrors =
      getGraphqlErrors(
        json,
      );

    if (
      pageErrors.length >
      0
    ) {
      return {
        productBySku,

        errors:
          pageErrors,
      };
    }

    const requested =
      new Set(
        skus.map(
          normalizeSku,
        ),
      );

    const variants =
      json.data
        ?.productVariants
        ?.nodes ??
      [];

    for (
      const variant
      of variants
    ) {
      const normalized =
        normalizeSku(
          variant.sku,
        );

      /*
       * Search syntax may perform tokenized matching
       * depending on field implementation.
       *
       * We always validate the exact SKU ourselves.
       */
      if (
        !requested.has(
          normalized,
        )
      ) {
        continue;
      }

      if (
        productBySku.has(
          normalized,
        )
      ) {
        continue;
      }

      productBySku.set(
        normalized,
        {
          id:
            variant
              .product
              .id,

          title:
            variant
              .product
              .title,

          handle:
            variant
              .product
              .handle,

          status:
            variant
              .product
              .status,

          productType:
            variant
              .product
              .productType,

          publishedAt:
            variant
              .product
              .publishedAt,

          sku:
            variant.sku,

          managedBy:
            null,

          template:
            null,

          baseProductId:
            null,

          componentProductIds:
            [],

          componentProducts:
            [],
        },
      );
    }

    return {
      productBySku,

      errors:
        [] as string[],
    };
  } catch (
    error
  ) {
    return {
      productBySku,

      errors: [
        error instanceof Error
          ? error.message
          : "No fue posible comprobar un grupo de SKUs.",
      ],
    };
  }
}

/* =========================================================
   TARGETED MANAGED-BUNDLE CHECK

   Product search indexes can lag briefly after creating a
   DRAFT bundle. If the SKU search already finds a product,
   query that exact product by ID and inspect our metafields
   directly before reporting a SKU conflict.
========================================================= */

async function fetchManagedBundleIdentity(
  admin:
    AdminClient,

  productId:
    string,
) {
  try {
    const response =
      await admin.graphql(
        `#graphql
          query CsbyteManagedBundleIdentity(
            $id: ID!
          ) {
            product(
              id: $id
            ) {
              id
              title
              handle
              status
              productType
              publishedAt

              variants(
                first: 1
              ) {
                nodes {
                  id
                  sku
                }
              }

              managedByMeta: metafield(
                namespace: "${BUNDLE_META_NAMESPACE}"
                key: "${BUNDLE_MANAGED_BY_KEY}"
              ) {
                value
              }

              templateMeta: metafield(
                namespace: "${BUNDLE_META_NAMESPACE}"
                key: "${BUNDLE_TEMPLATE_KEY}"
              ) {
                value
              }

              baseProductIdMeta: metafield(
                namespace: "${BUNDLE_META_NAMESPACE}"
                key: "${BUNDLE_BASE_PRODUCT_ID_KEY}"
              ) {
                value
              }
            }
          }
        `,
        {
          variables: {
            id:
              productId,
          },
        },
      );

    const json =
      (await response.json()) as {
        data?: {
          product?:
            | {
                id:
                  string;

                title:
                  string;

                handle:
                  string;

                status:
                  string;

                productType:
                  string;

                publishedAt:
                  | string
                  | null;

                variants: {
                  nodes: Array<{
                    id:
                      string;

                    sku:
                      | string
                      | null;
                  }>;
                };

                managedByMeta?:
                  | {
                      value:
                        string;
                    }
                  | null;

                templateMeta?:
                  | {
                      value:
                        string;
                    }
                  | null;

                baseProductIdMeta?:
                  | {
                      value:
                        string;
                    }
                  | null;
              }
            | null;
        };

        errors?: Array<{
          message:
            string;
        }>;
      };

    const errors =
      getGraphqlErrors(
        json,
      );

    if (
      errors.length >
      0
    ) {
      return {
        product:
          null as ExistingBundleProduct | null,

        errors,
      };
    }

    const product =
      json.data
        ?.product;

    if (
      !product
    ) {
      return {
        product:
          null as ExistingBundleProduct | null,

        errors: [
          "Shopify no devolvió el producto encontrado por SKU.",
        ],
      };
    }

    return {
      product: {
        id:
          product.id,

        title:
          product.title,

        handle:
          product.handle,

        status:
          product.status,

        productType:
          product.productType,

        publishedAt:
          product.publishedAt,

        sku:
          product
            .variants
            .nodes[0]
            ?.sku ??
          null,

        managedBy:
          parseStoredString(
            product
              .managedByMeta
              ?.value,
          ),

        template:
          parseStoredString(
            product
              .templateMeta
              ?.value,
          ),

        baseProductId:
          parseStoredString(
            product
              .baseProductIdMeta
              ?.value,
          ),

        componentProductIds:
          [],

        componentProducts:
          [],
      },

      errors:
        [] as string[],
    };
  } catch (
    error
  ) {
    return {
      product:
        null as ExistingBundleProduct | null,

      errors: [
        error instanceof Error
          ? error.message
          : "No fue posible comprobar el producto encontrado por SKU.",
      ],
    };
  }
}

function isManagedProductForCandidate(
  product:
    ExistingBundleProduct,

  candidate:
    TemplateBundleCandidate,
) {
  if (
    product.managedBy !==
    BUNDLE_MANAGED_BY_VALUE
  ) {
    return false;
  }

  if (
    product.baseProductId !==
    candidate
      .baseProduct
      .id
  ) {
    return false;
  }

  if (
    product.template ===
    candidate.templateId
  ) {
    return true;
  }

  return (
    candidate.templateId ===
      "pc_monitor_new" &&
    product.template ===
      OLD_TEMPLATE_PC_MONITOR
  );
}

/* =========================================================
   MAIN
========================================================= */

export async function loadExistingPcMonitorBundleMatches(
  admin:
    AdminClient,

  candidates:
    TemplateBundleCandidate[],
): Promise<ExistingBundleLookupResult> {
  const errors:
    string[] =
    [];

  const resultByCandidateId =
    new Map<
      string,
      ExistingBundleMatch
    >();

  /* -------------------------------------------------------
     1. EXISTING BUNDLES
  ------------------------------------------------------- */

  const existingResult =
    await fetchExistingBundles(
      admin,
      candidates,
    );

  errors.push(
    ...existingResult.errors,
  );

  /*
   * Fail closed.
   */
  if (
    existingResult.errors.length >
    0
  ) {
    return {
      matches:
        candidates.map(
          (candidate) => {
            const expectedSku =
              getExpectedSku(
                candidate,
              );

            return {
              candidateId:
                candidate.id,

              baseProductId:
                candidate
                  .baseProduct
                  .id,

              templateId:
                candidate.templateId,

              expectedSku,

              status:
                expectedSku
                  ? "lookup_error"
                  : "missing_base_sku",

              existingProduct:
                null,

              message:
                expectedSku
                  ? "No fue posible completar la revisión segura de bundles existentes."
                  : "El computador base no tiene SKU.",
            };
          },
        ),

      errors,
    };
  }

  /* -------------------------------------------------------
     2. INTERNAL SKU DUPLICATES
  ------------------------------------------------------- */

  const skuCounts =
    new Map<
      string,
      number
    >();

  for (
    const candidate
    of candidates
  ) {
    const expectedSku =
      getExpectedSku(
        candidate,
      );

    if (
      !expectedSku
    ) {
      continue;
    }

    const normalized =
      normalizeSku(
        expectedSku,
      );

    skuCounts.set(
      normalized,
      (
        skuCounts.get(
          normalized,
        ) ??
        0
      ) +
        1,
    );
  }

  /* -------------------------------------------------------
     3. RESOLVE EVERYTHING THAT DOESN'T REQUIRE SKU SEARCH
  ------------------------------------------------------- */

  const unresolved:
    TemplateBundleCandidate[] =
    [];

  for (
    const candidate
    of candidates
  ) {
    const expectedSku =
      getExpectedSku(
        candidate,
      );

    if (
      !expectedSku
    ) {
      resultByCandidateId.set(
        candidate.id,
        {
          candidateId:
            candidate.id,

          baseProductId:
            candidate
              .baseProduct
              .id,

          templateId:
            candidate.templateId,

          expectedSku:
            null,

          status:
            "missing_base_sku",

          existingProduct:
            null,

          message:
            "El computador base no tiene SKU.",
        },
      );

      continue;
    }

    if (
      (
        skuCounts.get(
          normalizeSku(
            expectedSku,
          ),
        ) ??
        0
      ) >
      1
    ) {
      resultByCandidateId.set(
        candidate.id,
        {
          candidateId:
            candidate.id,

          baseProductId:
            candidate
              .baseProduct
              .id,

          templateId:
            candidate.templateId,

          expectedSku,

          status:
            "sku_conflict",

          existingProduct:
            null,

          message:
            "Dos o más plantillas están intentando generar el mismo SKU.",
        },
      );

      continue;
    }

    const managed =
      findManagedBundle(
        candidate,
        existingResult.products,
      );

    if (
      managed
    ) {
      resultByCandidateId.set(
        candidate.id,
        {
          candidateId:
            candidate.id,

          baseProductId:
            candidate
              .baseProduct
              .id,

          templateId:
            candidate.templateId,

          expectedSku,

          status:
            "existing_managed",

          existingProduct:
            managed,

          message:
            `Ya existe un producto de Bundles administrado por la plantilla "${candidate.templateName}".`,
        },
      );

      continue;
    }

    const familyBundle =
      findBundleForTemplateFamily(
        candidate,
        existingResult.products,
      );

    if (
      familyBundle
    ) {
      const managedByApp =
        familyBundle.managedBy ===
        BUNDLE_MANAGED_BY_VALUE;

      resultByCandidateId.set(
        candidate.id,
        {
          candidateId:
            candidate.id,

          baseProductId:
            candidate
              .baseProduct
              .id,

          templateId:
            candidate.templateId,

          expectedSku,

          status:
            managedByApp
              ? "existing_managed"
              : "existing_legacy",

          existingProduct:
            familyBundle,

          message:
            managedByApp
              ? `Ya existe un producto de Bundles administrado para la plantilla "${candidate.templateName}".`
              : `Shopify ya tiene un producto de Bundles nativo para este PC que corresponde a la plantilla "${candidate.templateName}".`,
        },
      );

      continue;
    }

    unresolved.push(
      candidate,
    );
  }

  /* -------------------------------------------------------
     4. SKU CHECKS IN SMALL BATCHES
  ------------------------------------------------------- */

  const batches =
    chunkArray(
      unresolved,
      SKU_BATCH_SIZE,
    );

  for (
    const batch
    of batches
  ) {
    const skus =
      batch
        .map(
          getExpectedSku,
        )
        .filter(
          (
            sku,
          ): sku is string =>
            Boolean(
              sku,
            ),
        );

    const skuResult =
      await searchExactSkuBatch(
        admin,
        skus,
      );

    if (
      skuResult.errors.length >
      0
    ) {
      errors.push(
        ...skuResult.errors,
      );

      for (
        const candidate
        of batch
      ) {
        const expectedSku =
          getExpectedSku(
            candidate,
          );

        resultByCandidateId.set(
          candidate.id,
          {
            candidateId:
              candidate.id,

            baseProductId:
              candidate
                .baseProduct
                .id,

            templateId:
              candidate.templateId,

            expectedSku,

            status:
              "lookup_error",

            existingProduct:
              null,

            message:
              "No fue posible comprobar si el SKU está disponible.",
          },
        );
      }

      continue;
    }

    for (
      const candidate
      of batch
    ) {
      const expectedSku =
        getExpectedSku(
          candidate,
        );

      if (
        !expectedSku
      ) {
        continue;
      }

      const conflict =
        skuResult
          .productBySku
          .get(
            normalizeSku(
              expectedSku,
            ),
          );

      if (
        conflict
      ) {
        /*
         * A newly-created DRAFT bundle can appear in the SKU
         * search before the broader bundles:true product
         * search has refreshed. Inspect the exact product by
         * ID before classifying it as a conflict.
         */
        const identityResult =
          await fetchManagedBundleIdentity(
            admin,
            conflict.id,
          );

        if (
          identityResult.errors.length >
          0
        ) {
          errors.push(
            ...identityResult.errors,
          );

          resultByCandidateId.set(
            candidate.id,
            {
              candidateId:
                candidate.id,

              baseProductId:
                candidate
                  .baseProduct
                  .id,

              templateId:
                candidate.templateId,

              expectedSku,

              status:
                "lookup_error",

              existingProduct:
                conflict,

              message:
                "El SKU existe, pero no fue posible comprobar de forma segura si corresponde al producto de Bundles recién creado.",
            },
          );

          continue;
        }

        if (
          identityResult.product &&
          isManagedProductForCandidate(
            identityResult.product,
            candidate,
          )
        ) {
          resultByCandidateId.set(
            candidate.id,
            {
              candidateId:
                candidate.id,

              baseProductId:
                candidate
                  .baseProduct
                  .id,

              templateId:
                candidate.templateId,

              expectedSku,

              status:
                "existing_managed",

              existingProduct:
                identityResult.product,

              message:
                `Ya existe un bundle administrado por la plantilla "${candidate.templateName}".`,
            },
          );

          continue;
        }

        resultByCandidateId.set(
          candidate.id,
          {
            candidateId:
              candidate.id,

            baseProductId:
              candidate
                .baseProduct
                .id,

            templateId:
              candidate.templateId,

            expectedSku,

            status:
              "sku_conflict",

            existingProduct:
              identityResult.product ??
              conflict,

            message:
              "El SKU generado por esta plantilla ya está ocupado por otro producto.",
          },
        );

        continue;
      }

      resultByCandidateId.set(
        candidate.id,
        {
          candidateId:
            candidate.id,

          baseProductId:
            candidate
              .baseProduct
              .id,

          templateId:
            candidate.templateId,

          expectedSku,

          status:
            "new",

          existingProduct:
            null,

          message:
            `La propuesta de "${candidate.templateName}" puede crearse y su SKU está disponible.`,
        },
      );
    }
  }

  /* -------------------------------------------------------
     5. SAME ORDER AS CANDIDATES
  ------------------------------------------------------- */

  return {
    matches:
      candidates.map(
        (candidate) =>
          resultByCandidateId.get(
            candidate.id,
          ) ?? {
            candidateId:
              candidate.id,

            baseProductId:
              candidate
                .baseProduct
                .id,

            templateId:
              candidate.templateId,

            expectedSku:
              getExpectedSku(
                candidate,
              ),

            status:
              "lookup_error",

            existingProduct:
              null,

            message:
              "No fue posible determinar el estado de esta propuesta.",
          },
      ),

    errors,
  };
}