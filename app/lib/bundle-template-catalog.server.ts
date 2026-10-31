import type {
  BundleTemplate,
  MetafieldReference,
  ProductRuleGroup,
} from "./bundle-templates";

import {
  getDefaultBundleTemplates,
  sanitizeBundleTemplates,
} from "./bundle-templates";

import {
  collectTemplateMetafieldReferences,
  type TemplateCatalogMetafield,
  type TemplateCatalogProduct,
} from "./bundle-rule-engine";

/* =========================================================
   CONSTANTS
========================================================= */

const CONFIG_NAMESPACE =
  "app_config";

const TEMPLATE_CONFIG_KEY =
  "bundle_templates_v1";

/*
 * Conservative page size.
 *
 * We fetch:
 * - product core fields
 * - up to 2 variants
 * - a limited number of exact metafields
 *
 * 20 products keeps the GraphQL query comfortably bounded
 * while avoiding the previous product-by-product approach.
 */
const PRODUCT_PAGE_SIZE =
  20;

const MAX_PRODUCT_PAGES =
  30;

/*
 * Prevent template configuration from making the catalog
 * query grow indefinitely.
 */
const MAX_RUNTIME_METAFIELDS =
  8;

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
   RESULT
========================================================= */

export type BundleTemplateCatalogData = {
  templates:
    BundleTemplate[];

  products:
    TemplateCatalogProduct[];

  metafieldReferences:
    MetafieldReference[];

  currencyCode:
    string;

  errors:
    string[];
};

/* =========================================================
   GRAPHQL TYPES
========================================================= */

type RawMetafield = {
  namespace: string;

  key: string;

  type: string;

  value: string;
};

type BaseProductNode = {
  id: string;

  title: string;

  status: string;

  productType: string;

  vendor: string;

  tags: string[];

  totalInventory: number;

  featuredImage:
    | {
        url: string;

        altText:
          | string
          | null;
      }
    | null;

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

  /*
   * Dynamic aliases such as:
   *
   * templateMf0
   * templateMf1
   * templateMf2
   */
  [key: string]:
    unknown;
};

/* =========================================================
   GENERAL HELPERS
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

function escapeSearchValue(
  value:
    string,
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

/* =========================================================
   SAFE PRODUCT TYPE PREFILTER
========================================================= */

/*
 * Examples:
 *
 * ALL
 *   product_type = Monitor
 *   title contains Nuevo
 *
 * We can safely query only "Monitor".
 *
 * ANY
 *   product_type = Monitor
 *   vendor = Samsung
 *
 * We cannot restrict to Monitor because a Samsung product
 * of another type could satisfy the OR rule.
 */

function getSafeRuleProductTypes(
  rule:
    ProductRuleGroup,
):
  | string[]
  | null {
  if (
    rule.conditions.length ===
    0
  ) {
    return null;
  }

  /* -------------------------------------------------------
     AND
  ------------------------------------------------------- */

  if (
    rule.match ===
    "all"
  ) {
    const types =
      rule.conditions
        .filter(
          (condition) =>
            condition.source ===
              "product_type" &&
            condition.operator ===
              "equals" &&
            Boolean(
              condition.value.trim(),
            ),
        )
        .map(
          (condition) =>
            condition.value.trim(),
        );

    return types.length >
      0
      ? types
      : null;
  }

  /* -------------------------------------------------------
     OR

     Safe only when every branch is:
     product_type = X
  ------------------------------------------------------- */

  const everyConditionIsType =
    rule.conditions.every(
      (condition) =>
        condition.source ===
          "product_type" &&
        condition.operator ===
          "equals" &&
        Boolean(
          condition.value.trim(),
        ),
    );

  if (
    !everyConditionIsType
  ) {
    return null;
  }

  return rule.conditions.map(
    (condition) =>
      condition.value.trim(),
  );
}

