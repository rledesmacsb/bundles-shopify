import type {
  BundlePriceConfig,
  BundlePriceMode,
  BundlePriceRounding,
  PcMonitorBundleConfig,
} from "./bundle-engine";

/* =========================================================
   CONSTANTS
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

export type BundleRuntimeSettings = {
  componentConfig:
    PcMonitorBundleConfig;

  priceConfig:
    BundlePriceConfig;

  errors:
    string[];
};

/* =========================================================
   PARSERS
========================================================= */

function parseIds(
  value:
    | string
    | null
    | undefined,
) {
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
        String,
      )
      .filter(
        Boolean,
      );
  } catch {
    return [];
  }
}

function parseString(
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
      : null;
  } catch {
    return value;
  }
}

function parseNumber(
  value:
    | string
    | null
    | undefined,

  fallback:
    number,
) {
  if (
    !value
  ) {
    return fallback;
  }

  try {
    const parsed =
      Number(
        JSON.parse(
          value,
        ),
      );

    return Number.isFinite(
      parsed,
    )
      ? parsed
      : fallback;
  } catch {
    const parsed =
      Number(
        value,
      );

    return Number.isFinite(
      parsed,
    )
      ? parsed
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
    parseString(
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

function parseRounding(
  value:
    | string
    | null
    | undefined,
): BundlePriceRounding {
  const parsed =
    parseString(
      value,
    );

  /*
   * Compatibility with previous stored value.
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
   LOAD
========================================================= */

export async function loadBundleRuntimeSettings(
  admin:
    AdminClient,
): Promise<BundleRuntimeSettings> {
  try {
    const response =
      await admin.graphql(
        `#graphql
          query CsbyteBundleRuntimeSettings {
            currentAppInstallation {

              monitors: metafield(
                namespace: "${CONFIG_NAMESPACE}"
                key: "${MONITOR_CONFIG_KEY}"
              ) {
                value
              }

              keyboards: metafield(
                namespace: "${CONFIG_NAMESPACE}"
                key: "${KEYBOARD_MOUSE_CONFIG_KEY}"
              ) {
                value
              }

              wifiAdapters: metafield(
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

              priceFixed: metafield(
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

    const json =
      (await response.json()) as {
        data?: {
          currentAppInstallation?:
            | {
                monitors?:
                  | {
                      value:
                        string;
                    }
                  | null;

                keyboards?:
                  | {
                      value:
                        string;
                    }
                  | null;

                wifiAdapters?:
                  | {
                      value:
                        string;
                    }
                  | null;

                primaryKeyboard?:
                  | {
                      value:
                        string;
                    }
                  | null;

                primaryWifi?:
                  | {
                      value:
                        string;
                    }
                  | null;

                excludedProducts?:
                  | {
                      value:
                        string;
                    }
                  | null;

                priceMode?:
                  | {
                      value:
                        string;
                    }
                  | null;

                pricePercentage?:
                  | {
                      value:
                        string;
                    }
                  | null;

                priceFixed?:
                  | {
                      value:
                        string;
                    }
                  | null;

                priceRounding?:
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

    const installation =
      json.data
        ?.currentAppInstallation;

    const errors =
      json.errors?.map(
        (error) =>
          error.message,
      ) ??
      [];

    if (
      !installation
    ) {
      return {
        componentConfig: {
          selectedMonitorIds:
            [],

          selectedKeyboardMouseIds:
            [],

          selectedWifiAdapterIds:
            [],

          primaryKeyboardMouseId:
            null,

          primaryWifiAdapterId:
            null,

          excludedProductIds:
            [],
        },

        priceConfig: {
          configured:
            false,

          mode:
            "none",

          percentage:
            0,

          fixedAmount:
            0,

          rounding:
            "none",
        },

        errors: [
          ...errors,

          "No fue posible obtener la instalación de la app.",
        ],
      };
    }

    return {
      componentConfig: {
        selectedMonitorIds:
          parseIds(
            installation
              .monitors
              ?.value,
          ),

        selectedKeyboardMouseIds:
          parseIds(
            installation
              .keyboards
              ?.value,
          ),

        selectedWifiAdapterIds:
          parseIds(
            installation
              .wifiAdapters
              ?.value,
          ),

        primaryKeyboardMouseId:
          parseString(
            installation
              .primaryKeyboard
              ?.value,
          ),

        primaryWifiAdapterId:
          parseString(
            installation
              .primaryWifi
              ?.value,
          ),

        excludedProductIds:
          parseIds(
            installation
              .excludedProducts
              ?.value,
          ),
      },

      priceConfig: {
        configured:
          Boolean(
            installation
              .priceMode
              ?.value,
          ),

        mode:
          parsePriceMode(
            installation
              .priceMode
              ?.value,
          ),

        percentage:
          parseNumber(
            installation
              .pricePercentage
              ?.value,
            5,
          ),

        fixedAmount:
          parseNumber(
            installation
              .priceFixed
              ?.value,
            10000,
          ),

        rounding:
          parseRounding(
            installation
              .priceRounding
              ?.value,
          ),
      },

      errors,
    };
  } catch (
    error
  ) {
    return {
      componentConfig: {
        selectedMonitorIds:
          [],

        selectedKeyboardMouseIds:
          [],

        selectedWifiAdapterIds:
          [],

        primaryKeyboardMouseId:
          null,

        primaryWifiAdapterId:
          null,

        excludedProductIds:
          [],
      },

      priceConfig: {
        configured:
          false,

        mode:
          "none",

        percentage:
          0,

        fixedAmount:
          0,

        rounding:
          "none",
      },

      errors: [
        error instanceof Error
          ? error.message
          : "No fue posible cargar la configuración operativa.",
      ],
    };
  }
}