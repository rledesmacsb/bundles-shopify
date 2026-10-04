import type {
  BundleTemplate,
  MetafieldReference,
  ProductRuleGroup,
  RuleCondition,
  RuleConditionOperator,
} from "./bundle-templates";

/* =========================================================
   RUNTIME PRODUCT TYPES
========================================================= */

export type TemplateCatalogMetafield = {
  namespace: string;
  key: string;
  type: string;
  value: string;
};

export type TemplateCatalogVariant = {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  inventoryQuantity: number | null;
};

export type TemplateCatalogProduct = {
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
        altText: string | null;
      }
    | null;

  variants: {
    nodes: TemplateCatalogVariant[];
  };

  /*
   * Only metafields referenced by active templates
   * are loaded here.
   */
  templateMetafields: TemplateCatalogMetafield[];
};

/* =========================================================
   RESULT TYPES
========================================================= */

export type RuleEvaluation = {
  matches: boolean;

  conditions: Array<{
    conditionId: string;
    matches: boolean;
  }>;
};

export type RuleValidationIssue = {
  conditionId: string | null;

  message: string;
};

/* =========================================================
   NORMALIZATION
========================================================= */

export function normalizeRuleText(
  value:
    | string
    | null
    | undefined,
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

function normalizeComparable(
  value:
    | string
    | null
    | undefined,
) {
  return normalizeRuleText(
    value,
  );
}

/* =========================================================
   METAFIELD HELPERS
========================================================= */

export function metafieldReferenceKey(
  reference:
    MetafieldReference,
) {
  return `${reference.namespace}.${reference.key}`;
}

export function getTemplateMetafield(
  product:
    TemplateCatalogProduct,

  reference:
    MetafieldReference | null,
) {
  if (
    !reference
  ) {
    return null;
  }

  return (
    product.templateMetafields.find(
      (metafield) =>
        metafield.namespace ===
          reference.namespace &&
        metafield.key ===
          reference.key,
    ) ??
    null
  );
}

export function getTemplateMetafieldValues(
  product:
    TemplateCatalogProduct,

  reference:
    MetafieldReference | null,
): string[] {
  const metafield =
    getTemplateMetafield(
      product,
      reference,
    );

  if (
    !metafield
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

  const value =
    metafield.value.trim();

  return value
    ? [value]
    : [];
}

/* =========================================================
   STRING OPERATORS
========================================================= */

function evaluateStringCollection(
  values:
    string[],

  operator:
    RuleConditionOperator,

  expected:
    string,
) {
  const normalizedValues =
    values
      .map(
        normalizeComparable,
      )
      .filter(
        Boolean,
      );

  const normalizedExpected =
    normalizeComparable(
      expected,
    );

  if (
    operator ===
    "exists"
  ) {
    return (
      normalizedValues.length >
      0
    );
  }

  if (
    operator ===
    "not_exists"
  ) {
    return (
      normalizedValues.length ===
      0
    );
  }

  if (
    !normalizedExpected
  ) {
    return false;
  }

  if (
    operator ===
    "equals"
  ) {
    return normalizedValues.some(
      (value) =>
        value ===
        normalizedExpected,
    );
  }

  if (
    operator ===
    "not_equals"
  ) {
    return normalizedValues.every(
      (value) =>
        value !==
        normalizedExpected,
    );
  }

  if (
    operator ===
    "contains"
  ) {
    return normalizedValues.some(
      (value) =>
        value.includes(
          normalizedExpected,
        ),
    );
  }

  if (
    operator ===
    "not_contains"
  ) {
    return normalizedValues.every(
      (value) =>
        !value.includes(
          normalizedExpected,
        ),
    );
  }

  if (
    operator ===
    "starts_with"
  ) {
    return normalizedValues.some(
      (value) =>
        value.startsWith(
          normalizedExpected,
        ),
    );
  }

  return false;
}

/* =========================================================
   NUMBER OPERATORS
========================================================= */

function evaluateNumber(
  actual:
    number,

  operator:
    RuleConditionOperator,

  expectedRaw:
    string,
) {
  const expected =
    Number(
      expectedRaw,
    );

  if (
    !Number.isFinite(
      expected,
    )
  ) {
    return false;
  }

  switch (
    operator
  ) {
    case "equals":
      return (
        actual ===
        expected
      );

    case "not_equals":
      return (
        actual !==
        expected
      );

    case "greater_than":
      return (
        actual >
        expected
      );

    case "greater_or_equal":
      return (
        actual >=
        expected
      );

    case "less_than":
      return (
        actual <
        expected
      );

    case "less_or_equal":
      return (
        actual <=
        expected
      );

    default:
      return false;
  }
}

/* =========================================================
   SKU
========================================================= */

function getProductSkus(
  product:
    TemplateCatalogProduct,
) {
  return product
    .variants
    .nodes
    .map(
      (variant) =>
        variant.sku ??
        "",
    )
    .filter(
      Boolean,
    );
}

/* =========================================================
   CONDITION EVALUATOR
========================================================= */

export function evaluateRuleCondition(
  product:
    TemplateCatalogProduct,

  condition:
    RuleCondition,
): boolean {
  switch (
    condition.source
  ) {
    /* -----------------------------------------------------
       PRODUCT TYPE
    ----------------------------------------------------- */

    case "product_type":
      return evaluateStringCollection(
        [
          product.productType,
        ],

        condition.operator,

        condition.value,
      );

    /* -----------------------------------------------------
       METAFIELD
    ----------------------------------------------------- */

    case "metafield": {
      const values =
        getTemplateMetafieldValues(
          product,
          condition.metafield,
        );

      return evaluateStringCollection(
        values,

        condition.operator,

        condition.value,
      );
    }

    /* -----------------------------------------------------
       SKU

       If a product has multiple variants:
       - equals/contains = at least one SKU matches
       - not_equals/not_contains = all SKUs must not match
    ----------------------------------------------------- */

    case "sku":
      return evaluateStringCollection(
        getProductSkus(
          product,
        ),

        condition.operator,

        condition.value,
      );

    /* -----------------------------------------------------
       TITLE
    ----------------------------------------------------- */

    case "title":
      return evaluateStringCollection(
        [
          product.title,
        ],

        condition.operator,

        condition.value,
      );

    /* -----------------------------------------------------
       VENDOR
    ----------------------------------------------------- */

    case "vendor":
      return evaluateStringCollection(
        [
          product.vendor,
        ],

        condition.operator,

        condition.value,
      );

    /* -----------------------------------------------------
       STATUS
    ----------------------------------------------------- */

    case "status":
      return evaluateStringCollection(
        [
          product.status,
        ],

        condition.operator,

        condition.value,
      );

    /* -----------------------------------------------------
       STOCK
    ----------------------------------------------------- */

    case "stock":
      return evaluateNumber(
        product.totalInventory,

        condition.operator,

        condition.value,
      );

    /* -----------------------------------------------------
       TAG
    ----------------------------------------------------- */

    case "tag":
      return evaluateStringCollection(
        product.tags,

        condition.operator,

        condition.value,
      );

    default:
      return false;
  }
}

/* =========================================================
   RULE GROUP EVALUATOR
========================================================= */

export function evaluateProductRuleGroup(
  product:
    TemplateCatalogProduct,

  rule:
    ProductRuleGroup,
): RuleEvaluation {
  if (
    rule.conditions.length ===
    0
  ) {
    return {
      matches:
        false,

      conditions:
        [],
    };
  }

  const conditions =
    rule.conditions.map(
      (condition) => ({
        conditionId:
          condition.id,

        matches:
          evaluateRuleCondition(
            product,
            condition,
          ),
      }),
    );

  const matches =
    rule.match ===
    "any"
      ? conditions.some(
          (condition) =>
            condition.matches,
        )
      : conditions.every(
          (condition) =>
            condition.matches,
        );

  return {
    matches,

    conditions,
  };
}

export function productMatchesRule(
  product:
    TemplateCatalogProduct,

  rule:
    ProductRuleGroup,
) {
  return evaluateProductRuleGroup(
    product,
    rule,
  ).matches;
}

export function filterProductsByRule(
  products:
    TemplateCatalogProduct[],

  rule:
    ProductRuleGroup,
) {
  return products.filter(
    (product) =>
      productMatchesRule(
        product,
        rule,
      ),
  );
}

/* =========================================================
   RULE VALIDATION
========================================================= */

export function validateProductRuleGroup(
  rule:
    ProductRuleGroup,
): RuleValidationIssue[] {
  const issues:
    RuleValidationIssue[] =
    [];

  if (
    rule.conditions.length ===
    0
  ) {
    issues.push({
      conditionId:
        null,

      message:
        "La regla no tiene condiciones.",
    });

    return issues;
  }

  for (
    const condition
    of rule.conditions
  ) {
    if (
      condition.source ===
        "metafield" &&
      (
        !condition.metafield ||
        !condition
          .metafield
          .namespace ||
        !condition
          .metafield
          .key
      )
    ) {
      issues.push({
        conditionId:
          condition.id,

        message:
          "La condición de metacampo no tiene un metacampo seleccionado.",
      });
    }

    if (
      condition.operator !==
        "exists" &&
      condition.operator !==
        "not_exists" &&
      !condition.value.trim()
    ) {
      issues.push({
        conditionId:
          condition.id,

        message:
          "La condición no tiene un valor configurado.",
      });
    }

    if (
      condition.source ===
        "stock" &&
      condition.value.trim() &&
      !Number.isFinite(
        Number(
          condition.value,
        ),
      )
    ) {
      issues.push({
        conditionId:
          condition.id,

        message:
          "La condición de stock debe contener un número válido.",
      });
    }
  }

  return issues;
}

/* =========================================================
   COLLECT DYNAMIC METAFIELDS

   We collect:
   - metafields used as product conditions
   - Wi-Fi field
   - PC video output field
   - monitor video input field
========================================================= */

function addReference(
  map:
    Map<
      string,
      MetafieldReference
    >,

  reference:
    MetafieldReference | null,
) {
  if (
    !reference?.namespace ||
    !reference?.key
  ) {
    return;
  }

  map.set(
    metafieldReferenceKey(
      reference,
    ),

    {
      namespace:
        reference.namespace,

      key:
        reference.key,
    },
  );
}

function collectRuleMetafields(
  map:
    Map<
      string,
      MetafieldReference
    >,

  rule:
    ProductRuleGroup,
) {
  for (
    const condition
    of rule.conditions
  ) {
    if (
      condition.source ===
      "metafield"
    ) {
      addReference(
        map,
        condition.metafield,
      );
    }
  }
}

export function collectTemplateMetafieldReferences(
  templates:
    BundleTemplate[],

  enabledOnly =
    true,
): MetafieldReference[] {
  const references =
    new Map<
      string,
      MetafieldReference
    >();

  for (
    const template
    of templates
  ) {
    if (
      enabledOnly &&
      !template.enabled
    ) {
      continue;
    }

    collectRuleMetafields(
      references,
      template.baseProductRule,
    );

    collectRuleMetafields(
      references,
      template.monitorRule,
    );

    collectRuleMetafields(
      references,
      template.keyboardMouseRule,
    );

    collectRuleMetafields(
      references,
      template.wifiAdapterRule,
    );

    addReference(
      references,
      template.wifiField,
    );

    addReference(
      references,
      template.videoOutputField,
    );

    addReference(
      references,
      template.videoInputField,
    );
  }

  return Array.from(
    references.values(),
  );
}

/* =========================================================
   TEMPLATE VALIDATION
========================================================= */

export function validateBundleTemplate(
  template:
    BundleTemplate,
) {
  const issues:
    string[] =
    [];

  const rules: Array<{
    name: string;
    rule: ProductRuleGroup;
  }> = [
    {
      name:
        "Computador base",

      rule:
        template.baseProductRule,
    },

    {
      name:
        "Monitor",

      rule:
        template.monitorRule,
    },

    {
      name:
        "Teclado + Mouse",

      rule:
        template.keyboardMouseRule,
    },

    {
      name:
        "Adaptador Wi-Fi",

      rule:
        template.wifiAdapterRule,
    },
  ];

  for (
    const item
    of rules
  ) {
    const ruleIssues =
      validateProductRuleGroup(
        item.rule,
      );

    for (
      const issue
      of ruleIssues
    ) {
      issues.push(
        `${item.name}: ${issue.message}`,
      );
    }
  }

  if (
    !template.titlePrefix.trim()
  ) {
    issues.push(
      "El prefijo del nombre está vacío.",
    );
  }

  if (
    !template.skuPrefix.trim()
  ) {
    issues.push(
      "El prefijo SKU está vacío.",
    );
  }

  if (
    !template.generatedProductType.trim()
  ) {
    issues.push(
      "El tipo de producto generado está vacío.",
    );
  }

  if (
    !template.vendor.trim()
  ) {
    issues.push(
      "El proveedor está vacío.",
    );
  }

  return issues;
}