import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,

  /*
   * Shopify CLI exposes the local app through a temporary
   * trycloudflare.com tunnel during development.
   *
   * React Router 7.18+ validates action origins before the
   * route action runs. Behind the Shopify tunnel, the browser
   * origin can differ from the internal request URL, which
   * otherwise causes every POST action to fail with 400.
   *
   * Keep this exception development-only. Production keeps
   * React Router's normal same-origin protection.
   */
  allowedActionOrigins:
    process.env.NODE_ENV === "development"
      ? ["*.trycloudflare.com"]
      : undefined,
} satisfies Config;
