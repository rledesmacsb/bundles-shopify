import type { TemplateBundleCandidate } from "./bundle-template-engine";
import { getTemplateMetafieldValues } from "./bundle-rule-engine";

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
  const intro = `El ${candidate.identity.title} de CSBYTE reúne un computador, un monitor compatible y un kit de teclado y mouse en una misma compra${candidate.wifiAdapter ? ", con adaptador Wi-Fi incluido" : ""}. Consulta el detalle de cada componente antes de elegir tu equipo.`;

  const list = includedProducts.map((product) =>
    `<li><strong>${escapeHtml(product.label)}:</strong> ${escapeHtml(product.title)}</li>`,
  ).join("");

  const detailList = (
    rows: Array<{ label: string; value: string | null | undefined }>,
  ): string => rows.filter((row) => Boolean(row.value?.trim()))
    .map((row) => `<li><strong>${escapeHtml(row.label)}:</strong> ${escapeHtml(row.value!)}</li>`)
    .join("");

  const baseSku = candidate.baseProduct.variants.nodes[0]?.sku?.trim() ?? "";
  const monitorSku = candidate.monitor.variants.nodes[0]?.sku?.trim() ?? "";
  const pcOutputs = getTemplateMetafieldValues(
    candidate.baseProduct, candidate.template.videoOutputField,
  ).join(", ");
  const monitorInputs = getTemplateMetafieldValues(
    candidate.monitor, candidate.template.videoInputField,
  ).join(", ");
  const pcWifi = getTemplateMetafieldValues(
    candidate.baseProduct, candidate.template.wifiField,
  ).join(", ");

  const pcDetails = detailList([
    { label: "SKU del computador", value: baseSku },
    { label: "Salidas de video", value: pcOutputs },
    { label: "Wi-Fi integrado", value: pcWifi },
  ]);
  const monitorDetails = detailList([
    { label: "SKU del monitor", value: monitorSku },
    { label: "Entradas de video", value: monitorInputs },
  ]);

  // GEO / AEO: direct, grounded answers to common buyer questions.
  // These are ordinary semantic HTML headings and paragraphs; Shopify theme
  // remains responsible for any Product structured data or canonical tags.
  const includedSummary = [
    candidate.baseProduct.title,
    candidate.monitor.title,
    "teclado y mouse",
    ...(candidate.wifiAdapter ? ["adaptador Wi-Fi"] : []),
  ].join(", ");

  const wifiAnswer = candidate.wifiAdapter
    ? `Sí, se incluye el adaptador Wi-Fi ${candidate.wifiAdapter.title}.`
    : pcWifi
      ? `El computador indica Wi-Fi integrado: ${pcWifi}. No se agrega un adaptador Wi-Fi adicional al combo.`
      : "No se incluye un adaptador Wi-Fi adicional. Revisa la conectividad del computador en su ficha técnica.";

  const videoAnswer = connection
    ? `Sí. El PC y el monitor comparten estas conexiones de video: ${connection}. La inclusión de cables específicos debe verificarse en cada ficha de producto.`
    : "Revisa las conexiones del computador y del monitor en sus fichas para confirmar qué cable o adaptador necesitas.";

  const question = (title: string, answer: string) =>
    `<h3>${escapeHtml(title)}</h3><p>${escapeHtml(answer)}</p>`;

  const paragraphs = [
    `<p>${escapeHtml(intro)}</p>`,
    "<h2>¿Qué incluye este combo PC + monitor?</h2>",
    `<p>Incluye ${escapeHtml(includedSummary)}.</p>`,
    "<h2>Productos incluidos</h2>",
    `<ul>${list}</ul>`,
    ...(pcDetails
      ? ["<h2>Características verificadas del computador</h2>", `<ul>${pcDetails}</ul>`]
      : []),
    ...(monitorDetails
      ? ["<h2>Características verificadas del monitor</h2>", `<ul>${monitorDetails}</ul>`]
      : []),
    "<h2>Preguntas frecuentes sobre el combo</h2>",
    question("¿Qué computador y monitor recibiré?",
      `Recibirás el computador ${candidate.baseProduct.title} y el monitor ${candidate.monitor.title}, junto con los accesorios detallados arriba.`),
    question("¿El PC y el monitor son compatibles?", videoAnswer),
    question("¿Incluye teclado y mouse?",
      `Sí. El combo incluye ${candidate.keyboardMouse.title}.`),
    question("¿Incluye conectividad Wi-Fi?", wifiAnswer),
    question("¿Dónde revisar especificaciones, estado y garantía?",
      "Las características que no se detallan aquí, las condiciones estéticas y las garantías deben verificarse en las fichas y condiciones comerciales de los productos incluidos. No se incluyen accesorios adicionales que no estén indicados."),
    "<p>Consulta los componentes y su configuración antes de comprar en CSBYTE Chile.</p>",
  ];

  return {
    handle: buildBundleSeoHandle(candidate),
    descriptionHtml: paragraphs.join("\n"),
    seoTitle: shorten(candidate.identity.title + " | CSBYTE", 70),
    seoDescription: shorten(
      `Combo ${candidate.baseProduct.title} con monitor ${candidate.monitor.title}, teclado y mouse${candidate.wifiAdapter ? " y adaptador Wi-Fi" : ""}. Revisa componentes y compatibilidad en CSBYTE Chile.`,
      160,
    ),
    includedProducts,
    connection,
  };
}
