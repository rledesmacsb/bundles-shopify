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
  Link,
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
  loadPcMonitorBundleData,
  parseStoredIds,
  savePcMonitorBundleConfig,
} from "../lib/bundle-data.server";

/* =========================================================
   LOADER
========================================================= */

export const loader =
  async ({
    request,
  }: LoaderFunctionArgs) => {
    const { admin } =
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
    const { admin } =
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

    return savePcMonitorBundleConfig(
      admin,
      {
        selectedMonitorIds,
        selectedKeyboardMouseIds,
        selectedWifiAdapterIds,

        primaryKeyboardMouseId,
        primaryWifiAdapterId,
      },
    );
  };

/* =========================================================
   THUMB
========================================================= */

function ProductThumb({
  product,
  size = 52,
}: {
  product:
    | ProductNode
    | null
    | undefined;

  size?: number;
}) {
  if (!product?.featuredImage?.url) {
    return (
      <div
        className="csb-thumb csb-thumb--empty"
        style={{
          width: size,
          height: size,
        }}
      >
        —
      </div>
    );
  }

  return (
    <img
      className="csb-thumb"
      src={product.featuredImage.url}
      alt={
        product.featuredImage.altText ??
        product.title
      }
      width={size}
      height={size}
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

  function renderMonitor(
    monitor: ProductNode,
  ) {
    const selected =
      monitorSet.has(monitor.id);

    const info =
      getProductInfo(monitor);

    const compatibleCount =
      state.readyDesktopProducts.filter(
        (pc) =>
          isDirectlyCompatible(
            pc,
            monitor,
          ),
      ).length;

    return (
      <div
        className={
          selected
            ? "csb-row csb-row--selected"
            : "csb-row"
        }
        key={monitor.id}
      >
        <ProductThumb
          product={monitor}
        />

        <div className="csb-row__content">
          <div className="csb-row__title">
            {monitor.title}
          </div>

          <div className="csb-meta">
            <span className="csb-chip">
              Stock{" "}
              {monitor.totalInventory}
            </span>

            <span className="csb-chip">
              {formatPrice(
                getPrice(monitor),
                data.currencyCode,
              )}
            </span>

            <span className="csb-chip">
              {compatibleCount} PC compatibles
            </span>
          </div>

          <div className="csb-small">
            Entradas: {info.video}
          </div>
        </div>

        <s-checkbox
          label="Usar"
          checked={selected}
          onChange={(event) => {
            const target =
              event.currentTarget as unknown as {
                checked: boolean;
              };

            toggleMonitor(
              monitor.id,
              target.checked,
            );
          }}
        />
      </div>
    );
  }

  function renderKeyboard(
    product: ProductNode,
  ) {
    const selected =
      keyboardSet.has(product.id);

    const primary =
      product.id ===
      primaryKeyboardMouseId;

    return (
      <div
        className={
          selected
            ? "csb-row csb-row--selected"
            : "csb-row"
        }
        key={product.id}
      >
        <ProductThumb
          product={product}
        />

        <div className="csb-row__content">
          <div className="csb-row__title">
            {product.title}
          </div>

          <div className="csb-meta">
            <span className="csb-chip">
              Stock{" "}
              {product.totalInventory}
            </span>

            <span className="csb-chip">
              {formatPrice(
                getPrice(product),
                data.currencyCode,
              )}
            </span>

            {primary && (
              <span className="csb-chip csb-chip--success">
                Principal
              </span>
            )}
          </div>

          {selected && (
            <label className="csb-radio">
              <input
                type="radio"
                checked={primary}
                name="keyboard-primary"
                onChange={() =>
                  setPrimaryKeyboardMouseId(
                    product.id,
                  )
                }
              />
              Usar como principal
            </label>
          )}
        </div>

        <s-checkbox
          label="Usar"
          checked={selected}
          onChange={(event) => {
            const target =
              event.currentTarget as unknown as {
                checked: boolean;
              };

            toggleKeyboard(
              product.id,
              target.checked,
            );
          }}
        />
      </div>
    );
  }

  function renderWifi(
    product: ProductNode,
  ) {
    const selected =
      wifiSet.has(product.id);

    const primary =
      product.id ===
      primaryWifiAdapterId;

    return (
      <div
        className={
          selected
            ? "csb-row csb-row--selected"
            : "csb-row"
        }
        key={product.id}
      >
        <ProductThumb
          product={product}
        />

        <div className="csb-row__content">
          <div className="csb-row__title">
            {product.title}
          </div>

          <div className="csb-meta">
            <span className="csb-chip">
              Stock{" "}
              {product.totalInventory}
            </span>

            <span className="csb-chip">
              {formatPrice(
                getPrice(product),
                data.currencyCode,
              )}
            </span>

            {primary && (
              <span className="csb-chip csb-chip--success">
                Principal
              </span>
            )}
          </div>

          {selected && (
            <label className="csb-radio">
              <input
                type="radio"
                checked={primary}
                name="wifi-primary"
                onChange={() =>
                  setPrimaryWifiAdapterId(
                    product.id,
                  )
                }
              />
              Usar como principal
            </label>
          )}
        </div>

        <s-checkbox
          label="Usar"
          checked={selected}
          onChange={(event) => {
            const target =
              event.currentTarget as unknown as {
                checked: boolean;
              };

            toggleWifi(
              product.id,
              target.checked,
            );
          }}
        />
      </div>
    );
  }

  return (
    <s-page heading="Componentes" inlineSize="large">
      <style>{`
        .csb-page {
          width: 100%;
          max-width: none;
          margin: 0;
          padding-bottom: 24px;
        }

        .csb-heading {
          display: flex;
          justify-content: space-between;
          gap: 24px;
          align-items: flex-end;
          margin-bottom: 18px;
          padding: 4px 2px 0;
        }

        .csb-title {
          font-size: 21px;
          line-height: 1.2;
          font-weight: 720;
          margin: 0 0 5px;
        }

        .csb-description {
          margin: 0;
          max-width: 720px;
          color: #69727d;
          font-size: 12px;
        }

        .csb-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 380px;
          gap: 16px;
          align-items: start;
        }

        .csb-main,
        .csb-preview {
          border: 1px solid #e4e9f0;
          border-radius: 16px;
          background: white;
          box-shadow: 0 1px 2px rgba(31,33,36,.03), 0 8px 22px rgba(31,33,36,.035);
        }

        .csb-main {
          padding: 16px;
        }

        .csb-group {
          border: 1px solid #e4e9f0;
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 14px;
        }

        .csb-group:last-child {
          margin-bottom: 0;
        }

        .csb-group__header {
          padding: 14px;
          border-bottom: 1px solid #ededed;
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
        }

        .csb-group__title {
          font-size: 14px;
          font-weight: 650;
          margin-bottom: 4px;
        }

        .csb-group__description {
          font-size: 11.5px;
          color: #616161;
        }

        .csb-count {
          background: #eef5ff;
          color: #0c62f2;
          padding: 3px 8px;
          border-radius: 999px;
          font-size: 10.5px;
          margin-left: 7px;
        }

        .csb-link-button,
        .csb-outline-button {
          appearance: none;
          border: 1px solid #d4d9df;
          background: white;
          border-radius: 8px;
          padding: 6px 11px;
          font: inherit;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
        }

        .csb-link-button {
          border-color: transparent;
          color: #0c62f2;
        }

        .csb-group__footer {
          padding: 10px 14px;
          border-top: 1px solid #ededed;
          background: #fafafa;
        }

        .csb-row {
          display: grid;
          grid-template-columns: 54px minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
          padding: 13px 14px;
          border-bottom: 1px solid #ededed;
        }

        .csb-row:last-of-type {
          border-bottom: 0;
        }

        .csb-row--selected {
          background: #f7faff;
          box-shadow: inset 3px 0 0 #0c62f2;
        }

        .csb-row__content {
          min-width: 0;
        }

        .csb-row__title {
          font-size: 12.5px;
          font-weight: 600;
          line-height: 1.4;
          margin-bottom: 5px;
        }

        .csb-thumb {
          object-fit: contain;
          border: 1px solid #ededed;
          border-radius: 8px;
          background: white;
        }

        .csb-thumb--empty {
          display: grid;
          place-items: center;
          color: #999;
          background: #f7f7f7;
        }

        .csb-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin-bottom: 4px;
        }

        .csb-chip {
          background: #f2f2f2;
          color: #616161;
          padding: 2px 7px;
          border-radius: 999px;
          font-size: 10px;
        }

        .csb-chip--success {
          background: #eaf8ee;
          color: #26733e;
        }

        .csb-small {
          font-size: 10.5px;
          color: #616161;
        }

        .csb-radio {
          margin-top: 7px;
          display: flex;
          gap: 6px;
          align-items: center;
          font-size: 10.5px;
          color: #4a4a4a;
        }

        .csb-side {
          position: sticky;
          top: 16px;
        }

        .csb-preview {
          overflow: hidden;
        }

        .csb-preview__header {
          padding: 14px;
          border-bottom: 1px solid #ededed;
          font-size: 13px;
          font-weight: 650;
        }

        .csb-preview__body {
          padding: 14px;
        }

        .csb-select {
          width: 100%;
          min-height: 37px;
          padding: 7px 9px;
          border: 1px solid #d4d9df;
          border-radius: 8px;
          margin-bottom: 14px;
          font: inherit;
          font-size: 11px;
        }

        .csb-preview-product {
          display: grid;
          grid-template-columns: 64px minmax(0, 1fr);
          gap: 11px;
          align-items: center;
          padding-bottom: 13px;
          margin-bottom: 8px;
          border-bottom: 1px solid #ededed;
        }

        .csb-preview-product__title {
          font-size: 12px;
          font-weight: 650;
          line-height: 1.4;
        }

        .csb-preview-component {
          display: grid;
          grid-template-columns: 40px minmax(0, 1fr);
          gap: 9px;
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid #f0f0f0;
        }

        .csb-preview-component__title {
          font-size: 10.5px;
          line-height: 1.4;
        }

        .csb-price {
          margin-top: 13px;
          padding: 13px;
          background: #fafafa;
          border: 1px solid #e4e9f0;
          border-radius: 10px;
        }

        .csb-price__label {
          font-size: 10.5px;
          color: #616161;
        }

        .csb-price__value {
          font-size: 21px;
          font-weight: 700;
          margin-top: 3px;
        }

        .csb-empty {
          padding: 28px 14px;
          color: #616161;
          text-align: center;
          font-size: 12px;
        }

        .csb-footer {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding-top: 16px;
        }

        .csb-next {
          display: inline-flex;
          align-items: center;
          min-height: 36px;
          padding: 7px 13px;
          background: #0c62f2;
          border-radius: 9px;
          color: white;
          text-decoration: none;
          font-size: 12px;
          font-weight: 600;
        }

        @media (max-width: 1000px) {
          .csb-layout {
            grid-template-columns: 1fr;
          }

          .csb-side {
            position: static;
          }
        }

        @media (max-width: 600px) {
          .csb-heading {
            flex-direction: column;
          }

          .csb-row {
            grid-template-columns: 44px minmax(0, 1fr);
          }

          .csb-row > s-checkbox {
            grid-column: 2;
          }
        }
      `}</style>

      <div className="csb-page">
        <div className="csb-heading">
          <div>
            <h1 className="csb-title">
              Componentes
            </h1>

            <p className="csb-description">
              Define qué productos pueden utilizarse en los bundles PC + Monitor.
            </p>
          </div>

          <fetcher.Form method="post">
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
        </div>

        <div className="csb-layout">
          <div className="csb-main">

            {/* MONITORES */}

            <div className="csb-group">
              <div className="csb-group__header">
                <div>
                  <div className="csb-group__title">
                    1. Monitores autorizados

                    <span className="csb-count">
                      {
                        state.selectedMonitors.length
                      }{" "}
                      seleccionados
                    </span>
                  </div>

                  <div className="csb-group__description">
                    La app utilizará el monitor compatible de menor precio.
                  </div>
                </div>

                {orderedMonitors.length > 2 && (
                  <button
                    type="button"
                    className="csb-link-button"
                    onClick={() =>
                      setShowAllMonitors(
                        (value) =>
                          !value,
                      )
                    }
                  >
                    {showAllMonitors
                      ? "Ver menos"
                      : `Ver más (${orderedMonitors.length - 2})`}
                  </button>
                )}
              </div>

              {visibleMonitors.map(
                renderMonitor,
              )}

              {orderedMonitors.length > 2 && (
                <div className="csb-group__footer">
                  <button
                    type="button"
                    className="csb-outline-button"
                    onClick={() =>
                      setShowAllMonitors(
                        (value) =>
                          !value,
                      )
                    }
                  >
                    {showAllMonitors
                      ? "Mostrar menos"
                      : "Ver todos los monitores"}
                  </button>
                </div>
              )}
            </div>

            {/* TECLADO */}

            <div className="csb-group">
              <div className="csb-group__header">
                <div>
                  <div className="csb-group__title">
                    2. Teclado / Mouse

                    <span className="csb-count">
                      {
                        state
                          .selectedKeyboardProducts
                          .length
                      }{" "}
                      seleccionados
                    </span>
                  </div>

                  <div className="csb-group__description">
                    El producto principal se utiliza primero. Los demás funcionan como respaldo.
                  </div>
                </div>

                {orderedKeyboards.length > 2 && (
                  <button
                    type="button"
                    className="csb-link-button"
                    onClick={() =>
                      setShowAllKeyboards(
                        (value) =>
                          !value,
                      )
                    }
                  >
                    {showAllKeyboards
                      ? "Ver menos"
                      : `Ver más (${orderedKeyboards.length - 2})`}
                  </button>
                )}
              </div>

              {visibleKeyboards.map(
                renderKeyboard,
              )}

              {orderedKeyboards.length > 2 && (
                <div className="csb-group__footer">
                  <button
                    type="button"
                    className="csb-outline-button"
                    onClick={() =>
                      setShowAllKeyboards(
                        (value) =>
                          !value,
                      )
                    }
                  >
                    {showAllKeyboards
                      ? "Mostrar menos"
                      : "Ver todos los teclado/mouse"}
                  </button>
                </div>
              )}
            </div>

            {/* WIFI */}

            <div className="csb-group">
              <div className="csb-group__header">
                <div>
                  <div className="csb-group__title">
                    3. Adaptadores Wi-Fi

                    <span className="csb-count">
                      {
                        state
                          .selectedWifiProducts
                          .length
                      }{" "}
                      seleccionados
                    </span>
                  </div>

                  <div className="csb-group__description">
                    Solo se agregan cuando Wi-Fi integrado = No.
                  </div>
                </div>

                {orderedWifi.length > 2 && (
                  <button
                    type="button"
                    className="csb-link-button"
                    onClick={() =>
                      setShowAllWifi(
                        (value) =>
                          !value,
                      )
                    }
                  >
                    {showAllWifi
                      ? "Ver menos"
                      : `Ver más (${orderedWifi.length - 2})`}
                  </button>
                )}
              </div>

              {visibleWifi.map(
                renderWifi,
              )}

              {orderedWifi.length > 2 && (
                <div className="csb-group__footer">
                  <button
                    type="button"
                    className="csb-outline-button"
                    onClick={() =>
                      setShowAllWifi(
                        (value) =>
                          !value,
                      )
                    }
                  >
                    {showAllWifi
                      ? "Mostrar menos"
                      : "Ver todos los adaptadores Wi-Fi"}
                  </button>
                </div>
              )}
            </div>

            <div className="csb-footer">
              <Link
                className="csb-next"
                to="/app/rules"
              >
                Siguiente: Reglas y cálculo →
              </Link>
            </div>
          </div>

          {/* PREVIEW */}

          <aside className="csb-side">
            <div className="csb-preview">
              <div className="csb-preview__header">
                Vista previa
              </div>

              {preview ? (
                <div className="csb-preview__body">

                  <select
                    className="csb-select"
                    value={preview.id}
                    onChange={(event) =>
                      setPreviewId(
                        event.target.value,
                      )
                    }
                  >
                    {state.bundleCandidates.map(
                      (candidate) => (
                        <option
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
                        </option>
                      ),
                    )}
                  </select>

                  <div className="csb-preview-product">
                    <ProductThumb
                      product={
                        preview.baseProduct
                      }
                      size={64}
                    />

                    <div>
                      <div className="csb-preview-product__title">
                        {cleanPcTitle(
                          preview
                            .baseProduct
                            .title,
                        )}
                      </div>

                      <div className="csb-meta">
                        <span className="csb-chip">
                          Stock{" "}
                          {
                            preview
                              .baseProduct
                              .totalInventory
                          }
                        </span>

                        <span className="csb-chip">
                          Wi-Fi{" "}
                          {
                            getProductInfo(
                              preview
                                .baseProduct,
                            ).wifi
                          }
                        </span>
                      </div>
                    </div>
                  </div>

                  {preview.monitor && (
                    <div className="csb-preview-component">
                      <ProductThumb
                        product={
                          preview.monitor
                        }
                        size={40}
                      />

                      <div className="csb-preview-component__title">
                        {cleanMonitorTitle(
                          preview.monitor.title,
                        )}

                        <div className="csb-small">
                          {
                            preview.commonVideoPorts.join(
                              ", ",
                            )
                          }
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="csb-preview-component">
                    <ProductThumb
                      product={
                        preview.keyboardMouse
                      }
                      size={40}
                    />

                    <div className="csb-preview-component__title">
                      {
                        preview
                          .keyboardMouse
                          .title
                      }
                    </div>
                  </div>

                  {preview.wifiAdapter && (
                    <div className="csb-preview-component">
                      <ProductThumb
                        product={
                          preview.wifiAdapter
                        }
                        size={40}
                      />

                      <div className="csb-preview-component__title">
                        {
                          preview
                            .wifiAdapter
                            .title
                        }
                      </div>
                    </div>
                  )}

                  <div className="csb-price">
                    <div className="csb-price__label">
                      Suma actual de componentes
                    </div>

                    <div className="csb-price__value">
                      {formatPrice(
                        getBundlePrice(
                          preview,
                        ),
                        data.currencyCode,
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="csb-empty">
                  No hay bundles disponibles con la configuración actual.
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
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