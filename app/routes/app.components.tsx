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

import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";

import {
  buildPcMonitorBundleState,
  cleanMonitorTitle,
  cleanPcTitle,
  formatPrice,
  getBundlePrice,
  getProductInfo,
  getPrice,
  isDirectlyCompatible,
  type ProductNode,
} from "../lib/bundle-engine";

import {
  parseStoredIds,
  savePcMonitorBundleConfig,
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

    const selectedMonitorRaw =
      formData.get(
        "selectedMonitorIds",
      );

    const selectedKeyboardRaw =
      formData.get(
        "selectedKeyboardMouseIds",
      );

    const selectedWifiRaw =
      formData.get(
        "selectedWifiAdapterIds",
      );

    const primaryKeyboardRaw =
      formData.get(
        "primaryKeyboardMouseId",
      );

    const primaryWifiRaw =
      formData.get(
        "primaryWifiAdapterId",
      );

    if (
      typeof selectedMonitorRaw !==
        "string" ||
      typeof selectedKeyboardRaw !==
        "string" ||
      typeof selectedWifiRaw !==
        "string"
    ) {
      return {
        success: false,

        message:
          "La configuración recibida no es válida.",
      };
    }

    const selectedMonitorIds =
      parseStoredIds(
        selectedMonitorRaw,
      );

    const selectedKeyboardMouseIds =
      parseStoredIds(
        selectedKeyboardRaw,
      );

    const selectedWifiAdapterIds =
      parseStoredIds(
        selectedWifiRaw,
      );

    const primaryKeyboardMouseId =
      typeof primaryKeyboardRaw ===
        "string" &&
      selectedKeyboardMouseIds.includes(
        primaryKeyboardRaw,
      )
        ? primaryKeyboardRaw
        : selectedKeyboardMouseIds[0] ??
          null;

    const primaryWifiAdapterId =
      typeof primaryWifiRaw ===
        "string" &&
      selectedWifiAdapterIds.includes(
        primaryWifiRaw,
      )
        ? primaryWifiRaw
        : selectedWifiAdapterIds[0] ??
          null;

    const result =
      await savePcMonitorBundleConfig(
        admin,
        {
          selectedMonitorIds,
          selectedKeyboardMouseIds,
          selectedWifiAdapterIds,

          primaryKeyboardMouseId,
          primaryWifiAdapterId,
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
   THUMB
========================================================= */

function ProductThumb({
  product,
  size = "base",
}: {
  product:
    | ProductNode
    | null
    | undefined;

  size?:
    | "small"
    | "small-200"
    | "small-100"
    | "base"
    | "large"
    | "large-100";
}) {
  return (
    <s-thumbnail
      src={
        product
          ?.featuredImage
          ?.url
      }
      alt={
        product
          ?.featuredImage
          ?.altText ??
        product
          ?.title ??
        "Sin imagen"
      }
      size={
        size
      }
    />
  );
}

/* =========================================================
   COMPONENT
========================================================= */

export default function Components() {
  const data =
    useLoaderData<
      typeof loader
    >();

  const shopify =
    useAppBridge();

  const fetcher =
    useFetcher<
      typeof action
    >();

  const [
    selectedMonitorIds,
    setSelectedMonitorIds,
  ] = useState(
    data.config.selectedMonitorIds,
  );

  const [
    selectedKeyboardMouseIds,
    setSelectedKeyboardMouseIds,
  ] = useState(
    data.config
      .selectedKeyboardMouseIds,
  );

  const [
    selectedWifiAdapterIds,
    setSelectedWifiAdapterIds,
  ] = useState(
    data.config
      .selectedWifiAdapterIds,
  );

  const [
    primaryKeyboardMouseId,
    setPrimaryKeyboardMouseId,
  ] = useState<string | null>(
    data.config
      .primaryKeyboardMouseId,
  );

  const [
    primaryWifiAdapterId,
    setPrimaryWifiAdapterId,
  ] = useState<string | null>(
    data.config
      .primaryWifiAdapterId,
  );

  const [
    showAllMonitors,
    setShowAllMonitors,
  ] = useState(false);

  const [
    showAllKeyboards,
    setShowAllKeyboards,
  ] = useState(false);

  const [
    showAllWifi,
    setShowAllWifi,
  ] = useState(false);

  const [
    previewId,
    setPreviewId,
  ] = useState<string | null>(
    null,
  );

  const config = {
    selectedMonitorIds,
    selectedKeyboardMouseIds,
    selectedWifiAdapterIds,

    primaryKeyboardMouseId,
    primaryWifiAdapterId,
  };

  const state = useMemo(
    () =>
      buildPcMonitorBundleState(
        data.products,
        config,
      ),
    [
      data.products,
      selectedMonitorIds,
      selectedKeyboardMouseIds,
      selectedWifiAdapterIds,
      primaryKeyboardMouseId,
      primaryWifiAdapterId,
    ],
  );

  /* =======================================================
     TOAST
  ======================================================= */

  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(
        fetcher.data.message,
      );
    }
  }, [
    fetcher.data,
    shopify,
  ]);

  /* =======================================================
     ORDER LISTS
  ======================================================= */

  const monitorSet = new Set(
    selectedMonitorIds,
  );

  const keyboardSet = new Set(
    selectedKeyboardMouseIds,
  );

  const wifiSet = new Set(
    selectedWifiAdapterIds,
  );

  const orderedMonitors =
    useMemo(() => {
      return [
        ...state.monitorProducts,
      ].sort((a, b) => {
        const aSelected =
          monitorSet.has(a.id);

        const bSelected =
          monitorSet.has(b.id);

        if (
          aSelected !== bSelected
        ) {
          return aSelected
            ? -1
            : 1;
        }

        return (
          b.totalInventory -
          a.totalInventory
        );
      });
    }, [
      state.monitorProducts,
      selectedMonitorIds,
    ]);

  const orderedKeyboards =
    useMemo(() => {
      return [
        ...state.keyboardProducts,
      ].sort((a, b) => {
        const aPrimary =
          a.id ===
          primaryKeyboardMouseId;

        const bPrimary =
          b.id ===
          primaryKeyboardMouseId;

        if (aPrimary !== bPrimary) {
          return aPrimary
            ? -1
            : 1;
        }

        const aSelected =
          keyboardSet.has(a.id);

        const bSelected =
          keyboardSet.has(b.id);

        if (
          aSelected !== bSelected
        ) {
          return aSelected
            ? -1
            : 1;
        }

        return (
          b.totalInventory -
          a.totalInventory
        );
      });
    }, [
      state.keyboardProducts,
      selectedKeyboardMouseIds,
      primaryKeyboardMouseId,
    ]);

  const orderedWifi =
    useMemo(() => {
      return [
        ...state.wifiProducts,
      ].sort((a, b) => {
        const aPrimary =
          a.id ===
          primaryWifiAdapterId;

        const bPrimary =
          b.id ===
          primaryWifiAdapterId;

        if (aPrimary !== bPrimary) {
          return aPrimary
            ? -1
            : 1;
        }

        const aSelected =
          wifiSet.has(a.id);

        const bSelected =
          wifiSet.has(b.id);

        if (
          aSelected !== bSelected
        ) {
          return aSelected
            ? -1
            : 1;
        }

        return (
          b.totalInventory -
          a.totalInventory
        );
      });
    }, [
      state.wifiProducts,
      selectedWifiAdapterIds,
      primaryWifiAdapterId,
    ]);

  const visibleMonitors =
    showAllMonitors
      ? orderedMonitors
      : orderedMonitors.slice(
          0,
          2,
        );

  const visibleKeyboards =
    showAllKeyboards
      ? orderedKeyboards
      : orderedKeyboards.slice(
          0,
          2,
        );

  const visibleWifi =
    showAllWifi
      ? orderedWifi
      : orderedWifi.slice(
          0,
          2,
        );

  /* =======================================================
     PREVIEW
  ======================================================= */

  useEffect(() => {
    if (
      state.bundleCandidates.length ===
      0
    ) {
      setPreviewId(null);
      return;
    }

    const exists =
      state.bundleCandidates.some(
        (candidate) =>
          candidate.id ===
          previewId,
      );

    if (!exists) {
      setPreviewId(
        state.bundleCandidates[0].id,
      );
    }
  }, [
    state.bundleCandidates,
    previewId,
  ]);

  const preview =
    state.bundleCandidates.find(
      (candidate) =>
        candidate.id ===
        previewId,
    ) ??
    state.bundleCandidates[0] ??
    null;

  /* =======================================================
     TOGGLES
  ======================================================= */

  function toggleMonitor(
    id: string,
    checked: boolean,
  ) {
    setSelectedMonitorIds(
      (current) =>
        checked
          ? Array.from(
              new Set([
                ...current,
                id,
              ]),
            )
          : current.filter(
              (item) =>
                item !== id,
            ),
    );
  }

  function toggleKeyboard(
    id: string,
    checked: boolean,
  ) {
    setSelectedKeyboardMouseIds(
      (current) => {
        if (checked) {
          const next =
            Array.from(
              new Set([
                ...current,
                id,
              ]),
            );

          if (
            !primaryKeyboardMouseId
          ) {
            setPrimaryKeyboardMouseId(
              id,
            );
          }

          return next;
        }

        const next =
          current.filter(
            (item) =>
              item !== id,
          );

        if (
          primaryKeyboardMouseId ===
          id
        ) {
          setPrimaryKeyboardMouseId(
            next[0] ?? null,
          );
        }

        return next;
      },
    );
  }

  function toggleWifi(
    id: string,
    checked: boolean,
  ) {
    setSelectedWifiAdapterIds(
      (current) => {
        if (checked) {
          const next =
            Array.from(
              new Set([
                ...current,
                id,
              ]),
            );

          if (!primaryWifiAdapterId) {
            setPrimaryWifiAdapterId(
              id,
            );
          }

          return next;
        }

        const next =
          current.filter(
            (item) =>
              item !== id,
          );

        if (
          primaryWifiAdapterId === id
        ) {
          setPrimaryWifiAdapterId(
            next[0] ?? null,
          );
        }

        return next;
      },
    );
  }

  /* =======================================================
     ROWS
  ======================================================= */

  function renderComponentHeader() {
    return (
      <div className="csb-components-table-head" role="row">
        <span role="columnheader">Producto</span>
        <span role="columnheader">Stock</span>
        <span role="columnheader">Precio</span>
        <span role="columnheader">Detalles</span>
        <span role="columnheader">Usar</span>
      </div>
    );
  }

  function renderMonitor(monitor: ProductNode) {
    const selected = monitorSet.has(monitor.id);
    const info = getProductInfo(monitor);
    const compatibleCount = state.readyDesktopProducts.filter(
      (pc) => isDirectlyCompatible(pc, monitor),
    ).length;

    return (
      <div className="csb-components-row" role="row" key={monitor.id}>
        <div className="csb-components-cell--product" role="cell">
          <div className="csb-components-product">
            <ProductThumb product={monitor} size="small-200" />
            <div className="csb-components-product-name">
              <s-text>{monitor.title}</s-text>
            </div>
          </div>
        </div>
        <div className="csb-components-cell--stock" role="cell">
          <span className="csb-components-mobile-label">Stock</span>
          <span>{monitor.totalInventory}</span>
        </div>
        <div className="csb-components-cell--price" role="cell">
          <span className="csb-components-mobile-label">Precio</span>
          <span>{formatPrice(getPrice(monitor), data.currencyCode)}</span>
        </div>
        <div className="csb-components-cell--detail" role="cell">
          <span className="csb-components-mobile-label">Detalles</span>
          <div>{compatibleCount} PC compatibles</div>
          <div className="csb-components-detail-secondary">{info.video || "Sin entradas informadas"}</div>
        </div>
        <div className="csb-components-cell--use" role="cell">
          <s-checkbox
            label="Usar"
            checked={selected}
            onChange={(event) => {
              const target = event.currentTarget as unknown as { checked: boolean };
              toggleMonitor(monitor.id, target.checked);
            }}
          />
        </div>
      </div>
    );
  }

  function renderKeyboard(product: ProductNode) {
    const selected = keyboardSet.has(product.id);
    const primary = product.id === primaryKeyboardMouseId;

    return (
      <div className="csb-components-row" role="row" key={product.id}>
        <div className="csb-components-cell--product" role="cell">
          <div className="csb-components-product">
            <ProductThumb product={product} size="small-200" />
            <div className="csb-components-product-name">
              <s-text>{product.title}</s-text>
            </div>
          </div>
        </div>
        <div className="csb-components-cell--stock" role="cell">
          <span className="csb-components-mobile-label">Stock</span>
          <span>{product.totalInventory}</span>
        </div>
        <div className="csb-components-cell--price" role="cell">
          <span className="csb-components-mobile-label">Precio</span>
          <span>{formatPrice(getPrice(product), data.currencyCode)}</span>
        </div>
        <div className="csb-components-cell--detail" role="cell">
          <span className="csb-components-mobile-label">Prioridad</span>
          {primary ? (
            <s-badge tone="success">Principal</s-badge>
          ) : selected ? (
            <s-button
              variant="tertiary"
              onClick={() => setPrimaryKeyboardMouseId(product.id)}
            >
              Definir principal
            </s-button>
          ) : (
            <s-text tone="neutral">—</s-text>
          )}
        </div>
        <div className="csb-components-cell--use" role="cell">
          <s-checkbox
            label="Usar"
            checked={selected}
            onChange={(event) => {
              const target = event.currentTarget as unknown as { checked: boolean };
              toggleKeyboard(product.id, target.checked);
            }}
          />
        </div>
      </div>
    );
  }

  function renderWifi(product: ProductNode) {
    const selected = wifiSet.has(product.id);
    const primary = product.id === primaryWifiAdapterId;

    return (
      <div className="csb-components-row" role="row" key={product.id}>
        <div className="csb-components-cell--product" role="cell">
          <div className="csb-components-product">
            <ProductThumb product={product} size="small-200" />
            <div className="csb-components-product-name">
              <s-text>{product.title}</s-text>
            </div>
          </div>
        </div>
        <div className="csb-components-cell--stock" role="cell">
          <span className="csb-components-mobile-label">Stock</span>
          <span>{product.totalInventory}</span>
        </div>
        <div className="csb-components-cell--price" role="cell">
          <span className="csb-components-mobile-label">Precio</span>
          <span>{formatPrice(getPrice(product), data.currencyCode)}</span>
        </div>
        <div className="csb-components-cell--detail" role="cell">
          <span className="csb-components-mobile-label">Prioridad</span>
          {primary ? (
            <s-badge tone="success">Principal</s-badge>
          ) : selected ? (
            <s-button
              variant="tertiary"
              onClick={() => setPrimaryWifiAdapterId(product.id)}
            >
              Definir principal
            </s-button>
          ) : (
            <s-text tone="neutral">—</s-text>
          )}
        </div>
        <div className="csb-components-cell--use" role="cell">
          <s-checkbox
            label="Usar"
            checked={selected}
            onChange={(event) => {
              const target = event.currentTarget as unknown as { checked: boolean };
              toggleWifi(product.id, target.checked);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <s-page
      heading="Componentes"
      inlineSize="large"
    >

      <s-stack gap="base">

      <style>{`
        .csb-components-table {
          container-type: inline-size;
          min-width: 0;
          width: 100%;
        }
        .csb-components-table-head,
        .csb-components-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 80px 115px 220px 90px;
          gap: 14px;
          align-items: center;
          padding: 12px 14px;
          min-width: 0;
        }
        .csb-components-table-head {
          color: var(--p-color-text-secondary, #616161);
          background: var(--p-color-bg-surface-secondary, #f6f6f7);
          font-size: 12px;
          font-weight: 600;
          border-bottom: 1px solid var(--p-color-border-secondary, #e3e3e3);
        }
        .csb-components-row {
          border-bottom: 1px solid var(--p-color-border-secondary, #e3e3e3);
          font-size: 13px;
        }
        .csb-components-row:last-child {
          border-bottom: none;
        }
        .csb-components-row > div {
          min-width: 0;
        }
        .csb-components-product {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .csb-components-product-name {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .csb-components-cell--stock,
        .csb-components-cell--price {
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .csb-components-table-head > span:nth-child(2),
        .csb-components-table-head > span:nth-child(3) {
          text-align: right;
        }
        .csb-components-cell--use {
          display: flex;
          align-items: center;
          justify-content: flex-start;
        }
        .csb-components-detail-secondary {
          color: var(--p-color-text-secondary, #616161);
          font-size: 12px;
          margin-top: 3px;
          overflow-wrap: anywhere;
        }
        .csb-components-mobile-label { display: none; }

        @container (max-width: 850px) {
          .csb-components-table-head { display: none; }
          .csb-components-row {
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
            grid-template-areas:
              "product product product"
              "stock price use"
              "detail detail detail";
            column-gap: 12px;
            row-gap: 10px;
          }
          .csb-components-cell--product { grid-area: product; }
          .csb-components-cell--stock {
            grid-area: stock;
            text-align: left;
          }
          .csb-components-cell--price {
            grid-area: price;
            text-align: left;
          }
          .csb-components-cell--detail { grid-area: detail; }
          .csb-components-cell--use {
            grid-area: use;
            justify-content: flex-end;
          }
          .csb-components-mobile-label {
            display: block;
            color: var(--p-color-text-secondary, #616161);
            font-size: 11px;
            margin-bottom: 3px;
          }
        }
      `}</style>

        <s-section>

          <s-paragraph>
            Define qué productos pueden utilizarse en los Bundles PC + Monitor.
          </s-paragraph>

          <fetcher.Form
            slot="primary-action"
            method="post"
          >
            <input
              type="hidden"
              name="selectedMonitorIds"
              value={JSON.stringify(
                selectedMonitorIds,
              )}
            />

            <input
              type="hidden"
              name="selectedKeyboardMouseIds"
              value={JSON.stringify(
                selectedKeyboardMouseIds,
              )}
            />

            <input
              type="hidden"
              name="selectedWifiAdapterIds"
              value={JSON.stringify(
                selectedWifiAdapterIds,
              )}
            />

            <input
              type="hidden"
              name="primaryKeyboardMouseId"
              value={
                primaryKeyboardMouseId ??
                ""
              }
            />

            <input
              type="hidden"
              name="primaryWifiAdapterId"
              value={
                primaryWifiAdapterId ??
                ""
              }
            />

            <s-button
              type="submit"
              variant="primary"
            >
              Guardar componentes
            </s-button>
          </fetcher.Form>

        </s-section>

        <s-query-container>

          <s-grid
            gridTemplateColumns="@container (inline-size > 1000px) minmax(0, 1fr) 360px, 1fr"
            gap="base"
          >

            <s-stack gap="base">

              <s-section
                heading="1. Monitores autorizados"
                padding="none"
              >

                <s-badge
                  slot="accessory"
                  tone="info"
                >
                  {
                    state
                      .selectedMonitors
                      .length
                  }{" "}
                  seleccionados
                </s-badge>

                <s-box padding="small">

                  <s-paragraph>
                    La app utilizará el monitor compatible de menor precio.
                  </s-paragraph>

                </s-box>

                <div className="csb-components-table" role="table" aria-label="Monitores autorizados">
                  <div role="rowgroup">{renderComponentHeader()}</div>
                  <div role="rowgroup">
                    {visibleMonitors.map(renderMonitor)}
                  </div>
                </div>

                {orderedMonitors.length >
                  2 && (
                  <s-box padding="small">

                    <s-button
                      variant="tertiary"
                      onClick={() =>
                        setShowAllMonitors(
                          (
                            value,
                          ) =>
                            !value,
                        )
                      }
                    >
                      {showAllMonitors
                        ? "Mostrar menos"
                        : `Ver todos los monitores (${orderedMonitors.length})`}
                    </s-button>

                  </s-box>
                )}

              </s-section>

              <s-section
                heading="2. Teclado / Mouse"
                padding="none"
              >

                <s-badge
                  slot="accessory"
                  tone="info"
                >
                  {
                    state
                      .selectedKeyboardProducts
                      .length
                  }{" "}
                  seleccionados
                </s-badge>

                <s-box padding="small">

                  <s-paragraph>
                    El producto principal se utiliza primero. Los demás funcionan como respaldo.
                  </s-paragraph>

                </s-box>

                <div className="csb-components-table" role="table" aria-label="Teclado y Mouse">
                  <div role="rowgroup">{renderComponentHeader()}</div>
                  <div role="rowgroup">
                    {visibleKeyboards.map(renderKeyboard)}
                  </div>
                </div>

                {orderedKeyboards.length >
                  2 && (
                  <s-box padding="small">

                    <s-button
                      variant="tertiary"
                      onClick={() =>
                        setShowAllKeyboards(
                          (
                            value,
                          ) =>
                            !value,
                        )
                      }
                    >
                      {showAllKeyboards
                        ? "Mostrar menos"
                        : `Ver todos los teclado/mouse (${orderedKeyboards.length})`}
                    </s-button>

                  </s-box>
                )}

              </s-section>

              <s-section
                heading="3. Adaptadores Wi-Fi"
                padding="none"
              >

                <s-badge
                  slot="accessory"
                  tone="info"
                >
                  {
                    state
                      .selectedWifiProducts
                      .length
                  }{" "}
                  seleccionados
                </s-badge>

                <s-box padding="small">

                  <s-paragraph>
                    Solo se agregan cuando Wi-Fi integrado = No.
                  </s-paragraph>

                </s-box>

                <div className="csb-components-table" role="table" aria-label="Adaptadores Wi-Fi">
                  <div role="rowgroup">{renderComponentHeader()}</div>
                  <div role="rowgroup">
                    {visibleWifi.map(renderWifi)}
                  </div>
                </div>

                {orderedWifi.length >
                  2 && (
                  <s-box padding="small">

                    <s-button
                      variant="tertiary"
                      onClick={() =>
                        setShowAllWifi(
                          (
                            value,
                          ) =>
                            !value,
                        )
                      }
                    >
                      {showAllWifi
                        ? "Mostrar menos"
                        : `Ver todos los adaptadores Wi-Fi (${orderedWifi.length})`}
                    </s-button>

                  </s-box>
                )}

              </s-section>

              <s-section>

                <s-button
                  variant="primary"
                  href="/app/rules"
                >
                  Siguiente: Reglas y cálculo
                </s-button>

              </s-section>

            </s-stack>

            <s-section heading="Vista previa">

              {preview ? (
                <s-stack gap="base">

                  <s-select
                    label="PC de ejemplo"
                    value={
                      preview.id
                    }
                    onChange={(event) =>
                      setPreviewId(
                        event.currentTarget
                          .value,
                      )
                    }
                  >
                    {state.bundleCandidates.map(
                      (candidate) => (
                        <s-option
                          key={
                            candidate.id
                          }
                          value={
                            candidate.id
                          }
                        >
                          {
                            cleanPcTitle(
                              candidate
                                .baseProduct
                                .title,
                            )
                          }
                        </s-option>
                      ),
                    )}
                  </s-select>

                  <s-stack
                    direction="inline"
                    gap="small"
                    alignItems="center"
                  >

                    <ProductThumb
                      product={
                        preview.baseProduct
                      }
                      size="base"
                    />

                    <s-stack gap="small">

                      <s-text>
                        {cleanPcTitle(
                          preview
                            .baseProduct
                            .title,
                        )}
                      </s-text>

                      <s-stack
                        direction="inline"
                        gap="small"
                      >
                        <s-badge tone="neutral">
                          Stock{" "}
                          {
                            preview
                              .baseProduct
                              .totalInventory
                          }
                        </s-badge>

                        <s-badge tone="neutral">
                          Wi-Fi{" "}
                          {
                            getProductInfo(
                              preview
                                .baseProduct,
                            ).wifi
                          }
                        </s-badge>
                      </s-stack>

                    </s-stack>

                  </s-stack>

                  <s-divider />

                  {preview.monitor && (
                    <s-stack
                      direction="inline"
                      gap="small"
                      alignItems="center"
                    >
                      <ProductThumb
                        product={
                          preview.monitor
                        }
                        size="small-200"
                      />

                      <s-stack gap="small">
                        <s-text>
                          {cleanMonitorTitle(
                            preview
                              .monitor
                              .title,
                          )}
                        </s-text>

                        <s-text tone="neutral">
                          {
                            preview
                              .commonVideoPorts
                              .join(
                                ", ",
                              )
                          }
                        </s-text>
                      </s-stack>
                    </s-stack>
                  )}

                  <s-stack
                    direction="inline"
                    gap="small"
                    alignItems="center"
                  >
                    <ProductThumb
                      product={
                        preview.keyboardMouse
                      }
                      size="small-200"
                    />

                    <s-text>
                      {
                        preview
                          .keyboardMouse
                          .title
                      }
                    </s-text>
                  </s-stack>

                  {preview.wifiAdapter && (
                    <s-stack
                      direction="inline"
                      gap="small"
                      alignItems="center"
                    >
                      <ProductThumb
                        product={
                          preview.wifiAdapter
                        }
                        size="small-200"
                      />

                      <s-text>
                        {
                          preview
                            .wifiAdapter
                            .title
                        }
                      </s-text>
                    </s-stack>
                  )}

                  <s-divider />

                  <s-grid
                    gridTemplateColumns="1fr auto"
                    gap="small"
                  >
                    <s-text tone="neutral">
                      Suma actual de componentes
                    </s-text>

                    <s-heading>
                      {formatPrice(
                        getBundlePrice(
                          preview,
                        ),
                        data.currencyCode,
                      )}
                    </s-heading>
                  </s-grid>

                </s-stack>
              ) : (
                <s-banner
                  tone="info"
                  heading="Sin vista previa"
                >
                  No hay Bundles disponibles con la configuración actual.
                </s-banner>
              )}

            </s-section>

          </s-grid>

        </s-query-container>

      </s-stack>

    </s-page>
  );
}

export const headers:
  HeadersFunction = (
    headersArgs,
  ) => {
    return boundary.headers(
      headersArgs,
    );
  };