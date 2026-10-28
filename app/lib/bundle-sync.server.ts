import {
  calculateBundlePrice,
  type BundleCandidate,
  type ProductNode,
} from "./bundle-engine";
import { loadBundleRuntimeSettings } from "./bundle-runtime-settings.server";

type Admin = { graphql: (query: string, options?: any) => Promise<any> };

type Variant = {
  id: string;
  sku: string | null;
  price: string;
  compareAtPrice?: string | null;
  inventoryQuantity: number | null;
};
type Component = {
  quantity: number;
  componentProduct: {
    id: string;
    title: string;
    status: string;
    totalInventory: number;
  } | null;
  componentVariants: {
    nodes: Variant[];
    pageInfo: { hasNextPage: boolean };
  };
};
type ManagedProduct = {
  id: string;
  title: string;
  status: string;
  totalInventory: number;
  variants: { nodes: Variant[] };
  managedBy: { value: string } | null;
  snapshotMeta: { value: string; compareDigest: string | null } | null;
  bundleComponents: {
    nodes: Component[];
    pageInfo: { hasNextPage: boolean };
  };
};
type Snapshot = {
  schemaVersion: number;
  sku: string;
  finalPrice: number;
  base: { productId: string; variantId: string };
  monitor: { productId: string; variantId: string };
  keyboardMouse: { productId: string; variantId: string };
  wifiAdapter: { productId: string; variantId: string } | null;
  [key: string]: unknown;
};

export type BundleSyncRow = {
  id: string;
  title: string;
  status: string;
  available: number;
  price: number | null;
  expectedPrice: number | null;
  issues: string[];
  updated: boolean;
  updatedDetail?: "price" | "compare_at" | "both";
  autoUnpublished?: boolean;
};

export type BundleSyncReport = {
  checkedAt: string;
  total: number;
  updated: number;
  unpublished: number;
  requiresAttention: number;
  priceRuleConfigured: boolean;
  errors: string[];
  rows: BundleSyncRow[];
};

const PAGE_LIMIT = 25;
const PAGE_SIZE = 15;
const NAMESPACE = "csbyte_bundle";

