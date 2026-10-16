import type {
  TemplateCatalogProduct,
} from "./bundle-rule-engine";

import type {
  TemplateBundleCandidate,
} from "./bundle-template-engine";

import {
  buildTemplateBundleState,
  calculateTemplateCandidatePrice,
} from "./bundle-template-engine";

import {
  loadBundleTemplateCatalog,
} from "./bundle-template-catalog.server";

import {
  loadBundleRuntimeSettings,
} from "./bundle-runtime-settings.server";

import {
  BUNDLE_BASE_PRODUCT_ID_KEY,
  BUNDLE_MANAGED_BY_KEY,
  BUNDLE_MANAGED_BY_VALUE,
  BUNDLE_META_NAMESPACE,
  BUNDLE_TEMPLATE_KEY,
  loadExistingPcMonitorBundleMatches,
} from "./bundle-existing.server";

/* =========================================================
   CONSTANTS
========================================================= */

const MANAGED_NAMESPACE =
  BUNDLE_META_NAMESPACE;

const MANAGED_BY_VALUE =
  BUNDLE_MANAGED_BY_VALUE;

/* =========================================================
   TYPES
========================================================= */

type AdminClient = {
  graphql: (
    query: string,
    options?: any,
  ) => Promise<any>;
};

type SelectedOption = {
  name: string;
  value: string;
};

type ProductOption = {
  id: string;
  name: string;
  values: string[];
};

type CreationVariant = {
  id: string;
  sku: string | null;

  selectedOptions: SelectedOption[];
};

type CreationProduct = {
  id: string;
  title: string;
  totalInventory: number;

  options: ProductOption[];

  variants: {
    nodes: CreationVariant[];
  };
};

type ComponentRole =
  | "pc"
  | "monitor"
  | "keyboard_mouse"
  | "wifi_adapter";

type ComponentDetail = {
  role: ComponentRole;

  product: CreationProduct;

  variant: CreationVariant;
};

type BundleComponentInput = {
  productId: string;

  quantity: number;

  optionSelections: Array<{
    componentOptionId: string;
    name: string;
    values: string[];
  }>;
};

export type CreateDraftBundleResult = {
  success: boolean;

  message: string;

  productId?: string;

  title?: string;

  sku?: string;

  price?: number;

  partial?: boolean;
};

/* =========================================================
   HELPERS
========================================================= */

function sleep(
  milliseconds: number,
) {
  return new Promise<void>(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

function normalize(
  value:
    | string
    | null
    | undefined,
) {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase(
      "es",
    )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      "",
    );
}

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
    ) ?? []
  );
}

function formatErrors(
  errors: string[],
) {
  return errors
    .filter(Boolean)
    .join(" | ");
}

function getComponentLabel(
  role: ComponentRole,
) {
  switch (role) {
    case "pc":
      return "PC";

    case "monitor":
      return "Monitor";

    case "keyboard_mouse":
      return "Teclado y mouse";

    case "wifi_adapter":
      return "Wi-Fi";

    default:
      return "Componente";
  }
}

/* =========================================================
   FETCH A COMPONENT

   Una consulta pequeña por producto.
   No usamos aliases dinámicos ni lotes grandes.
========================================================= */

