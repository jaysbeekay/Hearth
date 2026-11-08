// The PDF preview's own response. Safari draws a PDF in a frame with its PDF
// plugin, and WebKit checks that plugin against the framed document's
// object-src. A blob: URL document inherits the app's CSP, which has
// object-src 'none' (#229), so the old blob: iframe stayed blank in Safari
// while Chrome and Firefox drew it. Online, the preview now frames the
// file's own URL with ?inline=1, and that one response gets the narrow CSP
// below: it may be framed by this origin only, may load nothing but itself
// as the plugin, and runs no script. The app's own CSP is unchanged.

export const INLINE_PARAM = "inline";

/** The URL the preview frames for a Document or Inbox file. */
export function inlineViewHref(downloadHref: string): string {
  return `${downloadHref}${downloadHref.includes("?") ? "&" : "?"}${INLINE_PARAM}=1`;
}

// /api/documents/<id> and /api/documents/inbox/<id>: the two file routes.
const FILE_ROUTE = /^\/api\/documents\/(?:inbox\/)?[^/]+$/;

export function isInlineViewRequest(pathname: string, searchParams: URLSearchParams): boolean {
  return FILE_ROUTE.test(pathname) && searchParams.get(INLINE_PARAM) === "1";
}

export const INLINE_VIEW_CSP = [
  "default-src 'none'",
  "object-src 'self'",
  "frame-ancestors 'self'",
].join("; ");

/**
 * Only a PDF is ever served inline. Any other type (an uploaded HTML file,
 * say) stays an attachment, so ?inline=1 can't turn a stored file into a
 * page that renders on this origin.
 */
export function contentDisposition(
  mimeType: string,
  filename: string,
  inlineRequested: boolean,
): string {
  const safeFilename = filename.replace(/[\r\n"]/g, "_");
  const kind = inlineRequested && mimeType === "application/pdf" ? "inline" : "attachment";
  return `${kind}; filename="${safeFilename}"`;
}
