/**
 * Decides whether a sender may reach a UI-only namespace.
 *
 * Note what is NOT used here: `sender.tab`. The options page is
 * `options_ui.open_in_tab: true` and the approval window is created with
 * `browser.windows.create`, so BOTH are extension pages that carry a
 * `sender.tab`. Requiring its absence would break them. `sender.id` alone is
 * also insufficient: this extension's own content script reports
 * `sender.id === browser.runtime.id`.
 *
 * The usable signal is the sender's URL: an extension page's URL starts with
 * the extension origin, a content script's does not.
 */
export function isTrustedExtensionSender(
  sender: unknown,
  runtimeId: string,
  extensionOrigin: string
): boolean {
  if (!sender || typeof sender !== "object") return false;
  const s = sender as { id?: unknown; url?: unknown };
  if (typeof s.id !== "string" || s.id !== runtimeId) return false;
  if (typeof s.url !== "string" || s.url.length === 0) return false;
  return s.url.startsWith(extensionOrigin);
}

/**
 * The outcome of binding a page request to the sender the browser attests.
 *
 * `origin` is the value derived from `sender.url`, never the one the message
 * carried: on success the two are equal, and the derived one is what handlers
 * receive.
 */
export type PageOriginAttestation =
  | { ok: true; origin: string }
  | { ok: false; reason: string };

/**
 * Decides which page origin a `nostr` request speaks for.
 *
 * The content script fills `origin` from `window.location.origin`, which is
 * correct in an uncompromised renderer. But every per-origin decision -
 * consent, trust level, rate limit, the origin the approval window shows -
 * rests on it, and any code running in the content-script process can write
 * it. `sender` is filled in by the browser, not by the caller, so the origin
 * is derived from it and the claim is only compared.
 *
 * A mismatch is refused rather than silently corrected: the content script
 * and the browser disagreeing about where a request came from means a
 * navigation race or a tampered process, and neither should sign.
 *
 * `sender.origin` is Chromium-only. Where present it must agree; where absent
 * (Firefox) the URL alone decides.
 */
export function attestPageOrigin(
  sender: unknown,
  runtimeId: string,
  claimedOrigin: unknown
): PageOriginAttestation {
  if (!sender || typeof sender !== "object") {
    return { ok: false, reason: "no sender" };
  }
  const s = sender as {
    id?: unknown;
    tab?: unknown;
    frameId?: unknown;
    url?: unknown;
    origin?: unknown;
  };
  if (s.id !== runtimeId) return { ok: false, reason: "foreign sender" };
  if (!s.tab || typeof s.tab !== "object") {
    return { ok: false, reason: "not a tab sender" };
  }
  // The content script runs in the top frame only.
  if (s.frameId !== 0) return { ok: false, reason: "not the top frame" };
  if (typeof s.url !== "string") return { ok: false, reason: "no sender url" };

  let url: URL;
  try {
    url = new URL(s.url);
  } catch {
    return { ok: false, reason: "unparseable sender url" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "sender is not https" };
  }
  const derived = url.origin;
  if (s.origin !== undefined && s.origin !== derived) {
    return { ok: false, reason: "sender origin disagrees with its url" };
  }
  if (claimedOrigin !== derived) {
    return { ok: false, reason: "claimed origin disagrees with sender" };
  }
  return { ok: true, origin: derived };
}
