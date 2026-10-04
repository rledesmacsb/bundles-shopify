import type {
  BundleTemplate,
  MetafieldReference,
} from "./bundle-templates";

import type {
  TemplateCatalogProduct,
} from "./bundle-rule-engine";

import {
  filterProductsByRule,
  getTemplateMetafieldValues,
  normalizeRuleText,
  productMatchesRule,
  validateBundleTemplate,
} from "./bundle-rule-engine";

import type {
  BundlePriceConfig,
  BundleCandidate as LegacyBundleCandidate,
  PcMonitorBundleConfig,
  ProductNode as LegacyProductNode,
} from "./bundle-engine";

import {
  calculateBundlePrice,
  cleanMonitorTitle,
  cleanPcTitle,
} from "./bundle-engine";

/* =========================================================
   TYPES
========================================================= */

export type TemplateBundleIdentity = {
  title: string;

  sku: string;

  productType: string;

  vendor: string;

  initialStatus:
    "DRAFT";

  templateId: string;
};

export type TemplateBundleCandidate = {
  id: string;

  templateId: string;

  templateName: string;

  template:
    BundleTemplate;

  baseProduct:
    TemplateCatalogProduct;

  monitor:
    TemplateCatalogProduct;

  keyboardMouse:
    TemplateCatalogProduct;

  wifiAdapter:
    | TemplateCatalogProduct
    | null;

  commonVideoPorts:
    string[];

  identity:
    TemplateBundleIdentity;
};

export type TemplateExecutionSummary = {
  templateId: string;

  templateName: string;

  enabled: boolean;

  baseProductsCount: number;

  monitorProductsCount: number;

  candidatesCount: number;

  issues: string[];
};

export type TemplateMonitorOverlap = {
  product:
    TemplateCatalogProduct;

  templateIds:
    string[];

  templateNames:
    string[];
};

export type TemplateBundleState = {
  candidates:
    TemplateBundleCandidate[];

  summaries:
    TemplateExecutionSummary[];

  eligibleBaseProducts:
    TemplateCatalogProduct[];

  manuallyExcludedProducts:
    TemplateCatalogProduct[];

  automaticallyExcludedProducts:
    TemplateCatalogProduct[];

  multiVariantBaseProducts:
    TemplateCatalogProduct[];

  overlappingMonitorProducts:
    TemplateMonitorOverlap[];

  issues:
    string[];
};

/* =========================================================
   PRODUCT HELPERS
========================================================= */

export function getFirstTemplateVariant(
  product:
    | TemplateCatalogProduct
    | null
    | undefined,
) {
  return product
    ?.variants
    .nodes?.[0];
}

export function getTemplateProductPrice(
  product:
    | TemplateCatalogProduct
    | null
    | undefined,
) {
  const price =
    Number(
      getFirstTemplateVariant(
        product,
      )?.price ??
        0,
    );

  return Number.isFinite(
    price,
  )
    ? price
    : 0;
}

function hasSingleVariant(
  product:
    TemplateCatalogProduct,
) {
  return (
    product
      .variants
      .nodes
      .length ===
    1
  );
}

function hasMultipleVariants(
  product:
    TemplateCatalogProduct,
) {
  return (
    product
      .variants
      .nodes
      .length >
    1
  );
}

/* =========================================================
   AUTOMATIC SAFETY EXCLUSION
========================================================= */

