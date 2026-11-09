import type { TemplateBundleCandidate } from "./bundle-template-engine";
import { buildTemplateBundleState } from "./bundle-template-engine";
import { loadBundleTemplateCatalog } from "./bundle-template-catalog.server";
import { loadBundleRuntimeSettings } from "./bundle-runtime-settings.server";
import {
  BUNDLE_MANAGED_BY_VALUE,
  BUNDLE_MANAGED_BY_KEY,
  BUNDLE_META_NAMESPACE,
  loadExistingPcMonitorBundleMatches,
} from "./bundle-existing.server";

type AdminClient = {
  graphql: (query: string, options?: any) => Promise<any>;
};

export type BundleGalleryResult = {
  success: boolean;
  changed: boolean;
  message: string;
  productId?: string;
  imagesCount?: number;
};

type ShopifyError = { message: string };

const failed = (message: string): BundleGalleryResult =>
  ({ success: false, changed: false, message });

function getErrors(value: {
  errors?: ShopifyError[];
} | null | undefined): string[] {
  return (value?.errors ?? []).map((error) => error.message);
}

function sourceProducts(candidate: TemplateBundleCandidate) {
  return [
    { label: "Computador", product: candidate.baseProduct },
    { label: "Monitor", product: candidate.monitor },
    { label: "Teclado y mouse", product: candidate.keyboardMouse },
    ...(candidate.wifiAdapter
      ? [{ label: "Adaptador Wi-Fi", product: candidate.wifiAdapter }]
      : []),
  ];
}

function isShopifyImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "cdn.shopify.com" ||
        url.hostname.endsWith(".cdn.shopify.com"));
  } catch {
    return false;
  }
}

/**
 * Add the first photo of each selected component to a managed Bundle
 * ONLY if the bundle has no gallery.
 *
 * This imports media by URL into Shopify without creating a generated mockup.
 * Component products and any merchant-maintained Bundle media are untouched.
 * The source products and the bundle composition are rechecked server-side.
 */
