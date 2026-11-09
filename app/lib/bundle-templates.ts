/* =========================================================
   GENERIC BUNDLE TEMPLATE TYPES
========================================================= */

export type BundleTemplateKind =
  | "pc_monitor";

export type MetafieldReference = {
  namespace: string;
  key: string;
};

/* =========================================================
   RULE ENGINE
========================================================= */

export type RuleMatchMode =
  | "all"
  | "any";

export type RuleConditionSource =
  | "product_type"
  | "metafield"
  | "sku"
  | "title"
  | "vendor"
  | "status"
  | "stock"
  | "tag";

export type RuleConditionOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "exists"
  | "not_exists"
  | "greater_than"
  | "greater_or_equal"
  | "less_than"
  | "less_or_equal";

export type RuleCondition = {
  id: string;

  source:
    RuleConditionSource;

  operator:
    RuleConditionOperator;

  value: string;

  metafield:
    MetafieldReference | null;
};

export type ProductRuleGroup = {
  match:
    RuleMatchMode;

  conditions:
    RuleCondition[];
};

/* =========================================================
   LEGACY FORMAT

   Only used to migrate the first version of Templates.
========================================================= */

type LegacyProductRule = {
  mode?:
    | "product_type"
    | "metafield";

  productType?:
    string;

  metafield?:
    MetafieldReference | null;

  value?:
    string;
};

/* =========================================================
   TEMPLATE
========================================================= */

export type CompatibilityOperator =
  | "intersection";

export type PcMonitorBundleTemplate = {
  id: string;

  name: string;

  enabled: boolean;

  kind:
    "pc_monitor";

  /* =======================================================
     COMPONENT RULES
  ======================================================= */

  baseProductRule:
    ProductRuleGroup;

  monitorRule:
    ProductRuleGroup;

  keyboardMouseRule:
    ProductRuleGroup;

  wifiAdapterRule:
    ProductRuleGroup;

  /* =======================================================
     TECHNICAL COMPATIBILITY
  ======================================================= */

  wifiField:
    MetafieldReference | null;

  wifiNoValue:
    string;

  videoOutputField:
    MetafieldReference | null;

  videoInputField:
    MetafieldReference | null;

  compatibilityOperator:
    CompatibilityOperator;

  /* =======================================================
     GENERATED PRODUCT
  ======================================================= */

  titlePrefix:
    string;

  monitorSuffix:
    string;

  skuPrefix:
    string;

  generatedProductType:
    string;

  vendor:
    string;

  initialStatus:
    "DRAFT";
};

export type BundleTemplate =
  PcMonitorBundleTemplate;

/* =========================================================
   SHOPIFY OPTIONS
========================================================= */

export type ShopifyMetafieldDefinitionOption = {
  id: string;

  name: string;

  namespace: string;

  key: string;

  type: string;
};

/* =========================================================
   VALID VALUES
========================================================= */

const CONDITION_SOURCES:
  RuleConditionSource[] = [
    "product_type",
    "metafield",
    "sku",
    "title",
    "vendor",
    "status",
    "stock",
    "tag",
  ];

const CONDITION_OPERATORS:
  RuleConditionOperator[] = [
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "starts_with",
    "exists",
    "not_exists",
    "greater_than",
    "greater_or_equal",
    "less_than",
    "less_or_equal",
  ];

/* =========================================================
   DEFAULT CONDITIONS
========================================================= */

function productTypeCondition(
  id: string,
  productType: string,
): RuleCondition {
  return {
    id,

    source:
      "product_type",

    operator:
      "equals",

    value:
      productType,

    metafield:
      null,
  };
}

function productTypeRule(
  id: string,
  productType: string,
): ProductRuleGroup {
  return {
    match:
      "all",

    conditions: [
      productTypeCondition(
        id,
        productType,
      ),
    ],
  };
}

/* =========================================================
   DEFAULT TEMPLATES
========================================================= */

