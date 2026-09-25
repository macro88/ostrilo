// Provide WebCrypto for Node test environment (without overriding read-only crypto)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { webcrypto } = require("node:crypto");
// Only set if missing or lacks subtle
// @ts-ignore
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  try {
    // @ts-ignore
    globalThis.crypto = webcrypto;
  } catch {
    // As a fallback, attempt defineProperty (may still be blocked in some runtimes)
    try {
      // @ts-ignore
      Object.defineProperty(globalThis, "crypto", {
        value: webcrypto,
        configurable: true,
      });
    } catch {
      // ignore; most tests here do not require crypto directly
    }
  }
}

// Node provides TextEncoder/Decoder globally in modern versions; fallback if missing
// @ts-ignore
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TextEncoder, TextDecoder } = require("node:util");
  // @ts-ignore
  globalThis.TextEncoder = TextEncoder;
  // @ts-ignore
  globalThis.TextDecoder =
    TextDecoder as unknown as typeof globalThis.TextDecoder;
}
