import { useState } from "react";

import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";

import {
  Outlet,
  NavLink,
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
import { isAllowedShop } from "../lib/shop-allowlist.server";

/* =========================================================
   LOADER
========================================================= */

export const loader =
  async ({
    request,
  }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(
      request,
    );
    if (!isAllowedShop(session.shop)) {
      throw new Response("Esta tienda no está autorizada para esta instalación.", { status: 403 });
    }

    return {
      apiKey:
        process.env
          .SHOPIFY_API_KEY ||
        "",
    };
  };

/*
 * The app shell only returns the public API key. It does not
 * need to authenticate again when moving between child pages
 * or after child actions.
 */
export const shouldRevalidate =
  () => false;

/* =========================================================
   APP
========================================================= */

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
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

      <style>{`
        .csbyte-app-shell {
          --csbyte-sidebar-bg: #fff;
          --csbyte-sidebar-text: #52525b;
          --csbyte-sidebar-active: #18181b;
          --csbyte-sidebar-hover: #f4f4f5;
          --csbyte-sidebar-border: #e4e4e7;
          display: grid;
          grid-template-columns: 220px minmax(0, 1fr);
          gap: 20px;
          max-width: 1680px;
          min-width: 0;
          margin: 0 auto;
          padding: 20px;
          box-sizing: border-box;
        }
        .csbyte-app-sidebar {
          box-sizing: border-box;
          position: sticky;
          top: 20px;
          align-self: start;
          max-height: calc(100vh - 40px);
          overflow-y: auto;
          background: var(--csbyte-sidebar-bg);
          border: 1px solid var(--csbyte-sidebar-border);
          border-radius: 14px;
          padding: 10px;
        }
        .csbyte-app-sidebar-title {
          display: block;
          padding: 10px 12px 14px;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.01em;
          color: var(--csbyte-sidebar-active);
        }
        .csbyte-app-sidebar-links {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .csbyte-app-sidebar-link {
          display: block;
          padding: 10px 12px;
          border-radius: 10px;
          color: var(--csbyte-sidebar-text);
          text-decoration: none;
          line-height: 1.35;
          font-size: 14px;
          font-weight: 500;
          transition: background-color 120ms ease, color 120ms ease;
        }
        .csbyte-app-sidebar-link:hover {
          background: var(--csbyte-sidebar-hover);
          color: var(--csbyte-sidebar-active);
        }
        .csbyte-app-sidebar-link[aria-current="page"] {
          background: var(--csbyte-sidebar-active);
          color: #fff;
          font-weight: 600;
        }
        .csbyte-app-sidebar-link:focus-visible,
        .csbyte-app-sidebar-toggle:focus-visible {
          outline: 2px solid #2563eb;
          outline-offset: 2px;
        }
        .csbyte-app-main {
          min-width: 0;
          width: 100%;
        }
        .csbyte-app-sidebar-toggle { display: none; }
        @media (prefers-color-scheme: dark) {
          .csbyte-app-shell {
            --csbyte-sidebar-bg: #151515;
            --csbyte-sidebar-text: #b1b1b1;
            --csbyte-sidebar-active: #f4f4f5;
            --csbyte-sidebar-hover: #292929;
            --csbyte-sidebar-border: #333;
          }
          .csbyte-app-sidebar-link[aria-current="page"] {
            background: #303030;
            color: #fff;
          }
        }
        @media (max-width: 900px) {
          .csbyte-app-shell {
            grid-template-columns: minmax(0, 1fr);
            gap: 12px;
            padding: 12px;
          }
          .csbyte-app-sidebar {
            position: static;
            max-height: none;
          }
          .csbyte-app-sidebar-title { display: none; }
          .csbyte-app-sidebar-toggle {
            display: block;
            width: 100%;
            text-align: left;
            background: transparent;
            border: 0;
            padding: 10px 12px;
            font-weight: 600;
            color: var(--csbyte-sidebar-active);
            cursor: pointer;
            list-style-position: inside;
          }
          .csbyte-app-sidebar-links { display: none; }
           .csbyte-app-sidebar-links[data-open="true"] {
            display: flex;
            margin-top: 6px;
          }
        }
      `}</style>

      <div className="csbyte-app-shell">
        <aside className="csbyte-app-sidebar">
          <button
            type="button"
            className="csbyte-app-sidebar-toggle"
            aria-expanded={menuOpen}
            aria-controls="csbyte-app-sidebar-links"
            onClick={() => setMenuOpen(value => !value)}
          >
            Menú de Bundles
          </button>
          <nav
            id="csbyte-app-sidebar-links"
            className="csbyte-app-sidebar-links"
            data-open={menuOpen}
            aria-label="Navegación de CSBYTE Bundles"
            onClick={() => setMenuOpen(false)}
          >
            <span className="csbyte-app-sidebar-title">Bundles</span>
            <NavLink to="/app/bundles" className="csbyte-app-sidebar-link">
              Bundles
            </NavLink>
            <NavLink to="/app" end className="csbyte-app-sidebar-link">
              Resumen
            </NavLink>
            <NavLink to="/app/templates" className="csbyte-app-sidebar-link">
              Plantillas
            </NavLink>
            <NavLink to="/app/components" className="csbyte-app-sidebar-link">
              Componentes
            </NavLink>
            <NavLink to="/app/rules" className="csbyte-app-sidebar-link">
              Reglas y cálculo
            </NavLink>
            <NavLink to="/app/sync" className="csbyte-app-sidebar-link">
              Precios y disponibilidad
            </NavLink>
            <NavLink to="/app/problems" className="csbyte-app-sidebar-link">
              Productos con problemas
            </NavLink>
          </nav>
        </aside>

        <main className="csbyte-app-main">
          <Outlet />
        </main>
      </div>

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