export const DEFAULT_BUNDLE_TEMPLATES:
  BundleTemplate[] = [
    {
      id:
        "pc_monitor_new",

      name:
        "PC + Monitor nuevo",

      enabled:
        true,

      kind:
        "pc_monitor",

      baseProductRule:
        productTypeRule(
          "pc-new-base-type",
          "PC de Escritorio",
        ),

      monitorRule: {
        match:
          "all",

        conditions: [
          productTypeCondition(
            "pc-new-monitor-type",
            "Monitor",
          ),

          {
            id:
              "pc-new-monitor-condition",

            source:
              "title",

            operator:
              "contains",

            value:
              "Nuevo",

            metafield:
              null,
          },
        ],
      },

      keyboardMouseRule:
        productTypeRule(
          "pc-new-keyboard-type",
          "Combo Teclado y Mouse",
        ),

      wifiAdapterRule:
        productTypeRule(
          "pc-new-wifi-type",
          "Adaptador WiFi",
        ),

      wifiField: {
        namespace:
          "custom",

        key:
          "wi_fi_integrado",
      },

      wifiNoValue:
        "No",

      videoOutputField: {
        namespace:
          "custom",

        key:
          "salidas_de_video",
      },

      videoInputField: {
        namespace:
          "custom",

        key:
          "entradas_de_video",
      },

      compatibilityOperator:
        "intersection",

      titlePrefix:
        "Combo PC",

      monitorSuffix:
        "",

      skuPrefix:
        "BND-",

      generatedProductType:
        "Combo PC y Monitor",

      vendor:
        "CSBYTE",

      initialStatus:
        "DRAFT",
    },

    {
      id:
        "pc_monitor_refurbished",

      name:
        "Combo Reacondicionado",

      enabled:
        true,

      kind:
        "pc_monitor",

      baseProductRule:
        productTypeRule(
          "pc-ref-base-type",
          "PC de Escritorio",
        ),

      monitorRule: {
        match:
          "all",

        conditions: [
          productTypeCondition(
            "pc-ref-monitor-type",
            "Monitor",
          ),

          {
            id:
              "pc-ref-monitor-condition",

            source:
              "title",

            operator:
              "contains",

            value:
              "Reacondicionado",

            metafield:
              null,
          },
        ],
      },

      keyboardMouseRule:
        productTypeRule(
          "pc-ref-keyboard-type",
          "Combo Teclado y Mouse",
        ),

      wifiAdapterRule:
        productTypeRule(
          "pc-ref-wifi-type",
          "Adaptador WiFi",
        ),

      wifiField: {
        namespace:
          "custom",

        key:
          "wi_fi_integrado",
      },

      wifiNoValue:
        "No",

      videoOutputField: {
        namespace:
          "custom",

        key:
          "salidas_de_video",
      },

      videoInputField: {
        namespace:
          "custom",

        key:
          "entradas_de_video",
      },

      compatibilityOperator:
        "intersection",

      titlePrefix:
        "Combo Reacondicionado",

      monitorSuffix:
        "",

      skuPrefix:
        "BND-R-",

      generatedProductType:
        "Combo PC y Monitor",

      vendor:
        "CSBYTE",

      initialStatus:
        "DRAFT",
    },
  ];

/* =========================================================
   CLONE HELPERS
========================================================= */

function cloneMetafieldReference(
  value:
    MetafieldReference | null,
):
  | MetafieldReference
  | null {
  if (
    !value
  ) {
    return null;
  }

  return {
    namespace:
      value.namespace,

    key:
      value.key,
  };
}

function cloneCondition(
  condition:
    RuleCondition,
): RuleCondition {
  return {
    id:
      condition.id,

    source:
      condition.source,

    operator:
      condition.operator,

    value:
      condition.value,

    metafield:
      cloneMetafieldReference(
        condition.metafield,
      ),
  };
}

function cloneRuleGroup(
  group:
    ProductRuleGroup,
): ProductRuleGroup {
  return {
    match:
      group.match,

    conditions:
      group.conditions.map(
        cloneCondition,
      ),
  };
}

function cloneTemplate(
  template:
    BundleTemplate,
): BundleTemplate {
  return {
    ...template,

    baseProductRule:
      cloneRuleGroup(
        template.baseProductRule,
      ),

    monitorRule:
      cloneRuleGroup(
        template.monitorRule,
      ),

    keyboardMouseRule:
      cloneRuleGroup(
        template.keyboardMouseRule,
      ),

    wifiAdapterRule:
      cloneRuleGroup(
        template.wifiAdapterRule,
      ),

    wifiField:
      cloneMetafieldReference(
        template.wifiField,
      ),

    videoOutputField:
      cloneMetafieldReference(
        template.videoOutputField,
      ),

    videoInputField:
      cloneMetafieldReference(
        template.videoInputField,
      ),
  };
}

