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
  savePcMonitorPriceConfig,
} from "../lib/bundle-data.server";

import {
  invalidateShopBundleCache,
  loadCachedPcMonitorBundleData,
} from "../lib/bundle-cache.server";

/* =========================================================
   LOADER
========================================================= */

export const loader =
  async ({
    request,
  }: LoaderFunctionArgs) => {
    const {
      admin,
      session,
    } =
      await authenticate.admin(
        request,
      );

    return loadCachedPcMonitorBundleData(
      admin,
      session.shop,
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
      session,
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

    const result =
      await savePcMonitorPriceConfig(
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
    <s-page
      heading="Reglas y cálculo"
      inlineSize="large"
    >

      <s-stack gap="base">

        <s-section>

          <s-paragraph>
            Configura cómo se calcula el precio final de los Bundles PC + Monitor. El descuento se aplica únicamente al computador base; monitor, teclado/mouse y adaptador Wi-Fi mantienen su precio normal.
          </s-paragraph>

        </s-section>

        <s-query-container>

          <s-grid
            gridTemplateColumns="@container (inline-size > 900px) minmax(0, 1.2fr) minmax(340px, .8fr), 1fr"
            gap="base"
          >

            <s-section heading="Configuración de precio">

              <fetcher.Form method="post">

                <s-stack gap="base">

                  <s-select
                    label="Descuento sobre el computador"
                    name="mode"
                    value={
                      mode
                    }
                    onChange={(event) =>
                      setMode(
                        event.currentTarget
                          .value as BundlePriceMode,
                      )
                    }
                  >
                    <s-option value="none">
                      Sin descuento
                    </s-option>
                    <s-option value="percentage">
                      Descuento porcentual
                    </s-option>
                    <s-option value="fixed">
                      Descuento fijo
                    </s-option>
                  </s-select>

                  {mode ===
                    "percentage" && (
                    <s-number-field
                      label="Porcentaje de descuento"
                      name="percentage"
                      value={
                        percentage
                      }
                      min={0}
                      max={100}
                      step={0.1}
                      suffix="%"
                      details="Se aplica únicamente al precio del PC."
                      onChange={(event) =>
                        setPercentage(
                          event.currentTarget.value,
                        )
                      }
                    />
                  )}

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

                  {mode ===
                    "fixed" && (
                    <s-number-field
                      label="Monto de descuento"
                      name="fixedAmount"
                      value={
                        fixedAmount
                      }
                      min={0}
                      step={100}
                      prefix="$"
                      details="Ingresa el monto en pesos, sin puntos."
                      onChange={(event) =>
                        setFixedAmount(
                          event.currentTarget.value,
                        )
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

                  <s-select
                    label="Terminación del precio"
                    name="rounding"
                    value={
                      rounding
                    }
                    onChange={(event) =>
                      setRounding(
                        event.currentTarget
                          .value as BundlePriceRounding,
                      )
                    }
                  >
                    <s-option value="none">
                      Sin redondeo
                    </s-option>
                    <s-option value="x900">
                      Terminar en $900
                    </s-option>
                  </s-select>

                  <s-banner
                    tone="info"
                    heading="Regla de seguridad"
                  >
                    El redondeo nunca permitirá que un Bundles termine más caro que comprar sus componentes individualmente.
                  </s-banner>

                  <s-button
                    type="submit"
                    variant="primary"
                    disabled={
                      saving
                    }
                  >
                    {saving
                      ? "Guardando..."
                      : "Guardar reglas"}
                  </s-button>

                </s-stack>

              </fetcher.Form>

            </s-section>

            <s-section heading="Ejemplo de cálculo">

              {state
                .desktopCandidates
                .length >
              0 ? (
                <s-stack gap="base">

                  <s-select
                    label="Producto de ejemplo"
                    value={
                      exampleCandidateId
                    }
                    onChange={(event) =>
                      setExampleCandidateId(
                        event.currentTarget.value,
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
                            <s-option
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
                            </s-option>
                          );
                        },
                      )}
                  </s-select>

                  {exampleCandidate &&
                    preview &&
                    identity && (
                    <>

                      <s-stack gap="small">

                        <s-text>
                          {
                            identity.title
                          }
                        </s-text>

                        <s-text tone="neutral">
                          SKU:{" "}
                          {
                            identity.sku
                          }
                        </s-text>

                      </s-stack>

                      <s-divider />

                      <s-grid
                        gridTemplateColumns="1fr auto"
                        gap="small"
                      >
                        <s-text tone="neutral">
                          Precio PC
                        </s-text>
                        <s-text>
                          {formatPrice(
                            preview.baseProductPrice,
                            data.currencyCode,
                          )}
                        </s-text>
                      </s-grid>

                      <s-grid
                        gridTemplateColumns="1fr auto"
                        gap="small"
                      >
                        <s-text tone="neutral">
                          Descuento PC
                        </s-text>
                        <s-text tone="success">
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
                        </s-text>
                      </s-grid>

                      <s-grid
                        gridTemplateColumns="1fr auto"
                        gap="small"
                      >
                        <s-text tone="neutral">
                          PC con descuento
                        </s-text>
                        <s-text>
                          {formatPrice(
                            preview.discountedBaseProductPrice,
                            data.currencyCode,
                          )}
                        </s-text>
                      </s-grid>

                      <s-grid
                        gridTemplateColumns="1fr auto"
                        gap="small"
                      >
                        <s-text tone="neutral">
                          Otros componentes
                        </s-text>
                        <s-text>
                          {formatPrice(
                            preview.otherComponentsPrice,
                            data.currencyCode,
                          )}
                        </s-text>
                      </s-grid>

                      <s-divider />

                      <s-grid
                        gridTemplateColumns="1fr auto"
                        gap="small"
                      >
                        <s-text tone="neutral">
                          Precio calculado
                        </s-text>
                        <s-text>
                          {formatPrice(
                            preview.calculatedPrice,
                            data.currencyCode,
                          )}
                        </s-text>
                      </s-grid>

                      {rounding ===
                        "x900" && (
                        <s-grid
                          gridTemplateColumns="1fr auto"
                          gap="small"
                        >
                          <s-text tone="neutral">
                            Ajuste a $900
                          </s-text>
                          <s-text>
                            {formatSignedPrice(
                              preview.roundingAdjustment,
                              data.currencyCode,
                            )}
                          </s-text>
                        </s-grid>
                      )}

                      <s-divider />

                      <s-grid
                        gridTemplateColumns="1fr auto"
                        gap="small"
                      >
                        <s-text>
                          Precio final
                        </s-text>
                        <s-heading>
                          {formatPrice(
                            preview.finalPrice,
                            data.currencyCode,
                          )}
                        </s-heading>
                      </s-grid>

                      <s-banner
                        tone="success"
                        heading="Ahorro total"
                      >
                        {formatPrice(
                          preview.savings,
                          data.currencyCode,
                        )}{" "}
                        ·{" "}
                        {
                          preview.savingsPercentage.toFixed(
                            1,
                          )
                        }
                        %
                      </s-banner>

                    </>
                  )}

                </s-stack>
              ) : (
                <s-banner
                  tone="info"
                  heading="Sin ejemplo disponible"
                >
                  Todavía no existe una combinación de Bundles PC + Monitor elegible para utilizar como ejemplo.
                </s-banner>
              )}

            </s-section>

          </s-grid>

        </s-query-container>

      </s-stack>

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