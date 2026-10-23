import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAP_TILE_ATTRIBUTION,
  DEFAULT_MAP_TILE_URL,
  resolveMapTiles,
  tileImgSrc,
} from "@/lib/mapTiles";

describe("tileImgSrc (#338)", () => {
  it("returns the origin of a plain tile template", () => {
    expect(tileImgSrc(DEFAULT_MAP_TILE_URL)).toBe("https://tile.openstreetmap.org");
  });

  it("turns a {s} subdomain template into a CSP wildcard host", () => {
    expect(
      tileImgSrc("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"),
    ).toBe("https://*.basemaps.cartocdn.com");
  });

  it("keeps a port and ignores the query string (e.g. an API key)", () => {
    expect(tileImgSrc("http://tiles.local:8080/{z}/{x}/{y}.png?key=abc")).toBe(
      "http://tiles.local:8080",
    );
  });

  it.each([
    ["missing placeholders", "https://tile.example/map.png"],
    ["not a URL", "not a url {z}/{x}/{y}"],
    ["non-http scheme", "ftp://tile.example/{z}/{x}/{y}.png"],
    ["javascript scheme", "javascript:alert(1)//{z}/{x}/{y}"],
    ["embedded credentials", "https://user:pass@tile.example/{z}/{x}/{y}.png"],
    ["wildcard not in the leading label", "https://tiles-{s}.example/{z}/{x}/{y}.png"],
  ])("rejects %s", (_label, template) => {
    expect(tileImgSrc(template)).toBeNull();
  });
});

describe("resolveMapTiles (#338)", () => {
  it("defaults to OpenStreetMap when nothing is configured", () => {
    expect(resolveMapTiles({})).toEqual({
      url: DEFAULT_MAP_TILE_URL,
      attribution: DEFAULT_MAP_TILE_ATTRIBUTION,
    });
  });

  it("falls back to the default when MAP_TILE_URL is invalid", () => {
    expect(resolveMapTiles({ url: "https://tile.example/map.png", attribution: "X" }).url).toBe(
      DEFAULT_MAP_TILE_URL,
    );
  });

  it("uses a valid custom URL with its own attribution and subdomains", () => {
    expect(
      resolveMapTiles({
        url: "https://{s}.tiles.example/{z}/{x}/{y}.png",
        attribution: "© Example",
        subdomains: "ab",
      }),
    ).toEqual({ url: "https://{s}.tiles.example/{z}/{x}/{y}.png", attribution: "© Example", subdomains: "ab" });
  });

  it("credits OpenStreetMap when a custom URL has no attribution", () => {
    expect(resolveMapTiles({ url: "https://tiles.example/{z}/{x}/{y}.png" }).attribution).toBe(
      DEFAULT_MAP_TILE_ATTRIBUTION,
    );
  });
});