function collectSafeCatalogProductTypes(
  templates:
    BundleTemplate[],
):
  | string[]
  | null {
  const productTypes =
    new Set<string>();

  let hasActiveTemplate =
    false;

  for (
    const template
    of templates
  ) {
    if (
      !template.enabled
    ) {
      continue;
    }

    hasActiveTemplate =
      true;

    const rules = [
      template.baseProductRule,
      template.monitorRule,
      template.keyboardMouseRule,
      template.wifiAdapterRule,
    ];

    for (
      const rule
      of rules
    ) {
      const safeTypes =
        getSafeRuleProductTypes(
          rule,
        );

      /*
       * If one rule can't be safely represented by
       * productType, we must load the general in-stock
       * catalog instead.
       */
      if (
        !safeTypes
      ) {
        return null;
      }

      for (
        const productType
        of safeTypes
      ) {
        productTypes.add(
          productType,
        );
      }
    }
  }

  if (
    !hasActiveTemplate
  ) {
    return [];
  }

  return Array.from(
    productTypes,
  );
}

/* =========================================================
   LOAD STORED TEMPLATES
========================================================= */

async function loadRuntimeTemplates(
  admin:
    AdminClient,
) {
  try {
    const response =
      await admin.graphql(
        `#graphql
          query CsbyteRuntimeBundleTemplates {
            currentAppInstallation {
              templates: metafield(
                namespace: "${CONFIG_NAMESPACE}"
                key: "${TEMPLATE_CONFIG_KEY}"
              ) {
                value
              }
            }
          }
        `,
      );

    const json =
      (await response.json()) as {
        data?: {
          currentAppInstallation?:
            | {
                templates?:
                  | {
                      value:
                        string;
                    }
                  | null;
              }
            | null;
        };

        errors?: Array<{
          message: string;
        }>;
      };

    const errors =
      getGraphqlErrors(
        json,
      );

    const raw =
      json.data
        ?.currentAppInstallation
        ?.templates
        ?.value;

    if (
      !raw
    ) {
      return {
        templates:
          getDefaultBundleTemplates(),

        errors,
      };
    }

    try {
      return {
        templates:
          sanitizeBundleTemplates(
            JSON.parse(
              raw,
            ),
          ),

        errors,
      };
    } catch {
      return {
        templates:
          getDefaultBundleTemplates(),

        errors: [
          ...errors,

          "La configuración de plantillas no contiene JSON válido. Se utilizaron los valores predeterminados.",
        ],
      };
    }
  } catch (
    error
  ) {
    return {
      templates:
        getDefaultBundleTemplates(),

      errors: [
        error instanceof Error
          ? error.message
          : "No fue posible cargar las plantillas.",
      ],
    };
  }
}

/* =========================================================
   CURRENCY
========================================================= */

async function loadShopCurrency(
  admin:
    AdminClient,
) {
  try {
    const response =
      await admin.graphql(
        `#graphql
          query CsbyteTemplateCatalogShop {
            shop {
              currencyCode
            }
          }
        `,
      );

    const json =
      (await response.json()) as {
        data?: {
          shop?: {
            currencyCode?:
              string;
          };
        };

        errors?: Array<{
          message:
            string;
        }>;
      };

    return {
      currencyCode:
        json.data
          ?.shop
          ?.currencyCode ??
        "CLP",

      errors:
        getGraphqlErrors(
          json,
        ),
    };
  } catch (
    error
  ) {
    return {
      currencyCode:
        "CLP",

      errors: [
        error instanceof Error
          ? error.message
          : "No fue posible obtener la moneda de la tienda.",
      ],
    };
  }
}

/* =========================================================
   DYNAMIC EXACT METAFIELDS

   Instead of:

   metafields(keys: [...])

   we generate:

   templateMf0: metafield(
     namespace: $mfNamespace0
     key: $mfKey0
   )

   templateMf1: metafield(...)
   ...

   This is the same exact lookup mechanism that worked in
   the original bundle loader, but batched inside product
   pages.
========================================================= */

function buildMetafieldGraphql(
  references:
    MetafieldReference[],
) {
  if (
    references.length ===
    0
  ) {
    return {
      variableDefinitions:
        "",

      selections:
        "",
    };
  }

  const variableDefinitions =
    references
      .map(
        (
          _reference,
          index,
        ) => `
          $mfNamespace${index}: String!
          $mfKey${index}: String!
        `,
      )
      .join(
        "\n",
      );

  const selections =
    references
      .map(
        (
          _reference,
          index,
        ) => `
          templateMf${index}: metafield(
            namespace: $mfNamespace${index}
            key: $mfKey${index}
          ) {
            namespace
            key
            type
            value
          }
        `,
      )
      .join(
        "\n",
      );

  return {
    variableDefinitions,
    selections,
  };
}

