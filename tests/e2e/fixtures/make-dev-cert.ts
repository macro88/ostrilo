/**
 * Generates a throwaway self-signed certificate for `localhost`, used ONLY by
 * the Playwright fixture server.
 *
 * The NIP-07 content script matches `https://*` only, so the fixture page has
 * to be served over TLS or `window.nostr` is never injected and every provider
 * test would fail for a reason unrelated to what it is testing.
 *
 * The certificate is generated fresh into `test-results/` on each run and is
 * never committed. Chromium is launched with `--ignore-certificate-errors`, so
 * it is never trusted by anything outside the test browser. Do not reuse it
 * for anything, and do not add it to a trust store.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUT_DIR = resolve(process.cwd(), "test-results", "e2e-tls");
export const CERT_PATH = resolve(OUT_DIR, "localhost-cert.pem");
export const KEY_PATH = resolve(OUT_DIR, "localhost-key.pem");

export function ensureDevCertificate(): { cert: string; key: string } {
  if (existsSync(CERT_PATH) && existsSync(KEY_PATH)) {
    return { cert: CERT_PATH, key: KEY_PATH };
  }

  mkdirSync(dirname(CERT_PATH), { recursive: true });

  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey", "rsa:2048",
      "-nodes",
      "-keyout", KEY_PATH,
      "-out", CERT_PATH,
      "-days", "1",
      "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "ignore" }
  );

  return { cert: CERT_PATH, key: KEY_PATH };
}

