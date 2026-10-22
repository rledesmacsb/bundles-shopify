import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

export default {
  ssr: true,

  presets: [
    vercelPreset(),
  ],

  /*
   * Shopify CLI exposes the local app through a temporary
   * trycloudflare.com tunnel during development.
   *
   * React Router validates action origins before route
   * actions run. Behind the Shopify tunnel, the browser
   * origin can differ from the internal request URL.
   *
   * Keep this exception development-only. Production on
   * Vercel keeps React Router's normal same-origin
   * protection.
   */
  allowedActionOrigins:
    process.env.NODE_ENV === "development"
      ? ["*.trycloudflare.com"]
      : undefined,
} satisfies Config;
