type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: {
      variables?: Record<
        string,
        unknown
      >;
    },
  ) => Promise<Response>;
};

type MetafieldNode = {
  type: string;
  value: string;
};

type VariantNode = {
  id: string;
  sku: string | null;
  price: string;
  inventoryQuantity: number | null;
};

type ProductNode = {
  id: string;
  title: string;
  productType: string;
  totalInventory: number;

  variants: {
    nodes: VariantNode[];
  };

  wifiMeta: MetafieldNode | null;
  videoOutputMeta: MetafieldNode | null;
  videoInputMeta: MetafieldNode | null;
};

export type ProductDiagnosticStatus =
  | "ready"
  | "missing_data"
  | "blocked";

export type ProductDiagnosticProblemCode =
  | "missing_wifi"
  | "missing_video"
  | "multiple_variants"
  | "missing_keyboard"
  | "missing_wifi_adapter"
  | "no_compatible_monitor";

export type ProductDiagnostic = {
  id: string;
  title: string;
  sku: string | null;
  totalInventory: number;

  wifi: string;
  videoOutputs: string[];

  status:
    ProductDiagnosticStatus;

  problemCodes:
    ProductDiagnosticProblemCode[];

  problems: string[];

  bundlePossible: boolean;
};

export type BundleDiagnostics = {
  totalPcWithStock: number;

  excludedCustomBuildCount: number;
  manuallyExcludedCount: number;

  multiVariantCount: number;

  readyDataCount: number;
  missingDataCount: number;

  bundlePossibleCount: number;
  attentionCount: number;

  missingWifiCount: number;
  missingVideoCount: number;

  noCompatibleMonitorCount: number;
  noKeyboardCount: number;
  noWifiAdapterCount: number;

  selectedMonitorCount: number;
  selectedKeyboardCount: number;
  selectedWifiCount: number;

  priceConfigured: boolean;
  priceMode: string | null;

  products:
    ProductDiagnostic[];
};

/* =========================================================
   CONFIG
========================================================= */

const CONFIG_NAMESPACE =
  "app_config";

const MONITOR_CONFIG_KEY =
  "bundle_monitor_ids";

const KEYBOARD_MOUSE_CONFIG_KEY =
  "bundle_keyboard_mouse_ids";

const WIFI_ADAPTER_CONFIG_KEY =
  "bundle_wifi_adapter_ids";

const PRICE_MODE_KEY =
  "bundle_price_mode";

const EXCLUDED_PRODUCT_IDS_KEY =
  "bundle_excluded_product_ids";

/* =========================================================
   HELPERS
========================================================= */

function parseStoredIds(
  value:
    | string
    | null
    | undefined,
): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed =
      JSON.parse(value);

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
          String(item),
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseStoredString(
  value:
    | string
    | null
    | undefined,
): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed =
      JSON.parse(value);

    return typeof parsed ===
      "string"
      ? parsed
      : null;
  } catch {
    return value;
  }
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

function isCustomBuildProduct(
  product: ProductNode,
) {
  const title =
    normalize(
      product.title,
    );

  return (
    title.startsWith(
      "¡arma a tu medida",
    ) ||
    title.startsWith(
      "arma a tu medida",
    )
  );
}

function hasMultipleVariants(
  product: ProductNode,
) {
  return (
    product.variants.nodes.length >
    1
  );
}

function normalizePort(
  port: string,
) {
  return normalize(port)
    .replace(
      /\s+/g,
      "",
    )
    .replace(
      /-/g,
      "",
    )
    .replace(
      /[()]/g,
      "",
    );
}

function getMetafieldList(
  metafield:
    | MetafieldNode
    | null
    | undefined,
): string[] {
  if (
    !metafield?.value
  ) {
    return [];
  }

  if (
    metafield.type.startsWith(
      "list.",
    )
  ) {
    try {
      const parsed =
        JSON.parse(
          metafield.value,
        );

      if (
        Array.isArray(
          parsed,
        )
      ) {
        return parsed
          .map(
            (item) =>
              String(
                item,
              ).trim(),
          )
          .filter(Boolean);
      }
    } catch {
      return [];
    }
  }

  return metafield.value
    .split(",")
    .map(
      (item) =>
        item.trim(),
    )
    .filter(Boolean);
}

function getWifiState(
  product: ProductNode,
):
  | "yes"
  | "no"
  | "unknown" {
  const value =
    normalize(
      product
        .wifiMeta
        ?.value,
    );

  if (
    value === "si"
  ) {
    return "yes";
  }

  if (
    value === "no"
  ) {
    return "no";
  }

  return "unknown";
}

function isMonitorCompatible(
  pc: ProductNode,
  monitor: ProductNode,
) {
  const outputs =
    getMetafieldList(
      pc.videoOutputMeta,
    );

  const inputs =
    getMetafieldList(
      monitor.videoInputMeta,
    );

  if (
    outputs.length === 0 ||
    inputs.length === 0
  ) {
    return false;
  }

  return outputs.some(
    (output) =>
      inputs.some(
        (input) =>
          normalizePort(
            output,
          ) ===
          normalizePort(
            input,
          ),
      ),
  );
}