function addMetafieldVariables(
  variables:
    Record<
      string,
      any
    >,

  references:
    MetafieldReference[],
) {
  references.forEach(
    (
      reference,
      index,
    ) => {
      variables[
        `mfNamespace${index}`
      ] =
        reference.namespace;

      variables[
        `mfKey${index}`
      ] =
        reference.key;
    },
  );
}

/* =========================================================
   EXTRACT EXACT METAFIELDS FROM PRODUCT
========================================================= */

function extractTemplateMetafields(
  product:
    BaseProductNode,

  references:
    MetafieldReference[],
): TemplateCatalogMetafield[] {
  const result:
    TemplateCatalogMetafield[] =
    [];

  references.forEach(
    (
      _reference,
      index,
    ) => {
      const raw =
        product[
          `templateMf${index}`
        ];

      if (
        !raw ||
        typeof raw !==
          "object"
      ) {
        return;
      }

      const metafield =
        raw as RawMetafield;

      if (
        !metafield.namespace ||
        !metafield.key
      ) {
        return;
      }

      result.push({
        namespace:
          metafield.namespace,

        key:
          metafield.key,

        type:
          metafield.type,

        value:
          metafield.value,
      });
    },
  );

  return result;
}

/* =========================================================
   LOAD ONE PRODUCT-TYPE / SEARCH QUERY

   Products + required metafields are returned together.

   No follow-up call per product.
========================================================= */

async function loadProductsForQuery(
  admin:
    AdminClient,

  searchQuery:
    string,

  metafieldReferences:
    MetafieldReference[],
) {
  const products:
    TemplateCatalogProduct[] =
    [];

  const errors:
    string[] =
    [];

  let after:
    | string
    | null =
    null;

  let hasNextPage =
    true;

  let page =
    0;

  const dynamic =
    buildMetafieldGraphql(
      metafieldReferences,
    );

  while (
    hasNextPage &&
    page <
      MAX_PRODUCT_PAGES
  ) {
    page +=
      1;

    const variables:
      Record<
        string,
        any
      > = {
        after,

        query:
          searchQuery,
      };

    addMetafieldVariables(
      variables,
      metafieldReferences,
    );

    try {
      const response =
        await admin.graphql(
          `#graphql
            query CsbyteTemplateCatalogPage(
              $after: String
              $query: String!

              ${dynamic.variableDefinitions}
            ) {
              products(
                first: ${PRODUCT_PAGE_SIZE}
                after: $after
                sortKey: TITLE
                query: $query
              ) {
                nodes {
                  id
                  title
                  status
                  productType
                  vendor
                  tags
                  totalInventory

                  featuredImage {
                    url
                    altText
                  }

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

                  ${dynamic.selections}
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
                BaseProductNode[];

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
          "Shopify no devolvió el catálogo de productos.",
        );

        break;
      }

      for (
        const product
        of connection.nodes
      ) {
        products.push({
          id:
            product.id,

          title:
            product.title,

          status:
            product.status,

          productType:
            product.productType,

          vendor:
            product.vendor,

          tags:
            product.tags ??
            [],

          totalInventory:
            product.totalInventory,

          featuredImage:
            product.featuredImage,

          variants: {
            nodes:
              product
                .variants
                .nodes,
          },

          templateMetafields:
            extractTemplateMetafields(
              product,
              metafieldReferences,
            ),
        });
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
          "Shopify indicó que existen más productos pero no devolvió cursor.",
        );

        break;
      }
    } catch (
      error
    ) {
      errors.push(
        error instanceof Error
          ? error.message
          : "No fue posible cargar una página del catálogo.",
      );

      break;
    }
  }

  if (
    hasNextPage &&
    page >=
      MAX_PRODUCT_PAGES
  ) {
    errors.push(
      `Una búsqueda superó el límite preventivo de ${
        PRODUCT_PAGE_SIZE *
        MAX_PRODUCT_PAGES
      } productos.`,
    );
  }

  return {
    products,

    errors,
  };
}

/* =========================================================
   LOAD COMPLETE CATALOG
========================================================= */

async function loadBaseProductCatalog(
  admin:
    AdminClient,

  templates:
    BundleTemplate[],

  metafieldReferences:
    MetafieldReference[],
) {
  const safeProductTypes =
    collectSafeCatalogProductTypes(
      templates,
    );

  const products:
    TemplateCatalogProduct[] =
    [];

  const errors:
    string[] =
    [];

  /* -------------------------------------------------------
     NO ACTIVE TEMPLATES
  ------------------------------------------------------- */

  if (
    safeProductTypes &&
    safeProductTypes.length ===
      0
  ) {
    return {
      products,
      errors,
    };
  }

  /* -------------------------------------------------------
     SAFE PRODUCT TYPE PREFILTER
  ------------------------------------------------------- */

  if (
    safeProductTypes
  ) {
    /*
     * Each product type keeps its own bounded GraphQL query.
     * We only run the independent type lookups concurrently,
     * so query cost stays controlled while removing several
     * network round trips from the critical path.
     */
    const results =
      await Promise.all(
        safeProductTypes.map(
          (
            productType,
          ) =>
            loadProductsForQuery(
              admin,

              `product_type:"${escapeSearchValue(
                productType,
              )}" AND inventory_total:>0`,

              metafieldReferences,
            ),
        ),
      );

    for (
      const result
      of results
    ) {
      products.push(
        ...result.products,
      );

      errors.push(
        ...result.errors,
      );
    }
  } else {
    /* -----------------------------------------------------
       GENERIC RULE FALLBACK
    ----------------------------------------------------- */

    const result =
      await loadProductsForQuery(
        admin,

        "inventory_total:>0",

        metafieldReferences,
      );

    products.push(
      ...result.products,
    );

    errors.push(
      ...result.errors,
    );
  }

  /* -------------------------------------------------------
     DEDUPLICATE

     Monitor appears in both current templates, so the same
     Shopify product type is intentionally queried only once
     by Set above, but we deduplicate again defensively.
  ------------------------------------------------------- */

  return {
    products:
      Array.from(
        new Map(
          products.map(
            (product) => [
              product.id,
              product,
            ],
          ),
        ).values(),
      ),

    errors,
  };
}

