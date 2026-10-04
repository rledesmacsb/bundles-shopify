export type MetafieldNode = {
  type: string;
  value: string;
};

export type ProductImage = {
  url: string;
  altText: string | null;
};

export type VariantNode = {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  inventoryQuantity: number | null;
};

export type ProductNode = {
  id: string;
  title: string;
  status: string;
  productType: string;
  totalInventory: number;

  featuredImage: ProductImage | null;

  variants: {
    nodes: VariantNode[];
  };

  wifiMeta: MetafieldNode | null;
  videoOutputMeta: MetafieldNode | null;
  videoInputMeta: MetafieldNode | null;
};

export type PcMonitorBundleConfig = {
  selectedMonitorIds: string[];
  selectedKeyboardMouseIds: string[];
  selectedWifiAdapterIds: string[];

  primaryKeyboardMouseId: string | null;
  primaryWifiAdapterId: string | null;

  excludedProductIds?: string[];
};

export type BundlePriceMode =
  | "none"
  | "percentage"
  | "fixed";

export type BundlePriceRounding =
  | "none"
  | "x900";

export type BundlePriceConfig = {
  configured: boolean;

  mode: BundlePriceMode;

  percentage: number;

  fixedAmount: number;

  rounding: BundlePriceRounding;
};

export type BundlePriceResult = {
  componentPrice: number;

  baseProductPrice: number;

  otherComponentsPrice: number;

  discountAmount: number;

  discountedBaseProductPrice: number;

  calculatedPrice: number;

  roundingAdjustment: number;

  finalPrice: number;

  savings: number;

  savingsPercentage: number;
};

export type ProductGroup =
  | "desktop"
  | "all_in_one"
  | "monitor"
  | "keyboard_mouse"
  | "wifi_adapter"
  | "other";

export type MonitorCondition =
  | "new"
  | "refurbished"
  | "unknown";

export type BundleTemplate =
  | "pc_monitor_new"
  | "pc_monitor_refurbished"
  | "all_in_one";

export type ProductInfo = {
  group: ProductGroup;

  wifi: string;

  video: string;

  status:
    | "ready"
    | "warning";

  missing: string[];
};

export type BundleCandidate = {
  id: string;

  type:
    | "desktop"
    | "all_in_one";

  template: BundleTemplate;

  baseProduct: ProductNode;

  monitor: ProductNode | null;

  keyboardMouse: ProductNode;

  wifiAdapter: ProductNode | null;

  commonVideoPorts: string[];
};

export type BundleIdentity = {
  title: string;

  sku: string;

  productType: string;

  template: BundleTemplate;
};

export type BlockedDesktop = {
  product: ProductNode;

  reason: string;
};

export type PcMonitorBundleState = {
  allDesktopProducts: ProductNode[];

  desktopProducts: ProductNode[];

  excludedCustomBuildProducts: ProductNode[];

  manuallyExcludedProducts: ProductNode[];

  multiVariantDesktopProducts: ProductNode[];

  allInOneProducts: ProductNode[];

  monitorProducts: ProductNode[];

  newMonitorProducts: ProductNode[];

  refurbishedMonitorProducts: ProductNode[];

  keyboardProducts: ProductNode[];

  wifiProducts: ProductNode[];

  readyDesktopProducts: ProductNode[];

  readyAllInOneProducts: ProductNode[];

  incompleteDesktopProducts: ProductNode[];

  selectedMonitors: ProductNode[];

  readySelectedMonitors: ProductNode[];

  readySelectedNewMonitors: ProductNode[];

  readySelectedRefurbishedMonitors: ProductNode[];

  selectedKeyboardProducts: ProductNode[];

  selectedWifiProducts: ProductNode[];

  activeKeyboard: ProductNode | null;

  activeWifi: ProductNode | null;

  bundleCandidates: BundleCandidate[];

  desktopCandidates: BundleCandidate[];

  newMonitorCandidates: BundleCandidate[];

  refurbishedMonitorCandidates: BundleCandidate[];

  aioCandidates: BundleCandidate[];

  blockedDesktopProducts: BlockedDesktop[];
};

/* =========================================================
   BASIC HELPERS
========================================================= */

export function normalize(
  value: string | null | undefined,
) {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      "",
    );
}

