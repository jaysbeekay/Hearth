// Hearth standalone backup format, version 2 (#226).
//
// A backup is UTF-8 text, one record per line, so it can be written with
// Filesystem.appendFile and read back a slice at a time without ever holding
// the whole file (every document, base64) in WebView memory:
//
//   line 0   header JSON, plaintext: kind, formatVersion, schemaVersion,
//            exportedAt, and the PBKDF2 parameters (salt, iterations).
//   line 1+  base64(iv[12] || AES-256-GCM ciphertext+tag) of one JSON record:
//              { type: "manifest", tables, preferences }   exactly one, first
//              { type: "file", key, seq, data }            document file parts
//              { type: "end", records }                    exactly one, last
//
// The key comes from the user's backup password (PBKDF2-SHA256), never from
// the device keychain, so a backup can be opened on a new phone. Each record's
// additional authenticated data is the header line plus the record's index,
// so a changed header, a reordered, dropped or spliced record, or a file cut
// short all fail to decrypt or fail the end-record count.
//
// Loaded by index.html before app.js (window.HearthBackupFormat), and by the
// unit tests through require(). Pure functions only: no Capacitor plugins.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HearthBackupFormat = api;
})(typeof self !== "undefined" ? self : this, function () {
  const KIND = "hearth-standalone-backup";
  const FORMAT_VERSION = 2;
  const FILE_EXTENSION = ".hearthbackup";
  const DEFAULT_ITERATIONS = 600000;
  // Bounds on what a header may ask for: too few makes a weak key, too many
  // hangs the phone on a crafted file.
  const MIN_ITERATIONS = 100000;
  const MAX_ITERATIONS = 5000000;
  const MIN_PASSWORD_LENGTH = 8;
  // Base64 characters of document data per record. A multiple of 4, so each
  // part decodes on its own and parts can be appended to a file one by one.
  const FILE_PART_CHARS = 1024 * 1024;
  const IV_BYTES = 12;
  const SALT_BYTES = 16;

  const subtle = () => {
    const value = globalThis.crypto?.subtle;
    if (!value) throw new Error("This device cannot encrypt backups (WebCrypto unavailable).");
    return value;
  };
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function bytesToBase64(bytes) {
    let binary = "";
    const step = 0x8000;
    for (let index = 0; index < bytes.length; index += step) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + step));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  }

  function checkPassword(password) {
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Backup password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
  }

  // WebCrypto failures surface as a plain DOMException; each async step below
  // turns them into a message the restore/export screen can show.
  async function deriveKey(password, salt, iterations) {
    try {
      const material = await subtle().importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
      return await subtle().deriveKey(
        { name: "PBKDF2", hash: "SHA-256", salt, iterations },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    } catch (error) {
      throw new Error(`Could not prepare backup encryption: ${error?.message ?? error}`);
    }
  }

  function aad(headerLine, index) {
    return encoder.encode(`${headerLine}\n${index}`);
  }

  // Returns { header, headerLine, encrypt(record) → line, end() → line }.
  // Lines carry no trailing newline; the caller joins them with "\n".
  async function createWriter({ password, schemaVersion, exportedAt, iterations = DEFAULT_ITERATIONS }) {
    checkPassword(password);
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const header = {
      kind: KIND,
      formatVersion: FORMAT_VERSION,
      schemaVersion,
      exportedAt,
      cipher: "AES-256-GCM",
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: bytesToBase64(salt) },
    };
    const headerLine = JSON.stringify(header);
    const key = await deriveKey(password, salt, iterations);
    let index = 0;
    let ended = false;
    async function encrypt(record) {
      if (ended) throw new Error("Backup already finished.");
      index += 1;
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
      let ciphertext;
      try {
        ciphertext = new Uint8Array(
          await subtle().encrypt({ name: "AES-GCM", iv, additionalData: aad(headerLine, index) }, key, encoder.encode(JSON.stringify(record))),
        );
      } catch (error) {
        throw new Error(`Could not encrypt the backup: ${error?.message ?? error}`);
      }
      const framed = new Uint8Array(IV_BYTES + ciphertext.length);
      framed.set(iv, 0);
      framed.set(ciphertext, IV_BYTES);
      return bytesToBase64(framed);
    }
    return {
      header,
      headerLine,
      encrypt,
      // The end record counts the records before it, so a reader can tell a
      // complete backup from one cut off at a line boundary.
      async end() {
        const line = await encrypt({ type: "end", records: index });
        ended = true;
        return line;
      },
    };
  }

  // Splits a document's base64 data into file records.
  function fileRecords(key, base64) {
    const data = String(base64 ?? "");
    const parts = Math.max(1, Math.ceil(data.length / FILE_PART_CHARS));
    return Array.from({ length: parts }, (_, seq) => ({
      type: "file",
      key,
      seq,
      data: data.slice(seq * FILE_PART_CHARS, (seq + 1) * FILE_PART_CHARS),
    }));
  }

  // Parses line 0. Returns null when the text is not a v2 backup at all (for
  // example a v1 pretty-printed JSON backup), throws when it is a v2 header
  // this build cannot read.
  function parseHeader(headerLine) {
    let header;
    try {
      header = JSON.parse(headerLine);
    } catch {
      return null;
    }
    if (!header || header.kind !== KIND || typeof header.formatVersion !== "number") return null;
    if (header.formatVersion === 1) return null;
    if (header.formatVersion > FORMAT_VERSION) {
      throw new Error("This backup was made by a newer version of Hearth. Update the app to restore it.");
    }
    const kdf = header.kdf ?? {};
    if (header.formatVersion !== FORMAT_VERSION || header.cipher !== "AES-256-GCM" || kdf.name !== "PBKDF2" || kdf.hash !== "SHA-256") {
      throw new Error("Unsupported backup encryption.");
    }
    if (!Number.isInteger(kdf.iterations) || kdf.iterations < MIN_ITERATIONS || kdf.iterations > MAX_ITERATIONS) {
      throw new Error("Backup encryption settings are out of range.");
    }
    if (typeof kdf.salt !== "string" || kdf.salt.length === 0) throw new Error("Backup header is damaged.");
    if (!Number.isInteger(header.schemaVersion) || header.schemaVersion < 1) throw new Error("Backup header is damaged.");
    return header;
  }

  // Returns { header, decrypt(line, index) → record }. index starts at 1 for
  // the line after the header. A wrong password and a damaged record look the
  // same to AES-GCM, so the message names both.
  async function createReader(headerLine, password) {
    const header = parseHeader(headerLine);
    if (!header) throw new Error("That is not an encrypted Hearth backup.");
    if (typeof password !== "string" || password.length === 0) throw new Error("Enter the backup password.");
    let salt;
    try {
      salt = base64ToBytes(header.kdf.salt);
    } catch {
      throw new Error("Backup header is damaged.");
    }
    const key = await deriveKey(password, salt, header.kdf.iterations);
    async function decrypt(line, index) {
      let framed;
      try {
        framed = base64ToBytes(line.trim());
      } catch {
        throw new Error("The backup file is damaged.");
      }
      if (framed.length <= IV_BYTES) throw new Error("The backup file is damaged.");
      let plaintext;
      try {
        plaintext = await subtle().decrypt(
          { name: "AES-GCM", iv: framed.subarray(0, IV_BYTES), additionalData: aad(headerLine, index) },
          key,
          framed.subarray(IV_BYTES),
        );
      } catch {
        throw new Error(index === 1 ? "Wrong backup password, or the backup is damaged." : "The backup file is damaged.");
      }
      const record = JSON.parse(decoder.decode(plaintext));
      if (!record || typeof record.type !== "string") throw new Error("The backup file is damaged.");
      return record;
    }
    return { header, decrypt };
  }

  // Yields the lines of a source without loading it all: `source` is
  // { size, readSlice(start, end) → Promise<string> }. Backup text is ASCII
  // (JSON header plus base64), so byte offsets and string offsets agree.
  async function* readLines(source, sliceBytes = 4 * 1024 * 1024) {
    let carry = "";
    for (let offset = 0; offset < source.size; offset += sliceBytes) {
      let slice;
      try {
        slice = await source.readSlice(offset, Math.min(offset + sliceBytes, source.size));
      } catch (error) {
        throw new Error(`Could not read the backup file: ${error?.message ?? error}`);
      }
      const text = carry + slice;
      const lines = text.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) if (line.length > 0) yield line;
    }
    if (carry.length > 0) yield carry;
  }

  function blobSource(blob) {
    return { size: blob.size, readSlice: (start, end) => blob.slice(start, end).text() };
  }

  // A document storage key is `owner/ownerId/uuid.ext` or `inbox/uuid.ext`.
  // Anything else from a backup file is refused before it becomes a path.
  function isSafeStorageKey(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 300) return false;
    return value.split("/").every((segment) => /^[A-Za-z0-9_.-]+$/.test(segment) && segment !== "." && segment !== "..");
  }

  return {
    KIND,
    FORMAT_VERSION,
    FILE_EXTENSION,
    DEFAULT_ITERATIONS,
    MIN_PASSWORD_LENGTH,
    FILE_PART_CHARS,
    checkPassword,
    createWriter,
    createReader,
    parseHeader,
    fileRecords,
    readLines,
    blobSource,
    isSafeStorageKey,
    bytesToBase64,
    base64ToBytes,
  };
});
