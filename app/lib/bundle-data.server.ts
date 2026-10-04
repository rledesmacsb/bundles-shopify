import type {
  BundlePriceConfig,
  BundlePriceMode,
  BundlePriceRounding,
  PcMonitorBundleConfig,
  ProductNode,
} from "./bundle-engine";

/* =========================================================
   CONFIG KEYS
========================================================= */

const CONFIG_NAMESPACE =
  "app_config";

const MONITOR_CONFIG_KEY =
  "bundle_monitor_ids";

const KEYBOARD_MOUSE_CONFIG_KEY =
  "bundle_keyboard_mouse_ids";

const WIFI_ADAPTER_CONFIG_KEY =
  "bundle_wifi_adapter_ids";

const PRIMARY_KEYBOARD_MOUSE_KEY =
  "bundle_primary_keyboard_mouse_id";

const PRIMARY_WIFI_ADAPTER_KEY =
  "bundle_primary_wifi_adapter_id";

const EXCLUDED_PRODUCT_IDS_KEY =
  "bundle_excluded_product_ids";

const PRICE_MODE_KEY =
  "bundle_price_mode";

const PRICE_PERCENTAGE_KEY =
  "bundle_price_percentage";

const PRICE_FIXED_AMOUNT_KEY =
  "bundle_price_fixed_amount";

const PRICE_ROUNDING_KEY =
  "bundle_price_rounding";

type AdminClient = {
  graphql: (
    query: string,
    options?: any,
  ) => Promise<any>;
};

export type PcMonitorBundleData = {
  products: ProductNode[];

  currencyCode: string;

  config: PcMonitorBundleConfig;

  priceConfig: BundlePriceConfig;

  errors: string[];
};

/* =========================================================
   PARSERS
========================================================= */

export function parseStoredIds(
  value:
    | string
    | null
    | undefined,
): string[] {
  if (
    !value
  ) {
    return [];
  }

  try {
    const parsed =
      JSON.parse(
        value,
      );

    if (
      !Array.isArray(
        parsed,
      )
    ) {
      return [];
    }

    return parsed
      .map(
        (item) =>
          String(
            item,
          ),
      )
      .filter(
        Boolean,
      );
  } catch {
    return [];
  }
}

export function parseStoredString(
  value:
    | string
    | null
    | undefined,
): string | null {
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

    if (
      typeof parsed ===
      "string"
    ) {
      return parsed;
    }

    return null;
  } catch {
    return value;
  }
}

export function parseStoredNumber(
  value:
    | string
    | null
    | undefined,
  fallback = 0,
): number {
  if (
    !value
  ) {
    return fallback;
  }

  try {
    const parsed =
      JSON.parse(
        value,
      );

    const number =
      Number(
        parsed,
      );

    return Number.isFinite(
      number,
    )
      ? number
      : fallback;
  } catch {
    const number =
      Number(
        value,
      );

    return Number.isFinite(
      number,
    )
      ? number
      : fallback;
  }
}

function parsePriceMode(
  value:
    | string
    | null
    | undefined,
): BundlePriceMode {
  const parsed =
    parseStoredString(
      value,
    );

  if (
    parsed ===
      "percentage" ||
    parsed ===
      "fixed" ||
    parsed ===
      "none"
  ) {
    return parsed;
  }

  return "none";
}

function parsePriceRounding(
  value:
    | string
    | null
    | undefined,
): BundlePriceRounding {
  const parsed =
    parseStoredString(
      value,
    );

  /*
   * Compatibilidad con la configuración anterior.
   *
   * x9900 -> x900
   */
  if (
    parsed ===
      "x900" ||
    parsed ===
      "x9900"
  ) {
    return "x900";
  }

  return "none";
}

/* =========================================================
   FETCH PRODUCTS
========================================================= */