export function getProductGroup(
  productType: string,
): ProductGroup {
  const type =
    normalize(
      productType,
    );

  if (
    type ===
    "pc de escritorio"
  ) {
    return "desktop";
  }

  if (
    type ===
    "all in one"
  ) {
    return "all_in_one";
  }

  if (
    type ===
      "monitor" ||
    type ===
      "monitor reacondicionado"
  ) {
    return "monitor";
  }

  if (
    type ===
    "combo teclado y mouse"
  ) {
    return "keyboard_mouse";
  }

  if (
    type ===
    "adaptador wifi"
  ) {
    return "wifi_adapter";
  }

  return "other";
}

export function getMonitorCondition(
  product: ProductNode,
): MonitorCondition {
  const type =
    normalize(
      product.productType,
    );

  if (
    type ===
    "monitor"
  ) {
    return "new";
  }

  if (
    type ===
    "monitor reacondicionado"
  ) {
    return "refurbished";
  }

  return "unknown";
}

/* =========================================================
   EXCLUSIONS / VARIANTS
========================================================= */

export function isCustomBuildProduct(
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

export function isManuallyExcluded(
  product: ProductNode,
  excludedProductIds:
    string[] = [],
) {
  return excludedProductIds.includes(
    product.id,
  );
}

export function hasMultipleVariants(
  product: ProductNode,
) {
  return (
    product
      .variants
      .nodes
      .length >
    1
  );
}

export function hasSingleVariant(
  product: ProductNode,
) {
  return (
    product
      .variants
      .nodes
      .length ===
    1
  );
}

/* =========================================================
   METAFIELDS
========================================================= */

export function formatMetafieldValue(
  metafield?:
    | MetafieldNode
    | null,
): string {
  if (
    !metafield?.value
  ) {
    return "—";
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
        return parsed.join(
          ", ",
        );
      }
    } catch {
      return metafield.value;
    }
  }

  return metafield.value;
}

export function getMetafieldList(
  metafield?:
    | MetafieldNode
    | null,
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
          .filter(
            Boolean,
          );
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
    .filter(
      Boolean,
    );
}

/* =========================================================
   VIDEO
========================================================= */

