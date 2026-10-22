import {
  buildTemplateBundleState,
  calculateTemplateCandidatePrice,
  getTemplateCandidateStock,
  type TemplateBundleCandidate,
} from "./bundle-template-engine";
import { loadBundleTemplateCatalog } from "./bundle-template-catalog.server";
import { loadBundleRuntimeSettings } from "./bundle-runtime-settings.server";
import {
  loadExistingPcMonitorBundleMatches,
  BUNDLE_MANAGED_BY_VALUE,
} from "./bundle-existing.server";
import { loadBundleReadiness } from "./bundle-readiness.server";

type Admin = {
  graphql: (query: string, options?: any) => Promise<any>;
};

type CheckResult = {
  success: boolean;
  ready: boolean;
  candidateId: string;
  message: string;
  checks?: string[];
  productId?: string;
  publicationId?: string;
};

function failed(candidateId: string, message: string): CheckResult {
  return { success: false, ready: false, candidateId, message };
}

function errorsOf(json: any) {
  return (json?.errors ?? []).map((item: any) => item.message as string);
}

async function graphql(admin: Admin, query: string, variables?: object): Promise<any> {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  return response.json();
}

function toGrams(value: number, unit: string): number {
  if (unit === "GRAMS") return value;
  if (unit === "KILOGRAMS") return value * 1000;
  if (unit === "OUNCES") return value * 28.349523125;
  if (unit === "POUNDS") return value * 453.59237;
  return NaN;
}

function componentsOf(candidate: TemplateBundleCandidate) {
  return [
    candidate.baseProduct.id,
    candidate.monitor.id,
    candidate.keyboardMouse.id,
    ...(candidate.wifiAdapter ? [candidate.wifiAdapter.id] : []),
  ];
}

/**
 * A fresh, fail-closed check. The browser may send a candidate ID, but
 * never supplies a Shopify product ID, price, publication or components.
 */