async function fetchProductsByType(
  admin:
    AdminClient,
  productType:
    string,
) {
  const response =
    await admin.graphql(
      `#graphql
        query CsbyteBundleProducts(
          $query: String!
        ) {
          products(
            first: 250
            sortKey: TITLE
            query: $query
          ) {
            nodes {
              id
              title
              status
              productType
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

              wifiMeta: metafield(
                namespace: "custom"
                key: "wi_fi_integrado"
              ) {
                type
                value
              }

              videoOutputMeta: metafield(
                namespace: "custom"
                key: "salidas_de_video"
              ) {
                type
                value
              }

              videoInputMeta: metafield(
                namespace: "custom"
                key: "entradas_de_video"
              ) {
                type
                value
              }
            }
          }
        }
      `,
      {
        variables: {
          query:
            `product_type:"${productType}" AND inventory_total:>0`,
        },
      },
    );

  const json =
    (await response.json()) as {
      data?: {
        products?: {
          nodes:
            ProductNode[];
        };
      };

      errors?: Array<{
        message: string;
      }>;
    };

  return {
    products:
      json.data
        ?.products
        ?.nodes
        ?.filter(
          (product) =>
            product.totalInventory >
            0,
        ) ??
      [],

    errors:
      json.errors
        ?.map(
          (error) =>
            error.message,
        ) ??
      [],
  };
}

/* =========================================================
   LOAD DATA
========================================================= */