export function getDefaultBundleTemplates() {
  return DEFAULT_BUNDLE_TEMPLATES.map(
    cloneTemplate,
  );
}

/* =========================================================
   BASIC SANITIZERS
========================================================= */

function asString(
  value: unknown,
  fallback: string,
) {
  return typeof value ===
    "string"
    ? value
    : fallback;
}

function asBoolean(
  value: unknown,
  fallback: boolean,
) {
  return typeof value ===
    "boolean"
    ? value
    : fallback;
}

function sanitizeMetafieldReference(
  value: unknown,

  fallback:
    MetafieldReference | null,
):
  | MetafieldReference
  | null {
  if (
    value ===
    null
  ) {
    return null;
  }

  if (
    typeof value !==
      "object" ||
    !value
  ) {
    return cloneMetafieldReference(
      fallback,
    );
  }

  const object =
    value as Record<
      string,
      unknown
    >;

  const namespace =
    asString(
      object.namespace,
      "",
    ).trim();

  const key =
    asString(
      object.key,
      "",
    ).trim();

  if (
    !namespace ||
    !key
  ) {
    return cloneMetafieldReference(
      fallback,
    );
  }

  return {
    namespace,
    key,
  };
}

/* =========================================================
   CONDITION SANITIZER
========================================================= */

function sanitizeCondition(
  value: unknown,

  fallback:
    RuleCondition,

  index:
    number,
): RuleCondition {
  if (
    typeof value !==
      "object" ||
    !value
  ) {
    return cloneCondition(
      fallback,
    );
  }

  const object =
    value as Record<
      string,
      unknown
    >;

  const rawSource =
    object.source;

  const source:
    RuleConditionSource =
    typeof rawSource ===
      "string" &&
    CONDITION_SOURCES.includes(
      rawSource as RuleConditionSource,
    )
      ? (
          rawSource as RuleConditionSource
        )
      : fallback.source;

  const rawOperator =
    object.operator;

  const operator:
    RuleConditionOperator =
    typeof rawOperator ===
      "string" &&
    CONDITION_OPERATORS.includes(
      rawOperator as RuleConditionOperator,
    )
      ? (
          rawOperator as RuleConditionOperator
        )
      : fallback.operator;

  return {
    id:
      asString(
        object.id,
        `${fallback.id}-${index}`,
      ),

    source,

    operator,

    value:
      asString(
        object.value,
        fallback.value,
      ),

    metafield:
      sanitizeMetafieldReference(
        object.metafield,
        fallback.metafield,
      ),
  };
}

/* =========================================================
   LEGACY MIGRATION

   Converts:

   {
     mode: "product_type",
     productType: "Monitor"
   }

   into:

   {
     match: "all",
     conditions: [...]
   }
========================================================= */

function migrateLegacyRule(
  value:
    LegacyProductRule,

  fallback:
    ProductRuleGroup,
): ProductRuleGroup {
  if (
    value.mode ===
    "metafield"
  ) {
    return {
      match:
        "all",

      conditions: [
        {
          id:
            `${fallback.conditions[0].id}-migrated`,

          source:
            "metafield",

          operator:
            "equals",

          value:
            value.value ??
            "",

          metafield:
            sanitizeMetafieldReference(
              value.metafield,
              null,
            ),
        },
      ],
    };
  }

  return {
    match:
      "all",

    conditions: [
      {
        id:
          `${fallback.conditions[0].id}-migrated`,

        source:
          "product_type",

        operator:
          "equals",

        value:
          value.productType ??
          fallback
            .conditions[0]
            .value,

        metafield:
          null,
      },
    ],
  };
}

/* =========================================================
   RULE GROUP SANITIZER
========================================================= */