export async function validateBundlePublication(
  admin: Admin,
  candidateId: string,
): Promise<CheckResult> {
  if (!candidateId) return failed(candidateId, "Falta identificar el Bundles.");

  try {
    const [catalog, runtime] = await Promise.all([
      loadBundleTemplateCatalog(admin),
      loadBundleRuntimeSettings(admin),
    ]);

    if (catalog.errors.length || runtime.errors.length) {
      return failed(candidateId,
        "No se pudo verificar el catálogo y la configuración actual: " +
        [...catalog.errors, ...runtime.errors].join(" · "));
    }

    const state = buildTemplateBundleState(
      catalog.products, catalog.templates, runtime.componentConfig,
    );
    const candidate = state.candidates.find((item) => item.id === candidateId);
    if (!candidate) {
      return failed(candidateId,
        "La propuesta cambió o ya no es válida. Recarga la página.");
    }

    const requiredStock = getTemplateCandidateStock(candidate);
    if (!Number.isFinite(requiredStock) || requiredStock <= 0) {
      return failed(candidateId, "No hay stock suficiente en los componentes.");
    }

    const calculatedPrice = calculateTemplateCandidatePrice(
      candidate, runtime.priceConfig,
    );
    const expectedPrice = calculatedPrice.finalPrice;
    const expectedCompareAtPrice = calculatedPrice.componentPrice > expectedPrice
      ? calculatedPrice.componentPrice
      : null;

    if (!Number.isFinite(expectedPrice) || expectedPrice <= 0) {
      return failed(candidateId, "El precio calculado para el Bundles no es válido.");
    }

    const readiness = await loadBundleReadiness(admin, [candidate]);
    if (readiness.errors.length || readiness.issues.length) {
      return failed(candidateId,
        "Completa los datos de los componentes antes de publicar: " +
        [...readiness.errors, ...readiness.issues.map((i) =>
          i.componentTitle + ": " + i.message)].join(" · "));
    }

    const matches = await loadExistingPcMonitorBundleMatches(admin, [candidate]);
    if (matches.errors.length) {
      return failed(candidateId, "No se pudo comprobar el producto existente: " +
        matches.errors.join(" · "));
    }

    const match = matches.matches[0];
    const existing = match?.existingProduct;
    if (
      match?.status !== "existing_managed" ||
      existing?.managedBy !== BUNDLE_MANAGED_BY_VALUE ||
      !existing.id
    ) {
      return failed(candidateId,
        "La publicación solo está habilitada para Bundles creados y administrados por esta app.");
    }

    const componentIds = componentsOf(candidate);
    const json = await graphql(admin, `#graphql
      query CsbytePublicationAudit($id: ID!, $componentIds: [ID!]!) {
        product(id: $id) {
          id
          title
          status
          descriptionHtml
          handle
          seo { title description }
          bundleComponents(first: 20) {
            nodes { componentProduct { id } }
            pageInfo { hasNextPage }
          }
          variants(first: 2) {
            nodes {
              id
              price
              compareAtPrice
              inventoryItem {
                sku
                measurement { weight { value unit } }
              }
            }
          }
        }
        nodes(ids: $componentIds) {
          ... on Product {
            id
            totalInventory
            variants(first: 2) {
              nodes {
                inventoryItem {
                  measurement { weight { value unit } }
                }
              }
            }
          }
        }
      }
    `, { id: existing.id, componentIds });

    if (errorsOf(json).length) {
      return failed(candidateId,
        "No se pudieron auditar los productos: " + errorsOf(json).join(" · "));
    }

    const product = json.data?.product;
    if (!product || product.id !== existing.id || product.status !== "DRAFT") {
      return failed(candidateId,
        "El producto debe existir en Shopify y encontrarse en estado Borrador.");
    }

    if (product.variants?.nodes?.length !== 1) {
      return failed(candidateId, "El producto Bundles debe tener una sola variante.");
    }

    const descriptionText = String(product.descriptionHtml ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .trim();

    if (!descriptionText) {
      return failed(candidateId,
        "El borrador no tiene descripción. Usa «Completar campos faltantes de la ficha» antes de publicarlo.");
    }

    const seoHandle = String(product.handle ?? "").trim();
    const seoTitle = String(product.seo?.title ?? "").trim();
    const seoDescription = String(product.seo?.description ?? "").trim();

    if (!seoHandle || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(seoHandle)) {
      return failed(candidateId,
        "El borrador no tiene un handle SEO válido. Revísalo en Shopify antes de publicar.");
    }
    if (!seoTitle || !seoDescription) {
      return failed(candidateId,
        "Faltan el título o la metadescripción SEO. Complétalos en Shopify antes de publicar.");
    }

    const actualComponents: string[] = (product.bundleComponents?.nodes ?? [])
      .map((item: any) => item.componentProduct?.id)
      .filter(Boolean);
    if (
      product.bundleComponents?.pageInfo?.hasNextPage ||
      actualComponents.length !== componentIds.length ||
      [...actualComponents].sort().join("|") !== [...componentIds].sort().join("|")
    ) {
      return failed(candidateId,
        "Los componentes del producto en Shopify no coinciden con la plantilla actual.");
    }

    const variant = product.variants.nodes[0];
    if (variant.inventoryItem?.sku?.trim() !== candidate.identity.sku) {
      return failed(candidateId,
        "El SKU del Bundles no coincide con el generado por la plantilla.");
    }

    if (Math.abs(Number(variant.price) - expectedPrice) > 0.01) {
      return failed(candidateId,
        "El precio del Bundles cambió. Revísalo antes de publicarlo.");
    }

    const currentCompareAt = variant.compareAtPrice == null
      ? null : Number(variant.compareAtPrice);
    if (currentCompareAt !== expectedCompareAtPrice) {
      return failed(candidateId,
        expectedCompareAtPrice === null
          ? "No corresponde un precio de comparación cuando no hay ahorro. Revísalo en Shopify."
          : "Falta o no coincide el precio de comparación. Usa «Completar precio de comparación» antes de publicar.");
    }

    const sourceProducts = json.data?.nodes ?? [];
    if (sourceProducts.length !== componentIds.length ||
      sourceProducts.some((item: any) => !item || item.totalInventory <= 0 ||
        item.variants?.nodes?.length !== 1)) {
      return failed(candidateId,
        "No fue posible verificar el inventario y las variantes de todos los componentes.");
    }

    let expectedWeight = 0;
    for (const source of sourceProducts) {
      const weight = source.variants.nodes[0].inventoryItem?.measurement?.weight;
      if (!weight || !Number.isFinite(weight.value) || weight.value <= 0) {
        return failed(candidateId, "Uno de los componentes no tiene peso válido.");
      }
      expectedWeight += toGrams(weight.value, weight.unit);
    }

    const parentWeight = variant.inventoryItem?.measurement?.weight;
    const savedWeight = parentWeight
      ? toGrams(parentWeight.value, parentWeight.unit)
      : NaN;

    if (
      !Number.isFinite(expectedWeight) || expectedWeight <= 0 ||
      !Number.isFinite(savedWeight) ||
      Math.abs(Math.round(expectedWeight) - Math.round(savedWeight)) > 1 ||
      parentWeight?.unit !== "KILOGRAMS"
    ) {
      return failed(candidateId,
        "El peso del Bundle debe expresarse en kg y coincidir con la suma de sus componentes. Utiliza Actualizar peso.");
    }

    const scopesJson = await graphql(admin, `#graphql
      query CsbytePublicationScopes {
        currentAppInstallation { accessScopes { handle } }
      }
    `);
    if (errorsOf(scopesJson).length) {
      return failed(candidateId,
        "No se pudieron verificar los permisos de la aplicación.");
    }
    const scopes: string[] = (
      scopesJson.data?.currentAppInstallation?.accessScopes ?? []
    ).map((item: any) => item.handle);
    if (!scopes.includes("read_publications") ||
        !scopes.includes("write_publications")) {
      return failed(candidateId,
        "La app necesita permisos read_publications y write_publications antes de publicar. Actualiza la configuración de permisos de Shopify.");
    }

    const publicationsJson = await graphql(admin, `#graphql
      query CsbyteOnlineStorePublication {
        publications(first: 50) {
          nodes {
            id
            channels(first: 10) { nodes { handle name } }
          }
          pageInfo { hasNextPage }
        }
      }
    `);
    if (errorsOf(publicationsJson).length ||
        publicationsJson.data?.publications?.pageInfo?.hasNextPage) {
      return failed(candidateId,
        "No se pudo verificar de manera completa el canal Tienda online.");
    }
    const publications: Array<{id: string; channels?: {nodes: Array<{handle: string; name: string}>}}> =
      publicationsJson.data?.publications?.nodes ?? [];
    const onlineStores = publications.filter((publication) =>
      publication.channels?.nodes?.some((channel) => {
        const name = channel.name.trim().toLowerCase();
        const handle = channel.handle.trim().toLowerCase();
        return handle === "online-store" ||
          handle === "online_store" ||
          name === "online store" ||
          name === "tienda online";
      }),
    );

    if (onlineStores.length !== 1) {
      return failed(candidateId,
        "No se pudo identificar de forma única la publicación de Tienda online. No se realizaron cambios.");
    }

    return {
      success: true,
      ready: true,
      candidateId,
      productId: product.id,
      publicationId: onlineStores[0].id,
      message: "Validación aprobada. Confirma para activar y publicar este Bundles en Tienda online.",
      checks: [
        "Producto administrado por CSBYTE en estado Borrador",
        "Componentes y stock vigentes",
        "SKU, precio y precio de comparación verificados",
        "Peso total verificado en kilogramos",
        "Descripción del producto informada",
        "Handle, título y metadescripción SEO verificados",
        "Canal Tienda online identificado",
      ],
    };
  } catch (error) {
    return failed(candidateId, "No fue posible validar la publicación: " +
      (error instanceof Error ? error.message : "Error inesperado"));
  }
}

export async function publishValidatedBundle(
  admin: Admin,
  candidateId: string,
): Promise<CheckResult & { partial?: boolean }> {
  // Never rely on any client-side prior validation; revalidate immediately.
  const result = await validateBundlePublication(admin, candidateId);
  if (!result.ready || !result.productId || !result.publicationId) return result;

  try {
    const activation = await graphql(admin, `#graphql
      mutation CsbyteActivateForPublication($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product { id status }
          userErrors { field message }
        }
      }
    `, { product: { id: result.productId, status: "ACTIVE" } });

    const activationErrors = [
      ...errorsOf(activation),
      ...(activation.data?.productUpdate?.userErrors ?? []).map((e: any) => e.message),
    ];
    if (
      activationErrors.length ||
      activation.data?.productUpdate?.product?.status !== "ACTIVE"
    ) {
      return failed(candidateId,
        "Shopify no permitió activar el borrador: " +
        (activationErrors.join(" · ") || "Estado no confirmado"));
    }

    const publication = await graphql(admin, `#graphql
      mutation CsbytePublishOnlineStore($id: ID!, $publicationId: ID!) {
        publishablePublish(id: $id, input: [{publicationId: $publicationId}]) {
          publishable { publishedOnPublication(publicationId: $publicationId) }
          userErrors { field message }
        }
      }
    `, { id: result.productId, publicationId: result.publicationId });

    const publishErrors = [
      ...errorsOf(publication),
      ...(publication.data?.publishablePublish?.userErrors ?? [])
        .map((e: any) => e.message),
    ];
    if (
      publishErrors.length ||
      publication.data?.publishablePublish?.publishable?.publishedOnPublication !== true
    ) {
      // Do not report success; try to return to draft if channel publishing failed.
      const revert = await graphql(admin, `#graphql
        mutation CsbyteRestoreDraft($product: ProductUpdateInput!) {
          productUpdate(product: $product) {
            product { status }
            userErrors { message }
          }
        }
      `, { product: { id: result.productId, status: "DRAFT" } });
      const reverted = !errorsOf(revert).length &&
        revert.data?.productUpdate?.product?.status === "DRAFT" &&
        !revert.data?.productUpdate?.userErrors?.length;

      return {
        ...failed(candidateId,
          "No se confirmó la publicación en Tienda online. " +
          (publishErrors.join(" · ") || "Shopify no confirmó el canal.") +
          (reverted ? " El producto volvió a Borrador." :
            " Revisa el estado del producto en Shopify antes de reintentar.")),
        partial: !reverted,
        productId: result.productId,
      };
    }

    return {
      success: true,
      ready: false,
      candidateId,
      productId: result.productId,
      message: "Bundles activado y publicado en Tienda online correctamente.",
    };
  } catch (error) {
    return {
      ...failed(candidateId,
        "La publicación quedó sin confirmación. Revisa el producto en Shopify antes de reintentar: " +
        (error instanceof Error ? error.message : "Error de Shopify")),
      partial: true,
      productId: result.productId,
    };
  }
}