export async function loadPcMonitorBundleData(
  admin:
    AdminClient,
): Promise<PcMonitorBundleData> {
  const shopResponse =
    await admin.graphql(
      `#graphql
        query CsbyteBundleShop {
          shop {
            currencyCode
          }
        }
      `,
    );

  const shopJson =
    (await shopResponse.json()) as {
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

  const configResponse =
    await admin.graphql(
      `#graphql
        query CsbyteBundleConfiguration {
          currentAppInstallation {
            monitorSelection: metafield(
              namespace: "${CONFIG_NAMESPACE}"
              key: "${MONITOR_CONFIG_KEY}"
            ) {
              value
            }

            keyboardSelection: metafield(
              namespace: "${CONFIG_NAMESPACE}"
              key: "${KEYBOARD_MOUSE_CONFIG_KEY}"
            ) {
              value
            }

            wifiSelection: metafield(
              namespace: "${CONFIG_NAMESPACE}"
              key: "${WIFI_ADAPTER_CONFIG_KEY}"
            ) {
              value
            }

            primaryKeyboard: metafield(
              namespace: "${CONFIG_NAMESPACE}"
              key: "${PRIMARY_KEYBOARD_MOUSE_KEY}"
            ) {
              value
            }

            primaryWifi: metafield(
              namespace: "${CONFIG_NAMESPACE}"
              key: "${PRIMARY_WIFI_ADAPTER_KEY}"
            ) {
              value
            }

            excludedProducts: metafield(
              namespace: "${CONFIG_NAMESPACE}"
              key: "${EXCLUDED_PRODUCT_IDS_KEY}"
            ) {
              value
            }

            priceMode: metafield(
              namespace: "${CONFIG_NAMESPACE}"
              key: "${PRICE_MODE_KEY}"
            ) {
              value
            }

            pricePercentage: metafield(
              namespace: "${CONFIG_NAMESPACE}"
              key: "${PRICE_PERCENTAGE_KEY}"
            ) {
              value
            }

            priceFixedAmount: metafield(
              namespace: "${CONFIG_NAMESPACE}"
              key: "${PRICE_FIXED_AMOUNT_KEY}"
            ) {
              value
            }

            priceRounding: metafield(
              namespace: "${CONFIG_NAMESPACE}"
              key: "${PRICE_ROUNDING_KEY}"
            ) {
              value
            }
          }
        }
      `,
    );

  const configJson =
    (await configResponse.json()) as {
      data?: {
        currentAppInstallation?: {
          monitorSelection?: {
            value:
              string;
          } | null;

          keyboardSelection?: {
            value:
              string;
          } | null;

          wifiSelection?: {
            value:
              string;
          } | null;

          primaryKeyboard?: {
            value:
              string;
          } | null;

          primaryWifi?: {
            value:
              string;
          } | null;

          excludedProducts?: {
            value:
              string;
          } | null;

          priceMode?: {
            value:
              string;
          } | null;

          pricePercentage?: {
            value:
              string;
          } | null;

          priceFixedAmount?: {
            value:
              string;
          } | null;

          priceRounding?: {
            value:
              string;
          } | null;
        };
      };

      errors?: Array<{
        message:
          string;
      }>;
    };

  const installation =
    configJson.data
      ?.currentAppInstallation;

  const config:
    PcMonitorBundleConfig =
    {
      selectedMonitorIds:
        parseStoredIds(
          installation
            ?.monitorSelection
            ?.value,
        ),

      selectedKeyboardMouseIds:
        parseStoredIds(
          installation
            ?.keyboardSelection
            ?.value,
        ),

      selectedWifiAdapterIds:
        parseStoredIds(
          installation
            ?.wifiSelection
            ?.value,
        ),

      primaryKeyboardMouseId:
        parseStoredString(
          installation
            ?.primaryKeyboard
            ?.value,
        ),

      primaryWifiAdapterId:
        parseStoredString(
          installation
            ?.primaryWifi
            ?.value,
        ),

      excludedProductIds:
        parseStoredIds(
          installation
            ?.excludedProducts
            ?.value,
        ),
    };

  const priceConfig:
    BundlePriceConfig =
    {
      configured:
        Boolean(
          installation
            ?.priceMode
            ?.value,
        ),

      mode:
        parsePriceMode(
          installation
            ?.priceMode
            ?.value,
        ),

      percentage:
        parseStoredNumber(
          installation
            ?.pricePercentage
            ?.value,
          5,
        ),

      fixedAmount:
        parseStoredNumber(
          installation
            ?.priceFixedAmount
            ?.value,
          10000,
        ),

      rounding:
        parsePriceRounding(
          installation
            ?.priceRounding
            ?.value,
        ),
    };

  const productTypes =
    [
      "PC de Escritorio",
      "All in One",
      "Monitor",
      "Monitor reacondicionado",
      "Combo Teclado y Mouse",
      "Adaptador WiFi",
    ];

  const products:
    ProductNode[] =
    [];

  const errors:
    string[] =
    [
      ...(shopJson.errors?.map(
        (error) =>
          error.message,
      ) ?? []),

      ...(configJson.errors?.map(
        (error) =>
          error.message,
      ) ?? []),
    ];

  /*
   * Secuencial intencionalmente.
   * Una consulta por tipo de producto.
   */
  for (
    const productType
    of productTypes
  ) {
    const result =
      await fetchProductsByType(
        admin,
        productType,
      );

    products.push(
      ...result.products,
    );

    errors.push(
      ...result.errors,
    );
  }

  const uniqueProducts =
    Array.from(
      new Map(
        products.map(
          (product) => [
            product.id,
            product,
          ],
        ),
      ).values(),
    );

  return {
    products:
      uniqueProducts,

    currencyCode:
      shopJson.data
        ?.shop
        ?.currencyCode ??
      "CLP",

    config,

    priceConfig,

    errors,
  };
}

/* =========================================================
   INSTALLATION
========================================================= */

async function getInstallationId(
  admin:
    AdminClient,
) {
  const response =
    await admin.graphql(
      `#graphql
        query CsbyteCurrentInstallation {
          currentAppInstallation {
            id
          }
        }
      `,
    );

  const json =
    (await response.json()) as {
      data?: {
        currentAppInstallation?: {
          id:
            string;
        };
      };
    };

  return (
    json.data
      ?.currentAppInstallation
      ?.id ??
    null
  );
}

/* =========================================================
   MANUAL EXCLUSIONS
========================================================= */

export async function loadPcMonitorManualExcludedProductIds(
  admin:
    AdminClient,
) {
  const response =
    await admin.graphql(
      `#graphql
        query CsbyteManualBundleExclusions {
          currentAppInstallation {
            exclusions: metafield(
              namespace: "${CONFIG_NAMESPACE}"
              key: "${EXCLUDED_PRODUCT_IDS_KEY}"
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
        currentAppInstallation?: {
          exclusions?: {
            value:
              string;
          } | null;
        };
      };
    };

  return parseStoredIds(
    json.data
      ?.currentAppInstallation
      ?.exclusions
      ?.value,
  );
}

export async function savePcMonitorManualExcludedProductIds(
  admin:
    AdminClient,
  productIds:
    string[],
) {
  const installationId =
    await getInstallationId(
      admin,
    );

  if (
    !installationId
  ) {
    return {
      success:
        false,

      message:
        "No fue posible obtener la instalación de la app.",
    };
  }

  const uniqueIds =
    Array.from(
      new Set(
        productIds.filter(
          Boolean,
        ),
      ),
    );

  return saveConfigurationMetafields(
    admin,
    [
      {
        ownerId:
          installationId,

        namespace:
          CONFIG_NAMESPACE,

        key:
          EXCLUDED_PRODUCT_IDS_KEY,

        type:
          "json",

        value:
          JSON.stringify(
            uniqueIds,
          ),
      },
    ],
    "Exclusiones actualizadas correctamente.",
  );
}

/* =========================================================
   SAVE COMPONENT CONFIG
========================================================= */

export async function savePcMonitorBundleConfig(
  admin:
    AdminClient,
  config:
    PcMonitorBundleConfig,
) {
  const installationId =
    await getInstallationId(
      admin,
    );

  if (
    !installationId
  ) {
    return {
      success:
        false,

      message:
        "No fue posible obtener la instalación de la app.",
    };
  }

  const metafields =
    [
      {
        ownerId:
          installationId,

        namespace:
          CONFIG_NAMESPACE,

        key:
          MONITOR_CONFIG_KEY,

        type:
          "json",

        value:
          JSON.stringify(
            config.selectedMonitorIds,
          ),
      },

      {
        ownerId:
          installationId,

        namespace:
          CONFIG_NAMESPACE,

        key:
          KEYBOARD_MOUSE_CONFIG_KEY,

        type:
          "json",

        value:
          JSON.stringify(
            config.selectedKeyboardMouseIds,
          ),
      },

      {
        ownerId:
          installationId,

        namespace:
          CONFIG_NAMESPACE,

        key:
          PRIMARY_KEYBOARD_MOUSE_KEY,

        type:
          "json",

        value:
          JSON.stringify(
            config.primaryKeyboardMouseId,
          ),
      },

      {
        ownerId:
          installationId,

        namespace:
          CONFIG_NAMESPACE,

        key:
          WIFI_ADAPTER_CONFIG_KEY,

        type:
          "json",

        value:
          JSON.stringify(
            config.selectedWifiAdapterIds,
          ),
      },

      {
        ownerId:
          installationId,

        namespace:
          CONFIG_NAMESPACE,

        key:
          PRIMARY_WIFI_ADAPTER_KEY,

        type:
          "json",

        value:
          JSON.stringify(
            config.primaryWifiAdapterId,
          ),
      },
    ];

  return saveConfigurationMetafields(
    admin,
    metafields,
    "Componentes guardados correctamente.",
  );
}

/* =========================================================
   SAVE PRICE CONFIG
========================================================= */

export async function savePcMonitorPriceConfig(
  admin:
    AdminClient,
  config:
    BundlePriceConfig,
) {
  const installationId =
    await getInstallationId(
      admin,
    );

  if (
    !installationId
  ) {
    return {
      success:
        false,

      message:
        "No fue posible obtener la instalación de la app.",
    };
  }

  const metafields =
    [
      {
        ownerId:
          installationId,

        namespace:
          CONFIG_NAMESPACE,

        key:
          PRICE_MODE_KEY,

        type:
          "json",

        value:
          JSON.stringify(
            config.mode,
          ),
      },

      {
        ownerId:
          installationId,

        namespace:
          CONFIG_NAMESPACE,

        key:
          PRICE_PERCENTAGE_KEY,

        type:
          "json",

        value:
          JSON.stringify(
            config.percentage,
          ),
      },

      {
        ownerId:
          installationId,

        namespace:
          CONFIG_NAMESPACE,

        key:
          PRICE_FIXED_AMOUNT_KEY,

        type:
          "json",

        value:
          JSON.stringify(
            config.fixedAmount,
          ),
      },

      {
        ownerId:
          installationId,

        namespace:
          CONFIG_NAMESPACE,

        key:
          PRICE_ROUNDING_KEY,

        type:
          "json",

        value:
          JSON.stringify(
            config.rounding,
          ),
      },
    ];

  return saveConfigurationMetafields(
    admin,
    metafields,
    "Reglas de precio guardadas correctamente.",
  );
}

/* =========================================================
   SAVE METAFIELDS
========================================================= */

async function saveConfigurationMetafields(
  admin:
    AdminClient,
  metafields:
    Array<{
      ownerId:
        string;
      namespace:
        string;
      key:
        string;
      type:
        string;
      value:
        string;
    }>,
  successMessage:
    string,
) {
  const response =
    await admin.graphql(
      `#graphql
        mutation SaveCsbyteBundleConfig(
          $metafields: [MetafieldsSetInput!]!
        ) {
          metafieldsSet(
            metafields: $metafields
          ) {
            metafields {
              id
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

  const errors =
    [
      ...(json.errors?.map(
        (error) =>
          error.message,
      ) ?? []),

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
      successMessage,
  };
}