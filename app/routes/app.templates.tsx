import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";

import {
  useFetcher,
  useLoaderData,
} from "react-router";

import {
  boundary,
} from "@shopify/shopify-app-react-router/server";

import {
  useAppBridge,
} from "@shopify/app-bridge-react";

import {
  authenticate,
} from "../shopify.server";

import type {
  BundleTemplate,
  MetafieldReference,
  ProductRuleGroup,
  RuleCondition,
  RuleConditionOperator,
  RuleConditionSource,
  ShopifyMetafieldDefinitionOption,
} from "../lib/bundle-templates";

import {
  sanitizeBundleTemplates,
} from "../lib/bundle-templates";

import {
  saveBundleTemplates,
} from "../lib/bundle-templates.server";

import {
  invalidateShopBundleCache,
  loadCachedBundleTemplateSettings,
} from "../lib/bundle-cache.server";

/* =========================================================
   TYPES
========================================================= */

type RuleKey =
  | "baseProductRule"
  | "monitorRule"
  | "keyboardMouseRule"
  | "wifiAdapterRule";

/* =========================================================
   LOADER
========================================================= */

export const loader = async ({
  request,
}: LoaderFunctionArgs) => {
  const {
    admin,
    session,
  } =
    await authenticate.admin(
      request,
    );

  return loadCachedBundleTemplateSettings(
    admin,
    session.shop,
  );
};

/* =========================================================
   ACTION
========================================================= */

export const action = async ({
  request,
}: ActionFunctionArgs) => {
  const {
    admin,
    session,
  } =
    await authenticate.admin(
      request,
    );

  const formData =
    await request.formData();

  const raw =
    String(
      formData.get(
        "templatesJson",
      ) ?? "",
    );

  if (!raw) {
    return {
      success: false,
      message:
        "No se recibió la configuración de plantillas.",
    };
  }

  let parsed: unknown;

  try {
    parsed =
      JSON.parse(raw);
  } catch {
    return {
      success: false,
      message:
        "La configuración de plantillas no contiene JSON válido.",
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      success: false,
      message:
        "La configuración recibida no es válida.",
    };
  }

  const templates =
    sanitizeBundleTemplates(
      parsed,
    );

  const result =
    await saveBundleTemplates(
      admin,
      templates,
    );

  if (
    result.success
  ) {
    invalidateShopBundleCache(
      session.shop,
    );
  }

  return result;
};

/* =========================================================
   METAFIELD HELPERS
========================================================= */

function metafieldToValue(
  field:
    MetafieldReference | null,
) {
  if (!field) {
    return "";
  }

  return JSON.stringify({
    namespace:
      field.namespace,

    key:
      field.key,
  });
}

function valueToMetafield(
  value: string,
):
  | MetafieldReference
  | null {
  if (!value) {
    return null;
  }

  try {
    const parsed =
      JSON.parse(value);

    if (
      typeof parsed !==
        "object" ||
      !parsed
    ) {
      return null;
    }

    const object =
      parsed as Record<
        string,
        unknown
      >;

    if (
      typeof object.namespace !==
        "string" ||
      typeof object.key !==
        "string"
    ) {
      return null;
    }

    return {
      namespace:
        object.namespace,

      key:
        object.key,
    };
  } catch {
    return null;
  }
}

/* =========================================================
   CONDITION HELPERS
========================================================= */