function sanitizeRuleGroup(
  value: unknown,

  fallback:
    ProductRuleGroup,
): ProductRuleGroup {
  if (
    typeof value !==
      "object" ||
    !value
  ) {
    return cloneRuleGroup(
      fallback,
    );
  }

  const object =
    value as Record<
      string,
      unknown
    >;

  /*
   * Old version detected.
   */
  if (
    "mode" in object ||
    "productType" in object
  ) {
    return migrateLegacyRule(
      object as LegacyProductRule,
      fallback,
    );
  }

  const match:
    RuleMatchMode =
    object.match ===
    "any"
      ? "any"
      : "all";

  const rawConditions =
    Array.isArray(
      object.conditions,
    )
      ? object.conditions
      : [];

  if (
    rawConditions.length ===
    0
  ) {
    return {
      match,

      conditions:
        fallback
          .conditions
          .map(
            cloneCondition,
          ),
    };
  }

  const conditions =
    rawConditions.map(
      (
        condition,
        index,
      ) => {
        const fallbackCondition =
          fallback
            .conditions[
              Math.min(
                index,
                fallback
                  .conditions
                  .length -
                  1,
              )
            ] ??
          fallback
            .conditions[0];

        return sanitizeCondition(
          condition,
          fallbackCondition,
          index,
        );
      },
    );

  return {
    match,
    conditions,
  };
}

/* =========================================================
   TEMPLATE SANITIZER
========================================================= */

function sanitizeTemplate(
  value: unknown,

  fallback:
    BundleTemplate,
): BundleTemplate {
  if (
    typeof value !==
      "object" ||
    !value
  ) {
    return cloneTemplate(
      fallback,
    );
  }

  const object =
    value as Record<
      string,
      unknown
    >;

  return {
    id:
      asString(
        object.id,
        fallback.id,
      ),

    name:
      asString(
        object.name,
        fallback.name,
      ),

    enabled:
      asBoolean(
        object.enabled,
        fallback.enabled,
      ),

    kind:
      "pc_monitor",

    baseProductRule:
      sanitizeRuleGroup(
        object.baseProductRule,
        fallback.baseProductRule,
      ),

    monitorRule:
      sanitizeRuleGroup(
        object.monitorRule,
        fallback.monitorRule,
      ),

    keyboardMouseRule:
      sanitizeRuleGroup(
        object.keyboardMouseRule,
        fallback.keyboardMouseRule,
      ),

    wifiAdapterRule:
      sanitizeRuleGroup(
        object.wifiAdapterRule,
        fallback.wifiAdapterRule,
      ),

    wifiField:
      sanitizeMetafieldReference(
        object.wifiField,
        fallback.wifiField,
      ),

    wifiNoValue:
      asString(
        object.wifiNoValue,
        fallback.wifiNoValue,
      ),

    videoOutputField:
      sanitizeMetafieldReference(
        object.videoOutputField,
        fallback.videoOutputField,
      ),

    videoInputField:
      sanitizeMetafieldReference(
        object.videoInputField,
        fallback.videoInputField,
      ),

    compatibilityOperator:
      "intersection",

    titlePrefix:
      asString(
        object.titlePrefix,
        fallback.titlePrefix,
      ),

    monitorSuffix:
      asString(
        object.monitorSuffix,
        fallback.monitorSuffix,
      ),

    skuPrefix:
      asString(
        object.skuPrefix,
        fallback.skuPrefix,
      ),

    generatedProductType:
      asString(
        object.generatedProductType,
        fallback.generatedProductType,
      ),

    vendor:
      asString(
        object.vendor,
        fallback.vendor,
      ),

    initialStatus:
      "DRAFT",
  };
}

/* =========================================================
   TEMPLATE ARRAY SANITIZER
========================================================= */

export function sanitizeBundleTemplates(
  value:
    unknown,
): BundleTemplate[] {
  const defaults =
    getDefaultBundleTemplates();

  if (
    !Array.isArray(
      value,
    )
  ) {
    return defaults;
  }

  const result:
    BundleTemplate[] =
    [];

  for (
    const defaultTemplate
    of defaults
  ) {
    const stored =
      value.find(
        (item) => {
          if (
            typeof item !==
              "object" ||
            !item
          ) {
            return false;
          }

          return (
            (
              item as Record<
                string,
                unknown
              >
            ).id ===
            defaultTemplate.id
          );
        },
      );

    result.push(
      sanitizeTemplate(
        stored,
        defaultTemplate,
      ),
    );
  }

  return result;
}