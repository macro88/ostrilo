/**
 * Which extension documents are allowed to instantiate the 3D mascot, and which
 * are not.
 *
 * The defect this exists to make unrepresentable: `src/ui/components/logo/
 * ModelViewer.tsx` statically imports `three` and `GLTFLoader`, `Logo.tsx`
 * statically imported `ModelViewer`, and the resulting 892 KB chunk was
 * referenced by every one of `popup.html`, `sidepanel.html`, `options.html` and
 * `approval.html`. That is the same realm in which `revealKey()` returns an nsec
 * into a ref, the master password sits in reducer state, and the approval screen
 * claims to show truthfully what is about to be signed. One compromised release
 * anywhere in the `three` dependency tree reads all of it straight off the heap.
 * The attack needs a bad npm publish, not a browser exploit.
 *
 * Two consumers read this declaration and they must read the same one:
 *
 *  - `Logo.tsx`, which downgrades `mode="model"` to the static poster when the
 *    document it is rendering in is not on the allowlist. A reviewer forgetting
 *    the rule is the failure mode; a constant the component enforces is not.
 *  - `tests/security/key-handling-bundle.test.ts`, which walks the module and
 *    `modulepreload` graph of each built document and fails on the WebGL
 *    markers.
 *
 * ON THE LOCATION OF THIS FILE. It belongs in shared infrastructure - the
 * `ui-architecture` delta calls for "shared key-handling document constants"
 * alongside `BROADCAST_EVENTS` in `src/infrastructure/messaging/events.ts`. It
 * sits here instead because `src/infrastructure/**` is owned by a concurrent
 * change in the same remediation programme and could not be edited without a
 * collision. Moving it is a rename plus two import updates; nothing depends on
 * the path.
 */

/**
 * Documents that can hold a private key, a master password, or a signing
 * decision the user is being asked to trust.
 *
 * All four shipped documents are on this list today, which is the point: there
 * is currently no document in the build that is allowed to run WebGL. The 3D
 * hero returns when `welcome.html` lands - a full-tab document with no password
 * or key input at all, whose realm is discarded by the navigation that leaves
 * it. See `openspec/changes/secure-key-backup-flow/design.md`, Decision 5.
 */
export const KEY_HANDLING_DOCUMENTS = [
  // Onboarding create/import, the lock screen, and the whole main app.
  "popup.html",
  // Same React tree as the popup, same lock screen.
  "sidepanel.html",
  // Hosts `ImportKeyForm` and its private key input.
  "options.html",
  // Holds no key material, but its entire job is to show truthfully what is
  // about to be signed. A decorative WebGL library in that realm can repaint
  // what the user is reading before they approve it.
  "approval.html",
] as const;

export type KeyHandlingDocument = (typeof KEY_HANDLING_DOCUMENTS)[number];

/**
 * Documents permitted to instantiate the 3D mascot.
 *
 * Deliberately empty. `welcome.html` goes here when it exists; until then
 * `mode="model"` is inert in every shipped document, and the static poster -
 * which was always the `Suspense` fallback anyway - is what renders.
 */
export const MODEL_CAPABLE_DOCUMENTS: readonly string[] = [];

/**
 * `true` when the calling realm may instantiate WebGL.
 *
 * Fails closed on anything it does not recognise, including a document with no
 * `location` at all (server rendering, a worker, a test harness). A new document
 * is therefore mascot-free until someone adds it to `MODEL_CAPABLE_DOCUMENTS`
 * and, in doing so, has to state that it holds no key material.
 */
export function isModelCapableDocument(
  pathname: string | undefined = typeof location === "undefined"
    ? undefined
    : location.pathname
): boolean {
  if (!pathname) return false;
  const documentName = pathname.slice(pathname.lastIndexOf("/") + 1);
  return MODEL_CAPABLE_DOCUMENTS.includes(documentName);
}