async function fetchCreationProduct(
  admin: AdminClient,

  productId: string,
): Promise<{
  product: CreationProduct | null;

  errors: string[];
}> {
  try {
    const response =
      await admin.graphql(
        `#graphql
          query CsbyteBundleCreationProduct(
            $id: ID!
          ) {
            product(
              id: $id
            ) {
              id
              title
              totalInventory

              options {
                id
                name
                values
              }

              variants(
                first: 2
              ) {
                nodes {
                  id
                  sku

                  selectedOptions {
                    name
                    value
                  }
                }
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
            CreationProduct | null;
        };

        errors?: Array<{
          message: string;
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
          null,

        errors,
      };
    }

    const product =
      json.data
        ?.product ??
      null;

    if (
      !product
    ) {
      return {
        product:
          null,

        errors: [
          `No fue posible encontrar el producto ${productId}.`,
        ],
      };
    }

    return {
      product,

      errors: [],
    };
  } catch (
    error
  ) {
    return {
      product:
        null,

      errors: [
        error instanceof Error
          ? error.message
          : "Error al leer uno de los componentes.",
      ],
    };
  }
}

/* =========================================================
   VALIDATE COMPONENT

   V1:
   Todos los componentes utilizados para crear el bundle
   deben tener exactamente una variante.

   Esto incluye:
   - PC
   - monitor
   - teclado/mouse
   - Wi-Fi
========================================================= */

async function loadComponentDetail(
  admin: AdminClient,

  product:
    TemplateCatalogProduct,

  role:
    ComponentRole,
): Promise<{
  component:
    ComponentDetail | null;

  errors:
    string[];
}> {
  const result =
    await fetchCreationProduct(
      admin,
      product.id,
    );

  if (
    !result.product
  ) {
    return {
      component:
        null,

      errors:
        result.errors,
    };
  }

  const freshProduct =
    result.product;

  const label =
    getComponentLabel(
      role,
    );

  if (
    freshProduct.totalInventory <=
    0
  ) {
    return {
      component:
        null,

      errors: [
        `${label}: el producto ya no tiene stock.`,
      ],
    };
  }

  if (
    freshProduct
      .variants
      .nodes
      .length !==
    1
  ) {
    return {
      component:
        null,

      errors: [
        `${label}: el producto tiene múltiples variantes. La creación fue bloqueada.`,
      ],
    };
  }

  const variant =
    freshProduct
      .variants
      .nodes[0];

  if (
    freshProduct
      .options
      .length ===
    0
  ) {
    return {
      component:
        null,

      errors: [
        `${label}: Shopify no devolvió las opciones del producto.`,
      ],
    };
  }

  for (
    const option
    of freshProduct.options
  ) {
    const selectedOption =
      variant
        .selectedOptions
        .find(
          (selected) =>
            normalize(
              selected.name,
            ) ===
            normalize(
              option.name,
            ),
        );

    if (
      !selectedOption
    ) {
      return {
        component:
          null,

        errors: [
          `${label}: no fue posible determinar la variante exacta para la opción "${option.name}".`,
        ],
      };
    }
  }

  return {
    component: {
      role,

      product:
        freshProduct,

      variant,
    },

    errors: [],
  };
}

/* =========================================================
   BUILD COMPONENT INPUT

   Todos los componentes quedan fijos a la única variante
   permitida por V1.

   Luego consolidaremos estas selecciones en una sola opción
   padre llamada "Configuración".
========================================================= */

function buildComponentInput(
  component:
    ComponentDetail,
): BundleComponentInput {
  const optionSelections =
    component
      .product
      .options
      .map(
        (option) => {
          const selected =
            component
              .variant
              .selectedOptions
              .find(
                (
                  selectedOption,
                ) =>
                  normalize(
                    selectedOption.name,
                  ) ===
                  normalize(
                    option.name,
                  ),
              );

          if (
            !selected
          ) {
            throw new Error(
              `No fue posible determinar "${option.name}" para ${component.product.title}.`,
            );
          }

          return {
            componentOptionId:
              option.id,

            /*
             * Todos se consolidan después en una sola
             * configuración padre.
             */
            name:
              "Configuración",

            values: [
              selected.value,
            ],
          };
        },
      );

  return {
    productId:
      component
        .product
        .id,

    quantity:
      1,

    optionSelections,
  };
}

/* =========================================================
   CONSOLIDATED OPTION

   Esto evita crear cuatro o más opciones en el producto
   padre cuando existe Wi-Fi.

   El padre tendrá una sola selección:
   Configuración = Estándar

   Esa selección representa exactamente las variantes de
   todos los componentes.
========================================================= */

function buildConsolidatedOptions(
  components:
    ComponentDetail[],
) {
  const mappings =
    components.flatMap(
      (component) =>
        component
          .product
          .options
          .map(
            (option) => {
              const selected =
                component
                  .variant
                  .selectedOptions
                  .find(
                    (
                      selectedOption,
                    ) =>
                      normalize(
                        selectedOption.name,
                      ) ===
                      normalize(
                        option.name,
                      ),
                  );

              if (
                !selected
              ) {
                throw new Error(
                  `No fue posible consolidar la opción "${option.name}".`,
                );
              }

              return {
                componentOptionId:
                  option.id,

                componentOptionValue:
                  selected.value,
              };
            },
          ),
    );

  return [
    {
      optionName:
        "Configuración",

      optionSelections: [
        {
          optionValue:
            "Estándar",

          components:
            mappings,
        },
      ],
    },
  ];
}

/* =========================================================
   CREATE NATIVE SHOPIFY BUNDLE
========================================================= */

async function startBundleCreation(
  admin:
    AdminClient,

  title:
    string,

  components:
    ComponentDetail[],
) {
  const componentInputs =
    components.map(
      buildComponentInput,
    );

  const consolidatedOptions =
    buildConsolidatedOptions(
      components,
    );

  const response =
    await admin.graphql(
      `#graphql
        mutation CsbyteCreateNativeBundle(
          $input: ProductBundleCreateInput!
        ) {
          productBundleCreate(
            input: $input
          ) {
            productBundleOperation {
              id
              status
            }

            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          input: {
            title,

            components:
              componentInputs,

            consolidatedOptions,
          },
        },
      },
    );

  const json =
    (await response.json()) as {
      data?: {
        productBundleCreate?: {
          productBundleOperation?:
            | {
                id: string;

                status: string;
              }
            | null;

          userErrors?: Array<{
            field?:
              string[];

            message:
              string;
          }>;
        };
      };

      errors?: Array<{
        message: string;
      }>;
    };

  const errors = [
    ...getGraphqlErrors(
      json,
    ),

    ...(json.data
      ?.productBundleCreate
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
      operationId:
        null as string | null,

      errors,
    };
  }

  const operationId =
    json.data
      ?.productBundleCreate
      ?.productBundleOperation
      ?.id ??
    null;

  if (
    !operationId
  ) {
    return {
      operationId:
        null,

      errors: [
        "Shopify no devolvió el ID de la operación de creación.",
      ],
    };
  }

  return {
    operationId,

    errors: [] as string[],
  };
}

/* =========================================================
   POLL OPERATION

   Shopify documenta productBundleCreate como asíncrono.

   Esperamos hasta 15 segundos:
   30 consultas x 500 ms.

   Cada consulta es pequeña.
========================================================= */

async function waitForBundleCreation(
  admin:
    AdminClient,

  operationId:
    string,
) {
  for (
    let attempt = 0;
    attempt < 30;
    attempt += 1
  ) {
    const response =
      await admin.graphql(
        `#graphql
          query CsbyteBundleCreationOperation(
            $id: ID!
          ) {
            productOperation(
              id: $id
            ) {
              ... on ProductBundleOperation {
                id
                status

                product {
                  id
                  title

                  variants(
                    first: 2
                  ) {
                    nodes {
                      id
                      price

                      inventoryItem {
                        sku
                      }
                    }
                  }
                }

                userErrors {
                  field
                  message
                  code
                }
              }
            }
          }
        `,
        {
          variables: {
            id:
              operationId,
          },
        },
      );

    const json =
      (await response.json()) as {
        data?: {
          productOperation?:
            | {
                id: string;

                status: string;

                product?:
                  | {
                      id:
                        string;

                      title:
                        string;

                      variants: {
                        nodes: Array<{
                          id:
                            string;

                          price:
                            string;

                          inventoryItem?:
                            | {
                                sku:
                                  string | null;
                              }
                            | null;
                        }>;
                      };
                    }
                  | null;

                userErrors?: Array<{
                  field?:
                    string[];

                  message:
                    string;

                  code?:
                    string | null;
                }>;
              }
            | null;
        };

        errors?: Array<{
          message:
            string;
        }>;
      };

    const topErrors =
      getGraphqlErrors(
        json,
      );

    if (
      topErrors.length >
      0
    ) {
      return {
        product:
          null,

        errors:
          topErrors,
      };
    }

    const operation =
      json.data
        ?.productOperation;

    if (
      !operation
    ) {
      return {
        product:
          null,

        errors: [
          "Shopify no devolvió la operación del bundle.",
        ],
      };
    }

    const operationErrors =
      operation
        .userErrors
        ?.map(
          (error) =>
            error.message,
        ) ??
      [];

    if (
      operationErrors.length >
      0
    ) {
      return {
        product:
          null,

        errors:
          operationErrors,
      };
    }

    if (
      operation.status ===
      "COMPLETE"
    ) {
      if (
        !operation.product
      ) {
        return {
          product:
            null,

          errors: [
            "La operación terminó pero Shopify no devolvió el producto creado.",
          ],
        };
      }

      return {
        product:
          operation.product,

        errors: [] as string[],
      };
    }

    await sleep(
      500,
    );
  }

  return {
    product:
      null,

    errors: [
      "Shopify todavía está procesando el bundle. La operación superó el tiempo de espera de la app.",
    ],
  };
}

/* =========================================================
   UPDATE PRODUCT

   The generated product always uses the identity configured
   in the active template and remains DRAFT.
========================================================= */

async function forceBundleDraft(
  admin:
    AdminClient,

  productId:
    string,
) {
  try {
    const response =
      await admin.graphql(
        `#graphql
          mutation CsbyteForceBundleDraft(
            $product: ProductUpdateInput!
          ) {
            productUpdate(
              product: $product
            ) {
              product {
                id
                status
              }

              userErrors {
                field
                message
              }
            }
          }
        `,
        {
          variables: {
            product: {
              id:
                productId,

              status:
                "DRAFT",
            },
          },
        },
      );

    const json =
      (await response.json()) as {
        data?: {
          productUpdate?: {
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

    return {
      errors: [
        ...getGraphqlErrors(
          json,
        ),

        ...(json.data
          ?.productUpdate
          ?.userErrors
          ?.map(
            (error) =>
              error.message,
          ) ?? []),
      ],
    };
  } catch (
    error
  ) {
    return {
      errors: [
        error instanceof Error
          ? error.message
          : "No fue posible forzar el producto a Borrador.",
      ],
    };
  }
}

async function updateBundleProduct(
  admin:
    AdminClient,

  productId:
    string,

  candidate:
    TemplateBundleCandidate,
) {
  try {
    const response =
      await admin.graphql(
        `#graphql
          mutation CsbyteConfigureBundleProduct(
            $product: ProductUpdateInput!
          ) {
            productUpdate(
              product: $product
            ) {
              product {
                id
                title
                vendor
                productType
                status
              }

              userErrors {
                field
                message
              }
            }
          }
        `,
        {
          variables: {
            product: {
              id:
                productId,

              title:
                candidate
                  .identity
                  .title,

              vendor:
                candidate
                  .identity
                  .vendor,

              productType:
                candidate
                  .identity
                  .productType,

              status:
                "DRAFT",
            },
          },
        },
      );

    const json =
      (await response.json()) as {
        data?: {
          productUpdate?: {
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
      ...getGraphqlErrors(
        json,
      ),

      ...(json.data
        ?.productUpdate
        ?.userErrors
        ?.map(
          (error) =>
            error.message,
        ) ?? []),
    ];

    if (
      errors.length ===
      0
    ) {
      return {
        errors,
      };
    }

    const fallback =
      await forceBundleDraft(
        admin,
        productId,
      );

    return {
      errors: [
        ...errors,

        ...(fallback.errors.length >
        0
          ? [
              `Además falló el intento de dejar el producto en Borrador: ${formatErrors(
                fallback.errors,
              )}`,
            ]
          : []),
      ],
    };
  } catch (
    error
  ) {
    const fallback =
      await forceBundleDraft(
        admin,
        productId,
      );

    return {
      errors: [
        error instanceof Error
          ? error.message
          : "No fue posible configurar el producto creado.",

        ...(fallback.errors.length >
        0
          ? [
              `Además falló el intento de dejar el producto en Borrador: ${formatErrors(
                fallback.errors,
              )}`,
            ]
          : []),
      ],
    };
  }
}

/* =========================================================
   UPDATE PARENT VARIANT

   - Commercial bundle price
   - BND-{base SKU}
========================================================= */

async function updateBundleVariant(
  admin:
    AdminClient,

  productId:
    string,

  variantId:
    string,

  sku:
    string,

  price:
    number,
) {
  const response =
    await admin.graphql(
      `#graphql
        mutation CsbyteConfigureBundleVariant(
          $productId: ID!
          $variants: [ProductVariantsBulkInput!]!
        ) {
          productVariantsBulkUpdate(
            productId: $productId
            variants: $variants
          ) {
            productVariants {
              id
              price

              inventoryItem {
                sku
              }
            }

            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          productId,

          variants: [
            {
              id:
                variantId,

              price:
                String(
                  price,
                ),

              inventoryItem: {
                sku,
              },
            },
          ],
        },
      },
    );

  const json =
    (await response.json()) as {
      data?: {
        productVariantsBulkUpdate?: {
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
    ...getGraphqlErrors(
      json,
    ),

    ...(json.data
      ?.productVariantsBulkUpdate
      ?.userErrors
      ?.map(
        (error) =>
          error.message,
      ) ?? []),
  ];

  return {
    errors,
  };
}

/* =========================================================
   INTERNAL METADATA

   Estos metafields se escriben AL FINAL.

   Si cualquier paso anterior falla, el bundle quedará sin
   managed_by y será detectado como legacy, lo cual impide
   que la app intente crear otro automáticamente.
========================================================= */

async function writeBundleMetadata(
  admin:
    AdminClient,

  parentProductId:
    string,

  candidate:
    TemplateBundleCandidate,

  components:
    ComponentDetail[],

  sku:
    string,

  finalPrice:
    number,
) {
  const base =
    components.find(
      (component) =>
        component.role ===
        "pc",
    );

  const monitor =
    components.find(
      (component) =>
        component.role ===
        "monitor",
    );

  const keyboard =
    components.find(
      (component) =>
        component.role ===
        "keyboard_mouse",
    );

  const wifi =
    components.find(
      (component) =>
        component.role ===
        "wifi_adapter",
    );

  if (
    !base ||
    !monitor ||
    !keyboard
  ) {
    return {
      errors: [
        "No fue posible construir los metadatos internos del bundle.",
      ],
    };
  }

  const snapshot = {
    schemaVersion:
      2,

    templateId:
      candidate.templateId,

    sku,

    finalPrice,

    base: {
      productId:
        base.product.id,

      variantId:
        base.variant.id,
    },

    monitor: {
      productId:
        monitor.product.id,

      variantId:
        monitor.variant.id,
    },

    keyboardMouse: {
      productId:
        keyboard.product.id,

      variantId:
        keyboard.variant.id,
    },

    wifiAdapter:
      wifi
        ? {
            productId:
              wifi.product.id,

            variantId:
              wifi.variant.id,
          }
        : null,
  };

  const metafields = [
    {
      ownerId:
        parentProductId,

      namespace:
        MANAGED_NAMESPACE,

      key:
        BUNDLE_MANAGED_BY_KEY,

      type:
        "single_line_text_field",

      value:
        MANAGED_BY_VALUE,
    },

    {
      ownerId:
        parentProductId,

      namespace:
        MANAGED_NAMESPACE,

      key:
        BUNDLE_TEMPLATE_KEY,

      type:
        "single_line_text_field",

      value:
        candidate.templateId,
    },

    {
      ownerId:
        parentProductId,

      namespace:
        MANAGED_NAMESPACE,

      key:
        BUNDLE_BASE_PRODUCT_ID_KEY,

      type:
        "single_line_text_field",

      value:
        base.product.id,
    },

    {
      ownerId:
        parentProductId,

      namespace:
        MANAGED_NAMESPACE,

      key:
        "component_snapshot",

      type:
        "json",

      value:
        JSON.stringify(
          snapshot,
        ),
    },
  ];

  const response =
    await admin.graphql(
      `#graphql
        mutation CsbyteWriteBundleMetadata(
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
          metafields,
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
    ...getGraphqlErrors(
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

  return {
    errors,
  };
}

/* =========================================================
   FINAL VERIFICATION
========================================================= */

async function verifyCreatedBundle(
  admin:
    AdminClient,

  productId:
    string,

  candidate:
    TemplateBundleCandidate,

  expectedSku:
    string,

  expectedPrice:
    number,
) {
  const response =
    await admin.graphql(
      `#graphql
        query CsbyteVerifyCreatedBundle(
          $id: ID!
        ) {
          product(
            id: $id
          ) {
            id
            title
            vendor
            productType
            status

            variants(
              first: 2
            ) {
              nodes {
                id
                price

                inventoryItem {
                  sku
                }
              }
            }

            bundleComponents(
              first: 10
            ) {
              nodes {
                componentProduct {
                  id
                }
              }

              pageInfo {
                hasNextPage
              }
            }

            managedBy: metafield(
              namespace: "${MANAGED_NAMESPACE}"
              key: "${BUNDLE_MANAGED_BY_KEY}"
            ) {
              value
            }

            template: metafield(
              namespace: "${MANAGED_NAMESPACE}"
              key: "${BUNDLE_TEMPLATE_KEY}"
            ) {
              value
            }

            baseProductId: metafield(
              namespace: "${MANAGED_NAMESPACE}"
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

              vendor:
                string;

              productType:
                string;

              status:
                string;

              variants: {
                nodes: Array<{
                  id:
                    string;

                  price:
                    string;

                  inventoryItem?:
                    | {
                        sku:
                          string | null;
                      }
                    | null;
                }>;
              };

              bundleComponents: {
                nodes: Array<{
                  componentProduct: {
                    id:
                      string;
                  };
                }>;

                pageInfo: {
                  hasNextPage:
                    boolean;
                };
              };

              managedBy?:
                | {
                    value:
                      string;
                  }
                | null;

              template?:
                | {
                    value:
                      string;
                  }
                | null;

              baseProductId?:
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
      errors: [
        "No fue posible verificar el bundle recién creado.",
      ],
    };
  }

  const verificationErrors:
    string[] = [];

  if (
    product.title !==
    candidate.identity.title
  ) {
    verificationErrors.push(
      "El título final no coincide con la propuesta.",
    );
  }

  if (
    product.vendor !==
    candidate.identity.vendor
  ) {
    verificationErrors.push(
      `Proveedor esperado: ${candidate.identity.vendor}.`,
    );
  }

  if (
    product.productType !==
    candidate.identity.productType
  ) {
    verificationErrors.push(
      `Tipo de producto esperado: ${candidate.identity.productType}.`,
    );
  }

  if (
    product.status !==
    "DRAFT"
  ) {
    verificationErrors.push(
      "El bundle no quedó en estado Borrador.",
    );
  }

  if (
    product
      .variants
      .nodes
      .length !==
    1
  ) {
    verificationErrors.push(
      "El bundle padre no tiene exactamente una variante.",
    );

    return {
      errors:
        verificationErrors,
    };
  }

  const variant =
    product
      .variants
      .nodes[0];

  if (
    variant
      .inventoryItem
      ?.sku !==
    expectedSku
  ) {
    verificationErrors.push(
      `SKU esperado: ${expectedSku}.`,
    );
  }

  if (
    Number(
      variant.price,
    ) !==
    expectedPrice
  ) {
    verificationErrors.push(
      `Precio esperado: ${expectedPrice}.`,
    );
  }

  const expectedComponentIds =
    [
      candidate
        .baseProduct
        .id,

      candidate
        .monitor
        .id,

      candidate
        .keyboardMouse
        .id,

      ...(candidate.wifiAdapter
        ? [
            candidate
              .wifiAdapter
              .id,
          ]
        : []),
    ];

  const actualComponentIds =
    product
      .bundleComponents
      .nodes
      .map(
        (node) =>
          node
            .componentProduct
            .id,
      );

  if (
    product
      .bundleComponents
      .pageInfo
      .hasNextPage
  ) {
    verificationErrors.push(
      "El bundle tiene más componentes de los esperados.",
    );
  }

  if (
    actualComponentIds.length !==
    expectedComponentIds.length ||
    expectedComponentIds.some(
      (id) =>
        !actualComponentIds.includes(
          id,
        ),
    )
  ) {
    verificationErrors.push(
      "Los componentes finales no coinciden exactamente con la propuesta.",
    );
  }

  if (
    product
      .managedBy
      ?.value !==
    MANAGED_BY_VALUE
  ) {
    verificationErrors.push(
      "Falta identificación managed_by.",
    );
  }

  if (
    product
      .template
      ?.value !==
    candidate.templateId
  ) {
    verificationErrors.push(
      "Falta o no coincide la identificación de plantilla.",
    );
  }

  if (
    product
      .baseProductId
      ?.value !==
    candidate
      .baseProduct
      .id
  ) {
    verificationErrors.push(
      "Falta o no coincide la identificación del PC base.",
    );
  }

  return {
    errors:
      verificationErrors,
  };
}

/* =========================================================
   MAIN

   Rebuilds the current catalog and candidate on the server.
   The browser sends only candidateId.
========================================================= */

export async function createDraftBundleFromCandidate(
  admin:
    AdminClient,

  candidateId:
    string,
): Promise<CreateDraftBundleResult> {
  const cleanCandidateId =
    candidateId.trim();

  if (
    !cleanCandidateId
  ) {
    return {
      success:
        false,

      message:
        "No se recibió la propuesta a crear.",
    };
  }

  /* -------------------------------------------------------
     1. RELOAD CURRENT CONFIGURATION + CATALOG
  ------------------------------------------------------- */

  const catalog =
    await loadBundleTemplateCatalog(
      admin,
    );

  if (
    catalog.errors.length >
    0
  ) {
    return {
      success:
        false,

      message:
        `No se pudo volver a validar el catálogo: ${formatErrors(
          catalog.errors,
        )}`,
    };
  }

  const runtime =
    await loadBundleRuntimeSettings(
      admin,
    );

  if (
    runtime.errors.length >
    0
  ) {
    return {
      success:
        false,

      message:
        `No se pudo volver a validar la configuración: ${formatErrors(
          runtime.errors,
        )}`,
    };
  }

  const state =
    buildTemplateBundleState(
      catalog.products,
      catalog.templates,
      runtime.componentConfig,
    );

  const candidate =
    state.candidates.find(
      (item) =>
        item.id ===
        cleanCandidateId,
    );

  if (
    !candidate
  ) {
    return {
      success:
        false,

      message:
        "La propuesta ya no es válida. Recarga Bundles y vuelve a revisarla.",
    };
  }

  if (
    !candidate
      .identity
      .sku ||
    candidate
      .identity
      .sku ===
      "SKU pendiente"
  ) {
    return {
      success:
        false,

      message:
        "El PC base no tiene SKU. La creación fue bloqueada.",
    };
  }

  const normalizedExpectedSku =
    candidate
      .identity
      .sku
      .trim()
      .toUpperCase();

  const sameSkuCandidates =
    state.candidates.filter(
      (item) =>
        item
          .identity
          .sku
          .trim()
          .toUpperCase() ===
        normalizedExpectedSku,
    );

  if (
    sameSkuCandidates.length >
    1
  ) {
    return {
      success:
        false,

      message:
        "Dos o más plantillas están intentando generar el mismo SKU. La creación fue bloqueada.",
    };
  }

  /* -------------------------------------------------------
     2. FRESH COMPONENT VALIDATION

     Sequential deliberately. This runs only after clicking
     Crear borrador, not during normal page load.
  ------------------------------------------------------- */

  const componentRequests: Array<{
    product:
      TemplateCatalogProduct;

    role:
      ComponentRole;
  }> = [
    {
      product:
        candidate.baseProduct,

      role:
        "pc",
    },

    {
      product:
        candidate.monitor,

      role:
        "monitor",
    },

    {
      product:
        candidate.keyboardMouse,

      role:
        "keyboard_mouse",
    },
  ];

  if (
    candidate.wifiAdapter
  ) {
    componentRequests.push({
      product:
        candidate.wifiAdapter,

      role:
        "wifi_adapter",
    });
  }

  const components:
    ComponentDetail[] =
    [];

  for (
    const request
    of componentRequests
  ) {
    const result =
      await loadComponentDetail(
        admin,
        request.product,
        request.role,
      );

    if (
      !result.component
    ) {
      return {
        success:
          false,

        message:
          formatErrors(
            result.errors,
          ),
      };
    }

    components.push(
      result.component,
    );
  }

  const baseComponent =
    components.find(
      (component) =>
        component.role ===
        "pc",
    );

  const freshBaseSku =
    baseComponent
      ?.variant
      .sku
      ?.trim();

  if (
    !freshBaseSku
  ) {
    return {
      success:
        false,

      message:
        "El PC base ya no tiene SKU. La creación fue bloqueada.",
    };
  }

  const freshExpectedSku =
    `${candidate.template.skuPrefix}${freshBaseSku}`;

  if (
    freshExpectedSku !==
    candidate.identity.sku
  ) {
    return {
      success:
        false,

      message:
        "El SKU del PC cambió desde que se generó la propuesta. Recarga Bundles antes de crearla.",
    };
  }

  /* -------------------------------------------------------
     3. DUPLICATE / SKU CHECK IMMEDIATELY BEFORE MUTATION

     We check only the selected candidate here. The local
     duplicate check above already protects collisions
     between active templates.
  ------------------------------------------------------- */

  const existing =
    await loadExistingPcMonitorBundleMatches(
      admin,
      [
        candidate,
      ],
    );

  if (
    existing.errors.length >
    0
  ) {
    return {
      success:
        false,

      message:
        `No se pudo comprobar de forma segura si el bundle ya existe: ${formatErrors(
          existing.errors,
        )}`,
    };
  }

  const match =
    existing.matches[0];

  if (
    !match ||
    match.status !==
      "new"
  ) {
    return {
      success:
        false,

      message:
        match?.message ??
        "No fue posible confirmar que la propuesta siga disponible.",
    };
  }

  /* -------------------------------------------------------
     4. FINAL COMMERCIAL PRICE
  ------------------------------------------------------- */

  const price =
    calculateTemplateCandidatePrice(
      candidate,
      runtime.priceConfig,
    );

  if (
    !Number.isFinite(
      price.finalPrice,
    ) ||
    price.finalPrice <=
      0
  ) {
    return {
      success:
        false,

      message:
        "El precio calculado del bundle no es válido.",
    };
  }

  /* -------------------------------------------------------
     5. CREATE NATIVE SHOPIFY BUNDLE
  ------------------------------------------------------- */

  let creationResult: {
    operationId:
      string | null;

    errors:
      string[];
  };

  try {
    creationResult =
      await startBundleCreation(
        admin,
        candidate
          .identity
          .title,
        components,
      );
  } catch (
    error
  ) {
    return {
      success:
        false,

      message:
        error instanceof Error
          ? error.message
          : "No fue posible iniciar la creación del bundle.",
    };
  }

  if (
    !creationResult.operationId
  ) {
    return {
      success:
        false,

      message:
        formatErrors(
          creationResult.errors,
        ),
    };
  }

  /* -------------------------------------------------------
     6. WAIT FOR ASYNC PRODUCT OPERATION
  ------------------------------------------------------- */

  const operationResult =
    await waitForBundleCreation(
      admin,
      creationResult.operationId,
    );

  if (
    !operationResult.product
  ) {
    return {
      success:
        false,

      partial:
        true,

      message:
        `${formatErrors(
          operationResult.errors,
        )} No vuelvas a pulsar Crear hasta recargar la pantalla y comprobar Shopify.`,
    };
  }

  const parent =
    operationResult.product;

  if (
    parent
      .variants
      .nodes
      .length !==
    1
  ) {
    const draftFallback =
      await forceBundleDraft(
        admin,
        parent.id,
      );

    return {
      success:
        false,

      partial:
        true,

      productId:
        parent.id,

      message:
        `Shopify creó el producto, pero generó más de una variante padre. La configuración se detuvo por seguridad.${
          draftFallback.errors.length >
          0
            ? ` Además no fue posible confirmar Borrador: ${formatErrors(
                draftFallback.errors,
              )}.`
            : ""
        } No vuelvas a crearlo.`,
    };
  }

  const parentVariant =
    parent
      .variants
      .nodes[0];

  /* -------------------------------------------------------
     7. TEMPLATE IDENTITY + DRAFT
  ------------------------------------------------------- */

  const productUpdate =
    await updateBundleProduct(
      admin,
      parent.id,
      candidate,
    );

  if (
    productUpdate.errors.length >
    0
  ) {
    return {
      success:
        false,

      partial:
        true,

      productId:
        parent.id,

      message:
        `Shopify creó el bundle, pero no fue posible terminar la configuración del producto: ${formatErrors(
          productUpdate.errors,
        )}. No vuelvas a crearlo.`,
    };
  }

  /* -------------------------------------------------------
     8. PRICE + SKU
  ------------------------------------------------------- */

  const variantUpdate =
    await updateBundleVariant(
      admin,
      parent.id,
      parentVariant.id,
      freshExpectedSku,
      price.finalPrice,
    );

  if (
    variantUpdate.errors.length >
    0
  ) {
    return {
      success:
        false,

      partial:
        true,

      productId:
        parent.id,

      message:
        `El bundle fue creado como borrador, pero falló la configuración de precio/SKU: ${formatErrors(
          variantUpdate.errors,
        )}. No vuelvas a crearlo.`,
    };
  }

  /* -------------------------------------------------------
     9. INTERNAL APP METADATA
  ------------------------------------------------------- */

  const metadataResult =
    await writeBundleMetadata(
      admin,
      parent.id,
      candidate,
      components,
      freshExpectedSku,
      price.finalPrice,
    );

  if (
    metadataResult.errors.length >
    0
  ) {
    return {
      success:
        false,

      partial:
        true,

      productId:
        parent.id,

      message:
        `El bundle fue creado y configurado, pero no fue posible guardar su identificación interna: ${formatErrors(
          metadataResult.errors,
        )}. No vuelvas a crearlo.`,
    };
  }

  /* -------------------------------------------------------
     10. FINAL AUDIT
  ------------------------------------------------------- */

  const verification =
    await verifyCreatedBundle(
      admin,
      parent.id,
      candidate,
      freshExpectedSku,
      price.finalPrice,
    );

  if (
    verification.errors.length >
    0
  ) {
    return {
      success:
        false,

      partial:
        true,

      productId:
        parent.id,

      message:
        `El bundle fue creado como borrador, pero la verificación final detectó diferencias: ${formatErrors(
          verification.errors,
        )}`,
    };
  }

  return {
    success:
      true,

    productId:
      parent.id,

    title:
      candidate
        .identity
        .title,

    sku:
      freshExpectedSku,

    price:
      price.finalPrice,

    message:
      `Bundle creado correctamente como borrador: ${candidate.identity.title}.`,
  };
}
