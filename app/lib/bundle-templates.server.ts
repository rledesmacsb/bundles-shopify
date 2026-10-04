import type {
  BundleTemplate,
  ShopifyMetafieldDefinitionOption,
} from "./bundle-templates";

import {
  getDefaultBundleTemplates,
  sanitizeBundleTemplates,
} from "./bundle-templates";

/* =========================================================
   CONSTANTS
========================================================= */

const CONFIG_NAMESPACE =
  "app_config";

const TEMPLATE_CONFIG_KEY =
  "bundle_templates_v1";

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

export type BundleTemplateSettingsData = {
  templates:
    BundleTemplate[];

  productTypes:
    string[];

  metafields:
    ShopifyMetafieldDefinitionOption[];

  errors:
    string[];
};

/* =========================================================
   BASIC HELPERS
========================================================= */

function getErrors(
  json: {
    errors?: Array<{
      message:
        string;
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

/* =========================================================
   LOAD STORED TEMPLATES
========================================================= */

async function loadStoredTemplates(
  admin:
    AdminClient,
) {
  try {
    const response =
      await admin.graphql(
        `#graphql
          query CsbyteBundleTemplates {
            currentAppInstallation {
              id

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
                id:
                  string;

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
          message:
            string;
        }>;
      };

    const errors =
      getErrors(
        json,
      );

    const installation =
      json.data
        ?.currentAppInstallation;

    if (
      !installation
    ) {
      return {
        installationId:
          null as string | null,

        templates:
          getDefaultBundleTemplates(),

        errors: [
          ...errors,

          "No fue posible obtener la instalación de la app.",
        ],
      };
    }

    const rawValue =
      installation
        .templates
        ?.value;

    if (
      !rawValue
    ) {
      return {
        installationId:
          installation.id,

        templates:
          getDefaultBundleTemplates(),

        errors,
      };
    }

    try {
      const parsed =
        JSON.parse(
          rawValue,
        );

      return {
        installationId:
          installation.id,

        templates:
          sanitizeBundleTemplates(
            parsed,
          ),

        errors,
      };
    } catch {
      return {
        installationId:
          installation.id,

        templates:
          getDefaultBundleTemplates(),

        errors: [
          ...errors,

          "La configuración guardada de plantillas no contiene JSON válido. Se cargaron los valores predeterminados.",
        ],
      };
    }
  } catch (
    error
  ) {
    return {
      installationId:
        null as string | null,

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
   LOAD PRODUCT TYPES

   Small independent query.
========================================================= */

async function loadProductTypes(
  admin:
    AdminClient,
) {
  try {
    const response =
      await admin.graphql(
        `#graphql
          query CsbyteBundleProductTypes {
            productTypes(
              first: 250
            ) {
              nodes
            }
          }
        `,
      );

    const json =
      (await response.json()) as {
        data?: {
          productTypes?: {
            nodes:
              string[];
          };
        };

        errors?: Array<{
          message:
            string;
        }>;
      };

    const errors =
      getErrors(
        json,
      );

    const productTypes =
      (
        json.data
          ?.productTypes
          ?.nodes ??
        []
      )
        .filter(
          Boolean,
        )
        .sort(
          (
            a,
            b,
          ) =>
            a.localeCompare(
              b,
              "es",
            ),
        );

    return {
      productTypes,

      errors,
    };
  } catch (
    error
  ) {
    return {
      productTypes:
        [] as string[],

      errors: [
        error instanceof Error
          ? error.message
          : "No fue posible consultar los tipos de producto.",
      ],
    };
  }
}

/* =========================================================
   LOAD PRODUCT METAFIELD DEFINITIONS

   100 definitions per query.
   Sequential pagination.
========================================================= */

async function loadProductMetafields(
  admin:
    AdminClient,
) {
  const metafields:
    ShopifyMetafieldDefinitionOption[] =
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

  while (
    hasNextPage &&
    page <
      10
  ) {
    page +=
      1;

    try {
      const response =
        await admin.graphql(
          `#graphql
            query CsbyteProductMetafieldDefinitions(
              $after: String
            ) {
              metafieldDefinitions(
                ownerType: PRODUCT
                first: 100
                after: $after
              ) {
                nodes {
                  id
                  name
                  namespace
                  key

                  type {
                    name
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
            variables: {
              after,
            },
          },
        );

      const json =
        (await response.json()) as {
          data?: {
            metafieldDefinitions?: {
              nodes:
                Array<{
                  id:
                    string;

                  name:
                    string;

                  namespace:
                    string;

                  key:
                    string;

                  type: {
                    name:
                      string;
                  };
                }>;

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
        getErrors(
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
          ?.metafieldDefinitions;

      if (
        !connection
      ) {
        errors.push(
          "Shopify no devolvió las definiciones de metacampos.",
        );

        break;
      }

      for (
        const definition
        of connection.nodes
      ) {
        metafields.push({
          id:
            definition.id,

          name:
            definition.name,

          namespace:
            definition.namespace,

          key:
            definition.key,

          type:
            definition.type.name,
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
          "Shopify indicó que existen más metacampos pero no devolvió cursor.",
        );

        break;
      }
    } catch (
      error
    ) {
      errors.push(
        error instanceof Error
          ? error.message
          : "No fue posible consultar las definiciones de metacampos.",
      );

      break;
    }
  }

  metafields.sort(
    (
      a,
      b,
    ) => {
      const namespaceCompare =
        a.namespace.localeCompare(
          b.namespace,
          "es",
        );

      if (
        namespaceCompare !==
        0
      ) {
        return namespaceCompare;
      }

      return a.name.localeCompare(
        b.name,
        "es",
      );
    },
  );

  return {
    metafields,

    errors,
  };
}

/* =========================================================
   LOAD COMPLETE SETTINGS PAGE

   Queries are intentionally sequential.
========================================================= */

export async function loadBundleTemplateSettings(
  admin:
    AdminClient,
): Promise<BundleTemplateSettingsData> {
  const stored =
    await loadStoredTemplates(
      admin,
    );

  const productTypes =
    await loadProductTypes(
      admin,
    );

  const metafields =
    await loadProductMetafields(
      admin,
    );

  return {
    templates:
      stored.templates,

    productTypes:
      productTypes.productTypes,

    metafields:
      metafields.metafields,

    errors: [
      ...stored.errors,

      ...productTypes.errors,

      ...metafields.errors,
    ],
  };
}

/* =========================================================
   SAVE TEMPLATES
========================================================= */

export async function saveBundleTemplates(
  admin:
    AdminClient,

  templates:
    BundleTemplate[],
) {
  const stored =
    await loadStoredTemplates(
      admin,
    );

  if (
    !stored.installationId
  ) {
    return {
      success:
        false,

      message:
        "No fue posible obtener la instalación de la app.",
    };
  }

  const sanitized =
    sanitizeBundleTemplates(
      templates,
    );

  const response =
    await admin.graphql(
      `#graphql
        mutation CsbyteSaveBundleTemplates(
          $metafields: [MetafieldsSetInput!]!
        ) {
          metafieldsSet(
            metafields: $metafields
          ) {
            metafields {
              id
              namespace
              key
              value
            }

            userErrors {
              field
              message
              code
            }
          }
        }
      `,
      {
        variables: {
          metafields: [
            {
              ownerId:
                stored.installationId,

              namespace:
                CONFIG_NAMESPACE,

              key:
                TEMPLATE_CONFIG_KEY,

              type:
                "json",

              value:
                JSON.stringify(
                  sanitized,
                ),
            },
          ],
        },
      },
    );

  const json =
    (await response.json()) as {
      data?: {
        metafieldsSet?: {
          userErrors?: Array<{
            message:
              string;
          }>;
        };
      };

      errors?: Array<{
        message:
          string;
      }>;
    };

  const errors = [
    ...getErrors(
      json,
    ),

    ...(json.data
      ?.metafieldsSet
      ?.userErrors
      ?.map(
        (error) =>
          error.message,
      ) ?? []),
  ];

  if (
    errors.length >
    0
  ) {
    return {
      success:
        false,

      message:
        errors.join(
          " | ",
        ),
    };
  }

  return {
    success:
      true,

    message:
      "Plantillas guardadas correctamente.",
  };
}