import { buildTemplateBundleState, calculateTemplateCandidatePrice } from "./bundle-template-engine";
import { loadBundleTemplateCatalog } from "./bundle-template-catalog.server";
import { loadBundleRuntimeSettings } from "./bundle-runtime-settings.server";
import { BUNDLE_MANAGED_BY_VALUE, loadExistingPcMonitorBundleMatches } from "./bundle-existing.server";

type Admin = { graphql: (query: string, options?: any) => Promise<any> };
type Result = { success: boolean; message: string; productId?: string };
const fail = (message: string): Result => ({ success: false, message });

/**
 * One-bundle, DRAFT-only repair. Changes only compareAtPrice; it neither
 * modifies the active selling price nor overrides merchant comparison prices.
 */
export async function completeMissingBundleCompareAtPrice(
  admin: Admin,
  candidateId: string,
): Promise<Result> {
  if (!candidateId) return fail("No se identificó el Bundle.");
  try {
    const [catalog, runtime] = await Promise.all([
      loadBundleTemplateCatalog(admin),
      loadBundleRuntimeSettings(admin),
    ]);
    if (catalog.errors.length || runtime.errors.length) {
      return fail("No se pudo validar el catálogo: " +
        [...catalog.errors, ...runtime.errors].join(" · "));
    }
    const state = buildTemplateBundleState(
      catalog.products, catalog.templates, runtime.componentConfig,
    );
    const candidate = state.candidates.find((item) => item.id === candidateId);
    if (!candidate) return fail("La propuesta cambió. Recarga la página.");

    const matches = await loadExistingPcMonitorBundleMatches(admin, [candidate]);
    if (matches.errors.length) {
      return fail("No se pudo confirmar el Bundle: " + matches.errors.join(" · "));
    }
    const match = matches.matches[0];
    const existing = match?.existingProduct;
    if (
      match?.status !== "existing_managed" ||
      existing?.managedBy !== BUNDLE_MANAGED_BY_VALUE ||
      existing.status !== "DRAFT" || !existing.id ||
      existing.sku !== candidate.identity.sku
    ) {
      return fail("Esta opción solo funciona con borradores gestionados por la app y SKU coincidente.");
    }

    const calculated = calculateTemplateCandidatePrice(candidate, runtime.priceConfig);
    if (
      !Number.isFinite(calculated.componentPrice) ||
      !Number.isFinite(calculated.finalPrice) ||
      calculated.finalPrice <= 0 ||
      calculated.componentPrice < calculated.finalPrice
    ) return fail("El cálculo de precios actual no es válido.");

    const expected = calculated.componentPrice > calculated.finalPrice
      ? calculated.componentPrice
      : null;
    if (expected === null) return {
      success: true,
      productId: existing.id,
      message: "Este Bundle no tiene ahorro: no corresponde asignar un precio de comparación.",
    };

    const response = await admin.graphql(`#graphql
      query CsbyteCompareAtDraft($id: ID!) {
        product(id: $id) {
          id
          status
          variants(first: 2) {
            nodes {
              id
              price
              compareAtPrice
              inventoryItem { sku }
            }
          }
        }
      }
    `, { variables: { id: existing.id } });
    const data = await response.json() as {
      data?: { product?: {
        id: string; status: string; variants: {nodes: Array<{
          id: string; price: string; compareAtPrice: string | null;
          inventoryItem?: { sku: string | null } | null;
        }>};
      } | null };
      errors?: Array<{message: string}>;
    };
    if (data.errors?.length) return fail(data.errors.map((e) => e.message).join(" · "));
    const product = data.data?.product;
    if (
      product?.id !== existing.id || product?.status !== "DRAFT" ||
      product.variants.nodes.length !== 1
    ) return fail("El producto cambió; no se modificó ningún precio.");

    const variant = product.variants.nodes[0];
    if (
      variant.inventoryItem?.sku !== candidate.identity.sku ||
      Number(variant.price) !== calculated.finalPrice
    ) return fail("El SKU o precio actual ya no coincide con la propuesta. No se modificó.");

    if (variant.compareAtPrice != null) {
      return Number(variant.compareAtPrice) === expected
        ? {success: true, productId: existing.id,
            message: "El precio de comparación ya es correcto; no se modificó."}
        : fail("Ya existe un precio de comparación diferente. Revísalo en Shopify antes de modificarlo.");
    }

    const update = await admin.graphql(`#graphql
      mutation CsbyteCompleteBundleCompareAt(
        $productId: ID!, $variants: [ProductVariantsBulkInput!]!
      ) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price compareAtPrice }
          userErrors { field message }
        }
      }
    `, {
      variables: {
        productId: existing.id,
        variants: [{id: variant.id, compareAtPrice: String(expected)}],
      },
    });
    const saved = await update.json() as {
      data?: { productVariantsBulkUpdate?: {
        productVariants?: Array<{id: string; price: string; compareAtPrice: string | null}>;
        userErrors?: Array<{message: string}>;
      }};
      errors?: Array<{message: string}>;
    };
    const errors = [
      ...(saved.errors ?? []).map((e) => e.message),
      ...(saved.data?.productVariantsBulkUpdate?.userErrors ?? []).map((e) => e.message),
    ];
    if (errors.length) return fail("Shopify rechazó la actualización: " + errors.join(" · "));
    const confirmed = saved.data?.productVariantsBulkUpdate?.productVariants?.[0];
    if (
      confirmed?.id !== variant.id ||
      Number(confirmed.compareAtPrice) !== expected ||
      Number(confirmed.price) !== calculated.finalPrice
    ) return fail("Shopify no confirmó el precio de comparación. Revisa el producto antes de reintentar.");

    return {success: true, productId: existing.id,
      message: "Precio de comparación guardado usando la suma individual de los componentes."};
  } catch (error) {
    return fail("No se pudo completar el precio de comparación: " +
      (error instanceof Error ? error.message : "Error inesperado"));
  }
}