function isCustomBuildProduct(
  product:
    TemplateCatalogProduct,
) {
  const title =
    normalizeRuleText(
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

/* =========================================================
   UNIQUE PRODUCTS
========================================================= */

function uniqueProducts(
  products:
    TemplateCatalogProduct[],
) {
  return Array.from(
    new Map(
      products.map(
        (product) => [
          product.id,
          product,
        ],
      ),
    ).values(),
  );
}

/* =========================================================
   AUTHORIZED COMPONENTS
========================================================= */

function filterAuthorizedProducts(
  products:
    TemplateCatalogProduct[],

  authorizedIds:
    string[],
) {
  const authorized =
    new Set(
      authorizedIds,
    );

  return products.filter(
    (product) =>
      authorized.has(
        product.id,
      ),
  );
}

function sortComponentFallback(
  products:
    TemplateCatalogProduct[],
) {
  return [
    ...products,
  ].sort(
    (
      a,
      b,
    ) => {
      const stockDifference =
        b.totalInventory -
        a.totalInventory;

      if (
        stockDifference !==
        0
      ) {
        return stockDifference;
      }

      return (
        getTemplateProductPrice(
          a,
        ) -
        getTemplateProductPrice(
          b,
        )
      );
    },
  );
}

function choosePrincipalProduct(
  products:
    TemplateCatalogProduct[],

  primaryId:
    | string
    | null,
) {
  if (
    products.length ===
    0
  ) {
    return null;
  }

  if (
    primaryId
  ) {
    const primary =
      products.find(
        (product) =>
          product.id ===
          primaryId,
      );

    if (
      primary
    ) {
      return primary;
    }
  }

  return (
    sortComponentFallback(
      products,
    )[0] ??
    null
  );
}

/* =========================================================
   METAFIELD VALUES
========================================================= */

function getTechnicalValues(
  product:
    TemplateCatalogProduct,

  reference:
    MetafieldReference | null,
) {
  if (
    !reference
  ) {
    return [];
  }

  return getTemplateMetafieldValues(
    product,
    reference,
  );
}

/* =========================================================
   PORTS
========================================================= */

function normalizePort(
  value:
    string,
) {
  return normalizeRuleText(
    value,
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

export function getTemplateCommonVideoPorts(
  pc:
    TemplateCatalogProduct,

  monitor:
    TemplateCatalogProduct,

  template:
    BundleTemplate,
) {
  if (
    !template.videoOutputField ||
    !template.videoInputField
  ) {
    return [];
  }

  const outputs =
    getTechnicalValues(
      pc,
      template.videoOutputField,
    );

  const inputs =
    getTechnicalValues(
      monitor,
      template.videoInputField,
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

function isVideoCompatible(
  pc:
    TemplateCatalogProduct,

  monitor:
    TemplateCatalogProduct,

  template:
    BundleTemplate,
) {
  if (
    !template.videoOutputField ||
    !template.videoInputField
  ) {
    return true;
  }

  return (
    getTemplateCommonVideoPorts(
      pc,
      monitor,
      template,
    ).length >
    0
  );
}

/* =========================================================
   TECHNICAL READINESS
========================================================= */

function isBaseTechnicallyReady(
  product:
    TemplateCatalogProduct,

  template:
    BundleTemplate,
) {
  if (
    template.wifiField
  ) {
    const wifi =
      getTechnicalValues(
        product,
        template.wifiField,
      );

    if (
      wifi.length ===
      0
    ) {
      return false;
    }
  }

  if (
    template.videoOutputField
  ) {
    const outputs =
      getTechnicalValues(
        product,
        template.videoOutputField,
      );

    if (
      outputs.length ===
      0
    ) {
      return false;
    }
  }

  return true;
}

function isMonitorTechnicallyReady(
  product:
    TemplateCatalogProduct,

  template:
    BundleTemplate,
) {
  if (
    !template.videoInputField
  ) {
    return true;
  }

  return (
    getTechnicalValues(
      product,
      template.videoInputField,
    ).length >
    0
  );
}

/* =========================================================
   WI-FI
========================================================= */

function baseRequiresWifiAdapter(
  product:
    TemplateCatalogProduct,

  template:
    BundleTemplate,
) {
  if (
    !template.wifiField
  ) {
    return false;
  }

  const values =
    getTechnicalValues(
      product,
      template.wifiField,
    );

  const noValue =
    normalizeRuleText(
      template.wifiNoValue,
    );

  return values.some(
    (value) =>
      normalizeRuleText(
        value,
      ) ===
      noValue,
  );
}

/* =========================================================
   MONITOR OVERLAP DETECTION

   A monitor that satisfies multiple active monitor rules is
   ambiguous.

   We fail closed:
   it is not used by any conflicting template until the
   merchant fixes the rules.
========================================================= */

function detectMonitorOverlaps(
  products:
    TemplateCatalogProduct[],

  templates:
    BundleTemplate[],

  authorizedMonitorIds:
    string[],
): TemplateMonitorOverlap[] {
  const authorizedIds =
    new Set(
      authorizedMonitorIds,
    );

  const activeTemplates =
    templates.filter(
      (template) =>
        template.enabled,
    );

  const authorizedProducts =
    products.filter(
      (product) =>
        authorizedIds.has(
          product.id,
        ),
    );

  const overlaps:
    TemplateMonitorOverlap[] =
    [];

  for (
    const product
    of authorizedProducts
  ) {
    const matchingTemplates =
      activeTemplates.filter(
        (template) =>
          productMatchesRule(
            product,
            template.monitorRule,
          ),
      );

    if (
      matchingTemplates.length <=
      1
    ) {
      continue;
    }

    overlaps.push({
      product,

      templateIds:
        matchingTemplates.map(
          (template) =>
            template.id,
        ),

      templateNames:
        matchingTemplates.map(
          (template) =>
            template.name,
        ),
    });
  }

  return overlaps;
}

function getOverlapIssues(
  overlaps:
    TemplateMonitorOverlap[],
) {
  const issues:
    string[] =
    [];

  const visible =
    overlaps.slice(
      0,
      8,
    );

  for (
    const overlap
    of visible
  ) {
    issues.push(
      `Conflicto de plantillas: "${overlap.product.title}" cumple simultáneamente las reglas de ${overlap.templateNames
        .map(
          (name) =>
            `"${name}"`,
        )
        .join(
          " y ",
        )}. El monitor fue excluido temporalmente de esas propuestas.`,
    );
  }

  if (
    overlaps.length >
    visible.length
  ) {
    issues.push(
      `Existen ${
        overlaps.length -
        visible.length
      } monitores adicionales con reglas superpuestas.`,
    );
  }

  return issues;
}

/* =========================================================
   MONITOR SELECTION
========================================================= */

function chooseCheapestCompatibleMonitor(
  pc:
    TemplateCatalogProduct,

  monitors:
    TemplateCatalogProduct[],

  template:
    BundleTemplate,
) {
  const compatible =
    monitors
      .filter(
        (monitor) =>
          isVideoCompatible(
            pc,
            monitor,
            template,
          ),
      )
      .sort(
        (
          a,
          b,
        ) => {
          const priceDifference =
            getTemplateProductPrice(
              a,
            ) -
            getTemplateProductPrice(
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
   IDENTITY
========================================================= */

function appendSuffix(
  value:
    string,

  suffix:
    string,
) {
  const cleanSuffix =
    suffix.trim();

  if (
    !cleanSuffix
  ) {
    return value.trim();
  }

  if (
    normalizeRuleText(
      value,
    ).endsWith(
      normalizeRuleText(
        cleanSuffix,
      ),
    )
  ) {
    return value.trim();
  }

  return `${value.trim()} ${cleanSuffix}`;
}

export function getTemplateBundleIdentity(
  template:
    BundleTemplate,

  baseProduct:
    TemplateCatalogProduct,

  monitor:
    TemplateCatalogProduct,
): TemplateBundleIdentity {
  const cleanBase =
    cleanPcTitle(
      baseProduct.title,
    );

  const cleanMonitor =
    appendSuffix(
      cleanMonitorTitle(
        monitor.title,
      ),

      template.monitorSuffix,
    );

  const prefix =
    template.titlePrefix
      .trim() ||
    "Combo";

  const baseSku =
    getFirstTemplateVariant(
      baseProduct,
    )?.sku?.trim();

  return {
    title:
      `${prefix} ${cleanBase} + Monitor ${cleanMonitor}`
        .replace(
          /\s+/g,
          " ",
        )
        .trim(),

    sku:
      baseSku
        ? `${template.skuPrefix}${baseSku}`
        : "SKU pendiente",

    productType:
      template.generatedProductType,

    vendor:
      template.vendor,

    initialStatus:
      "DRAFT",

    templateId:
      template.id,
  };
}

/* =========================================================
   PRICE ADAPTER
========================================================= */

function toLegacyProduct(
  product:
    TemplateCatalogProduct,
): LegacyProductNode {
  return {
    id:
      product.id,

    title:
      product.title,

    status:
      product.status,

    productType:
      product.productType,

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

    wifiMeta:
      null,

    videoOutputMeta:
      null,

    videoInputMeta:
      null,
  };
}

export function calculateTemplateCandidatePrice(
  candidate:
    TemplateBundleCandidate,

  priceConfig:
    BundlePriceConfig,
) {
  const legacyCandidate:
    LegacyBundleCandidate = {
      id:
        candidate.id,

      type:
        "desktop",

      /*
       * Only required by the legacy pricing type.
       * Pricing itself doesn't use this field.
       */
      template:
        "pc_monitor_new",

      baseProduct:
        toLegacyProduct(
          candidate.baseProduct,
        ),

      monitor:
        toLegacyProduct(
          candidate.monitor,
        ),

      keyboardMouse:
        toLegacyProduct(
          candidate.keyboardMouse,
        ),

      wifiAdapter:
        candidate.wifiAdapter
          ? toLegacyProduct(
              candidate.wifiAdapter,
            )
          : null,

      commonVideoPorts:
        candidate.commonVideoPorts,
    };

  return calculateBundlePrice(
    legacyCandidate,
    priceConfig,
  );
}

/* =========================================================
   STOCK
========================================================= */

export function getTemplateCandidateStock(
  candidate:
    TemplateBundleCandidate,
) {
  const stocks = [
    candidate
      .baseProduct
      .totalInventory,

    candidate
      .monitor
      .totalInventory,

    candidate
      .keyboardMouse
      .totalInventory,
  ];

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

/* =========================================================
   BUILD STATE
========================================================= */

export function buildTemplateBundleState(
  products:
    TemplateCatalogProduct[],

  templates:
    BundleTemplate[],

  componentConfig:
    PcMonitorBundleConfig,
): TemplateBundleState {
  const candidates:
    TemplateBundleCandidate[] =
    [];

  const summaries:
    TemplateExecutionSummary[] =
    [];

  const issues:
    string[] =
    [];

  const allEligibleBases:
    TemplateCatalogProduct[] =
    [];

  const allManualExcluded:
    TemplateCatalogProduct[] =
    [];

  const allAutomaticExcluded:
    TemplateCatalogProduct[] =
    [];

  const allMultiVariant:
    TemplateCatalogProduct[] =
    [];

  const manualExclusionIds =
    new Set(
      componentConfig.excludedProductIds ??
      [],
    );

  /* -------------------------------------------------------
     MONITOR RULE OVERLAPS
  ------------------------------------------------------- */

  const overlappingMonitorProducts =
    detectMonitorOverlaps(
      products,
      templates,
      componentConfig.selectedMonitorIds,
    );

  const overlappingMonitorIds =
    new Set(
      overlappingMonitorProducts.map(
        (overlap) =>
          overlap.product.id,
      ),
    );

  issues.push(
    ...getOverlapIssues(
      overlappingMonitorProducts,
    ),
  );

  /* -------------------------------------------------------
     EACH TEMPLATE
  ------------------------------------------------------- */

  for (
    const template
    of templates
  ) {
    if (
      !template.enabled
    ) {
      summaries.push({
        templateId:
          template.id,

        templateName:
          template.name,

        enabled:
          false,

        baseProductsCount:
          0,

        monitorProductsCount:
          0,

        candidatesCount:
          0,

        issues:
          [],
      });

      continue;
    }

    const templateIssues =
      validateBundleTemplate(
        template,
      );

    if (
      template.wifiField &&
      !template.wifiNoValue.trim()
    ) {
      templateIssues.push(
        "El valor que representa 'sin Wi-Fi' está vacío.",
      );
    }

    if (
      templateIssues.length >
      0
    ) {
      issues.push(
        ...templateIssues.map(
          (issue) =>
            `${template.name}: ${issue}`,
        ),
      );

      summaries.push({
        templateId:
          template.id,

        templateName:
          template.name,

        enabled:
          true,

        baseProductsCount:
          0,

        monitorProductsCount:
          0,

        candidatesCount:
          0,

        issues:
          templateIssues,
      });

      continue;
    }

    /* -----------------------------------------------------
       BASE PRODUCTS
    ----------------------------------------------------- */

    const rawBaseProducts =
      filterProductsByRule(
        products,
        template.baseProductRule,
      );

    const automaticExcluded =
      rawBaseProducts.filter(
        isCustomBuildProduct,
      );

    const manualExcluded =
      rawBaseProducts.filter(
        (product) =>
          !isCustomBuildProduct(
            product,
          ) &&
          manualExclusionIds.has(
            product.id,
          ),
      );

    const multiVariant =
      rawBaseProducts.filter(
        (product) =>
          !isCustomBuildProduct(
            product,
          ) &&
          !manualExclusionIds.has(
            product.id,
          ) &&
          hasMultipleVariants(
            product,
          ),
      );

    const baseProducts =
      rawBaseProducts.filter(
        (product) =>
          !isCustomBuildProduct(
            product,
          ) &&
          !manualExclusionIds.has(
            product.id,
          ) &&
          hasSingleVariant(
            product,
          ) &&
          isBaseTechnicallyReady(
            product,
            template,
          ),
      );

    allEligibleBases.push(
      ...baseProducts,
    );

    allManualExcluded.push(
      ...manualExcluded,
    );

    allAutomaticExcluded.push(
      ...automaticExcluded,
    );

    allMultiVariant.push(
      ...multiVariant,
    );

    /* -----------------------------------------------------
       MONITORS

       Ambiguous monitors are removed before selection.
    ----------------------------------------------------- */

    const monitorsByRule =
      filterProductsByRule(
        products,
        template.monitorRule,
      )
        .filter(
          hasSingleVariant,
        )
        .filter(
          (product) =>
            !overlappingMonitorIds.has(
              product.id,
            ),
        )
        .filter(
          (product) =>
            isMonitorTechnicallyReady(
              product,
              template,
            ),
        );

    const monitors =
      filterAuthorizedProducts(
        monitorsByRule,
        componentConfig.selectedMonitorIds,
      );

    /* -----------------------------------------------------
       KEYBOARD + MOUSE
    ----------------------------------------------------- */

    const keyboardsByRule =
      filterProductsByRule(
        products,
        template.keyboardMouseRule,
      )
        .filter(
          hasSingleVariant,
        );

    const keyboards =
      filterAuthorizedProducts(
        keyboardsByRule,
        componentConfig.selectedKeyboardMouseIds,
      );

    const activeKeyboard =
      choosePrincipalProduct(
        keyboards,
        componentConfig.primaryKeyboardMouseId,
      );

    /* -----------------------------------------------------
       WI-FI
    ----------------------------------------------------- */

    const wifiByRule =
      filterProductsByRule(
        products,
        template.wifiAdapterRule,
      )
        .filter(
          hasSingleVariant,
        );

    const wifiAdapters =
      filterAuthorizedProducts(
        wifiByRule,
        componentConfig.selectedWifiAdapterIds,
      );

    const activeWifi =
      choosePrincipalProduct(
        wifiAdapters,
        componentConfig.primaryWifiAdapterId,
      );

    const candidateCountBefore =
      candidates.length;

    if (
      !activeKeyboard
    ) {
      templateIssues.push(
        "No existe un teclado/mouse autorizado que cumpla las reglas de esta plantilla.",
      );
    } else if (
      monitors.length ===
      0
    ) {
      templateIssues.push(
        "No existe ningún monitor autorizado y sin conflictos que cumpla las reglas de esta plantilla.",
      );
    } else {
      for (
        const baseProduct
        of baseProducts
      ) {
        const requiresWifi =
          baseRequiresWifiAdapter(
            baseProduct,
            template,
          );

        if (
          requiresWifi &&
          !activeWifi
        ) {
          continue;
        }

        const monitor =
          chooseCheapestCompatibleMonitor(
            baseProduct,
            monitors,
            template,
          );

        if (
          !monitor
        ) {
          continue;
        }

        const identity =
          getTemplateBundleIdentity(
            template,
            baseProduct,
            monitor,
          );

        candidates.push({
          id:
            `${template.id}|${baseProduct.id}|${monitor.id}`,

          templateId:
            template.id,

          templateName:
            template.name,

          template,

          baseProduct,

          monitor,

          keyboardMouse:
            activeKeyboard,

          wifiAdapter:
            requiresWifi
              ? activeWifi
              : null,

          commonVideoPorts:
            getTemplateCommonVideoPorts(
              baseProduct,
              monitor,
              template,
            ),

          identity,
        });
      }
    }

    const generatedCount =
      candidates.length -
      candidateCountBefore;

    summaries.push({
      templateId:
        template.id,

      templateName:
        template.name,

      enabled:
        true,

      baseProductsCount:
        baseProducts.length,

      monitorProductsCount:
        monitors.length,

      candidatesCount:
        generatedCount,

      issues:
        templateIssues,
    });

    issues.push(
      ...templateIssues.map(
        (issue) =>
          `${template.name}: ${issue}`,
      ),
    );
  }

  /* =======================================================
     SORT
  ======================================================= */

  candidates.sort(
    (
      a,
      b,
    ) => {
      const priceDifference =
        getTemplateProductPrice(
          a.baseProduct,
        ) -
        getTemplateProductPrice(
          b.baseProduct,
        );

      if (
        priceDifference !==
        0
      ) {
        return priceDifference;
      }

      return a.identity.title.localeCompare(
        b.identity.title,
        "es",
      );
    },
  );

  return {
    candidates,

    summaries,

    eligibleBaseProducts:
      uniqueProducts(
        allEligibleBases,
      ),

    manuallyExcludedProducts:
      uniqueProducts(
        allManualExcluded,
      ),

    automaticallyExcludedProducts:
      uniqueProducts(
        allAutomaticExcluded,
      ),

    multiVariantBaseProducts:
      uniqueProducts(
        allMultiVariant,
      ),

    overlappingMonitorProducts,

    issues:
      Array.from(
        new Set(
          issues,
        ),
      ),
  };
}