export async function addComponentImagesToEmptyBundle(
  admin: AdminClient,
  bundleId: string,
  candidate: TemplateBundleCandidate,
): Promise<BundleGalleryResult> {
  if (!bundleId || !candidate) {
    return failed("No se pudo identificar el Bundle o sus componentes.");
  }

  const sources = sourceProducts(candidate);
  const ids = sources.map((source) => source.product.id);
  if (ids.length < 3 || new Set(ids).size !== ids.length) {
    return failed("La lista de componentes del Bundle es inválida.");
  }

  try {
    const parentResponse = await admin.graphql(`#graphql
      query CsbyteCheckBundleGallery($id: ID!) {
        product(id: $id) {
          id
          status
          media(first: 1) { nodes { id } }
          variants(first: 2) {
            nodes { inventoryItem { sku } }
          }
          bundleComponents(first: 10) {
            nodes { componentProduct { id } }
            pageInfo { hasNextPage }
          }
          managedBy: metafield(
            namespace: "${BUNDLE_META_NAMESPACE}",
            key: "${BUNDLE_MANAGED_BY_KEY}"
          ) { value }
        }
      }
    `, { variables: { id: bundleId } });

    const parentJson = await parentResponse.json() as {
      data?: {
        product?: {
          id: string;
          status: string;
          media: { nodes: Array<{ id: string }> };
          variants: { nodes: Array<{ inventoryItem?: { sku: string | null } | null }> };
          bundleComponents: {
            nodes: Array<{ componentProduct: { id: string } }>;
            pageInfo: { hasNextPage: boolean };
          };
          managedBy?: { value: string } | null;
        } | null;
      };
      errors?: ShopifyError[];
    };

    if (getErrors(parentJson).length) {
      return failed("No se pudo verificar el Bundle: " + getErrors(parentJson).join(" · "));
    }

    const bundle = parentJson.data?.product;
    const componentIds = bundle?.bundleComponents?.nodes
      .map((node) => node.componentProduct.id) ?? [];
    if (
      !bundle ||
      bundle.id !== bundleId ||
      !["ACTIVE", "DRAFT"].includes(bundle.status) ||
      bundle.managedBy?.value !== BUNDLE_MANAGED_BY_VALUE ||
      bundle.variants.nodes.length !== 1 ||
      bundle.variants.nodes[0].inventoryItem?.sku !== candidate.identity.sku ||
      bundle.bundleComponents.pageInfo.hasNextPage ||
      componentIds.length !== ids.length ||
      [...ids].sort().join("|") !== [...componentIds].sort().join("|")
    ) {
      return failed("La composición del Bundle ya no coincide con la propuesta actual. No se modificó.");
    }

    if (bundle.media.nodes.length > 0) {
      return {
        success: true,
        changed: false,
        productId: bundleId,
        message: "El Bundle ya tiene imágenes. Se conservó la galería existente sin agregar duplicados.",
      };
    }

    const sourceResponse = await admin.graphql(`#graphql
      query CsbyteComponentFeaturedImages($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            featuredImage { url altText }
          }
        }
      }
    `, { variables: { ids } });

    const sourceJson = await sourceResponse.json() as {
      data?: {
        nodes: Array<{
          id: string;
          title: string;
          featuredImage: { url: string; altText: string | null } | null;
        } | null>;
      };
      errors?: ShopifyError[];
    };

    if (getErrors(sourceJson).length || !sourceJson.data?.nodes) {
      return failed("No se pudieron consultar las imágenes de los componentes.");
    }

    const byId = new Map(
      sourceJson.data.nodes
        .filter((p): p is NonNullable<typeof p> => Boolean(p?.id))
        .map((p) => [p.id, p]),
    );

    // A publishable gallery must identify both the computer and the monitor.
    const missing = sources.filter((source) => {
      const url = byId.get(source.product.id)?.featuredImage?.url ?? "";
      return !isShopifyImageUrl(url);
    });

    if (missing.length) {
      return failed("Faltan imágenes principales en Shopify para: " +
        missing.map((entry) => entry.label).join(", ") +
        ". Cárgalas en los componentes antes de generar la galería.");
    }

    // The order is deliberate: PC, monitor, keyboard+mouse, optional Wi-Fi.
    const media = sources.map((source) => {
      const item = byId.get(source.product.id)!;
      return {
        mediaContentType: "IMAGE",
        originalSource: item.featuredImage!.url,
        alt: [source.label, item.title, "Combo CSBYTE"].join(" · ").slice(0, 250),
      };
    });

    const update = await admin.graphql(`#graphql
      mutation CsbyteAddBundleComponentImages(
        $product: ProductUpdateInput!,
        $media: [CreateMediaInput!]
      ) {
        productUpdate(product: $product, media: $media) {
          product {
            id
            media(first: 10) { nodes { id status } }
          }
          userErrors { field message }
        }
      }
    `, {
      variables: {
        product: { id: bundleId },
        media,
      },
    });

    const saved = await update.json() as {
      data?: {
        productUpdate?: {
          product?: { id: string; media: { nodes: Array<{ id: string; status: string }> } } | null;
          userErrors?: ShopifyError[];
        };
      };
      errors?: ShopifyError[];
    };
    const writeErrors = [
      ...getErrors(saved),
      ...(saved.data?.productUpdate?.userErrors ?? []).map((e) => e.message),
    ];
    if (writeErrors.length) {
      return failed("Shopify no pudo agregar las imágenes: " + writeErrors.join(" · "));
    }
    const product = saved.data?.productUpdate?.product;
    if (product?.id !== bundleId || product.media.nodes.length === 0) {
      return failed("Shopify no confirmó la galería. Revisa el producto antes de reintentar.");
    }

    return {
      success: true,
      changed: true,
      productId: bundleId,
      imagesCount: media.length,
      message: `Se enviaron ${media.length} imágenes de los componentes a Shopify. Revisa que todas finalicen su procesamiento antes de publicar.`,
    };
  } catch (error) {
    return failed(
      "No fue posible completar la galería: " +
      (error instanceof Error ? error.message : "Error inesperado"),
    );
  }
}

/**
 * Resolve everything on the server: the browser only supplies a candidate ID.
 * Existing ACTIVE bundles are allowed because their gallery is the only field
 * affected; the product's price, SEO, stock, and publication are not changed.
 */
export async function addImagesToExistingManagedBundle(
  admin: AdminClient,
  candidateId: string,
): Promise<BundleGalleryResult> {
  if (!candidateId) return failed("No se identificó la propuesta de Bundle.");
  try {
    const [catalog, runtime] = await Promise.all([
      loadBundleTemplateCatalog(admin),
      loadBundleRuntimeSettings(admin),
    ]);
    if (catalog.errors.length || runtime.errors.length) {
      return failed(
        "No fue posible verificar el catálogo: " +
        [...catalog.errors, ...runtime.errors].join(" · "),
      );
    }
    const state = buildTemplateBundleState(
      catalog.products,
      catalog.templates,
      runtime.componentConfig,
    );
    const candidate = state.candidates.find((item) => item.id === candidateId);
    if (!candidate) return failed("La propuesta cambió. Actualiza Bundles.");

    const matches = await loadExistingPcMonitorBundleMatches(admin, [candidate]);
    if (matches.errors.length) {
      return failed("No se pudo localizar el producto administrado: " +
        matches.errors.join(" · "));
    }
    const match = matches.matches[0];
    if (
      match?.status !== "existing_managed" ||
      match.existingProduct?.managedBy !== BUNDLE_MANAGED_BY_VALUE ||
      !match.existingProduct?.id
    ) {
      return failed("Solo se pueden importar imágenes a Bundles creados y administrados por la app.");
    }

    return addComponentImagesToEmptyBundle(
      admin,
      match.existingProduct.id,
      candidate,
    );
  } catch (error) {
    return failed(
      "No fue posible localizar las imágenes del Bundle: " +
      (error instanceof Error ? error.message : "Error inesperado"),
    );
  }
}
