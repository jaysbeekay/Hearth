// Raster tile source for the Property map (#338).
//
// CARTO's "voyager" basemap was chosen in #130 because OpenStreetMap's own
// tile servers are meant for light use rather than production embedding,
// but CARTO has since started serving an "API KEY REQUIRED" placeholder in
// place of every keyless tile. The default is now OpenStreetMap's standard
// tiles: a single household looking at its own property map is the light,
// attributed use that OSM's tile usage policy
// (https://operations.osmfoundation.org/policies/tiles/) allows. Anyone who
// wants a different or keyed provider (CARTO, Stadia, MapTiler, a
// self-hosted tile server...) sets MAP_TILE_URL to its template, and the
// Content-Security-Policy follows that host automatically.

export const DEFAULT_MAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const DEFAULT_MAP_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export interface MapTileConfig {
  url: string;
  attribution: string;
  subdomains?: string;
}

/**
 * The CSP `img-src` source matching a Leaflet tile URL template, e.g.
 * "https://tile.openstreetmap.org" or, for a "{s}." subdomain template,
 * "https://*.basemaps.cartocdn.com". Null when the template isn't a usable
 * http(s) tile URL with {z}/{x}/{y} placeholders.
 */
export function tileImgSrc(template: string): string | null {
  if (!/\{z\}/.test(template) || !/\{x\}/.test(template) || !/\{y\}/.test(template)) return null;
  const SUBDOMAIN_PROBE = "leafletsubdomain";
  let url: URL;
  try {
    url = new URL(template.replace(/\{s\}/g, SUBDOMAIN_PROBE));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.host.replace(SUBDOMAIN_PROBE, "*");
  // Only a leading "*." label is a valid CSP host wildcard.
  if (host.includes("*") && !host.startsWith("*.")) return null;
  return `${url.protocol}//${host}`;
}

/**
 * The tile source to use: MAP_TILE_URL when it's a valid tile template,
 * otherwise the OpenStreetMap default. A custom URL without its own
 * attribution falls back to the OSM credit, since almost every raster
 * basemap is built on OSM data.
 */
export function resolveMapTiles(input: {
  url?: string;
  attribution?: string;
  subdomains?: string;
}): MapTileConfig {
  const url = input.url?.trim();
  if (!url || !tileImgSrc(url)) {
    return { url: DEFAULT_MAP_TILE_URL, attribution: DEFAULT_MAP_TILE_ATTRIBUTION };
  }
  return {
    url,
    attribution: input.attribution?.trim() || DEFAULT_MAP_TILE_ATTRIBUTION,
    ...(input.subdomains?.trim() ? { subdomains: input.subdomains.trim() } : {}),
  };
}
