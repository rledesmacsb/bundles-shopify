import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";

import {
  Outlet,
  useLoaderData,
  useRouteError,
} from "react-router";

import {
  boundary,
} from "@shopify/shopify-app-react-router/server";

import {
  AppProvider,
} from "@shopify/shopify-app-react-router/react";

import {
  authenticate,
} from "../shopify.server";

/* =========================================================
   LOADER
========================================================= */

export const loader =
  async ({
    request,
  }: LoaderFunctionArgs) => {
    await authenticate.admin(
      request,
    );

    return {
      apiKey:
        process.env
          .SHOPIFY_API_KEY ||
        "",
    };
  };

/* =========================================================
   APP
========================================================= */

export default function App() {
  const {
    apiKey,
  } =
    useLoaderData<
      typeof loader
    >();

  return (
    <AppProvider
      embedded
      apiKey={
        apiKey
      }
    >

      <s-app-nav>

        <s-link href="/app">
          Home
        </s-link>

        <s-link href="/app/bundles">
          Bundles
        </s-link>

        <s-link href="/app/templates">
          Plantillas
        </s-link>

        <s-link href="/app/components">
          Componentes
        </s-link>

        <s-link href="/app/rules">
          Reglas y cálculo
        </s-link>

        <s-link href="/app/problems">
          Productos con problemas
        </s-link>

      </s-app-nav>

      <Outlet />

    </AppProvider>
  );
}

/* =========================================================
   ERROR BOUNDARY
========================================================= */

export function ErrorBoundary() {
  return boundary.error(
    useRouteError(),
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