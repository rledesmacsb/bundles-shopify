import type { TemplateBundleCandidate } from "./bundle-template-engine";

/**
 * This is deterministic catalog copy, not AI-generated specifications.
 * Catalog values are HTML-escaped before entering product descriptions.
 * Do not promise warranties, included cables, OS licenses or conditions
 * unless those attributes are explicitly verified in a future catalog model.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shorten(value: string, limit: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const prefix = text.slice(0, limit - 1);
  const lastSpace = prefix.lastIndexOf(" ");
  const safePrefix = lastSpace > limit * 0.6 ? prefix.slice(0, lastSpace) : prefix;
  return safePrefix.trimEnd() + "…";
}

/**
 * Stable, readable Shopify handle. Keep key terms at the beginning,
 * then a short deterministic suffix to distinguish different combos
 * even when their names share the same truncated prefix.
 * Never derive it from runtime inventory, price, or date.
 */
export function buildBundleSeoHandle(candidate: TemplateBundleCandidate): string {
  const base = candidate.identity.title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  // FNV-1a 32-bit: consistent on server and in the Shopify embedded UI.
  const uniqueValue = [
    candidate.id,
    candidate.identity.sku,
    candidate.monitor.id,
    candidate.templateId,
  ].join("|");
  let digest = 2166136261;
  for (let i = 0; i < uniqueValue.length; i++) {
    digest ^= uniqueValue.charCodeAt(i);
    digest = Math.imul(digest, 16777619);
  }
  const suffix = (digest >>> 0).toString(36).padStart(7, "0");

  const truncated = (base || "combo-csbyte")
    .slice(0, 112 - suffix.length - 1)
    .replace(/-+$/g, "");
  return `${truncated}-${suffix}`;
}

export type BundleProductContent = {
  handle: string;
  descriptionHtml: string;
  seoTitle: string;
  seoDescription: string;
  includedProducts: Array<{ label: string; title: string }>;
  connection: string | null;
};

export function buildBundleProductContent(
  candidate: TemplateBundleCandidate,
): BundleProductContent {
  const includedProducts = [
    { label: "Computador", title: candidate.baseProduct.title },
    { label: "Monitor", title: candidate.monitor.title },
    { label: "Teclado y mouse", title: candidate.keyboardMouse.title },
    ...(candidate.wifiAdapter
      ? [{ label: "Adaptador Wi-Fi", title: candidate.wifiAdapter.title }]
      : []),
  ];

  const ports = [...new Set(
    candidate.commonVideoPorts
      .map((port) => port.trim())
      .filter(Boolean),
  )];
  const connection = ports.length > 0 ? ports.join(", ") : null;
  const intro =
    "Este combo reúne un computador, un monitor y periféricos seleccionados para utilizarse en conjunto.";

  const list = includedProducts.map((product) =>
    `<li><strong>${escapeHtml(product.label)}:</strong> ${escapeHtml(product.title)}</li>`,
  ).join("");

  const paragraphs = [
    `<p>${escapeHtml(intro)}</p>`,
    "<h2>Productos incluidos</h2>",
    `<ul>${list}</ul>`,
    ...(connection
      ? [
          "<h2>Conexión de video</h2>",
          `<p>El PC y el monitor comparten las siguientes conexiones: ${escapeHtml(connection)}.</p>`,
        ]
      : []),
    "<p>Revisa las características de cada componente y la configuración seleccionada antes de comprar. Solo se incluyen los productos indicados en este combo.</p>",
  ];

  return {
    handle: buildBundleSeoHandle(candidate),
    descriptionHtml: paragraphs.join("\n"),
    seoTitle: shorten(candidate.identity.title + " | CSBYTE", 70),
    seoDescription: shorten(
      `Combo de computador, monitor y teclado/mouse en CSBYTE. ${candidate.wifiAdapter ? "Incluye adaptador Wi-Fi. " : ""}Conoce los componentes y su configuración.`,
      160,
    ),
    includedProducts,
    connection,
  };
}