function createCondition():
  RuleCondition {
  return {
    id:
      `condition-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,

    source:
      "product_type",

    operator:
      "equals",

    value:
      "",

    metafield:
      null,
  };
}

function getSourceLabel(
  source:
    RuleConditionSource,
) {
  switch (source) {
    case "product_type":
      return "Tipo de producto";

    case "metafield":
      return "Metacampo";

    case "sku":
      return "SKU";

    case "title":
      return "Título";

    case "vendor":
      return "Proveedor";

    case "status":
      return "Estado";

    case "stock":
      return "Stock";

    case "tag":
      return "Tag";

    default:
      return source;
  }
}

function getOperatorLabel(
  operator:
    RuleConditionOperator,
) {
  switch (operator) {
    case "equals":
      return "es igual a";

    case "not_equals":
      return "no es igual a";

    case "contains":
      return "contiene";

    case "not_contains":
      return "no contiene";

    case "starts_with":
      return "empieza con";

    case "exists":
      return "existe";

    case "not_exists":
      return "no existe";

    case "greater_than":
      return "mayor que";

    case "greater_or_equal":
      return "mayor o igual que";

    case "less_than":
      return "menor que";

    case "less_or_equal":
      return "menor o igual que";

    default:
      return operator;
  }
}

function getOperators(
  source:
    RuleConditionSource,
): RuleConditionOperator[] {
  switch (source) {
    case "product_type":
      return [
        "equals",
        "not_equals",
      ];

    case "metafield":
      return [
        "equals",
        "not_equals",
        "contains",
        "not_contains",
        "exists",
        "not_exists",
      ];

    case "sku":
    case "title":
    case "vendor":
    case "tag":
      return [
        "equals",
        "not_equals",
        "contains",
        "not_contains",
        "starts_with",
      ];

    case "status":
      return [
        "equals",
        "not_equals",
      ];

    case "stock":
      return [
        "equals",
        "greater_than",
        "greater_or_equal",
        "less_than",
        "less_or_equal",
      ];

    default:
      return [
        "equals",
      ];
  }
}

function needsValue(
  condition:
    RuleCondition,
) {
  return (
    condition.operator !==
      "exists" &&
    condition.operator !==
      "not_exists"
  );
}

function summarizeCondition(
  condition:
    RuleCondition,
) {
  const operator =
    getOperatorLabel(
      condition.operator,
    );

  if (
    condition.source ===
    "metafield"
  ) {
    const metafield =
      condition.metafield
        ? `${condition.metafield.namespace}.${condition.metafield.key}`
        : "Metacampo sin seleccionar";

    if (
      !needsValue(
        condition,
      )
    ) {
      return `${metafield} ${operator}`;
    }

    return `${metafield} ${operator} ${
      condition.value ||
      "…"
    }`;
  }

  return `${getSourceLabel(
    condition.source,
  )} ${operator} ${
    condition.value ||
    "…"
  }`;
}

/* =========================================================
   MAIN PAGE
========================================================= */

export default function Templates() {
  const data =
    useLoaderData<
      typeof loader
    >();

  const fetcher =
    useFetcher<
      typeof action
    >();

  const shopify =
    useAppBridge();

  const [
    templates,
    setTemplates,
  ] =
    useState<
      BundleTemplate[]
    >(
      data.templates,
    );

  const [
    savedSnapshot,
    setSavedSnapshot,
  ] =
    useState(
      JSON.stringify(
        data.templates,
      ),
    );

  const [
    editingRule,
    setEditingRule,
  ] =
    useState<
      string | null
    >(
      null,
    );

  const pendingSaveSnapshot =
    useRef<
      string | null
    >(
      null,
    );

  const currentSnapshot =
    useMemo(
      () =>
        JSON.stringify(
          templates,
        ),
      [templates],
    );

  const dirty =
    currentSnapshot !==
    savedSnapshot;

  const saving =
    fetcher.state !==
    "idle";

  /* =======================================================
     SERVER DATA
  ======================================================= */

  useEffect(() => {
    setTemplates(
      data.templates,
    );

    setSavedSnapshot(
      JSON.stringify(
        data.templates,
      ),
    );
  }, [
    data.templates,
  ]);

  /* =======================================================
     SAVE RESULT
  ======================================================= */

  useEffect(() => {
    if (
      !fetcher.data
        ?.message
    ) {
      return;
    }

    shopify.toast.show(
      fetcher.data.message,
    );

    if (
      fetcher.data
        .success &&
      pendingSaveSnapshot
        .current
    ) {
      setSavedSnapshot(
        pendingSaveSnapshot
          .current,
      );

      pendingSaveSnapshot.current =
        null;
    }
  }, [
    fetcher.data,
    shopify,
  ]);

  /* =======================================================
     WARN BEFORE BROWSER EXIT
  ======================================================= */

  useEffect(() => {
    if (!dirty) {
      return;
    }

    const handler = (
      event:
        BeforeUnloadEvent,
    ) => {
      event.preventDefault();

      event.returnValue =
        "";
    };

    window.addEventListener(
      "beforeunload",
      handler,
    );

    return () => {
      window.removeEventListener(
        "beforeunload",
        handler,
      );
    };
  }, [
    dirty,
  ]);

  /* =======================================================
     TEMPLATE PATCH
  ======================================================= */

  function patchTemplate(
    templateId:
      string,

    patch:
      Partial<BundleTemplate>,
  ) {
    setTemplates(
      (current) =>
        current.map(
          (template) =>
            template.id ===
            templateId
              ? {
                  ...template,
                  ...patch,
                }
              : template,
        ),
    );
  }

  /* =======================================================
     RULE PATCH
  ======================================================= */

  function patchRule(
    templateId:
      string,

    ruleKey:
      RuleKey,

    updater: (
      current:
        ProductRuleGroup,
    ) => ProductRuleGroup,
  ) {
    setTemplates(
      (current) =>
        current.map(
          (template) => {
            if (
              template.id !==
              templateId
            ) {
              return template;
            }

            return {
              ...template,

              [ruleKey]:
                updater(
                  template[
                    ruleKey
                  ],
                ),
            };
          },
        ),
    );
  }

  function patchCondition(
    templateId:
      string,

    ruleKey:
      RuleKey,

    conditionId:
      string,

    patch:
      Partial<RuleCondition>,
  ) {
    patchRule(
      templateId,
      ruleKey,
      (rule) => ({
        ...rule,

        conditions:
          rule.conditions.map(
            (condition) =>
              condition.id ===
              conditionId
                ? {
                    ...condition,
                    ...patch,
                  }
                : condition,
          ),
      }),
    );
  }

  function addCondition(
    templateId:
      string,

    ruleKey:
      RuleKey,
  ) {
    patchRule(
      templateId,
      ruleKey,
      (rule) => ({
        ...rule,

        conditions: [
          ...rule.conditions,
          createCondition(),
        ],
      }),
    );
  }

  function removeCondition(
    templateId:
      string,

    ruleKey:
      RuleKey,

    conditionId:
      string,
  ) {
    patchRule(
      templateId,
      ruleKey,
      (rule) => {
        if (
          rule.conditions.length <=
          1
        ) {
          return rule;
        }

        return {
          ...rule,

          conditions:
            rule.conditions.filter(
              (condition) =>
                condition.id !==
                conditionId,
            ),
        };
      },
    );
  }

  return (
    <s-page
      heading="Plantillas de Bundles"
      inlineSize="large"
    >

      <s-stack gap="base">

        <style>{`
          /* Responsive field groups; retain Shopify's native form controls. */
          .csb-templates-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            align-items: start;
            gap: 16px;
            min-width: 0;
          }

          .csb-templates-grid > * {
            min-width: 0;
            width: 100%;
          }

          .csb-templates-grid--rules {
            align-items: stretch;
          }

          .csb-templates-grid--generated {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          /* Condition editors are nested inside a component rule card.
             Size these by available card width, not the desktop viewport. */
          .csb-templates-condition-container {
            container-type: inline-size;
            min-width: 0;
            width: 100%;
          }

          .csb-templates-grid--condition {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
          }

          @container (min-width: 780px) {
            .csb-templates-grid--condition {
              grid-template-columns: repeat(4, minmax(0, 1fr));
            }
          }

          @container (max-width: 440px) {
            .csb-templates-grid--condition {
              grid-template-columns: 1fr;
            }
          }

          @media (max-width: 1050px) {
            .csb-templates-grid--generated {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }

          @media (max-width: 720px) {
            .csb-templates-grid:not(.csb-templates-grid--condition) {
              grid-template-columns: minmax(0, 1fr);
            }
          }
        `}</style>

        <s-section>

          <s-paragraph>
            Define qué productos forman cada combinación de Bundles, qué condiciones deben cumplir y qué metacampos utiliza la app para comprobar compatibilidad.
          </s-paragraph>

        </s-section>

        <s-banner
          tone="info"
          heading="Motor conectado"
        >
          Los cambios guardados en estas plantillas modifican las propuestas de Bundles sin editar código.
        </s-banner>

        {data.errors.length >
          0 && (
          <s-banner
            tone="critical"
            heading="Algunas configuraciones de Shopify no pudieron cargarse"
          >
            {data.errors.join(
              " · ",
            )}
          </s-banner>
        )}

        {templates.map(
          (template) => (
            <s-section
              key={
                template.id
              }
              heading={
                template.name
              }
            >

              <s-badge
                slot="accessory"
                tone={
                  template.enabled
                    ? "success"
                    : "neutral"
                }
              >
                {template.enabled
                  ? "Activa"
                  : "Inactiva"}
              </s-badge>

              <s-stack gap="base">

                <s-stack
                  direction="inline"
                  gap="base"
                  alignItems="center"
                >
                  <s-checkbox
                    label="Plantilla activa"
                    checked={
                      template.enabled
                    }
                    onChange={(event) =>
                      patchTemplate(
                        template.id,
                        {
                          enabled:
                            event.currentTarget.checked,
                        },
                      )
                    }
                  />

                  <s-text tone="neutral">
                    {
                      template.id
                    }
                  </s-text>
                </s-stack>

                <s-divider />

                <s-stack gap="small">

                  <s-heading>
                    Identificación
                  </s-heading>

                  <s-paragraph>
                    Nombre interno y tipo de plantilla.
                  </s-paragraph>

                  <div className="csb-templates-grid csb-templates-grid--two">

                      <s-text-field
                        label="Nombre de plantilla"
                        value={
                          template.name
                        }
                        onInput={(event) =>
                          patchTemplate(
                            template.id,
                            {
                              name:
                                event.currentTarget.value,
                            },
                          )
                        }
                      />

                      <s-text-field
                        label="Tipo de plantilla"
                        value="PC + Monitor"
                        disabled
                      />

                    </div>

                </s-stack>

                <s-divider />

                <s-stack gap="small">

                  <s-heading>
                    Productos incluidos en Bundles
                  </s-heading>

                  <s-paragraph>
                    Cada componente puede utilizar una o más condiciones. Define si deben cumplirse todas o cualquiera de ellas.
                  </s-paragraph>

                  <div className="csb-templates-grid csb-templates-grid--rules">

                      <ComponentRuleCard
                        label="Computador base"
                        templateId={
                          template.id
                        }
                        ruleKey="baseProductRule"
                        rule={
                          template.baseProductRule
                        }
                        editingRule={
                          editingRule
                        }
                        setEditingRule={
                          setEditingRule
                        }
                        productTypes={
                          data.productTypes
                        }
                        metafields={
                          data.metafields
                        }
                        patchRule={
                          patchRule
                        }
                        patchCondition={
                          patchCondition
                        }
                        addCondition={
                          addCondition
                        }
                        removeCondition={
                          removeCondition
                        }
                      />

                      <ComponentRuleCard
                        label="Monitor"
                        templateId={
                          template.id
                        }
                        ruleKey="monitorRule"
                        rule={
                          template.monitorRule
                        }
                        editingRule={
                          editingRule
                        }
                        setEditingRule={
                          setEditingRule
                        }
                        productTypes={
                          data.productTypes
                        }
                        metafields={
                          data.metafields
                        }
                        patchRule={
                          patchRule
                        }
                        patchCondition={
                          patchCondition
                        }
                        addCondition={
                          addCondition
                        }
                        removeCondition={
                          removeCondition
                        }
                      />

                      <ComponentRuleCard
                        label="Teclado + Mouse"
                        templateId={
                          template.id
                        }
                        ruleKey="keyboardMouseRule"
                        rule={
                          template.keyboardMouseRule
                        }
                        editingRule={
                          editingRule
                        }
                        setEditingRule={
                          setEditingRule
                        }
                        productTypes={
                          data.productTypes
                        }
                        metafields={
                          data.metafields
                        }
                        patchRule={
                          patchRule
                        }
                        patchCondition={
                          patchCondition
                        }
                        addCondition={
                          addCondition
                        }
                        removeCondition={
                          removeCondition
                        }
                      />

                      <ComponentRuleCard
                        label="Adaptador Wi-Fi"
                        templateId={
                          template.id
                        }
                        ruleKey="wifiAdapterRule"
                        rule={
                          template.wifiAdapterRule
                        }
                        editingRule={
                          editingRule
                        }
                        setEditingRule={
                          setEditingRule
                        }
                        productTypes={
                          data.productTypes
                        }
                        metafields={
                          data.metafields
                        }
                        patchRule={
                          patchRule
                        }
                        patchCondition={
                          patchCondition
                        }
                        addCondition={
                          addCondition
                        }
                        removeCondition={
                          removeCondition
                        }
                      />

                    </div>

                </s-stack>

                <s-divider />

                <s-stack gap="small">

                  <s-heading>
                    Compatibilidad técnica
                  </s-heading>

                  <s-paragraph>
                    Define los metacampos utilizados para Wi-Fi y compatibilidad entre las salidas del computador y las entradas del monitor.
                  </s-paragraph>

                  <div className="csb-templates-grid csb-templates-grid--two">

                      <MetafieldSelector
                        label="Wi-Fi integrado"
                        value={
                          template.wifiField
                        }
                        metafields={
                          data.metafields
                        }
                        onChange={(value) =>
                          patchTemplate(
                            template.id,
                            {
                              wifiField:
                                value,
                            },
                          )
                        }
                      />

                      <s-text-field
                        label="Valor que significa “sin Wi-Fi”"
                        value={
                          template.wifiNoValue
                        }
                        onInput={(event) =>
                          patchTemplate(
                            template.id,
                            {
                              wifiNoValue:
                                event.currentTarget.value,
                            },
                          )
                        }
                      />

                      <MetafieldSelector
                        label="Salidas de video del PC"
                        value={
                          template.videoOutputField
                        }
                        metafields={
                          data.metafields
                        }
                        onChange={(value) =>
                          patchTemplate(
                            template.id,
                            {
                              videoOutputField:
                                value,
                            },
                          )
                        }
                      />

                      <MetafieldSelector
                        label="Entradas de video del monitor"
                        value={
                          template.videoInputField
                        }
                        metafields={
                          data.metafields
                        }
                        onChange={(value) =>
                          patchTemplate(
                            template.id,
                            {
                              videoInputField:
                                value,
                            },
                          )
                        }
                      />

                      <s-select
                        label="Regla de compatibilidad"
                        value={
                          template.compatibilityOperator
                        }
                        disabled
                      >
                        <s-option value="intersection">
                          Coincidencia directa de puertos
                        </s-option>
                      </s-select>

                    </div>

                </s-stack>

                <s-divider />

                <s-stack gap="small">

                  <s-heading>
                    Producto generado
                  </s-heading>

                  <s-paragraph>
                    Define cómo se identificará el producto de Bundles creado en Shopify.
                  </s-paragraph>

                  <div className="csb-templates-grid csb-templates-grid--generated">

                      <s-text-field
                        label="Prefijo del nombre"
                        value={
                          template.titlePrefix
                        }
                        onInput={(event) =>
                          patchTemplate(
                            template.id,
                            {
                              titlePrefix:
                                event.currentTarget.value,
                            },
                          )
                        }
                      />

                      <s-text-field
                        label="Sufijo del monitor"
                        placeholder="Opcional"
                        value={
                          template.monitorSuffix
                        }
                        onInput={(event) =>
                          patchTemplate(
                            template.id,
                            {
                              monitorSuffix:
                                event.currentTarget.value,
                            },
                          )
                        }
                      />

                      <s-text-field
                        label="Prefijo SKU"
                        value={
                          template.skuPrefix
                        }
                        onInput={(event) =>
                          patchTemplate(
                            template.id,
                            {
                              skuPrefix:
                                event.currentTarget.value,
                            },
                          )
                        }
                      />

                      <s-select
                        label="Tipo de producto generado"
                        value={
                          template.generatedProductType
                        }
                        onChange={(event) =>
                          patchTemplate(
                            template.id,
                            {
                              generatedProductType:
                                event.currentTarget.value,
                            },
                          )
                        }
                      >
                        <s-option value="">
                          Seleccionar...
                        </s-option>

                        {data.productTypes.map(
                          (productType) => (
                            <s-option
                              key={
                                productType
                              }
                              value={
                                productType
                              }
                            >
                              {
                                productType
                              }
                            </s-option>
                          ),
                        )}
                      </s-select>

                      <s-text-field
                        label="Proveedor"
                        value={
                          template.vendor
                        }
                        onInput={(event) =>
                          patchTemplate(
                            template.id,
                            {
                              vendor:
                                event.currentTarget.value,
                            },
                          )
                        }
                      />

                      <s-text-field
                        label="Estado inicial"
                        value="Borrador"
                        disabled
                      />

                    </div>

                  <s-banner
                    tone="info"
                    heading="Vista previa"
                  >
                    Nombre:{" "}
                    {template.titlePrefix ||
                      "Combo"}{" "}
                    {"{COMPUTADOR}"} + Monitor{" "}
                    {"{MONITOR}"}
                    {template.monitorSuffix
                      ? ` ${template.monitorSuffix}`
                      : ""}
                    {" · "}
                    SKU:{" "}
                    {template.skuPrefix}
                    {"{SKU_PC}"}
                  </s-banner>

                </s-stack>

              </s-stack>

            </s-section>
          ),
        )}

        <fetcher.Form
          method="post"
          onSubmit={() => {
            pendingSaveSnapshot.current =
              currentSnapshot;
          }}
        >

          <input
            type="hidden"
            name="templatesJson"
            value={
              currentSnapshot
            }
          />

          <s-section heading="Guardar cambios">

            <s-stack
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
            >

              <s-badge
                tone={
                  saving
                    ? "info"
                    : dirty
                      ? "warning"
                      : "success"
                }
              >
                {saving
                  ? "Guardando cambios..."
                  : dirty
                    ? "Hay cambios sin guardar"
                    : "Configuración guardada"}
              </s-badge>

              <s-button
                type="submit"
                variant="primary"
                disabled={
                  saving ||
                  !dirty
                }
              >
                {saving
                  ? "Guardando..."
                  : "Guardar plantillas"}
              </s-button>

            </s-stack>

          </s-section>

        </fetcher.Form>

      </s-stack>

    </s-page>
  );
}

/* =========================================================
   COMPONENT RULE CARD
========================================================= */

function ComponentRuleCard({
  label,
  templateId,
  ruleKey,
  rule,
  editingRule,
  setEditingRule,
  productTypes,
  metafields,
  patchRule,
  patchCondition,
  addCondition,
  removeCondition,
}: {
  label: string;

  templateId: string;

  ruleKey: RuleKey;

  rule:
    ProductRuleGroup;

  editingRule:
    string | null;

  setEditingRule: (
    value:
      string | null,
  ) => void;

  productTypes:
    string[];

  metafields:
    ShopifyMetafieldDefinitionOption[];

  patchRule: (
    templateId:
      string,

    ruleKey:
      RuleKey,

    updater: (
      rule:
        ProductRuleGroup,
    ) => ProductRuleGroup,
  ) => void;

  patchCondition: (
    templateId:
      string,

    ruleKey:
      RuleKey,

    conditionId:
      string,

    patch:
      Partial<RuleCondition>,
  ) => void;

  addCondition: (
    templateId:
      string,

    ruleKey:
      RuleKey,
  ) => void;

  removeCondition: (
    templateId:
      string,

    ruleKey:
      RuleKey,

    conditionId:
      string,
  ) => void;
}) {
  const editorId =
    `${templateId}:${ruleKey}`;

  const editing =
    editingRule ===
    editorId;

  return (
    <s-section
      heading={
        label
      }
    >

      <s-badge
        slot="accessory"
        tone="neutral"
      >
        {rule.conditions.length}{" "}
        {rule.conditions.length ===
        1
          ? "condición"
          : "condiciones"}
      </s-badge>

      <s-button
        slot="primary-action"
        variant="tertiary"
        onClick={() =>
          setEditingRule(
            editing
              ? null
              : editorId,
          )
        }
      >
        {editing
          ? "Cerrar"
          : "Editar"}
      </s-button>

      {!editing ? (
        <s-stack gap="small">

          <s-text tone="neutral">
            {rule.match ===
            "all"
              ? "Deben cumplirse todas"
              : "Puede cumplirse cualquiera"}
          </s-text>

          {rule.conditions
            .slice(
              0,
              3,
            )
            .map(
              (condition) => (
                <s-badge
                  key={
                    condition.id
                  }
                  tone="neutral"
                >
                  {summarizeCondition(
                    condition,
                  )}
                </s-badge>
              ),
            )}

          {rule.conditions.length >
            3 && (
            <s-text tone="neutral">
              +{" "}
              {rule.conditions.length -
                3}{" "}
              condición(es)
            </s-text>
          )}

        </s-stack>
      ) : (
        <s-stack gap="base">

          <s-select
            label="Cumplir"
            value={
              rule.match
            }
            onChange={(event) =>
              patchRule(
                templateId,
                ruleKey,
                (current) => ({
                  ...current,

                  match:
                    event.currentTarget.value ===
                    "any"
                      ? "any"
                      : "all",
                }),
              )
            }
          >
            <s-option value="all">
              Todas las condiciones (AND)
            </s-option>
            <s-option value="any">
              Cualquier condición (OR)
            </s-option>
          </s-select>

          {rule.conditions.map(
            (condition) => (
              <ConditionEditor
                key={
                  condition.id
                }
                condition={
                  condition
                }
                productTypes={
                  productTypes
                }
                metafields={
                  metafields
                }
                canRemove={
                  rule.conditions.length >
                  1
                }
                onChange={(patch) =>
                  patchCondition(
                    templateId,
                    ruleKey,
                    condition.id,
                    patch,
                  )
                }
                onRemove={() =>
                  removeCondition(
                    templateId,
                    ruleKey,
                    condition.id,
                  )
                }
              />
            ),
          )}

          <s-stack
            direction="inline"
            gap="small"
          >

            <s-button
              variant="secondary"
              onClick={() =>
                addCondition(
                  templateId,
                  ruleKey,
                )
              }
            >
              Agregar condición
            </s-button>

            <s-button
              variant="primary"
              onClick={() =>
                setEditingRule(
                  null,
                )
              }
            >
              Listo
            </s-button>

          </s-stack>

        </s-stack>
      )}

    </s-section>
  );
}

/* =========================================================
   CONDITION EDITOR
========================================================= */

function ConditionEditor({
  condition,
  productTypes,
  metafields,
  canRemove,
  onChange,
  onRemove,
}: {
  condition:
    RuleCondition;

  productTypes:
    string[];

  metafields:
    ShopifyMetafieldDefinitionOption[];

  canRemove:
    boolean;

  onChange: (
    patch:
      Partial<RuleCondition>,
  ) => void;

  onRemove:
    () => void;
}) {
  const operators =
    getOperators(
      condition.source,
    );

  const valueRequired =
    needsValue(
      condition,
    );

  const isMetafield =
    condition.source ===
    "metafield";

  function changeSource(
    source:
      RuleConditionSource,
  ) {
    const defaultOperator =
      getOperators(
        source,
      )[0];

    let value =
      "";

    if (
      source ===
      "status"
    ) {
      value =
        "ACTIVE";
    }

    if (
      source ===
      "stock"
    ) {
      value =
        "0";
    }

    onChange({
      source,

      operator:
        defaultOperator,

      value,

      metafield:
        source ===
        "metafield"
          ? condition.metafield
          : null,
    });
  }

  function changeOperator(
    operator:
      RuleConditionOperator,
  ) {
    onChange({
      operator,

      value:
        operator ===
          "exists" ||
        operator ===
          "not_exists"
          ? ""
          : condition.value,
    });
  }

  return (
    <s-section>

      <div className="csb-templates-condition-container">
          <div className="csb-templates-grid csb-templates-grid--condition">

          <s-select
            label="Campo"
            value={
              condition.source
            }
            onChange={(event) =>
              changeSource(
                event.currentTarget
                  .value as RuleConditionSource,
              )
            }
          >
            <s-option value="product_type">
              Tipo de producto
            </s-option>
            <s-option value="metafield">
              Metacampo
            </s-option>
            <s-option value="sku">
              SKU
            </s-option>
            <s-option value="title">
              Título
            </s-option>
            <s-option value="vendor">
              Proveedor
            </s-option>
            <s-option value="status">
              Estado
            </s-option>
            <s-option value="stock">
              Stock
            </s-option>
            <s-option value="tag">
              Tag
            </s-option>
          </s-select>

          {isMetafield && (
            <s-select
              label="Metacampo"
              value={
                metafieldToValue(
                  condition.metafield,
                )
              }
              onChange={(event) =>
                onChange({
                  metafield:
                    valueToMetafield(
                      event.currentTarget.value,
                    ),
                })
              }
            >
              <s-option value="">
                Seleccionar metacampo...
              </s-option>

              {metafields.map(
                (field) => (
                  <s-option
                    key={
                      field.id
                    }
                    value={
                      metafieldToValue({
                        namespace:
                          field.namespace,

                        key:
                          field.key,
                      })
                    }
                  >
                    {field.name} ·{" "}
                    {field.namespace}.
                    {field.key}
                  </s-option>
                ),
              )}
            </s-select>
          )}

          <s-select
            label="Operador"
            value={
              condition.operator
            }
            onChange={(event) =>
              changeOperator(
                event.currentTarget
                  .value as RuleConditionOperator,
              )
            }
          >
            {operators.map(
              (operator) => (
                <s-option
                  key={
                    operator
                  }
                  value={
                    operator
                  }
                >
                  {getOperatorLabel(
                    operator,
                  )}
                </s-option>
              ),
            )}
          </s-select>

          {valueRequired && (
            <ConditionValueEditor
              condition={
                condition
              }
              productTypes={
                productTypes
              }
              onChange={(value) =>
                onChange({
                  value,
                })
              }
            />
          )}

        </div>
      </div>

      <s-box paddingBlockStart="small">

        <s-button
          variant="tertiary"
          disabled={
            !canRemove
          }
          onClick={
            onRemove
          }
        >
          Eliminar condición
        </s-button>

      </s-box>

    </s-section>
  );
}

/* =========================================================
   CONDITION VALUE
========================================================= */

function ConditionValueEditor({
  condition,
  productTypes,
  onChange,
}: {
  condition:
    RuleCondition;

  productTypes:
    string[];

  onChange: (
    value:
      string,
  ) => void;
}) {
  if (
    condition.source ===
    "product_type"
  ) {
    return (
      <s-select
        label="Tipo de producto"
        value={
          condition.value
        }
        onChange={(event) =>
          onChange(
            event.currentTarget.value,
          )
        }
      >
        <s-option value="">
          Seleccionar...
        </s-option>

        {productTypes.map(
          (productType) => (
            <s-option
              key={
                productType
              }
              value={
                productType
              }
            >
              {
                productType
              }
            </s-option>
          ),
        )}
      </s-select>
    );
  }

  if (
    condition.source ===
    "status"
  ) {
    return (
      <s-select
        label="Estado"
        value={
          condition.value
        }
        onChange={(event) =>
          onChange(
            event.currentTarget.value,
          )
        }
      >
        <s-option value="ACTIVE">
          Activo
        </s-option>
        <s-option value="DRAFT">
          Borrador
        </s-option>
        <s-option value="ARCHIVED">
          Archivado
        </s-option>
        <s-option value="UNLISTED">
          No listado
        </s-option>
      </s-select>
    );
  }

  if (
    condition.source ===
    "stock"
  ) {
    return (
      <s-number-field
        label="Cantidad"
        value={
          condition.value
        }
        min={0}
        step={1}
        onChange={(event) =>
          onChange(
            event.currentTarget.value,
          )
        }
      />
    );
  }

  const placeholder =
    condition.source ===
    "sku"
      ? "Ej: PTR-"
      : condition.source ===
          "title"
        ? "Ej: Nuevo"
        : condition.source ===
            "vendor"
          ? "Ej: HP"
          : condition.source ===
              "tag"
            ? "Ej: Reacondicionado"
            : "Valor esperado";

  return (
    <s-text-field
      label="Valor"
      placeholder={
        placeholder
      }
      value={
        condition.value
      }
      onInput={(event) =>
        onChange(
          event.currentTarget.value,
        )
      }
    />
  );
}

/* =========================================================
   METAFIELD SELECTOR
========================================================= */

function MetafieldSelector({
  label,
  value,
  metafields,
  onChange,
}: {
  label: string;

  value:
    MetafieldReference | null;

  metafields:
    ShopifyMetafieldDefinitionOption[];

  onChange: (
    value:
      MetafieldReference | null,
  ) => void;
}) {
  return (
    <s-select
      label={
        label
      }
      value={
        metafieldToValue(
          value,
        )
      }
      onChange={(event) =>
        onChange(
          valueToMetafield(
            event.currentTarget.value,
          ),
        )
      }
    >
      <s-option value="">
        Seleccionar metacampo...
      </s-option>

      {metafields.map(
        (field) => (
          <s-option
            key={
              field.id
            }
            value={
              metafieldToValue({
                namespace:
                  field.namespace,

                key:
                  field.key,
              })
            }
          >
            {field.name} ·{" "}
            {field.namespace}.
            {field.key} ·{" "}
            {field.type}
          </s-option>
        ),
      )}
    </s-select>
  );
}

/* =========================================================
   HEADERS
========================================================= */

export const headers:
  HeadersFunction = (
    headersArgs,
  ) => {
    return boundary.headers(
      headersArgs,
    );
  };