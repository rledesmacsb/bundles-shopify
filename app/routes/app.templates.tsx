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
    <s-page heading="Plantillas de bundles" inlineSize="large">

      <style>{`
        .cst-page,
        .cst-page *,
        .cst-page *::before,
        .cst-page *::after {
          box-sizing: border-box;
        }

        .cst-page {
          width: 100%;
          max-width: none;
          margin: 0;
          padding-bottom: 24px;
        }

        .cst-intro {
          max-width: 900px;
          margin: 4px 2px 18px;
          color: #69727d;
          font-size: 12px;
          line-height: 1.55;
        }

        .cst-warning {
          margin-bottom: 16px;
          padding: 13px 15px;
          border: 1px solid #dfd2a6;
          border-radius: 12px;
          background: #fffaf0;
          color: #6d581c;
          font-size: 11.5px;
          line-height: 1.45;
        }

        .cst-errors {
          margin-bottom: 16px;
          padding: 13px 15px;
          border: 1px solid #e6b7b7;
          border-radius: 12px;
          background: #fff5f5;
          color: #8f2525;
          font-size: 11px;
          line-height: 1.45;
        }

        .cst-list {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .cst-template {
          overflow: hidden;
          border: 1px solid #e4e9f0;
          border-radius: 12px;
          background: #fff;
        }

        .cst-template__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 20px;
          padding: 18px 20px;
          border-bottom: 1px solid #ededed;
          background: #fff;
        }

        .cst-template__title {
          margin: 0 0 3px;
          color: #303030;
          font-size: 15px;
          font-weight: 700;
        }

        .cst-template__id {
          color: #777;
          font-family: monospace;
          font-size: 10px;
        }

        .cst-switch {
          display: flex;
          align-items: center;
          gap: 7px;
          color: #303030;
          font-size: 11px;
          font-weight: 600;
        }

        .cst-body {
          padding: 20px;
        }

        .cst-section {
          margin-bottom: 27px;
        }

        .cst-section:last-child {
          margin-bottom: 0;
        }

        .cst-section__title {
          margin: 0 0 4px;
          color: #303030;
          font-size: 12px;
          font-weight: 700;
        }

        .cst-section__description {
          margin: 0 0 12px;
          color: #777;
          font-size: 10.5px;
          line-height: 1.4;
        }

        .cst-grid {
          display: grid;
          grid-template-columns:
            repeat(
              2,
              minmax(0, 1fr)
            );
          gap: 12px;
        }

        .cst-grid--3 {
          grid-template-columns:
            repeat(
              3,
              minmax(0, 1fr)
            );
        }

        .cst-field {
          min-width: 0;
        }

        .cst-label {
          display: block;
          margin-bottom: 5px;
          color: #555;
          font-size: 10px;
          font-weight: 650;
        }

        .cst-input,
        .cst-select {
          display: block;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          min-height: 38px;
          padding: 7px 10px;
          border: 1px solid #c9c9c9;
          border-radius: 8px;
          background: #fff;
          color: #303030;
          font: inherit;
          font-size: 11.5px;
        }

        .cst-input:focus,
        .cst-select:focus {
          outline: none;
          border-color: #0c62f2;
          box-shadow: 0 0 0 1px #0c62f2;
        }

        /* ===============================================
           COMPONENTS
        =============================================== */

        .cst-components {
          display: grid;
          grid-template-columns:
            repeat(
              2,
              minmax(0, 1fr)
            );
          gap: 12px;
        }

        .cst-component {
          min-width: 0;
          padding: 14px;
          border: 1px solid #e4e9f0;
          border-radius: 11px;
          background: #fafafa;
        }

        .cst-component--editing {
          grid-column: 1 / -1;
          border-color: #a9c8f8;
          background: #fff;
        }

        .cst-component__header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }

        .cst-component__title {
          color: #303030;
          font-size: 11.5px;
          font-weight: 700;
        }

        .cst-component__count {
          margin-top: 3px;
          color: #777;
          font-size: 10px;
        }

        .cst-edit-button {
          flex-shrink: 0;
          min-width: 68px;
          min-height: 30px;
          padding: 5px 10px;
          border: 1px solid #c9c9c9;
          border-radius: 8px;
          background: #fff;
          color: #303030;
          font: inherit;
          font-size: 10px;
          font-weight: 650;
          cursor: pointer;
        }

        .cst-edit-button:hover {
          background: #f3f3f3;
        }

        .cst-component__summary {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-top: 10px;
        }

        .cst-summary-item {
          overflow: hidden;
          color: #616161;
          font-size: 9.5px;
          line-height: 1.4;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* ===============================================
           RULE EDITOR
        =============================================== */

        .cst-rule-editor {
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px solid #ededed;
        }

        .cst-rule-mode {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 13px;
        }

        .cst-rule-mode__label {
          color: #555;
          font-size: 10px;
          font-weight: 650;
        }

        .cst-rule-mode select {
          width: 260px;
        }

        .cst-condition-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        /*
         * Normal condition:
         *
         * Campo | Operador | Valor | Eliminar
         */
        .cst-condition {
          display: grid;
          grid-template-columns:
            155px
            160px
            minmax(0, 1fr)
            80px;
          gap: 8px;
          align-items: end;
          padding: 11px;
          border: 1px solid #e5e5e5;
          border-radius: 10px;
          background: #fafafa;
        }

        /*
         * Metafield condition:
         *
         * Campo | Metacampo | Operador | Valor | Eliminar
         */
        .cst-condition--metafield {
          grid-template-columns:
            125px
            minmax(220px, 1.4fr)
            145px
            minmax(160px, 1fr)
            80px;
        }

        /*
         * Exists / not exists:
         *
         * no value required.
         */
        .cst-condition--metafield-no-value {
          grid-template-columns:
            125px
            minmax(260px, 1fr)
            155px
            80px;
        }

        .cst-condition__field {
          min-width: 0;
        }

        .cst-condition__field label {
          display: block;
          margin-bottom: 4px;
          color: #777;
          font-size: 8.5px;
          font-weight: 650;
          text-transform: uppercase;
        }

        .cst-remove {
          width: 100%;
          min-height: 38px;
          border: 1px solid #e0c3c3;
          border-radius: 8px;
          background: #fff;
          color: #9a3535;
          font: inherit;
          font-size: 9.5px;
          cursor: pointer;
        }

        .cst-remove:disabled {
          opacity: .35;
          cursor: default;
        }

        .cst-rule-actions {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          margin-top: 12px;
        }

        .cst-add {
          min-height: 34px;
          padding: 6px 12px;
          border: 1px solid #c9c9c9;
          border-radius: 8px;
          background: #fff;
          color: #303030;
          font: inherit;
          font-size: 10.5px;
          font-weight: 600;
          cursor: pointer;
        }

        .cst-done {
          min-height: 34px;
          padding: 6px 16px;
          border: 0;
          border-radius: 8px;
          background: #0c62f2;
          color: #fff;
          font: inherit;
          font-size: 10.5px;
          font-weight: 600;
          cursor: pointer;
        }

        /* ===============================================
           GENERATED PRODUCT
        =============================================== */

        .cst-preview {
          margin-top: 12px;
          padding: 12px 14px;
          border: 1px solid #dcdcdc;
          border-radius: 10px;
          background: #fafafa;
        }

        .cst-preview__label {
          margin-bottom: 4px;
          color: #777;
          font-size: 9px;
          text-transform: uppercase;
        }

        .cst-preview__value {
          color: #303030;
          font-size: 12px;
          font-weight: 650;
        }

        /* ===============================================
           SAVE BAR
        =============================================== */

        .cst-save-wrap {
          position: sticky;
          bottom: 14px;
          z-index: 5;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 15px;
          margin-top: 18px;
          padding: 11px;
          border: 1px solid #e4e9f0;
          border-radius: 10px;
          background: #fff;
          box-shadow: 0 -2px 8px rgba(31, 33, 36, .04);
        }

        .cst-save-status {
          padding-left: 4px;
          color: #777;
          font-size: 10.5px;
        }

        .cst-save-status--dirty {
          color: #8a5a00;
          font-weight: 650;
        }

        .cst-save {
          min-width: 180px;
          min-height: 40px;
          padding: 7px 16px;
          border: 0;
          border-radius: 9px;
          background: #303030;
          color: #fff;
          font: inherit;
          font-size: 12px;
          font-weight: 650;
          cursor: pointer;
        }

        .cst-save:disabled {
          opacity: .45;
          cursor: default;
        }

        @media (max-width: 1050px) {
          .cst-condition,
          .cst-condition--metafield,
          .cst-condition--metafield-no-value {
            grid-template-columns:
              1fr
              1fr;
          }
        }

        @media (max-width: 850px) {
          .cst-grid,
          .cst-grid--3,
          .cst-components {
            grid-template-columns:
              1fr;
          }

          .cst-component--editing {
            grid-column: auto;
          }

          .cst-template__header {
            align-items: flex-start;
            flex-direction: column;
          }
        }

        @media (max-width: 600px) {
          .cst-page {
            padding-bottom: 88px;
          }

          .cst-intro {
            margin-top: 0;
            margin-bottom: 12px;
            font-size: 11.5px;
          }

          .cst-warning,
          .cst-errors {
            padding: 11px 12px;
            border-radius: 9px;
            font-size: 10.5px;
          }

          .cst-list {
            gap: 12px;
          }

          .cst-template {
            border-radius: 10px;
          }

          .cst-template__header {
            gap: 12px;
            padding: 14px;
          }

          .cst-template__title {
            font-size: 14px;
          }

          .cst-switch {
            min-height: 38px;
          }

          .cst-body {
            padding: 14px;
          }

          .cst-section {
            margin-bottom: 20px;
          }

          .cst-grid,
          .cst-grid--3,
          .cst-components,
          .cst-condition,
          .cst-condition--metafield,
          .cst-condition--metafield-no-value {
            grid-template-columns:
              1fr;
          }

          .cst-input,
          .cst-select {
            min-height: 42px;
            font-size: 12px;
          }

          .cst-component {
            padding: 12px;
          }

          .cst-component__header {
            align-items: stretch;
            flex-direction: column;
          }

          .cst-edit-button {
            width: 100%;
            min-height: 40px;
          }

          .cst-rule-mode {
            align-items: stretch;
            flex-direction: column;
          }

          .cst-rule-mode select {
            width: 100%;
          }

          .cst-rule-actions {
            flex-direction: column;
          }

          .cst-add,
          .cst-done,
          .cst-remove {
            width: 100%;
            min-height: 40px;
          }

          .cst-save-wrap {
            position: fixed;
            right: 10px;
            bottom: 10px;
            left: 10px;
            z-index: 30;
            align-items: stretch;
            flex-direction: column;
            gap: 7px;
            margin: 0;
            padding: 9px;
            border-radius: 10px;
          }

          .cst-save-status {
            padding-left: 0;
            text-align: center;
          }

          .cst-save {
            width: 100%;
            min-height: 44px;
          }
        }
      `}</style>

      <div className="cst-page">

        <p className="cst-intro">
          Define qué productos forman cada combinación de Bundles, qué condiciones deben cumplir y qué metacampos utiliza la app para comprobar compatibilidad.
        </p>

        <div className="cst-warning">
          <strong>
            Motor conectado:
          </strong>{" "}
          los cambios guardados en estas plantillas modifican las propuestas de Bundles sin editar código.
        </div>

        {data.errors.length >
          0 && (
          <div className="cst-errors">
            <strong>
              Algunas configuraciones de Shopify no pudieron cargarse:
            </strong>

            <br />

            {data.errors.join(
              " | ",
            )}
          </div>
        )}

        <div className="cst-list">

          {templates.map(
            (template) => (
              <div
                className="cst-template"
                key={
                  template.id
                }
              >

                {/* HEADER */}

                <div className="cst-template__header">

                  <div>

                    <h2 className="cst-template__title">
                      {template.name}
                    </h2>

                    <div className="cst-template__id">
                      {template.id}
                    </div>

                  </div>

                  <label className="cst-switch">

                    <input
                      type="checkbox"
                      checked={
                        template.enabled
                      }
                      onChange={(event) =>
                        patchTemplate(
                          template.id,
                          {
                            enabled:
                              event.target.checked,
                          },
                        )
                      }
                    />

                    Plantilla activa

                  </label>

                </div>

                <div className="cst-body">

                  {/* IDENTIFICATION */}

                  <div className="cst-section">

                    <h3 className="cst-section__title">
                      Identificación
                    </h3>

                    <p className="cst-section__description">
                      Nombre interno y tipo de plantilla.
                    </p>

                    <div className="cst-grid">

                      <div className="cst-field">

                        <label className="cst-label">
                          Nombre de plantilla
                        </label>

                        <input
                          className="cst-input"
                          value={
                            template.name
                          }
                          onChange={(event) =>
                            patchTemplate(
                              template.id,
                              {
                                name:
                                  event.target.value,
                              },
                            )
                          }
                        />

                      </div>

                      <div className="cst-field">

                        <label className="cst-label">
                          Tipo de plantilla
                        </label>

                        <input
                          className="cst-input"
                          value="PC + Monitor"
                          disabled
                        />

                      </div>

                    </div>

                  </div>

                  {/* COMPONENT RULES */}

                  <div className="cst-section">

                    <h3 className="cst-section__title">
                      Productos incluidos en Bundles
                    </h3>

                    <p className="cst-section__description">
                      Cada componente puede utilizar una o más condiciones. Define si deben cumplirse todas o cualquiera de ellas.
                    </p>

                    <div className="cst-components">

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

                  </div>

                  {/* TECHNICAL COMPATIBILITY */}

                  <div className="cst-section">

                    <h3 className="cst-section__title">
                      Compatibilidad técnica
                    </h3>

                    <p className="cst-section__description">
                      Define los metacampos utilizados para Wi-Fi y compatibilidad entre las salidas del computador y las entradas del monitor.
                    </p>

                    <div className="cst-grid">

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

                      <div className="cst-field">

                        <label className="cst-label">
                          Valor que significa “sin Wi-Fi”
                        </label>

                        <input
                          className="cst-input"
                          value={
                            template.wifiNoValue
                          }
                          onChange={(event) =>
                            patchTemplate(
                              template.id,
                              {
                                wifiNoValue:
                                  event.target.value,
                              },
                            )
                          }
                        />

                      </div>

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

                      <div className="cst-field">

                        <label className="cst-label">
                          Regla de compatibilidad
                        </label>

                        <select
                          className="cst-select"
                          value={
                            template.compatibilityOperator
                          }
                          disabled
                        >
                          <option value="intersection">
                            Coincidencia directa de puertos
                          </option>
                        </select>

                      </div>

                    </div>

                  </div>

                  {/* GENERATED PRODUCT */}

                  <div className="cst-section">

                    <h3 className="cst-section__title">
                      Producto generado
                    </h3>

                    <p className="cst-section__description">
                      Define cómo se identificará el producto de Bundles creado en Shopify.
                    </p>

                    <div className="cst-grid cst-grid--3">

                      <div className="cst-field">

                        <label className="cst-label">
                          Prefijo del nombre
                        </label>

                        <input
                          className="cst-input"
                          value={
                            template.titlePrefix
                          }
                          onChange={(event) =>
                            patchTemplate(
                              template.id,
                              {
                                titlePrefix:
                                  event.target.value,
                              },
                            )
                          }
                        />

                      </div>

                      <div className="cst-field">

                        <label className="cst-label">
                          Sufijo del monitor
                        </label>

                        <input
                          className="cst-input"
                          placeholder="Opcional"
                          value={
                            template.monitorSuffix
                          }
                          onChange={(event) =>
                            patchTemplate(
                              template.id,
                              {
                                monitorSuffix:
                                  event.target.value,
                              },
                            )
                          }
                        />

                      </div>

                      <div className="cst-field">

                        <label className="cst-label">
                          Prefijo SKU
                        </label>

                        <input
                          className="cst-input"
                          value={
                            template.skuPrefix
                          }
                          onChange={(event) =>
                            patchTemplate(
                              template.id,
                              {
                                skuPrefix:
                                  event.target.value,
                              },
                            )
                          }
                        />

                      </div>

                      <div className="cst-field">

                        <label className="cst-label">
                          Tipo de producto generado
                        </label>

                        <select
                          className="cst-select"
                          value={
                            template.generatedProductType
                          }
                          onChange={(event) =>
                            patchTemplate(
                              template.id,
                              {
                                generatedProductType:
                                  event.target.value,
                              },
                            )
                          }
                        >

                          <option value="">
                            Seleccionar...
                          </option>

                          {data.productTypes.map(
                            (productType) => (
                              <option
                                key={
                                  productType
                                }
                                value={
                                  productType
                                }
                              >
                                {productType}
                              </option>
                            ),
                          )}

                        </select>

                      </div>

                      <div className="cst-field">

                        <label className="cst-label">
                          Proveedor
                        </label>

                        <input
                          className="cst-input"
                          value={
                            template.vendor
                          }
                          onChange={(event) =>
                            patchTemplate(
                              template.id,
                              {
                                vendor:
                                  event.target.value,
                              },
                            )
                          }
                        />

                      </div>

                      <div className="cst-field">

                        <label className="cst-label">
                          Estado inicial
                        </label>

                        <input
                          className="cst-input"
                          value="Borrador"
                          disabled
                        />

                      </div>

                    </div>

                    <div className="cst-preview">

                      <div className="cst-preview__label">
                        Vista previa del nombre
                      </div>

                      <div className="cst-preview__value">

                        {template.titlePrefix ||
                          "Combo"}{" "}

                        {"{COMPUTADOR}"} + Monitor{" "}

                        {"{MONITOR}"}

                        {template.monitorSuffix
                          ? ` ${template.monitorSuffix}`
                          : ""}

                      </div>

                    </div>

                    <div className="cst-preview">

                      <div className="cst-preview__label">
                        Vista previa SKU
                      </div>

                      <div className="cst-preview__value">
                        {template.skuPrefix}
                        {"{SKU_PC}"}
                      </div>

                    </div>

                  </div>

                </div>

              </div>
            ),
          )}

        </div>

        {/* SAVE */}

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

          <div className="cst-save-wrap">

            <div
              className={
                dirty
                  ? "cst-save-status cst-save-status--dirty"
                  : "cst-save-status"
              }
            >
              {saving
                ? "Guardando cambios..."
                : dirty
                  ? "Hay cambios sin guardar"
                  : "Configuración guardada"}
            </div>

            <button
              className="cst-save"
              type="submit"
              disabled={
                saving ||
                !dirty
              }
            >
              {saving
                ? "Guardando..."
                : "Guardar plantillas"}
            </button>

          </div>

        </fetcher.Form>

      </div>

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
    <div
      className={
        editing
          ? "cst-component cst-component--editing"
          : "cst-component"
      }
    >

      <div className="cst-component__header">

        <div>

          <div className="cst-component__title">
            {label}
          </div>

          <div className="cst-component__count">

            {rule.conditions.length}{" "}

            {rule.conditions.length ===
            1
              ? "condición"
              : "condiciones"}

            {" · "}

            {rule.match ===
            "all"
              ? "Todas"
              : "Cualquiera"}

          </div>

        </div>

        <button
          type="button"
          className="cst-edit-button"
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
        </button>

      </div>

      {!editing && (
        <div className="cst-component__summary">

          {rule.conditions
            .slice(
              0,
              3,
            )
            .map(
              (condition) => (
                <div
                  className="cst-summary-item"
                  key={
                    condition.id
                  }
                >
                  {summarizeCondition(
                    condition,
                  )}
                </div>
              ),
            )}

          {rule.conditions.length >
            3 && (
            <div className="cst-summary-item">
              +{" "}
              {rule.conditions.length -
                3}{" "}
              condición(es)
            </div>
          )}

        </div>
      )}

      {editing && (
        <div className="cst-rule-editor">

          <div className="cst-rule-mode">

            <span className="cst-rule-mode__label">
              Cumplir
            </span>

            <select
              className="cst-select"
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
                      event.target.value ===
                      "any"
                        ? "any"
                        : "all",
                  }),
                )
              }
            >

              <option value="all">
                Todas las condiciones (AND)
              </option>

              <option value="any">
                Cualquier condición (OR)
              </option>

            </select>

          </div>

          <div className="cst-condition-list">

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

          </div>

          <div className="cst-rule-actions">

            <button
              type="button"
              className="cst-add"
              onClick={() =>
                addCondition(
                  templateId,
                  ruleKey,
                )
              }
            >
              + Agregar condición
            </button>

            <button
              type="button"
              className="cst-done"
              onClick={() =>
                setEditingRule(
                  null,
                )
              }
            >
              Listo
            </button>

          </div>

        </div>
      )}

    </div>
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

  let className =
    "cst-condition";

  if (
    isMetafield &&
    valueRequired
  ) {
    className +=
      " cst-condition--metafield";
  }

  if (
    isMetafield &&
    !valueRequired
  ) {
    className +=
      " cst-condition--metafield-no-value";
  }

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
    <div className={className}>

      {/* FIELD */}

      <div className="cst-condition__field">

        <label>
          Campo
        </label>

        <select
          className="cst-select"
          value={
            condition.source
          }
          onChange={(event) =>
            changeSource(
              event.target
                .value as RuleConditionSource,
            )
          }
        >

          <option value="product_type">
            Tipo de producto
          </option>

          <option value="metafield">
            Metacampo
          </option>

          <option value="sku">
            SKU
          </option>

          <option value="title">
            Título
          </option>

          <option value="vendor">
            Proveedor
          </option>

          <option value="status">
            Estado
          </option>

          <option value="stock">
            Stock
          </option>

          <option value="tag">
            Tag
          </option>

        </select>

      </div>

      {/* METAFIELD */}

      {isMetafield && (
        <div className="cst-condition__field">

          <label>
            Metacampo
          </label>

          <select
            className="cst-select"
            value={
              metafieldToValue(
                condition.metafield,
              )
            }
            onChange={(event) =>
              onChange({
                metafield:
                  valueToMetafield(
                    event.target.value,
                  ),
              })
            }
          >

            <option value="">
              Seleccionar metacampo...
            </option>

            {metafields.map(
              (field) => (
                <option
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
                </option>
              ),
            )}

          </select>

        </div>
      )}

      {/* OPERATOR */}

      <div className="cst-condition__field">

        <label>
          Operador
        </label>

        <select
          className="cst-select"
          value={
            condition.operator
          }
          onChange={(event) =>
            changeOperator(
              event.target
                .value as RuleConditionOperator,
            )
          }
        >

          {operators.map(
            (operator) => (
              <option
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
              </option>
            ),
          )}

        </select>

      </div>

      {/* VALUE */}

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

      {/* REMOVE */}

      <button
        type="button"
        className="cst-remove"
        disabled={
          !canRemove
        }
        title={
          canRemove
            ? "Eliminar condición"
            : "Debe existir al menos una condición"
        }
        onClick={
          onRemove
        }
      >
        Eliminar
      </button>

    </div>
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
      <div className="cst-condition__field">

        <label>
          Tipo de producto
        </label>

        <select
          className="cst-select"
          value={
            condition.value
          }
          onChange={(event) =>
            onChange(
              event.target.value,
            )
          }
        >

          <option value="">
            Seleccionar...
          </option>

          {productTypes.map(
            (productType) => (
              <option
                key={
                  productType
                }
                value={
                  productType
                }
              >
                {productType}
              </option>
            ),
          )}

        </select>

      </div>
    );
  }

  if (
    condition.source ===
    "status"
  ) {
    return (
      <div className="cst-condition__field">

        <label>
          Estado
        </label>

        <select
          className="cst-select"
          value={
            condition.value
          }
          onChange={(event) =>
            onChange(
              event.target.value,
            )
          }
        >

          <option value="ACTIVE">
            Activo
          </option>

          <option value="DRAFT">
            Borrador
          </option>

          <option value="ARCHIVED">
            Archivado
          </option>

          <option value="UNLISTED">
            No listado
          </option>

        </select>

      </div>
    );
  }

  if (
    condition.source ===
    "stock"
  ) {
    return (
      <div className="cst-condition__field">

        <label>
          Cantidad
        </label>

        <input
          className="cst-input"
          type="number"
          value={
            condition.value
          }
          onChange={(event) =>
            onChange(
              event.target.value,
            )
          }
        />

      </div>
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
    <div className="cst-condition__field">

      <label>
        Valor
      </label>

      <input
        className="cst-input"
        placeholder={
          placeholder
        }
        value={
          condition.value
        }
        onChange={(event) =>
          onChange(
            event.target.value,
          )
        }
      />

    </div>
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
    <div className="cst-field">

      <label className="cst-label">
        {label}
      </label>

      <select
        className="cst-select"
        value={
          metafieldToValue(
            value,
          )
        }
        onChange={(event) =>
          onChange(
            valueToMetafield(
              event.target.value,
            ),
          )
        }
      >

        <option value="">
          Seleccionar metacampo...
        </option>

        {metafields.map(
          (field) => (
            <option
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
            </option>
          ),
        )}

      </select>

    </div>
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