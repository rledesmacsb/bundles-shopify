import {
  useEffect,
  useMemo,
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

import {
  buildPcMonitorBundleState,
  calculateBundlePrice,
  formatPrice,
  getBundleIdentity,
  type BundlePriceMode,
  type BundlePriceRounding,
} from "../lib/bundle-engine";

import {
  loadPcMonitorBundleData,
  savePcMonitorPriceConfig,
} from "../lib/bundle-data.server";

/* =========================================================
   LOADER
========================================================= */

export const loader =
  async ({
    request,
  }: LoaderFunctionArgs) => {
    const {
      admin,
    } =
      await authenticate.admin(
        request,
      );

    return loadPcMonitorBundleData(
      admin,
    );
  };

/* =========================================================
   ACTION
========================================================= */

export const action =
  async ({
    request,
  }: ActionFunctionArgs) => {
    const {
      admin,
    } =
      await authenticate.admin(
        request,
      );

    const formData =
      await request.formData();

    const rawMode =
      String(
        formData.get(
          "mode",
        ) ??
          "none",
      );

    const mode:
      BundlePriceMode =
      rawMode ===
        "percentage" ||
      rawMode ===
        "fixed"
        ? rawMode
        : "none";

    const percentageValue =
      Number(
        formData.get(
          "percentage",
        ) ??
          0,
      );

    const fixedAmountValue =
      Number(
        formData.get(
          "fixedAmount",
        ) ??
          0,
      );

    const rawRounding =
      String(
        formData.get(
          "rounding",
        ) ??
          "none",
      );

    const rounding:
      BundlePriceRounding =
      rawRounding ===
      "x900"
        ? "x900"
        : "none";

    const percentage =
      Number.isFinite(
        percentageValue,
      )
        ? Math.max(
            0,
            Math.min(
              100,
              percentageValue,
            ),
          )
        : 0;

    const fixedAmount =
      Number.isFinite(
        fixedAmountValue,
      )
        ? Math.max(
            0,
            fixedAmountValue,
          )
        : 0;

    return savePcMonitorPriceConfig(
      admin,
      {
        configured:
          true,

        mode,

        percentage,

        fixedAmount,

        rounding,
      },
    );
  };

/* =========================================================
   HELPERS
========================================================= */

function formatSignedPrice(
  value:
    number,
  currencyCode:
    string,
) {
  if (
    value ===
    0
  ) {
    return formatPrice(
      0,
      currencyCode,
    );
  }

  const absolute =
    formatPrice(
      Math.abs(
        value,
      ),
      currencyCode,
    );

  return value >
    0
    ? `+${absolute}`
    : `-${absolute}`;
}

/* =========================================================
   COMPONENT
========================================================= */

export default function Rules() {
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

  const state =
    useMemo(
      () =>
        buildPcMonitorBundleState(
          data.products,
          data.config,
        ),
      [
        data.products,
        data.config,
      ],
    );

  const [
    mode,
    setMode,
  ] =
    useState<
      BundlePriceMode
    >(
      data.priceConfig.mode,
    );

  const [
    percentage,
    setPercentage,
  ] =
    useState(
      String(
        data.priceConfig
          .percentage,
      ),
    );

  const [
    fixedAmount,
    setFixedAmount,
  ] =
    useState(
      String(
        data.priceConfig
          .fixedAmount,
      ),
    );

  const [
    rounding,
    setRounding,
  ] =
    useState<
      BundlePriceRounding
    >(
      data.priceConfig
        .rounding,
    );

  const [
    exampleCandidateId,
    setExampleCandidateId,
  ] =
    useState(
      state
        .desktopCandidates[0]
        ?.id ??
        "",
    );

  useEffect(() => {
    if (
      fetcher.data?.message
    ) {
      shopify.toast.show(
        fetcher.data.message,
      );
    }
  }, [
    fetcher.data,
    shopify,
  ]);

  useEffect(() => {
    if (
      !state
        .desktopCandidates
        .some(
          (candidate) =>
            candidate.id ===
            exampleCandidateId,
        )
    ) {
      setExampleCandidateId(
        state
          .desktopCandidates[0]
          ?.id ??
          "",
      );
    }
  }, [
    state.desktopCandidates,
    exampleCandidateId,
  ]);

  const previewConfig =
    useMemo(
      () => ({
        configured:
          true,

        mode,

        percentage:
          Number(
            percentage,
          ) ||
          0,

        fixedAmount:
          Number(
            fixedAmount,
          ) ||
          0,

        rounding,
      }),
      [
        mode,
        percentage,
        fixedAmount,
        rounding,
      ],
    );

  const exampleCandidate =
    state.desktopCandidates.find(
      (candidate) =>
        candidate.id ===
        exampleCandidateId,
    ) ??
    state
      .desktopCandidates[0] ??
    null;

  const preview =
    exampleCandidate
      ? calculateBundlePrice(
          exampleCandidate,
          previewConfig,
        )
      : null;

  const identity =
    exampleCandidate
      ? getBundleIdentity(
          exampleCandidate,
        )
      : null;

  const saving =
    fetcher.state !==
    "idle";

  return (
    <s-page heading="Reglas y cálculo" inlineSize="large">

      <style>{`
        /*
         * Evita que padding y border aumenten
         * el ancho real de inputs y selects.
         */
        .csr-page,
        .csr-page *,
        .csr-page *::before,
        .csr-page *::after {
          box-sizing: border-box;
        }

        .csr-page {
          width: 100%;
          max-width: none;
          margin: 0;
          padding-bottom: 24px;
        }

        .csr-intro {
          max-width: 860px;
          margin: 4px 2px 18px;
          color: #69727d;
          font-size: 12px;
          line-height: 1.55;
        }

        .csr-grid {
          display: grid;
          grid-template-columns:
            minmax(0, 1.25fr)
            minmax(380px, .75fr);
          gap: 16px;
          align-items: start;
          width: 100%;
        }

        /*
         * Muy importante con CSS Grid:
         * permite que las columnas realmente
         * puedan reducir su ancho.
         */
        .csr-grid > * {
          min-width: 0;
        }

        .csr-card {
          min-width: 0;
          width: 100%;
          border: 1px solid #e4e9f0;
          border-radius: 16px;
          background: #fff;
          overflow: hidden;
          box-shadow: 0 1px 2px rgba(31,33,36,.03), 0 8px 22px rgba(31,33,36,.035);
        }

        .csr-card__header {
          padding: 17px 18px;
          border-bottom: 1px solid #ededed;
        }

        .csr-card__title {
          margin: 0 0 4px;
          font-size: 15px;
          font-weight: 700;
          color: #303030;
        }

        .csr-card__description {
          margin: 0;
          color: #616161;
          font-size: 11.5px;
          line-height: 1.45;
        }

        .csr-card__body {
          min-width: 0;
          width: 100%;
          padding: 18px;
        }

        .csr-card__body form {
          min-width: 0;
          width: 100%;
        }

        .csr-section {
          min-width: 0;
          width: 100%;
          margin-bottom: 24px;
        }

        .csr-section:last-child {
          margin-bottom: 0;
        }

        .csr-label {
          display: block;
          margin-bottom: 8px;
          font-size: 11px;
          font-weight: 700;
          color: #303030;
        }

        .csr-options {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
          width: 100%;
        }

        .csr-option {
          display: grid;
          grid-template-columns:
            20px
            minmax(0, 1fr);
          gap: 10px;
          width: 100%;
          min-width: 0;
          padding: 13px;
          border: 1px solid #dfdfdf;
          border-radius: 10px;
          cursor: pointer;
          background: #fff;
        }

        /*
         * El segundo elemento del grid antes tenía
         * min-width:auto y podía forzar la tarjeta
         * hacia afuera.
         */
        .csr-option > div {
          min-width: 0;
          width: 100%;
        }

        .csr-option--selected {
          border-color: #a9c8f8;
          background: #f7faff;
        }

        .csr-option input[type="radio"] {
          margin-top: 2px;
        }

        .csr-option__title {
          margin-bottom: 3px;
          font-size: 12px;
          font-weight: 650;
          color: #303030;
        }

        .csr-option__description {
          color: #6d6d6d;
          font-size: 10.5px;
          line-height: 1.4;
          overflow-wrap: anywhere;
        }

        .csr-field {
          width: 100%;
          min-width: 0;
          max-width: 100%;
          margin-top: 10px;
        }

        .csr-field input,
        .csr-field select {
          display: block;
          width: 100%;
          min-width: 0;
          max-width: 100%;
          min-height: 38px;
          padding: 7px 10px;
          border: 1px solid #c9c9c9;
          border-radius: 8px;
          background: #fff;
          color: #303030;
          font: inherit;
          font-size: 12px;
          box-sizing: border-box;
        }

        .csr-field input:focus,
        .csr-field select:focus {
          outline: none;
          border-color: #0c62f2;
          box-shadow: 0 0 0 1px #0c62f2;
        }

        .csr-help {
          max-width: 100%;
          margin-top: 6px;
          color: #777;
          font-size: 10px;
          line-height: 1.4;
          overflow-wrap: anywhere;
        }

        .csr-save {
          width: 100%;
          max-width: 100%;
          min-height: 40px;
          border: 0;
          border-radius: 9px;
          background: #0c62f2;
          color: #fff;
          font: inherit;
          font-size: 12px;
          font-weight: 650;
          cursor: pointer;
        }

        .csr-save:disabled {
          opacity: .55;
          cursor: default;
        }

        .csr-preview-product {
          min-width: 0;
          margin-bottom: 15px;
          padding-bottom: 14px;
          border-bottom: 1px solid #ededed;
        }

        .csr-preview-product__title {
          margin-bottom: 5px;
          font-size: 12px;
          font-weight: 650;
          line-height: 1.4;
          color: #303030;
          overflow-wrap: anywhere;
        }

        .csr-preview-product__sku {
          color: #777;
          font-size: 10px;
          font-family: monospace;
          overflow-wrap: anywhere;
        }

        .csr-breakdown {
          display: flex;
          flex-direction: column;
          gap: 9px;
          min-width: 0;
          width: 100%;
        }

        .csr-row {
          display: flex;
          justify-content: space-between;
          gap: 15px;
          min-width: 0;
          color: #616161;
          font-size: 11px;
        }

        .csr-row > span {
          min-width: 0;
        }

        .csr-row strong {
          flex-shrink: 0;
          color: #303030;
          text-align: right;
        }

        .csr-row--subtotal {
          padding-top: 9px;
          border-top: 1px solid #ededed;
        }

        .csr-row--discount strong,
        .csr-row--saving strong {
          color: #26733e;
        }

        .csr-row--final {
          margin-top: 4px;
          padding-top: 13px;
          border-top: 1px solid #d9d9d9;
          align-items: center;
        }

        .csr-row--final span {
          font-weight: 650;
          color: #303030;
        }

        .csr-row--final strong {
          font-size: 20px;
        }

        .csr-saving-box {
          width: 100%;
          margin-top: 15px;
          padding: 12px;
          border-radius: 10px;
          background: #f1faf3;
          color: #26733e;
          text-align: center;
          font-size: 11px;
        }

        .csr-saving-box strong {
          font-size: 14px;
        }

        .csr-notice {
          margin-top: 18px;
          padding: 13px 14px;
          border: 1px solid #e4e9f0;
          border-radius: 11px;
          background: #fafafa;
          color: #616161;
          font-size: 11px;
          line-height: 1.45;
        }

        @media (max-width: 850px) {
          .csr-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 500px) {
          .csr-card__header,
          .csr-card__body {
            padding-left: 14px;
            padding-right: 14px;
          }

          .csr-option {
            padding: 12px;
          }

          .csr-row {
            gap: 10px;
          }

          .csr-row--final strong {
            font-size: 18px;
          }
        }
      `}</style>

      <div className="csr-page">

        <p className="csr-intro">
          Configura cómo se calcula el precio final de los bundles PC + Monitor. El descuento se aplica únicamente al computador base; monitor, teclado/mouse y adaptador Wi-Fi mantienen su precio normal.
        </p>

        <div className="csr-grid">

          {/* =================================================
              CONFIG
          ================================================= */}

          <div className="csr-card">

            <div className="csr-card__header">

              <h2 className="csr-card__title">
                Configuración de precio
              </h2>

              <p className="csr-card__description">
                Esta regla se aplicará a todos los bundles generados por esta plantilla.
              </p>

            </div>

            <div className="csr-card__body">

              <fetcher.Form method="post">

                {/* DISCOUNT */}

                <div className="csr-section">

                  <span className="csr-label">
                    Descuento sobre el computador
                  </span>

                  <div className="csr-options">

                    <label
                      className={
                        mode ===
                        "none"
                          ? "csr-option csr-option--selected"
                          : "csr-option"
                      }
                    >

                      <input
                        type="radio"
                        name="mode"
                        value="none"
                        checked={
                          mode ===
                          "none"
                        }
                        onChange={() =>
                          setMode(
                            "none",
                          )
                        }
                      />

                      <div>

                        <div className="csr-option__title">
                          Sin descuento
                        </div>

                        <div className="csr-option__description">
                          El bundle utiliza la suma normal de todos sus componentes.
                        </div>

                      </div>

                    </label>

                    <label
                      className={
                        mode ===
                        "percentage"
                          ? "csr-option csr-option--selected"
                          : "csr-option"
                      }
                    >

                      <input
                        type="radio"
                        name="mode"
                        value="percentage"
                        checked={
                          mode ===
                          "percentage"
                        }
                        onChange={() =>
                          setMode(
                            "percentage",
                          )
                        }
                      />

                      <div>

                        <div className="csr-option__title">
                          Descuento porcentual
                        </div>

                        <div className="csr-option__description">
                          Aplica un porcentaje de descuento únicamente al PC.
                        </div>

                        {mode ===
                          "percentage" && (
                          <div className="csr-field">

                            <input
                              type="number"
                              name="percentage"
                              min="0"
                              max="100"
                              step="0.1"
                              value={
                                percentage
                              }
                              onChange={(event) =>
                                setPercentage(
                                  event.target.value,
                                )
                              }
                            />

                            <div className="csr-help">
                              Ejemplo: 5 significa 5% de descuento sobre el computador.
                            </div>

                          </div>
                        )}

                      </div>

                    </label>

                    <label
                      className={
                        mode ===
                        "fixed"
                          ? "csr-option csr-option--selected"
                          : "csr-option"
                      }
                    >

                      <input
                        type="radio"
                        name="mode"
                        value="fixed"
                        checked={
                          mode ===
                          "fixed"
                        }
                        onChange={() =>
                          setMode(
                            "fixed",
                          )
                        }
                      />

                      <div>

                        <div className="csr-option__title">
                          Descuento fijo
                        </div>

                        <div className="csr-option__description">
                          Resta un monto fijo únicamente al precio del PC.
                        </div>

                        {mode ===
                          "fixed" && (
                          <div className="csr-field">

                            <input
                              type="number"
                              name="fixedAmount"
                              min="0"
                              step="100"
                              value={
                                fixedAmount
                              }
                              onChange={(event) =>
                                setFixedAmount(
                                  event.target.value,
                                )
                              }
                            />

                            <div className="csr-help">
                              Ingresa el monto en pesos, sin puntos.
                            </div>

                          </div>
                        )}

                      </div>

                    </label>

                  </div>

                  {mode !==
                    "percentage" && (
                    <input
                      type="hidden"
                      name="percentage"
                      value={
                        percentage
                      }
                    />
                  )}

                  {mode !==
                    "fixed" && (
                    <input
                      type="hidden"
                      name="fixedAmount"
                      value={
                        fixedAmount
                      }
                    />
                  )}

                </div>

                {/* ROUNDING */}

                <div className="csr-section">

                  <span className="csr-label">
                    Terminación del precio
                  </span>

                  <div className="csr-options">

                    <label
                      className={
                        rounding ===
                        "none"
                          ? "csr-option csr-option--selected"
                          : "csr-option"
                      }
                    >

                      <input
                        type="radio"
                        name="rounding"
                        value="none"
                        checked={
                          rounding ===
                          "none"
                        }
                        onChange={() =>
                          setRounding(
                            "none",
                          )
                        }
                      />

                      <div>

                        <div className="csr-option__title">
                          Sin redondeo
                        </div>

                        <div className="csr-option__description">
                          Mantiene exactamente el precio obtenido después del descuento.
                        </div>

                      </div>

                    </label>

                    <label
                      className={
                        rounding ===
                        "x900"
                          ? "csr-option csr-option--selected"
                          : "csr-option"
                      }
                    >

                      <input
                        type="radio"
                        name="rounding"
                        value="x900"
                        checked={
                          rounding ===
                          "x900"
                        }
                        onChange={() =>
                          setRounding(
                            "x900",
                          )
                        }
                      />

                      <div>

                        <div className="csr-option__title">
                          Terminar en $900
                        </div>

                        <div className="csr-option__description">
                          Lleva el precio al valor terminado en $900 más cercano. Por ejemplo, $190.605 pasa a $190.900.
                        </div>

                      </div>

                    </label>

                  </div>

                </div>

                <button
                  className="csr-save"
                  type="submit"
                  disabled={
                    saving
                  }
                >
                  {saving
                    ? "Guardando..."
                    : "Guardar reglas"}
                </button>

              </fetcher.Form>

            </div>

          </div>

          {/* =================================================
              PREVIEW
          ================================================= */}

          <div className="csr-card">

            <div className="csr-card__header">

              <h2 className="csr-card__title">
                Ejemplo de cálculo
              </h2>

              <p className="csr-card__description">
                Vista previa usando un bundle real disponible.
              </p>

            </div>

            <div className="csr-card__body">

              {state
                .desktopCandidates
                .length >
              0 ? (
                <>

                  <div className="csr-section">

                    <label className="csr-label">
                      Producto de ejemplo
                    </label>

                    <div className="csr-field">

                      <select
                        value={
                          exampleCandidateId
                        }
                        onChange={(event) =>
                          setExampleCandidateId(
                            event.target.value,
                          )
                        }
                      >
                        {state
                          .desktopCandidates
                          .map(
                            (candidate) => {
                              const candidateIdentity =
                                getBundleIdentity(
                                  candidate,
                                );

                              return (
                                <option
                                  key={
                                    candidate.id
                                  }
                                  value={
                                    candidate.id
                                  }
                                >
                                  {
                                    candidateIdentity.title
                                  }
                                </option>
                              );
                            },
                          )}
                      </select>

                    </div>

                  </div>

                  {exampleCandidate &&
                    preview &&
                    identity && (
                    <>

                      <div className="csr-preview-product">

                        <div className="csr-preview-product__title">
                          {
                            identity.title
                          }
                        </div>

                        <div className="csr-preview-product__sku">
                          {
                            identity.sku
                          }
                        </div>

                      </div>

                      <div className="csr-breakdown">

                        <div className="csr-row">

                          <span>
                            Precio PC
                          </span>

                          <strong>
                            {formatPrice(
                              preview.baseProductPrice,
                              data.currencyCode,
                            )}
                          </strong>

                        </div>

                        <div className="csr-row csr-row--discount">

                          <span>
                            Descuento PC
                          </span>

                          <strong>
                            {preview.discountAmount >
                            0
                              ? `-${formatPrice(
                                  preview.discountAmount,
                                  data.currencyCode,
                                )}`
                              : formatPrice(
                                  0,
                                  data.currencyCode,
                                )}
                          </strong>

                        </div>

                        <div className="csr-row">

                          <span>
                            PC con descuento
                          </span>

                          <strong>
                            {formatPrice(
                              preview.discountedBaseProductPrice,
                              data.currencyCode,
                            )}
                          </strong>

                        </div>

                        <div className="csr-row">

                          <span>
                            Otros componentes
                          </span>

                          <strong>
                            {formatPrice(
                              preview.otherComponentsPrice,
                              data.currencyCode,
                            )}
                          </strong>

                        </div>

                        <div className="csr-row csr-row--subtotal">

                          <span>
                            Precio calculado
                          </span>

                          <strong>
                            {formatPrice(
                              preview.calculatedPrice,
                              data.currencyCode,
                            )}
                          </strong>

                        </div>

                        {rounding ===
                          "x900" && (
                          <div className="csr-row">

                            <span>
                              Ajuste para terminar en $900
                            </span>

                            <strong>
                              {formatSignedPrice(
                                preview.roundingAdjustment,
                                data.currencyCode,
                              )}
                            </strong>

                          </div>
                        )}

                        <div className="csr-row csr-row--final">

                          <span>
                            Precio final
                          </span>

                          <strong>
                            {formatPrice(
                              preview.finalPrice,
                              data.currencyCode,
                            )}
                          </strong>

                        </div>

                      </div>

                      <div className="csr-saving-box">

                        Ahorro total{" "}

                        <strong>
                          {formatPrice(
                            preview.savings,
                            data.currencyCode,
                          )}
                        </strong>

                        {" · "}

                        {
                          preview.savingsPercentage.toFixed(
                            1,
                          )
                        }
                        %

                      </div>

                    </>
                  )}

                </>
              ) : (
                <div className="csr-notice">
                  Todavía no existe un bundle PC + Monitor elegible para utilizar como ejemplo.
                </div>
              )}

            </div>

          </div>

        </div>

        <div className="csr-notice">
          El redondeo puede aumentar o disminuir algunos cientos de pesos respecto del precio calculado, pero nunca permitirá que el bundle termine más caro que comprar sus componentes individualmente.
        </div>

      </div>

    </s-page>
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