const BUNDLES_QUERY = String.raw`#graphql
  query CsbyteManagedBundlePriceAudit($after: String) {
    products(first: 15, after: $after, query: "sku:BND-*") {
      nodes {
        id title status totalInventory
        managedBy: metafield(namespace: "csbyte_bundle", key: "managed_by") { value }
        snapshotMeta: metafield(namespace: "csbyte_bundle", key: "component_snapshot") {
          value compareDigest
        }
        variants(first: 2) {
          nodes { id sku price compareAtPrice inventoryQuantity }
        }
        bundleComponents(first: 10) {
          nodes {
            quantity
            componentProduct { id title status totalInventory }
            componentVariants(first: 2) {
              nodes { id sku price inventoryQuantity }
              pageInfo { hasNextPage }
            }
          }
          pageInfo { hasNextPage }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function readErrors(json: any): string[] {
  return (json?.errors ?? []).map((error: any) => String(error.message));
}

async function query(admin: Admin, operation: string, variables?: object) {
  const response = await admin.graphql(operation, variables ? { variables } : undefined);
  const body = await response.json();
  if (readErrors(body).length) {
    throw new Error(readErrors(body).join(" · "));
  }
  return body.data;
}

async function managedBundles(admin: Admin): Promise<ManagedProduct[]> {
  const result: ManagedProduct[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < PAGE_LIMIT; page++) {
    const data = await query(admin, BUNDLES_QUERY, { after: cursor });
    const connection = data?.products;
    if (!connection || !Array.isArray(connection.nodes)) {
      throw new Error("Shopify no devolvió el listado de Bundles.");
    }
    for (const product of connection.nodes as ManagedProduct[]) {
      if (product.managedBy?.value === "csbyte-commerce-tools") result.push(product);
    }
    if (!connection.pageInfo?.hasNextPage) return result;
    if (!connection.pageInfo?.endCursor) {
      throw new Error("Paginación incompleta. No se actualizarán precios.");
    }
    cursor = connection.pageInfo.endCursor;
  }
  throw new Error("Se alcanzó el límite de páginas. No se actualizarán precios.");
}

function parseSnapshot(product: ManagedProduct): Snapshot | null {
  try {
    const s = JSON.parse(product.snapshotMeta?.value || "null");
    if (s && s.schemaVersion === 2 && s.sku &&
      Number.isFinite(s.finalPrice) && s.finalPrice > 0 &&
      s.base?.variantId && s.monitor?.variantId && s.keyboardMouse?.variantId) {
      return s as Snapshot;
    }
  } catch { /* Invalid historical snapshot: never modify it. */ }
  return null;
}

function sourceProduct(component: Component): ProductNode {
  const p = component.componentProduct!;
  const v = component.componentVariants.nodes[0];
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    productType: "",
    totalInventory: p.totalInventory,
    featuredImage: null,
    variants: { nodes: [{ id: v.id, title: "Default", sku: v.sku,
      price: v.price, inventoryQuantity: v.inventoryQuantity }] },
    wifiMeta: null,
    videoInputMeta: null,
    videoOutputMeta: null,
  };
}

function asPrice(value: string | null | undefined) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function verifyComponents(product: ManagedProduct, s: Snapshot) {
  const issues: string[] = [];
  const expected = [s.base, s.monitor, s.keyboardMouse, ...(s.wifiAdapter ? [s.wifiAdapter] : [])];
  const actual = product.bundleComponents.nodes;
  const byVariant = new Map<string, Component>();

  if (product.bundleComponents.pageInfo.hasNextPage || actual.length !== expected.length) {
    issues.push("La composición del Bundle cambió. Revisión manual requerida.");
  }
  for (const entry of actual) {
    if (!entry.componentProduct || entry.quantity !== 1 ||
        entry.componentVariants.pageInfo.hasNextPage ||
        entry.componentVariants.nodes.length !== 1) {
      issues.push("Hay componentes ausentes, cantidades distintas o variantes múltiples.");
      continue;
    }
    byVariant.set(entry.componentVariants.nodes[0].id, entry);
  }
  for (const component of expected) {
    const found = byVariant.get(component.variantId);
    if (!found || found.componentProduct?.id !== component.productId) {
      issues.push("Los componentes ya no coinciden con la configuración original.");
    }
  }
  if (byVariant.size !== expected.length) {
    issues.push("Se encontraron variantes duplicadas o inesperadas.");
  }
  return { issues, byVariant, compositionInvalid: issues.length > 0 };
}

/**
 * Never allow a managed, published Bundle to remain for sale when Shopify
 * has removed or changed one of the original component variant IDs.
 * Re-fetch immediately before drafting, because another actor may have
 * corrected the Bundle since the inventory scan.
 *
 * Only structural differences trigger this safety action. Stock depletion
 * and DRAFT component status are reported but do not rewrite publication.
 */
async function unpublishInvalidBundle(
  admin: Admin,
  product: ManagedProduct,
): Promise<"unpublished" | "already_safe" | "restored"> {
  const data = await query(admin, String.raw`#graphql
    query CsbyteRecheckBundleBeforeDraft($id: ID!) {
      product(id: $id) {
        id status
        managedBy: metafield(namespace: "csbyte_bundle", key: "managed_by") { value }
        snapshotMeta: metafield(namespace: "csbyte_bundle", key: "component_snapshot") { value }
        bundleComponents(first: 10) {
          nodes {
            quantity
            componentProduct { id title status totalInventory }
            componentVariants(first: 2) {
              nodes { id sku price inventoryQuantity }
              pageInfo { hasNextPage }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    }
  `, { id: product.id });
  const current = data?.product as ManagedProduct | null;
  if (!current) return "already_safe";
  if (current.managedBy?.value !== "csbyte-commerce-tools") {
    throw new Error("No se modificó el Bundle: dejó de estar administrado por la app.");
  }
  if (!["ACTIVE", "UNLISTED"].includes(current.status)) return "already_safe";
  if (current.snapshotMeta?.value !== product.snapshotMeta?.value) {
    throw new Error("Los metadatos del Bundle cambiaron durante la revisión. Revisa antes de despublicar.");
  }
  const snapshot = parseSnapshot(current);
  if (!snapshot) {
    throw new Error("No se puede verificar la composición original: metadatos inválidos.");
  }
  if (!verifyComponents(current, snapshot).compositionInvalid) return "restored";

  const updated = await query(admin, String.raw`#graphql
    mutation CsbyteDisableInvalidBundle($input: ProductUpdateInput!) {
      productUpdate(product: $input) {
        product { id status }
        userErrors { field message }
      }
    }
  `, { input: { id: product.id, status: "DRAFT" } });
  const outcome = updated?.productUpdate;
  if (outcome?.userErrors?.length) {
    throw new Error(outcome.userErrors.map((x: any) => x.message).join(" · "));
  }
  if (outcome?.product?.id !== product.id || outcome.product.status !== "DRAFT") {
    throw new Error("Shopify no confirmó el cambio del Bundle a borrador.");
  }
  return "unpublished";
}

async function updatePrice(
  admin: Admin,
  product: ManagedProduct,
  snapshot: Snapshot,
  price: number,
  compareAtPrice: number | null,
) {
  const parent = product.variants.nodes[0];
  const result = await query(admin, String.raw`#graphql
    mutation CsbyteSyncManagedBundlePrice($id: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $id, variants: $variants) {
        productVariants { id price compareAtPrice }
        userErrors { field message }
      }
    }
  `, {
    id: product.id,
    variants: [{ id: parent.id, price: String(price),
      compareAtPrice: compareAtPrice == null ? null : String(compareAtPrice) }],
  });
  const updated = result?.productVariantsBulkUpdate;
  if (updated?.userErrors?.length) {
    throw new Error(updated.userErrors.map((x: any) => x.message).join(" · "));
  }
  const saved = updated?.productVariants?.find((variant: Variant) => variant.id === parent.id);
  if (!saved || Number(saved.price) !== price ||
      (saved.compareAtPrice == null ? null : Number(saved.compareAtPrice)) !== compareAtPrice) {
    throw new Error("Shopify no confirmó el nuevo precio de la variante.");
  }

  // The snapshot is our optimistic guard against overwriting manual prices.
  // Retain all original component identities and metadata.
  const nextSnapshot = { ...snapshot, finalPrice: price };
  const meta = await query(admin, String.raw`#graphql
    mutation CsbyteUpdateBundlePriceSnapshot($inputs: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $inputs) {
        metafields { id value }
        userErrors { field message }
      }
    }
  `, {
    inputs: [{
      ownerId: product.id,
      namespace: NAMESPACE,
      key: "component_snapshot",
      type: "json",
      value: JSON.stringify(nextSnapshot),
      compareDigest: product.snapshotMeta?.compareDigest ?? null,
    }],
  });
  if (meta?.metafieldsSet?.userErrors?.length ||
      !meta?.metafieldsSet?.metafields?.[0]) {
    throw new Error("Precio guardado, pero no se pudo actualizar el control de cambios. Revisar manualmente.");
  }
}

async function writeReport(admin: Admin, report: BundleSyncReport) {
  const installation = await query(admin, String.raw`#graphql
    query CsbyteSyncAppOwner { currentAppInstallation { id } }
  `);
  const ownerId = installation?.currentAppInstallation?.id;
  if (!ownerId) throw new Error("No se encontró la instalación de Shopify.");
  // Shopify's app-owned metafield stores only a bounded report.
  const compact = { ...report, rows: report.rows.slice(0, 50) };
  const result = await query(admin, String.raw`#graphql
    mutation CsbyteStoreBundleSyncReport($inputs: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $inputs) {
        metafields { id }
        userErrors { field message }
      }
    }
  `, {
    inputs: [{
      ownerId,
      namespace: "app_config",
      key: "bundle_sync_last_report",
      type: "json",
      value: JSON.stringify(compact),
    }],
  });
  if (result?.metafieldsSet?.userErrors?.length ||
      !result?.metafieldsSet?.metafields?.length) {
    throw new Error("No se pudo guardar el resumen de la sincronización.");
  }
}

export async function runManagedBundleSync(
  admin: Admin,
  options: { apply: boolean; saveReport?: boolean },
): Promise<BundleSyncReport> {
  const report: BundleSyncReport = {
    checkedAt: new Date().toISOString(),
    total: 0,
    updated: 0,
    unpublished: 0,
    requiresAttention: 0,
    priceRuleConfigured: false,
    errors: [],
    rows: [],
  };

  let bundles: ManagedProduct[];
  try {
    const [products, runtime] = await Promise.all([
      managedBundles(admin),
      loadBundleRuntimeSettings(admin),
    ]);
    if (runtime.errors.length) throw new Error(runtime.errors.join(" · "));
    bundles = products;
    report.priceRuleConfigured = runtime.priceConfig.configured;

    for (const product of bundles) {
      const parent = product.variants.nodes[0];
      const row: BundleSyncRow = {
        id: product.id,
        title: product.title,
        status: product.status,
        available: product.totalInventory,
        price: parent ? asPrice(parent.price) : null,
        expectedPrice: null,
        issues: [],
        updated: false,
      };
      report.rows.push(row);
      const snapshot = parseSnapshot(product);

      if (!snapshot || product.variants.nodes.length !== 1 ||
          parent.sku !== snapshot.sku) {
        row.issues.push("SKU, variante o metadatos internos no verificables.");
        continue;
      }
      const { issues, byVariant, compositionInvalid } = verifyComponents(product, snapshot);
      row.issues.push(...issues);
      if (compositionInvalid && options.apply &&
          ["ACTIVE", "UNLISTED"].includes(product.status)) {
        try {
          const result = await unpublishInvalidBundle(admin, product);
          if (result === "unpublished") {
            row.status = "DRAFT";
            row.autoUnpublished = true;
            row.issues.push("Despublicado automáticamente: faltan componentes del Bundle original.");
            report.unpublished++;
          } else if (result === "restored") {
            row.issues.push("La composición cambió durante la revisión: vuelve a ejecutar el control.");
          }
        } catch (error) {
          row.issues.push("No fue posible despublicar: " +
            (error instanceof Error ? error.message : "Error de Shopify."));
          report.errors.push(`${product.title}: no se pudo proteger el Bundle incompleto.`);
        }
      }

      const refs = [snapshot.base, snapshot.monitor, snapshot.keyboardMouse,
        ...(snapshot.wifiAdapter ? [snapshot.wifiAdapter] : [])];
      const source = refs.map(ref => byVariant.get(ref.variantId));
      const roles = ["PC", "Monitor", "Teclado y mouse", "Adaptador Wi-Fi"];
      for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (!c?.componentProduct || !c.componentVariants.nodes[0]) continue;
        const variant = c.componentVariants.nodes[0];
        const problems: string[] = [];
        if (!["ACTIVE", "UNLISTED"].includes(c.componentProduct.status)) {
          problems.push("no publicado");
        }
        if (variant.inventoryQuantity == null || variant.inventoryQuantity <= 0 ||
            c.componentProduct.totalInventory <= 0) {
          problems.push("sin stock verificable");
        }
        if (asPrice(variant.price) == null) {
          problems.push("precio no válido");
        }
        if (problems.length) {
          const name = c.componentProduct.title.split(" (")[0].trim();
          row.issues.push(`${roles[i]} — ${name}: ${problems.join(" y ")}.`);
        }
      }
      if (row.issues.length) continue;

      if (!runtime.priceConfig.configured) {
        row.issues.push("Falta configurar la regla de precios para habilitar la actualización automática.");
        continue;
      }

      const [base, monitor, keyboard, wifi] = source.map(x => sourceProduct(x!));
      const legacy: BundleCandidate = {
        id: product.id,
        type: "desktop",
        template: "pc_monitor_new",
        baseProduct: base,
        monitor: monitor,
        keyboardMouse: keyboard,
        wifiAdapter: wifi ?? null,
        commonVideoPorts: [],
      };
      const calculation = calculateBundlePrice(legacy, runtime.priceConfig);
      const wanted = calculation.finalPrice;
      const wantedCompare = calculation.componentPrice > wanted ?
        calculation.componentPrice : null;
      if (!Number.isSafeInteger(wanted) || wanted <= 0) {
        row.issues.push("El cálculo comercial devolvió un precio no válido.");
        continue;
      }
      row.expectedPrice = wanted;

      if (row.price !== snapshot.finalPrice) {
        row.issues.push("Precio editado fuera de la app; no se sobrescribirá.");
        continue;
      }

      const previousCompare = parent.compareAtPrice == null ? null : Number(parent.compareAtPrice);
      if (row.price === wanted && previousCompare === wantedCompare) continue;

      const salePriceChanged = row.price !== wanted;
      const compareChanged = previousCompare !== wantedCompare;
      row.updatedDetail = salePriceChanged && compareChanged
        ? "both"
        : salePriceChanged ? "price" : "compare_at";
      row.issues.push(salePriceChanged
        ? "El precio de venta necesita sincronización."
        : "El precio de comparación necesita sincronización.");
      if (!options.apply) continue;

      try {
        await updatePrice(admin, product, snapshot, wanted, wantedCompare);
        row.issues = [];
        row.price = wanted;
        row.updated = true;
        report.updated++;
      } catch (error) {
        row.issues.push(error instanceof Error ? error.message : "Error al sincronizar el precio.");
      }
    }
    report.total = report.rows.length;
    report.requiresAttention = report.rows.filter(row => row.issues.length > 0).length;
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : "No fue posible comprobar los Bundles.");
  }

  if (options.saveReport && !report.errors.length) {
    try {
      await writeReport(admin, report);
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : "No se pudo almacenar la última revisión.");
    }
  }
  return report;
}
