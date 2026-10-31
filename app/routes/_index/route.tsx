import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

/**
 * The public root is the Shopify application entry point, not a marketing page.
 * Redirect to Bundles and retain Shopify's shop/host/embedded query parameters
 * so that the app's existing authentication flow can use them.
 *
 * For direct visits without Shopify context, authenticate.admin() in /app
 * handles the login requirement. This route never bypasses authentication.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return redirect(`/app/bundles${url.search}`);
};

export default function Index() {
  return null;
}
