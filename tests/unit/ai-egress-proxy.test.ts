// #559: AI_EGRESS_PROXY_URL sends provider calls through an agent firewall
// (e.g. Pipelock) as a standard HTTP forward proxy. Pipelock's /fetch
// endpoint, which this used to target, answers POST with 405, so every
// provider call failed once the setting was on. These tests run a real
// forward proxy on localhost and check that provider traffic goes through
// it with its method, headers and body intact, and that every module that
// talks to an AI provider uses the shared route.
import { readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/appSettings", () => ({
  getOllamaConfig: async () => ({ baseUrl: process.env.TEST_OLLAMA_URL, model: "test-model" }),
  isOllamaConfigured: async () => true,
  getAppSettingRaw: async () => null,
}));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { role: "ADMIN" } }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

type Seen = { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string };

let ollama: http.Server;
let proxy: http.Server;
const proxied: Seen[] = [];

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });
}

beforeAll(async () => {
  // Stands in for Ollama: answers /api/generate with a contract title.
  ollama = http.createServer(async (req, res) => {
    await readBody(req);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ response: JSON.stringify({ title: "Fibre contract" }) }));
  });
  process.env.TEST_OLLAMA_URL = await listen(ollama);

  // A minimal absolute-URI forward proxy, which is how Pipelock's forward
  // proxy receives plain-http requests: record it, then relay it to the
  // stand-in Ollama only. It never connects to an address taken from the
  // request.
  const ollamaPort = (ollama.address() as AddressInfo).port;
  proxy = http.createServer(async (req, res) => {
    const body = await readBody(req);
    proxied.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.url !== `http://127.0.0.1:${ollamaPort}/api/generate`) {
      res.writeHead(403).end();
      return;
    }
    const upstream = http.request(
      { host: "127.0.0.1", port: ollamaPort, path: "/api/generate", method: req.method, headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.end(body);
  });
  process.env.AI_EGRESS_PROXY_URL = await listen(proxy);
});

afterEach(() => {
  proxied.length = 0;
});

afterAll(() => {
  delete process.env.AI_EGRESS_PROXY_URL;
  ollama.close();
  proxy.close();
});

describe("aiProviderFetch with AI_EGRESS_PROXY_URL set", () => {
  it("relays a POST through the proxy with its headers and body intact", async () => {
    const { aiProviderFetch } = await import("@/lib/ai/egressProxy");
    const target = `${process.env.TEST_OLLAMA_URL}/api/generate`;

    const res = await aiProviderFetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "test-key" },
      body: JSON.stringify({ prompt: "hello" }),
    });

    expect(res.ok).toBe(true);
    expect(await res.json()).toHaveProperty("response");
    expect(proxied).toHaveLength(1);
    expect(proxied[0]).toMatchObject({ method: "POST", url: target, body: '{"prompt":"hello"}' });
    expect(proxied[0].headers["x-api-key"]).toBe("test-key");
  });

  it("routes the Ollama text fallback of document extraction through the proxy", async () => {
    const { extractContractFields } = await import("@/lib/documents/fieldExtraction");

    const result = await extractContractFields("A scanned page with nothing a heuristic recognises.");

    expect(result).toMatchObject({ source: "llm", fields: { title: "Fibre contract" } });
    expect(proxied.map((p) => p.url)).toEqual([`${process.env.TEST_OLLAMA_URL}/api/generate`]);
  });

  it("logs the host and status, not the body, when the proxy blocks a call", async () => {
    const { aiProviderFetch } = await import("@/lib/ai/egressProxy");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await aiProviderFetch(`${process.env.TEST_OLLAMA_URL}/api/blocked`, {
      method: "POST",
      body: "secret-body",
    });

    expect(res.status).toBe(403);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(`HTTP 403 for ${new URL(process.env.TEST_OLLAMA_URL!).host}`);
    expect(warn.mock.calls[0][0]).not.toContain("secret-body");
    warn.mockRestore();
  });

  it("blames the proxy, not Ollama, when Test connection is blocked", async () => {
    const { testOllamaConnection } = await import("@/lib/actions/app-settings");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await testOllamaConnection();

    expect(result?.error).toMatch(/egress proxy refused or failed the request \(HTTP 403\)/);
    vi.mocked(console.warn).mockRestore();
  });
});

describe("every AI provider call uses aiProviderFetch", () => {
  const root = path.resolve(__dirname, "../../src/lib");
  const files = [
    ...readdirSync(path.join(root, "ai/providers")).map((f) => `ai/providers/${f}`),
    ...readdirSync(path.join(root, "ai/chat/providers")).map((f) => `ai/chat/providers/${f}`),
    ...readdirSync(path.join(root, "documents"))
      .filter((f) => /Extraction\.ts$/.test(f))
      .map((f) => `documents/${f}`),
  ].filter((f) => f.endsWith(".ts"));

  it.each(files)("%s makes no direct fetch() call", (file) => {
    const source = readFileSync(path.join(root, file), "utf8");
    expect(source).not.toMatch(/(?<!\w)fetch\s*\(/);
  });

  it("covers the provider modules and the Ollama text fallbacks", () => {
    expect(files).toEqual(expect.arrayContaining(["ai/providers/anthropic.ts", "documents/fieldExtraction.ts"]));
    const callers = files.filter((f) => readFileSync(path.join(root, f), "utf8").includes("aiProviderFetch("));
    expect(callers.length).toBeGreaterThanOrEqual(18);
  });
});
