/**
 * Extension documents that can hold a private key, a master password, or a
 * signing decision the user is being asked to trust.
 *
 * Such a document shares one JavaScript realm with everything it loads, so a
 * compromised release of any decorative dependency it imports can read key
 * material straight off the heap - the attack needs a bad npm publish, not a
 * browser exploit. `tests/security/key-handling-bundle.test.ts` walks the
 * module and `modulepreload` graph of each document listed here and fails if a
 * WebGL library becomes reachable from it. A new document that can hold key
 * material belongs on this list, and the guard starts inspecting it without
 * further configuration.
 */
export const KEY_HANDLING_DOCUMENTS = [
  // Onboarding create/import, the lock screen, and the whole main app.
  "popup.html",
  // Same React tree as the popup, same lock screen.
  "sidepanel.html",
  // Hosts `ImportKeyForm` and its private key input.
  "options.html",
  // aislop-ignore-next-line ai-slop/narrative-comment -- not narrative: this is why a document holding no key material sits on a key-handling allowlist, and every other entry here carries the same justification.
  // Holds no key material, but its entire job is to show truthfully what is
  // about to be signed. A decorative WebGL library in that realm can repaint
  // what the user is reading before they approve it.
  "approval.html",
  // Receives an authenticator's PRF output, which opens the vault for anyone
  // who can also read extension storage. Chromium builds only.
  "unlock.html",
] as const;

export type KeyHandlingDocument = (typeof KEY_HANDLING_DOCUMENTS)[number];

/** A build target, named as its directory under `.output/`. */
export type BuildTargetName = "chrome-mv3" | "firefox-mv3";

/**
 * Documents that exist in only some build targets. A document not listed here
 * ships in every target. The build-output guard reads this, so a target-scoped
 * document is checked where it ships and asserted absent where it does not.
 */
const TARGET_SCOPED_DOCUMENTS: Partial<
  Record<KeyHandlingDocument, readonly BuildTargetName[]>
> = {
  "unlock.html": ["chrome-mv3"],
};

/** True when `document` is declared for `target`. */
export function shipsInTarget(
  document: KeyHandlingDocument,
  target: BuildTargetName
): boolean {
  return TARGET_SCOPED_DOCUMENTS[document]?.includes(target) ?? true;
}