function getSku(
  product: ProductNode,
) {
  return (
    product
      .variants
      .nodes?.[0]
      ?.sku ??
    null
  );
}

/* =========================================================
   PRODUCTS
========================================================= */

async function fetchProductsByType(
  admin:
    AdminGraphqlClient,
  productType: string,
): Promise<ProductNode[]> {
  const response =
    await admin.graphql(
      `#graphql
        query BundleDiagnosticProducts(
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
              productType
              totalInventory

              variants(first: 2) {
                nodes {
                  id
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
    };

  return (
    json.data
      ?.products
      ?.nodes ??
    []
  ).filter(
    (product) =>
      product.totalInventory >
      0,
  );
}

/* =========================================================
   MAIN
========================================================= */

export async function loadBundleDiagnostics(
  admin:
    AdminGraphqlClient,
): Promise<BundleDiagnostics> {
  const [
    configResponse,
    allPcProducts,
    monitorProducts,
    refurbishedMonitorProducts,
    keyboardProducts,
    wifiProducts,
  ] =
    await Promise.all([
      admin.graphql(
        `#graphql
          query BundleDiagnosticConfig {
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

            exclusions: metafield(
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
          }
        }
        `,
      ),

      fetchProductsByType(
        admin,
        "PC de Escritorio",
      ),

      fetchProductsByType(
        admin,
        "Monitor",
      ),

      fetchProductsByType(
        admin,
        "Monitor reacondicionado",
      ),

      fetchProductsByType(
        admin,
        "Combo Teclado y Mouse",
      ),

      fetchProductsByType(
        admin,
        "Adaptador WiFi",
      ),
    ]);

  const configJson =
    (await configResponse.json()) as {
      data?: {
        currentAppInstallation?: {
          monitorSelection?: {
            value: string;
          } | null;

          keyboardSelection?: {
            value: string;
          } | null;

          wifiSelection?: {
            value: string;
          } | null;

          exclusions?: {
            value: string;
          } | null;

          priceMode?: {
            value: string;
          } | null;
        };
      };
    };

  const installation =
    configJson.data
      ?.currentAppInstallation;

  const selectedMonitorIds =
    parseStoredIds(
      installation
        ?.monitorSelection
        ?.value,
    );

  const selectedKeyboardIds =
    parseStoredIds(
      installation
        ?.keyboardSelection
        ?.value,
    );

  const selectedWifiIds =
    parseStoredIds(
      installation
        ?.wifiSelection
        ?.value,
    );

  const excludedProductIds =
    parseStoredIds(
      installation
        ?.exclusions
        ?.value,
    );

  const priceMode =
    parseStoredString(
      installation
        ?.priceMode
        ?.value,
    );

  const priceConfigured =
    Boolean(
      installation
        ?.priceMode
        ?.value,
    );

  const excludedCustomBuildProducts =
    allPcProducts.filter(
      isCustomBuildProduct,
    );

  const manuallyExcludedProducts =
    allPcProducts.filter(
      (product) =>
        !isCustomBuildProduct(
          product,
        ) &&
        excludedProductIds.includes(
          product.id,
        ),
    );

  /*
   * Manual exclusions disappear entirely from diagnostics.
   */
  const pcProducts =
    allPcProducts.filter(
      (product) =>
        !isCustomBuildProduct(
          product,
        ) &&
        !excludedProductIds.includes(
          product.id,
        ),
    );

  const monitors = [
    ...monitorProducts,
    ...refurbishedMonitorProducts,
  ];

  const authorizedMonitors =
    monitors.filter(
      (product) =>
        selectedMonitorIds.includes(
          product.id,
        ),
    );

  const authorizedKeyboards =
    keyboardProducts.filter(
      (product) =>
        selectedKeyboardIds.includes(
          product.id,
        ),
    );

  const authorizedWifi =
    wifiProducts.filter(
      (product) =>
        selectedWifiIds.includes(
          product.id,
        ),
    );

  const diagnostics:
    ProductDiagnostic[] =
    pcProducts.map(
      (pc) => {
        const problems:
          string[] = [];

        const problemCodes:
          ProductDiagnosticProblemCode[] =
          [];

        const wifiState =
          getWifiState(pc);

        const videoOutputs =
          getMetafieldList(
            pc.videoOutputMeta,
          );

        if (
          hasMultipleVariants(
            pc,
          )
        ) {
          problemCodes.push(
            "multiple_variants",
          );

          problems.push(
            "El producto tiene múltiples variantes. La V1 no selecciona automáticamente una variante.",
          );

          return {
            id:
              pc.id,

            title:
              pc.title,

            sku:
              getSku(pc),

            totalInventory:
              pc.totalInventory,

            wifi:
              wifiState ===
              "yes"
                ? "Sí"
                : wifiState ===
                    "no"
                  ? "No"
                  : "Sin informar",

            videoOutputs,

            status:
              "blocked" as const,

            problemCodes,
            problems,

            bundlePossible:
              false,
          };
        }

        const missingWifi =
          wifiState ===
          "unknown";

        const missingVideo =
          videoOutputs.length ===
          0;

        if (
          missingWifi
        ) {
          problemCodes.push(
            "missing_wifi",
          );

          problems.push(
            "Falta informar si tiene o no tiene Wi-Fi integrado.",
          );
        }

        if (
          missingVideo
        ) {
          problemCodes.push(
            "missing_video",
          );

          problems.push(
            "Falta informar las salidas de video.",
          );
        }

        if (
          missingWifi ||
          missingVideo
        ) {
          return {
            id:
              pc.id,

            title:
              pc.title,

            sku:
              getSku(pc),

            totalInventory:
              pc.totalInventory,

            wifi:
              wifiState ===
              "yes"
                ? "Sí"
                : wifiState ===
                    "no"
                  ? "No"
                  : "Sin informar",

            videoOutputs,

            status:
              "missing_data" as const,

            problemCodes,
            problems,

            bundlePossible:
              false,
          };
        }

        if (
          authorizedKeyboards.length ===
          0
        ) {
          problemCodes.push(
            "missing_keyboard",
          );

          problems.push(
            "No hay un teclado/mouse autorizado con stock.",
          );
        }

        if (
          wifiState ===
            "no" &&
          authorizedWifi.length ===
            0
        ) {
          problemCodes.push(
            "missing_wifi_adapter",
          );

          problems.push(
            "El PC requiere Wi-Fi y no hay un adaptador autorizado con stock.",
          );
        }

        const hasCompatibleMonitor =
          authorizedMonitors.some(
            (monitor) =>
              isMonitorCompatible(
                pc,
                monitor,
              ),
          );

        if (
          !hasCompatibleMonitor
        ) {
          problemCodes.push(
            "no_compatible_monitor",
          );

          problems.push(
            `No existe un monitor autorizado compatible con las salidas: ${videoOutputs.join(", ")}.`,
          );
        }

        const bundlePossible =
          problemCodes.length ===
          0;

        return {
          id:
            pc.id,

          title:
            pc.title,

          sku:
            getSku(pc),

          totalInventory:
            pc.totalInventory,

          wifi:
            wifiState ===
              "yes"
              ? "Sí"
              : "No",

          videoOutputs,

          status:
            bundlePossible
              ? "ready"
              : "blocked",

          problemCodes,
          problems,

          bundlePossible,
        };
      },
    );

  const missingWifiCount =
    diagnostics.filter(
      (product) =>
        product.problemCodes.includes(
          "missing_wifi",
        ),
    ).length;

  const missingVideoCount =
    diagnostics.filter(
      (product) =>
        product.problemCodes.includes(
          "missing_video",
        ),
    ).length;

  const multiVariantCount =
    diagnostics.filter(
      (product) =>
        product.problemCodes.includes(
          "multiple_variants",
        ),
    ).length;

  const missingDataCount =
    diagnostics.filter(
      (product) =>
        product.status ===
        "missing_data",
    ).length;

  const readyDataCount =
    diagnostics.filter(
      (product) =>
        product.status !==
        "missing_data",
    ).length;

  const bundlePossibleCount =
    diagnostics.filter(
      (product) =>
        product.bundlePossible,
    ).length;

  const noCompatibleMonitorCount =
    diagnostics.filter(
      (product) =>
        product.problemCodes.includes(
          "no_compatible_monitor",
        ),
    ).length;

  const noKeyboardCount =
    diagnostics.filter(
      (product) =>
        product.problemCodes.includes(
          "missing_keyboard",
        ),
    ).length;

  const noWifiAdapterCount =
    diagnostics.filter(
      (product) =>
        product.problemCodes.includes(
          "missing_wifi_adapter",
        ),
    ).length;

  return {
    totalPcWithStock:
      diagnostics.length,

    excludedCustomBuildCount:
      excludedCustomBuildProducts.length,

    manuallyExcludedCount:
      manuallyExcludedProducts.length,

    multiVariantCount,

    readyDataCount,
    missingDataCount,

    bundlePossibleCount,

    attentionCount:
      diagnostics.length -
      bundlePossibleCount,

    missingWifiCount,
    missingVideoCount,

    noCompatibleMonitorCount,
    noKeyboardCount,
    noWifiAdapterCount,

    selectedMonitorCount:
      authorizedMonitors.length,

    selectedKeyboardCount:
      authorizedKeyboards.length,

    selectedWifiCount:
      authorizedWifi.length,

    priceConfigured,
    priceMode,

    products:
      diagnostics,
  };
}