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

export type BundleProductContent = {
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
