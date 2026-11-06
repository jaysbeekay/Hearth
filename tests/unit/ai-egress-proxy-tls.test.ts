// #559: the https side of AI_EGRESS_PROXY_URL. Pipelock with TLS interception
// accepts a CONNECT, then answers the TLS handshake itself with a certificate
// signed by its own CA. To Hearth that is a CONNECT tunnel to a server whose
// certificate chains to AI_EGRESS_PROXY_CA_CERT, which is what these tests
// stand up: a CONNECT proxy in front of a local https server with a throwaway
// CA. They cover streaming POSTs, an untrusted certificate, a 403 from the
// firewall, a refused CONNECT and a missing CA file.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
let upstream: https.Server;
let proxy: http.Server;
let upstreamPort: number;
let proxyUrl: string;
let refuseConnect = false;
const connects: string[] = [];
const bodies: string[] = [];

function makeCerts(target: string) {
  const run = (args: string[]) => execFileSync("openssl", args, { cwd: target, stdio: "pipe" });
  const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes"];
  run(["req", "-x509", ...ec, "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", "/CN=Test egress CA",
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign"]);
  run(["req", ...ec, "-keyout", "server.key", "-out", "server.csr", "-subj", "/CN=127.0.0.1"]);
  writeFileSync(path.join(target, "san.ext"), "subjectAltName=IP:127.0.0.1\n");
  run(["x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial",
    "-out", "server.pem", "-days", "2", "-extfile", "san.ext"]);
}

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "hearth-egress-"));
  makeCerts(dir);

  // Plays the provider as seen through an intercepting firewall: streams its
  // reply in chunks, and answers 403 to a body carrying a secret, which is
  // what Pipelock's body DLP does.
  upstream = https.createServer(
    { key: readFileSync(path.join(dir, "server.key")), cert: readFileSync(path.join(dir, "server.pem")) },
    (req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        bodies.push(body);
        if (body.includes("AKIAIOSFODNN7EXAMPLE")) {
          res.writeHead(403).end("blocked: request body contains secret: AWS Access ID");
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        let n = 0;
        const timer = setInterval(() => {
          res.write(`data: chunk${n}\n\n`);
          if (++n === 3) {
            clearInterval(timer);
            res.end();
          }
        }, 20);
      });
    },
  );
  upstreamPort = await listen(upstream);

  // A CONNECT proxy that only tunnels to the local upstream.
  proxy = http.createServer((_req, res) => res.writeHead(405).end());
  proxy.on("connect", (req, socket: net.Socket, head) => {
    connects.push(req.url ?? "");
    if (refuseConnect || req.url !== `127.0.0.1:${upstreamPort}`) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const tunnel = net.connect(upstreamPort, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      tunnel.write(head);
      tunnel.pipe(socket);
      socket.pipe(tunnel);
    });
    tunnel.on("error", () => socket.destroy());
    socket.on("error", () => tunnel.destroy());
  });
  proxyUrl = `http://127.0.0.1:${await listen(proxy)}`;
});

afterAll(() => {
  upstream.close();
  proxy.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  connects.length = 0;
  bodies.length = 0;
  refuseConnect = false;
  vi.resetModules();
});

// env.ts reads process.env once at import, so each case re-imports.
async function loadWith(caCertFile: string) {
  process.env.AI_EGRESS_PROXY_URL = proxyUrl;
  process.env.AI_EGRESS_PROXY_CA_CERT = caCertFile;
  return import("@/lib/ai/egressProxy");
}

const target = () => `https://127.0.0.1:${upstreamPort}/v1/messages`;
const post = (body: string) => ({ method: "POST", headers: { "content-type": "application/json" }, body });

describe("aiProviderFetch over https through a CONNECT proxy", () => {
  it("streams a POST through the tunnel when the proxy CA is trusted", async () => {
    const { aiProviderFetch } = await loadWith(path.join(dir, "ca.pem"));

    const res = await aiProviderFetch(target(), post('{"prompt":"hi"}'));
    const chunks: string[] = [];
    const decoder = new TextDecoder();
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(res.status).toBe(200);
    expect(chunks.join("")).toBe("data: chunk0\n\ndata: chunk1\n\ndata: chunk2\n\n");
    expect(connects).toEqual([`127.0.0.1:${upstreamPort}`]);
    expect(bodies).toEqual(['{"prompt":"hi"}']);
  });

  it("refuses the interception certificate when no CA is configured", async () => {
    const { aiProviderFetch } = await loadWith("");

    const error = await aiProviderFetch(target(), post("{}")).catch((e: Error) => e);
    expect(String((error as Error & { cause?: unknown }).cause)).toMatch(/certificate/i);
    expect(bodies).toEqual([]);
  });

  it("hands the firewall's 403 back to the caller", async () => {
    const { aiProviderFetch } = await loadWith(path.join(dir, "ca.pem"));

    const res = await aiProviderFetch(target(), post('{"note":"AKIAIOSFODNN7EXAMPLE"}'));

    expect(res.status).toBe(403);
    expect(await res.text()).toContain("AWS Access ID");
  });

  it("fails the call when the proxy refuses the CONNECT", async () => {
    refuseConnect = true;
    const { aiProviderFetch } = await loadWith(path.join(dir, "ca.pem"));

    await expect(aiProviderFetch(target(), post("{}"))).rejects.toThrow();
    expect(connects).toHaveLength(1);
    expect(bodies).toEqual([]);
  });

  it("fails the call, without sending anything, when the CA file is missing", async () => {
    const { aiProviderFetch } = await loadWith(path.join(dir, "missing.pem"));

    await expect(aiProviderFetch(target(), post("{}"))).rejects.toThrow(/ENOENT/);
    expect(connects).toEqual([]);
  });

  it("refuses a cloud metadata address before contacting the proxy", async () => {
    const { aiProviderFetch } = await loadWith(path.join(dir, "ca.pem"));

    await expect(aiProviderFetch("http://169.254.169.254/latest/meta-data", {})).rejects.toThrow(/metadata/);
    expect(connects).toEqual([]);
  });
});
