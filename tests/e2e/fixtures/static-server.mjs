/**
 * Serves one directory over HTTPS for the Playwright suite.
 *
 *   node tests/e2e/fixtures/static-server.mjs --root <dir> --port <n> \
 *     --cert <cert.pem> --key <key.pem> [--host 127.0.0.1]
 *
 * This replaced the `http-server` devDependency, which needed 18 packages
 * nothing else in the tree uses to answer GET requests for one HTML page.
 * Plain `.mjs` with only `node:` imports, so it runs on the pinned Node
 * without a loader and without anything from node_modules.
 *
 * TLS only, because the NIP-07 content script matches `https://*` and a
 * plaintext fixture page never receives `window.nostr`. A plaintext request to
 * this port fails the handshake, which `nip07-provider.spec.ts` relies on.
 *
 * Bound to loopback by default. It serves files only from inside `--root`:
 * paths are resolved and anything that escapes the root is a 404, as is a
 * directory, a missing file, or a malformed path.
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { extname, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

/** Error codes that mean "nothing servable at this path", not a server fault. */
const NOT_FOUND_CODES = new Set(["ENOENT", "EISDIR", "ENOTDIR"]);

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    port: { type: "string" },
    cert: { type: "string" },
    key: { type: "string" },
    host: { type: "string", default: "127.0.0.1" },
  },
});

for (const name of ["root", "port", "cert", "key"]) {
  if (!values[name]) throw new Error(`static-server: --${name} is required`);
}

const root = resolve(values.root);
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`static-server: --port must be 1-65535, got ${values.port}`);
}

/** Maps a request path onto a file under `root`, or null if it would leave it. */
function filePathFor(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, "https://localhost").pathname);
  } catch {
    // A malformed percent-escape names no file; the caller answers 404.
    return null;
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const file = resolve(root, `.${pathname}`);
  return file.startsWith(root + sep) ? file : null;
}

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

const server = createServer(
  { cert: readFileSync(values.cert), key: readFileSync(values.key) },
  async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, "Method Not Allowed");
      return;
    }
    const file = filePathFor(req.url ?? "/");
    if (!file) {
      send(res, 404, "Not Found");
      return;
    }
    try {
      const body = await readFile(file);
      const type = CONTENT_TYPES[extname(file)] ?? "application/octet-stream";
      send(res, 200, req.method === "HEAD" ? undefined : body, type);
    } catch (error) {
      if (NOT_FOUND_CODES.has(error.code)) {
        send(res, 404, "Not Found");
        return;
      }
      console.error(`static-server: ${req.url}:`, error);
      send(res, 500, "Internal Server Error");
    }
  }
);

server.listen(port, values.host, () => {
  console.log(`static-server: serving ${root} at https://${values.host}:${port}`);
});