export function normalizePort(
  port: string,
) {
  return normalize(
    port,
  )
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

export function getCommonVideoPorts(
  pc: ProductNode,
  monitor: ProductNode,
): string[] {
  const outputs =
    getMetafieldList(
      pc.videoOutputMeta,
    );

  const inputs =
    getMetafieldList(
      monitor.videoInputMeta,
    );

  return outputs.filter(
    (output) =>
      inputs.some(
        (input) =>
          normalizePort(
            input,
          ) ===
          normalizePort(
            output,
          ),
      ),
  );
}

export function isDirectlyCompatible(
  pc: ProductNode,
  monitor: ProductNode,
) {
  return (
    getCommonVideoPorts(
      pc,
      monitor,
    ).length >
    0
  );
}

/* =========================================================
   WIFI
========================================================= */

export function getWifiState(
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

/* =========================================================
   PRODUCT READINESS
========================================================= */

export function getProductInfo(
  product: ProductNode,
): ProductInfo {
  const group =
    getProductGroup(
      product.productType,
    );

  const missing:
    string[] = [];

  let wifi = "—";
  let video = "—";

  if (
    group ===
    "desktop"
  ) {
    wifi =
      formatMetafieldValue(
        product.wifiMeta,
      );

    video =
      formatMetafieldValue(
        product.videoOutputMeta,
      );

    if (
      !product
        .wifiMeta
        ?.value
    ) {
      missing.push(
        "Wi-Fi",
      );
    }

    if (
      !product
        .videoOutputMeta
        ?.value
    ) {
      missing.push(
        "salidas de video",
      );
    }
  }

  if (
    group ===
    "all_in_one"
  ) {
    wifi =
      formatMetafieldValue(
        product.wifiMeta,
      );

    if (
      !product
        .wifiMeta
        ?.value
    ) {
      missing.push(
        "Wi-Fi",
      );
    }
  }

  if (
    group ===
    "monitor"
  ) {
    video =
      formatMetafieldValue(
        product.videoInputMeta,
      );

    if (
      !product
        .videoInputMeta
        ?.value
    ) {
      missing.push(
        "entradas de video",
      );
    }
  }

  return {
    group,

    wifi,

    video,

    status:
      missing.length ===
      0
        ? "ready"
        : "warning",

    missing,
  };
}

/* =========================================================
   PRODUCT PRICE
========================================================= */

export function getFirstVariant(
  product:
    | ProductNode
    | null
    | undefined,
) {
  return product
    ?.variants
    .nodes?.[0];
}

export function getPrice(
  product:
    | ProductNode
    | null
    | undefined,
) {
  const price =
    Number(
      getFirstVariant(
        product,
      )?.price ??
        0,
    );

  return Number.isNaN(
    price,
  )
    ? 0
    : price;
}

export function formatPrice(
  value: number,
  currencyCode =
    "CLP",
) {
  return new Intl.NumberFormat(
    "es-CL",
    {
      style:
        "currency",

      currency:
        currencyCode,

      maximumFractionDigits:
        0,
    },
  ).format(
    value,
  );
}

/* =========================================================
   TITLES
========================================================= */

function stripCondition(
  title: string,
) {
  return title
    .replace(
      /\s+(Reacondicionado|Usado|Nuevo)\s*$/i,
      "",
    )
    .trim();
}

function stripSpecifications(
  title: string,
) {
  const index =
    title.indexOf(
      "(",
    );

  if (
    index === -1
  ) {
    return title.trim();
  }

  return title
    .slice(
      0,
      index,
    )
    .trim();
}

export function cleanPcTitle(
  title: string,
) {
  let result =
    stripSpecifications(
      stripCondition(
        title,
      ),
    );

  result =
    result.replace(
      /^¡Arma a tu medida!\s*/i,
      "",
    );

  result =
    result.replace(
      /^PC\s*Tiny\s+/i,
      "",
    );

  result =
    result.replace(
      /^PCTiny\s+/i,
      "",
    );

  result =
    result.replace(
      /^PC\s+/i,
      "",
    );

  return result.trim();
}

export function cleanMonitorTitle(
  title: string,
) {
  let result =
    stripSpecifications(
      stripCondition(
        title,
      ),
    );

  result =
    result.replace(
      /^Monitor\s+/i,
      "",
    );

  const sizeMatch =
    result.match(
      /^(\d+(?:\.\d+)?\s*(?:"|''|”))\s*(.*)$/i,
    );

  if (
    sizeMatch
  ) {
    const size =
      sizeMatch[1]
        .replace(
          /\s+/g,
          "",
        )
        .replace(
          /''/,
          '"',
        )
        .replace(
          /”/,
          '"',
        );

    const model =
      sizeMatch[2]
        .trim();

    if (
      model
    ) {
      return `${model} ${size}`;
    }
  }

  return result.trim();
}

export function cleanAllInOneTitle(
  title: string,
) {
  let result =
    stripSpecifications(
      stripCondition(
        title,
      ),
    );

  result =
    result.replace(
      /^All in One\s+/i,
      "",
    );

  return result.trim();
}

/* =========================================================
   BUNDLE IDENTITY
========================================================= */

export function getBundleSku(
  candidate:
    BundleCandidate,
) {
  const sku =
    getFirstVariant(
      candidate.baseProduct,
    )?.sku?.trim();

  if (
    !sku
  ) {
    return "SKU pendiente";
  }

  if (
    candidate.template ===
    "pc_monitor_refurbished"
  ) {
    return `BND-R-${sku}`;
  }

  return `BND-${sku}`;
}

export function getBundleIdentity(
  candidate:
    BundleCandidate,
): BundleIdentity {
  if (
    candidate.type ===
    "desktop"
  ) {
    const pcName =
      cleanPcTitle(
        candidate
          .baseProduct
          .title,
      );

    const monitorName =
      candidate.monitor
        ? cleanMonitorTitle(
            candidate
              .monitor
              .title,
          )
        : "Monitor";

    if (
      candidate.template ===
      "pc_monitor_refurbished"
    ) {
      return {
        title:
          `Combo Reacondicionado ${pcName} + Monitor ${monitorName}`,

        sku:
          getBundleSku(
            candidate,
          ),

        productType:
          "Combo PC y Monitor",

        template:
          "pc_monitor_refurbished",
      };
    }

    return {
      title:
        `Combo PC ${pcName} + Monitor ${monitorName}`,

      sku:
        getBundleSku(
          candidate,
        ),

      productType:
        "Combo PC y Monitor",

      template:
        "pc_monitor_new",
    };
  }

  return {
    title:
      `Combo All in One ${cleanAllInOneTitle(
        candidate
          .baseProduct
          .title,
      )}`,

    sku:
      getBundleSku(
        candidate,
      ),

    productType:
      "Combo All in One",

    template:
      "all_in_one",
  };
}

/* =========================================================
   BUNDLE VALUES
========================================================= */

export function getBundlePrice(
  candidate:
    BundleCandidate,
) {
  return (
    getPrice(
      candidate.baseProduct,
    ) +
    getPrice(
      candidate.monitor,
    ) +
    getPrice(
      candidate.keyboardMouse,
    ) +
    getPrice(
      candidate.wifiAdapter,
    )
  );
}

export function getBundleStock(
  candidate:
    BundleCandidate,
) {
  const stocks = [
    candidate
      .baseProduct
      .totalInventory,

    candidate
      .keyboardMouse
      .totalInventory,
  ];

  if (
    candidate.monitor
  ) {
    stocks.push(
      candidate
        .monitor
        .totalInventory,
    );
  }

  if (
    candidate.wifiAdapter
  ) {
    stocks.push(
      candidate
        .wifiAdapter
        .totalInventory,
    );
  }

  return Math.min(
    ...stocks,
  );
}

export function getBundleComponentCount(
  candidate:
    BundleCandidate,
) {
  return (
    2 +
    (
      candidate.monitor
        ? 1
        : 0
    ) +
    (
      candidate.wifiAdapter
        ? 1
        : 0
    )
  );
}

/* =========================================================
   COMMERCIAL PRICE
========================================================= */

function clamp(
  value: number,
  min: number,
  max: number,
) {
  return Math.min(
    Math.max(
      value,
      min,
    ),
    max,
  );
}

export function normalizeBundlePriceConfig(
  config:
    BundlePriceConfig,
): BundlePriceConfig {
  return {
    configured:
      config.configured,

    mode:
      config.mode,

    percentage:
      clamp(
        Number.isFinite(
          config.percentage,
        )
          ? config.percentage
          : 0,
        0,
        100,
      ),

    fixedAmount:
      Math.max(
        0,
        Number.isFinite(
          config.fixedAmount,
        )
          ? config.fixedAmount
          : 0,
      ),

    rounding:
      config.rounding,
  };
}

export function roundToNearest900(
  value: number,
) {
  const price =
    Math.max(
      0,
      Math.round(
        value,
      ),
    );

  if (
    price === 0
  ) {
    return 0;
  }

  const rawLower =
    Math.floor(
      (
        price -
        900
      ) /
        1000,
    ) *
      1000 +
    900;

  const lower =
    Math.max(
      0,
      rawLower,
    );

  const upper =
    lower +
    1000;

  const lowerDistance =
    Math.abs(
      price -
        lower,
    );

  const upperDistance =
    Math.abs(
      upper -
        price,
    );

  if (
    upperDistance <
    lowerDistance
  ) {
    return upper;
  }

  return lower;
}

export function roundDownTo900(
  value: number,
) {
  const price =
    Math.max(
      0,
      Math.round(
        value,
      ),
    );

  if (
    price === 0
  ) {
    return 0;
  }

  const candidate =
    Math.floor(
      (
        price -
        900
      ) /
        1000,
    ) *
      1000 +
    900;

  return Math.max(
    0,
    candidate,
  );
}

export function roundDownToX9900(
  value: number,
) {
  return roundToNearest900(
    value,
  );
}

export function calculateBundlePrice(
  candidate:
    BundleCandidate,
  rawConfig:
    BundlePriceConfig,
): BundlePriceResult {
  const config =
    normalizeBundlePriceConfig(
      rawConfig,
    );

  const baseProductPrice =
    Math.round(
      getPrice(
        candidate.baseProduct,
      ),
    );

  const monitorPrice =
    Math.round(
      getPrice(
        candidate.monitor,
      ),
    );

  const keyboardMousePrice =
    Math.round(
      getPrice(
        candidate.keyboardMouse,
      ),
    );

  const wifiPrice =
    Math.round(
      getPrice(
        candidate.wifiAdapter,
      ),
    );

  const otherComponentsPrice =
    monitorPrice +
    keyboardMousePrice +
    wifiPrice;

  const componentPrice =
    baseProductPrice +
    otherComponentsPrice;

  let discountAmount =
    0;

  if (
    config.mode ===
    "percentage"
  ) {
    discountAmount =
      Math.round(
        baseProductPrice *
          (
            config.percentage /
            100
          ),
      );
  }

  if (
    config.mode ===
    "fixed"
  ) {
    discountAmount =
      Math.min(
        baseProductPrice,
        Math.round(
          config.fixedAmount,
        ),
      );
  }

  discountAmount =
    Math.max(
      0,
      discountAmount,
    );

  const discountedBaseProductPrice =
    Math.max(
      0,
      baseProductPrice -
        discountAmount,
    );

  const calculatedPrice =
    discountedBaseProductPrice +
    otherComponentsPrice;

  let finalPrice =
    calculatedPrice;

  if (
    config.rounding ===
    "x900"
  ) {
    const nearest900 =
      roundToNearest900(
        calculatedPrice,
      );

    if (
      nearest900 <=
      componentPrice
    ) {
      finalPrice =
        nearest900;
    } else {
      finalPrice =
        roundDownTo900(
          componentPrice,
        );
    }
  }

  const roundingAdjustment =
    finalPrice -
    calculatedPrice;

  const savings =
    Math.max(
      0,
      componentPrice -
        finalPrice,
    );

  const savingsPercentage =
    componentPrice >
    0
      ? (
          savings /
          componentPrice
        ) *
        100
      : 0;

  return {
    componentPrice,

    baseProductPrice,

    otherComponentsPrice,

    discountAmount,

    discountedBaseProductPrice,

    calculatedPrice,

    roundingAdjustment,

    finalPrice,

    savings,

    savingsPercentage,
  };
}

export function getPriceRuleLabel(
  config:
    BundlePriceConfig,
) {
  let label =
    "Sin descuento";

  if (
    config.mode ===
    "percentage"
  ) {
    label =
      `${config.percentage}% de descuento sobre el computador`;
  }

  if (
    config.mode ===
    "fixed"
  ) {
    label =
      "Descuento fijo sobre el computador";
  }

  if (
    config.rounding ===
    "x900"
  ) {
    return `${label} · Termina en $900`;
  }

  return label;
}

/* =========================================================
   MONITOR SELECTION
========================================================= */

export function getCheapestCompatibleMonitor(
  pc: ProductNode,
  monitors:
    ProductNode[],
): ProductNode | null {
  const compatible =
    monitors
      .filter(
        (monitor) =>
          isDirectlyCompatible(
            pc,
            monitor,
          ),
      )
      .sort(
        (
          a,
          b,
        ) => {
          const priceDifference =
            getPrice(
              a,
            ) -
            getPrice(
              b,
            );

          if (
            priceDifference !==
            0
          ) {
            return priceDifference;
          }

          return (
            b.totalInventory -
            a.totalInventory
          );
        },
      );

  return (
    compatible[0] ??
    null
  );
}

/* =========================================================
   BUILD STATE
========================================================= */

export function buildPcMonitorBundleState(
  products:
    ProductNode[],
  config:
    PcMonitorBundleConfig,
): PcMonitorBundleState {
  const allDesktopProducts =
    products.filter(
      (product) =>
        getProductGroup(
          product.productType,
        ) ===
        "desktop",
    );

  const manualExclusionIds =
    config.excludedProductIds ??
    [];

  const excludedCustomBuildProducts =
    allDesktopProducts.filter(
      isCustomBuildProduct,
    );

  const manuallyExcludedProducts =
    allDesktopProducts.filter(
      (product) =>
        !isCustomBuildProduct(
          product,
        ) &&
        isManuallyExcluded(
          product,
          manualExclusionIds,
        ),
    );

  const multiVariantDesktopProducts =
    allDesktopProducts.filter(
      (product) =>
        !isCustomBuildProduct(
          product,
        ) &&
        !isManuallyExcluded(
          product,
          manualExclusionIds,
        ) &&
        hasMultipleVariants(
          product,
        ),
    );

  const desktopProducts =
    allDesktopProducts.filter(
      (product) =>
        !isCustomBuildProduct(
          product,
        ) &&
        !isManuallyExcluded(
          product,
          manualExclusionIds,
        ) &&
        hasSingleVariant(
          product,
        ),
    );

  const allInOneProducts =
    products.filter(
      (product) =>
        getProductGroup(
          product.productType,
        ) ===
        "all_in_one",
    );

  const monitorProducts =
    products
      .filter(
        (product) =>
          getProductGroup(
            product.productType,
          ) ===
          "monitor",
      )
      .sort(
        (
          a,
          b,
        ) =>
          b.totalInventory -
          a.totalInventory,
      );

  const newMonitorProducts =
    monitorProducts.filter(
      (product) =>
        getMonitorCondition(
          product,
        ) ===
        "new",
    );

  const refurbishedMonitorProducts =
    monitorProducts.filter(
      (product) =>
        getMonitorCondition(
          product,
        ) ===
        "refurbished",
    );

  const keyboardProducts =
    products
      .filter(
        (product) =>
          getProductGroup(
            product.productType,
          ) ===
          "keyboard_mouse",
      )
      .sort(
        (
          a,
          b,
        ) =>
          b.totalInventory -
          a.totalInventory,
      );

  const wifiProducts =
    products
      .filter(
        (product) =>
          getProductGroup(
            product.productType,
          ) ===
          "wifi_adapter",
      )
      .sort(
        (
          a,
          b,
        ) =>
          b.totalInventory -
          a.totalInventory,
      );

  const readyDesktopProducts =
    desktopProducts.filter(
      (product) =>
        getProductInfo(
          product,
        ).status ===
        "ready",
    );

  const incompleteDesktopProducts =
    desktopProducts.filter(
      (product) =>
        getProductInfo(
          product,
        ).status !==
        "ready",
    );

  const readyAllInOneProducts =
    allInOneProducts.filter(
      (product) =>
        getProductInfo(
          product,
        ).status ===
        "ready",
    );

  const selectedMonitorSet =
    new Set(
      config.selectedMonitorIds,
    );

  const selectedKeyboardSet =
    new Set(
      config.selectedKeyboardMouseIds,
    );

  const selectedWifiSet =
    new Set(
      config.selectedWifiAdapterIds,
    );

  const selectedMonitors =
    monitorProducts.filter(
      (product) =>
        selectedMonitorSet.has(
          product.id,
        ),
    );

  const readySelectedMonitors =
    selectedMonitors.filter(
      (product) =>
        getProductInfo(
          product,
        ).status ===
        "ready",
    );

  const readySelectedNewMonitors =
    readySelectedMonitors.filter(
      (product) =>
        getMonitorCondition(
          product,
        ) ===
        "new",
    );

  const readySelectedRefurbishedMonitors =
    readySelectedMonitors.filter(
      (product) =>
        getMonitorCondition(
          product,
        ) ===
        "refurbished",
    );

  const selectedKeyboardProducts =
    keyboardProducts.filter(
      (product) =>
        selectedKeyboardSet.has(
          product.id,
        ),
    );

  const selectedWifiProducts =
    wifiProducts.filter(
      (product) =>
        selectedWifiSet.has(
          product.id,
        ),
    );

  const activeKeyboard =
    selectedKeyboardProducts.find(
      (product) =>
        product.id ===
        config.primaryKeyboardMouseId,
    ) ??
    selectedKeyboardProducts[0] ??
    null;

  const activeWifi =
    selectedWifiProducts.find(
      (product) =>
        product.id ===
        config.primaryWifiAdapterId,
    ) ??
    selectedWifiProducts[0] ??
    null;

  const bundleCandidates:
    BundleCandidate[] =
    [];

  if (
    activeKeyboard
  ) {
    for (
      const pc
      of readyDesktopProducts
    ) {
      const wifiState =
        getWifiState(
          pc,
        );

      if (
        wifiState ===
          "no" &&
        !activeWifi
      ) {
        continue;
      }

      /* ---------------------------------------------------
         1. PC + NEW MONITOR
      --------------------------------------------------- */

      const newMonitor =
        getCheapestCompatibleMonitor(
          pc,
          readySelectedNewMonitors,
        );

      if (
        newMonitor
      ) {
        bundleCandidates.push({
          id:
            `${pc.id}|pc_monitor_new|${newMonitor.id}`,

          type:
            "desktop",

          template:
            "pc_monitor_new",

          baseProduct:
            pc,

          monitor:
            newMonitor,

          keyboardMouse:
            activeKeyboard,

          wifiAdapter:
            wifiState ===
            "no"
              ? activeWifi
              : null,

          commonVideoPorts:
            getCommonVideoPorts(
              pc,
              newMonitor,
            ),
        });
      }

      /* ---------------------------------------------------
         2. PC + REFURBISHED MONITOR
      --------------------------------------------------- */

      const refurbishedMonitor =
        getCheapestCompatibleMonitor(
          pc,
          readySelectedRefurbishedMonitors,
        );

      if (
        refurbishedMonitor
      ) {
        bundleCandidates.push({
          id:
            `${pc.id}|pc_monitor_refurbished|${refurbishedMonitor.id}`,

          type:
            "desktop",

          template:
            "pc_monitor_refurbished",

          baseProduct:
            pc,

          monitor:
            refurbishedMonitor,

          keyboardMouse:
            activeKeyboard,

          wifiAdapter:
            wifiState ===
            "no"
              ? activeWifi
              : null,

          commonVideoPorts:
            getCommonVideoPorts(
              pc,
              refurbishedMonitor,
            ),
        });
      }
    }

    for (
      const aio
      of readyAllInOneProducts
    ) {
      const wifiState =
        getWifiState(
          aio,
        );

      if (
        wifiState ===
          "no" &&
        !activeWifi
      ) {
        continue;
      }

      bundleCandidates.push({
        id:
          `${aio.id}|all_in_one`,

        type:
          "all_in_one",

        template:
          "all_in_one",

        baseProduct:
          aio,

        monitor:
          null,

        keyboardMouse:
          activeKeyboard,

        wifiAdapter:
          wifiState ===
          "no"
            ? activeWifi
            : null,

        commonVideoPorts:
          [],
      });
    }
  }

  bundleCandidates.sort(
    (
      a,
      b,
    ) => {
      const priceDifference =
        getBundlePrice(
          a,
        ) -
        getBundlePrice(
          b,
        );

      if (
        priceDifference !==
        0
      ) {
        return priceDifference;
      }

      return getBundleIdentity(
        a,
      ).title.localeCompare(
        getBundleIdentity(
          b,
        ).title,
        "es",
      );
    },
  );

  const desktopCandidates =
    bundleCandidates.filter(
      (candidate) =>
        candidate.type ===
        "desktop",
    );

  const newMonitorCandidates =
    desktopCandidates.filter(
      (candidate) =>
        candidate.template ===
        "pc_monitor_new",
    );

  const refurbishedMonitorCandidates =
    desktopCandidates.filter(
      (candidate) =>
        candidate.template ===
        "pc_monitor_refurbished",
    );

  const aioCandidates =
    bundleCandidates.filter(
      (candidate) =>
        candidate.type ===
        "all_in_one",
    );

  const desktopCandidateBaseIds =
    new Set(
      desktopCandidates.map(
        (candidate) =>
          candidate
            .baseProduct
            .id,
      ),
    );

  const blockedDesktopProducts:
    BlockedDesktop[] =
    [];

  for (
    const product
    of multiVariantDesktopProducts
  ) {
    blockedDesktopProducts.push({
      product,

      reason:
        "Tiene múltiples variantes. La V1 no selecciona automáticamente una variante.",
    });
  }

  for (
    const pc
    of readyDesktopProducts
  ) {
    if (
      desktopCandidateBaseIds.has(
        pc.id,
      )
    ) {
      continue;
    }

    let reason =
      "No fue posible formar ningún bundle.";

    if (
      !activeKeyboard
    ) {
      reason =
        "No hay teclado/mouse autorizado.";
    } else if (
      getWifiState(
        pc,
      ) ===
        "no" &&
      !activeWifi
    ) {
      reason =
        "Requiere adaptador Wi-Fi y no hay uno autorizado.";
    } else {
      reason =
        "No existe un monitor autorizado compatible, nuevo ni reacondicionado.";
    }

    blockedDesktopProducts.push({
      product:
        pc,

      reason,
    });
  }

  return {
    allDesktopProducts,

    desktopProducts,

    excludedCustomBuildProducts,

    manuallyExcludedProducts,

    multiVariantDesktopProducts,

    allInOneProducts,

    monitorProducts,

    newMonitorProducts,

    refurbishedMonitorProducts,

    keyboardProducts,

    wifiProducts,

    readyDesktopProducts,

    readyAllInOneProducts,

    incompleteDesktopProducts,

    selectedMonitors,

    readySelectedMonitors,

    readySelectedNewMonitors,

    readySelectedRefurbishedMonitors,

    selectedKeyboardProducts,

    selectedWifiProducts,

    activeKeyboard,

    activeWifi,

    bundleCandidates,

    desktopCandidates,

    newMonitorCandidates,

    refurbishedMonitorCandidates,

    aioCandidates,

    blockedDesktopProducts,
  };
}