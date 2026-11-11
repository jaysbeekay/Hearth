// SPIKE #493 — NOT FOR MERGE. Client for /api/device-backups on the user's
// own Hearth server. The body it sends is the .hearthbackup file exactly as
// backup-format.js wrote it: already encrypted with the user's backup
// password, which never leaves the phone. The server only gets ciphertext.
//
// Loaded by index.html (window.HearthServerBackup) and by Node through
// require(). Pure fetch: no Capacitor plugins.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HearthServerBackup = api;
})(typeof self !== "undefined" ? self : this, function () {
  function endpoint(serverUrl, suffix = "") {
    const base = new URL(serverUrl);
    if (base.protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(base.hostname)) {
      // A Bearer token and a backup over plain HTTP: refuse outside loopback.
      throw new Error("The server address must use https.");
    }
    return new URL(`/api/device-backups${suffix}`, base).toString();
  }

  async function check(response) {
    if (response.ok) return response;
    let message = `Server answered ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error) message = `${message}: ${body.error}`;
    } catch {
      // not JSON
    }
    throw new Error(message);
  }

  async function sha256Hex(body) {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(await body.arrayBuffer());
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  // body: the backup text (string) or a Blob. Resolves to the server's row,
  // after checking the server stored the same bytes we sent.
  async function upload({ serverUrl, token, body, fetchImpl = globalThis.fetch }) {
    const expected = await sha256Hex(body);
    const response = await check(
      await fetchImpl(endpoint(serverUrl), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
        body,
      }),
    );
    const row = await response.json();
    if (row.sha256 !== expected) throw new Error("The server stored something other than this backup.");
    return row;
  }

  async function list({ serverUrl, token, fetchImpl = globalThis.fetch }) {
    const response = await check(await fetchImpl(endpoint(serverUrl), { headers: { authorization: `Bearer ${token}` } }));
    return (await response.json()).backups;
  }

  // Resolves to a Blob, checked against the hash the server recorded at upload.
  async function download({ serverUrl, token, id, fetchImpl = globalThis.fetch }) {
    if (!/^[a-z0-9]{20,40}$/.test(String(id))) throw new Error("Unknown backup.");
    const response = await check(
      await fetchImpl(endpoint(serverUrl, `/${id}`), { headers: { authorization: `Bearer ${token}` } }),
    );
    const blob = await response.blob();
    const expected = response.headers.get("x-backup-sha256");
    if (expected && (await sha256Hex(blob)) !== expected) throw new Error("The downloaded backup is damaged.");
    return blob;
  }

  return { upload, list, download, sha256Hex };
});
