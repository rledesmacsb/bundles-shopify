import { buildBundleProductContent } from "./bundle-description";
import { buildTemplateBundleState } from "./bundle-template-engine";
import { loadBundleTemplateCatalog } from "./bundle-template-catalog.server";
import { loadBundleRuntimeSettings } from "./bundle-runtime-settings.server";
import {
  BUNDLE_MANAGED_BY_VALUE,
  loadExistingPcMonitorBundleMatches,
} from "./bundle-existing.server";

type Admin = {
  graphql: (query: string, options?: any) => Promise<any>;
};

type Result = { success: boolean; message: string; productId?: string };

function rejected(message: string): Result {
  return { success: false, message };
}

function htmlHasContent(html: string | null | undefined): boolean {
  return Boolean(
    (html ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .trim(),
  );
}

/**
 * Fills missing content on one managed DRAFT without overwriting
 * Shopify descriptions, SEO title, SEO description, handle or variants.
 * There is deliberately no bulk action or overwrite flag.
 */
export async function completeMissingBundleContent(
  admin: Admin,
  candidateId: string,
): Promise<Result> {
  if (!candidateId) return rejected("No se identificó el Bundles.");

  try {
    const [catalog, runtime] = await Promise.all([
      loadBundleTemplateCatalog(admin),
      loadBundleRuntimeSettings(admin),
    ]);

    const errors = [...catalog.errors, ...runtime.errors];
    if (errors.length) {
      return rejected("No se pudo verificar la configuración actual: " + errors.join(" · "));
    }

    const state = buildTemplateBundleState(
      catalog.products,
      catalog.templates,
      runtime.componentConfig,
    );
    const candidate = state.candidates.find((item) => item.id === candidateId);
    if (!candidate) {
      return rejected("La propuesta ya no está disponible. Actualiza la página.");
    }

    const matches = await loadExistingPcMonitorBundleMatches(admin, [candidate]);
    if (matches.errors.length) {
      return rejected("No se pudo identificar el borrador: " + matches.errors.join(" · "));
    }

    const match = matches.matches[0];
    const existing = match?.existingProduct;
    if (
      match?.status !== "existing_managed" ||
      existing?.managedBy !== BUNDLE_MANAGED_BY_VALUE ||
      existing.status !== "DRAFT" ||
      !existing.id ||
      existing.sku !== candidate.identity.sku
    ) {
      return rejected(
        "La ficha solo puede completarse en un borrador administrado por CSBYTE con SKU coincidente.",
      );
    }

    const response = await admin.graphql(`#graphql
      query CsbyteDraftDescription($id: ID!) {
        product(id: $id) {
          id
          status
          descriptionHtml
          seo { title description }
          variants(first: 2) {
            nodes { inventoryItem { sku } }
          }
        }
      }
    `, { variables: { id: existing.id } });

    const snapshot = await response.json() as {
      data?: {
        product?: {
          id: string;
          status: string;
          descriptionHtml: string | null;
          seo?: { title?: string | null; description?: string | null } | null;
          variants: { nodes: Array<{ inventoryItem?: { sku: string | null } | null }> };
        } | null;
      };
      errors?: Array<{ message: string }>;
    };

    if (snapshot.errors?.length) {
      return rejected("Shopify no pudo consultar el borrador: " +
        snapshot.errors.map((error) => error.message).join(" · "));
    }

    const product = snapshot.data?.product;
    if (
      !product ||
      product.id !== existing.id ||
      product.status !== "DRAFT" ||
      product.variants.nodes.length !== 1 ||
      product.variants.nodes[0].inventoryItem?.sku !== candidate.identity.sku
    ) {
      return rejected("El borrador cambió en Shopify. Actualiza antes de continuar.");
    }

    const content = buildBundleProductContent(candidate);
    const missingDescription = !htmlHasContent(product.descriptionHtml);
    const missingSeoTitle = !product.seo?.title?.trim();
    const missingSeoDescription = !product.seo?.description?.trim();

    if (!missingDescription && !missingSeoTitle && !missingSeoDescription) {
      return {
        success: true,
        productId: existing.id,
        message: "La ficha ya contiene descripción, título SEO y metadescripción. No se modificó.",
      };
    }

    // Shopify must retain merchant-authored values as-is; send only missing
    // properties. For SEO, include the other existing value to preserve it.
    const updates: Record<string, unknown> = { id: existing.id };
    if (missingDescription) updates.descriptionHtml = content.descriptionHtml;
    if (missingSeoTitle || missingSeoDescription) {
      updates.seo = {
        title: missingSeoTitle ? content.seoTitle : product.seo!.title,
        description: missingSeoDescription
          ? content.seoDescription
          : product.seo!.description,
      };
    }

    const update = await admin.graphql(`#graphql
      mutation CsbyteCompleteBundleContent($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product { id status descriptionHtml seo { title description } }
          userErrors { field message }
        }
      }
    `, {
      variables: { product: updates },
    });

    const updated = await update.json() as {
      data?: {
        productUpdate?: {
          product?: {
            id: string;
            status: string;
            descriptionHtml: string | null;
            seo?: { title?: string | null; description?: string | null } | null;
          } | null;
          userErrors?: Array<{ message: string }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    const writeErrors = [
      ...(updated.errors ?? []).map((error) => error.message),
      ...(updated.data?.productUpdate?.userErrors ?? [])
        .map((error) => error.message),
    ];

    if (writeErrors.length) {
      return rejected("No se pudo guardar la descripción: " + writeErrors.join(" · "));
    }

    const saved = updated.data?.productUpdate?.product;
    if (
      saved?.id !== existing.id ||
      saved.status !== "DRAFT" ||
      !htmlHasContent(saved.descriptionHtml) ||
      !saved.seo?.title?.trim() ||
      !saved.seo?.description?.trim()
    ) {
      return rejected(
        "Shopify no confirmó todos los campos. Revisa el borrador antes de reintentar.",
      );
    }

    return {
      success: true,
      productId: existing.id,
      message: "Campos faltantes de la ficha completados; se conservaron los textos existentes.",
    };
  } catch (error) {
    return rejected("No se pudo completar la ficha: " +
      (error instanceof Error ? error.message : "Error inesperado"));
  }
}