/* =========================================================
   MAIN
========================================================= */

export async function loadBundleTemplateCatalog(
  admin:
    AdminClient,
): Promise<BundleTemplateCatalogData> {
  const errors:
    string[] =
    [];

  /* -------------------------------------------------------
     1. TEMPLATES + CURRENCY

     They are independent Shopify reads, so they can run in
     parallel without increasing individual query cost.
  ------------------------------------------------------- */

  const [
    templateResult,
    currencyResult,
  ] =
    await Promise.all([
      loadRuntimeTemplates(
        admin,
      ),

      loadShopCurrency(
        admin,
      ),
    ]);

  errors.push(
    ...templateResult.errors,
    ...currencyResult.errors,
  );

  const templates =
    templateResult.templates;

  /* -------------------------------------------------------
     2. DETERMINE EXACT METAFIELDS REQUIRED
  ------------------------------------------------------- */

  const metafieldReferences =
    collectTemplateMetafieldReferences(
      templates,
      true,
    );

  if (
    metafieldReferences.length >
    MAX_RUNTIME_METAFIELDS
  ) {
    return {
      templates,

      products:
        [],

      metafieldReferences,

      currencyCode:
        "CLP",

      errors: [
        ...errors,

        `Las plantillas activas requieren ${metafieldReferences.length} metacampos. El límite preventivo actual es ${MAX_RUNTIME_METAFIELDS}.`,
      ],
    };
  }

  /* -------------------------------------------------------
     3. CATALOG

     Exact metafields are now included in every product page.
  ------------------------------------------------------- */

  const catalogResult =
    await loadBaseProductCatalog(
      admin,
      templates,
      metafieldReferences,
    );

  errors.push(
    ...catalogResult.errors,
  );

  return {
    templates,

    products:
      catalogResult.products,

    metafieldReferences,

    currencyCode:
      currencyResult.currencyCode,

    errors,
  };
}