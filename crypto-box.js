/* The case number, the report key and the two envelopes.

   Part envelope, read by tools/cases.py:  "TCS1" | wrapped key length (2 bytes) | wrapped key | iv (12) | ciphertext
     The AES-GCM key is used once and wrapped with the operator's RSA-OAEP public key.
     Plain text inside: header length (4 bytes) | header JSON | the PDF.
   Report envelope, written by tools/cases.py:  "TCR1" | iv (12) | ciphertext

   The additional data ties each file to its case and part number, so a file renamed on the server won't open. */
(function (global) {
  "use strict";
  const subtle = global.crypto.subtle;
  const encoder = new TextEncoder();
  const PART_MAGIC = encoder.encode("TCS1");
  const REPORT_MAGIC = encoder.encode("TCR1");
  const IV_BYTES = 12;
  const CASE_RE = /^[0-9a-f]{16}$/;
  const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

  function randomBytes(n) {
    return global.crypto.getRandomValues(new Uint8Array(n));
  }

  /* String.fromCharCode can't take a very long list, so large files go in slices. */
  function toBase64(bytes) {
    const slice = 0x8000 - (0x8000 % 3);
    let out = "";
    for (let i = 0; i < bytes.length; i += slice) out += btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + slice)));
    return out;
  }

  function fromBase64(text) {
    const raw = atob(text);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  const toBase64Url = (bytes) => toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const fromBase64Url = (text) => fromBase64(text.replace(/-/g, "+").replace(/_/g, "/") + "=");
  const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

  function join(...arrays) {
    const out = new Uint8Array(arrays.reduce((sum, a) => sum + a.length, 0));
    let at = 0;
    for (const a of arrays) { out.set(a, at); at += a.length; }
    return out;
  }

  function makeCase() {
    return { caseId: toHex(randomBytes(8)), reportKey: toBase64Url(randomBytes(32)) };
  }

  /* Reads "<case>.<key>", with or without the page address and the #. Returns null for anything else. */
  function parseCode(text) {
    const code = String(text || "").trim().split("#").pop();
    const [caseId, reportKey, extra] = code.split(".");
    return extra === undefined && CASE_RE.test(caseId || "") && KEY_RE.test(reportKey || "") ? { caseId, reportKey } : null;
  }

  const partLabel = (caseId, part, parts) => encoder.encode(`TCS1|${caseId}|${part}|${parts}`);
  const reportLabel = (caseId) => encoder.encode(`TCR1|${caseId}`);

  /* pdf: Uint8Array. publicKey: the operator's RSA public key as JWK. */
  async function sealPart({ pdf, caseId, reportKey, part, parts, publicKey }) {
    const rsa = await subtle.importKey("jwk", publicKey, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["wrapKey"]);
    const key = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    const wrapped = new Uint8Array(await subtle.wrapKey("raw", key, rsa, { name: "RSA-OAEP" }));
    const header = encoder.encode(JSON.stringify({ v: 1, caseId, reportKey, part, parts }));
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, header.length);
    const iv = randomBytes(IV_BYTES);
    const sealed = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: partLabel(caseId, part, parts) }, key, join(length, header, pdf));
    const size = new Uint8Array(2);
    new DataView(size.buffer).setUint16(0, wrapped.length);
    return join(PART_MAGIC, size, wrapped, iv, new Uint8Array(sealed));
  }

  /* Returns the report's bytes. Throws if the key is wrong or the file was changed. */
  async function openReport(bytes, caseId, reportKey) {
    if (!REPORT_MAGIC.every((b, i) => bytes[i] === b)) throw new Error("format");
    const key = await subtle.importKey("raw", fromBase64Url(reportKey), "AES-GCM", false, ["decrypt"]);
    const iv = bytes.subarray(REPORT_MAGIC.length, REPORT_MAGIC.length + IV_BYTES);
    const body = bytes.subarray(REPORT_MAGIC.length + IV_BYTES);
    return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv, additionalData: reportLabel(caseId) }, key, body));
  }

  async function sha256Hex(text) {
    return toHex(new Uint8Array(await subtle.digest("SHA-256", encoder.encode(text))));
  }

  global.CaseCrypto = { makeCase, parseCode, sealPart, openReport, sha256Hex, toBase64, fromBase64 };
})(window);
