/**
 * The server's icon, shown by MCP clients (e.g. on Claude Desktop's permission prompt).
 *
 * A plain sports-watch glyph of our own, deliberately NOT Garmin's logo: this package is not a
 * Garmin product, and a trademark on the prompt would suggest it is. Inlined as a data URI so the
 * server needs no network access and no files beside cli.js.
 */
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect x="22" y="2" width="20" height="60" rx="6" fill="#1f2937"/>' +
  '<circle cx="32" cy="32" r="20" fill="#0f766e"/>' +
  '<circle cx="32" cy="32" r="15" fill="#f8fafc"/>' +
  '<path d="M32 21v11l7 5" fill="none" stroke="#0f766e" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<rect x="51" y="27" width="5" height="10" rx="2" fill="#1f2937"/>' +
  "</svg>";

export const SERVER_ICON = {
  src: `data:image/svg+xml;base64,${Buffer.from(SVG, "utf8").toString("base64")}`,
  mimeType: "image/svg+xml",
  sizes: ["any"],
};
