import { useLayoutEffect, type RefObject } from "react";

/**
 * The documents whose lifetime is longer than one unlock attempt.
 *
 * `options.html` opens in a full browser tab (`open_in_tab: true`,
 * `wxt.config.ts:112-115`) and stays there. `sidepanel.html` stays mounted
 * while the user browses.
 *
 * `popup.html` is deliberately absent: closing the popup destroys its document,
 * which clears every input for free. A handler there would be code that looks
 * like a control and is not. `approval.html` holds no password input.
 */
const PERSISTENT_DOCUMENTS = ["/options.html", "/sidepanel.html"];

function documentOutlivesTheAttempt(): boolean {
  const path = globalThis.location?.pathname;
  if (!path) return false;
  return PERSISTENT_DOCUMENTS.some((document) => path.endsWith(document));
}

/**
 * Clears a password input element's own `value` on `pagehide` and on unmount,
 * on the surfaces whose document outlives the attempt: the options page, which
 * opens in a full tab (`open_in_tab: true`, `wxt.config.ts:112-115`), and the
 * side panel, which stays mounted while the user browses.
 *
 * What this achieves and what it does not: clearing the element's `value` drops
 * the extension's own reference to the entered text. It does **not** erase the
 * string - a JavaScript string is immutable and the engine keeps whatever
 * copies it made. Anything running in this realm, React DevTools included, is
 * out of reach of this or any other option available here.
 *
 * Modelled on the clipboard flush at
 * `src/ui/features/onboarding/backup/useExpiringClipboard.ts:135-153`, and
 * carrying its constraint verbatim.
 */
export function useEphemeralInputTeardown(
  inputRef: RefObject<HTMLInputElement | null>
): void {
  // A layout effect, not a passive one. React detaches DOM refs during the
  // mutation phase, before passive cleanups run - so a passive teardown here
  // would read `inputRef.current` as null on unmount and silently clear
  // nothing. A layout cleanup still holds the element.
  useLayoutEffect(() => {
    if (!documentOutlivesTheAttempt()) return;

    // No `setState` in here: it runs while the component is being torn down,
    // and the only thing that still matters at that point is the input value.
    const flush = () => {
      const element = inputRef.current;
      if (element) element.value = "";
    };

    globalThis.addEventListener?.("pagehide", flush);
    return () => {
      globalThis.removeEventListener?.("pagehide", flush);
      flush();
    };
  }, [inputRef]);
}
