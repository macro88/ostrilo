/**
 * The NIP-07 methods Ostrilo implements on `window.nostr`.
 *
 * One list, three readers: the injected provider is built from it, the content
 * script's allowlist is checked against it, and `window.nostr.capabilities.methods`
 * advertises it. A method added to or removed from the provider therefore changes
 * what a dApp is told, and what the bridge will relay, in the same edit.
 *
 * `nip04` and `nip44` are not listed because they are not implemented.
 */
export const PROVIDER_METHODS = ["getPublicKey", "signEvent"] as const;

export type ProviderMethod = (typeof PROVIDER_METHODS)[number];

export function isProviderMethod(value: unknown): value is ProviderMethod {
  return (
    typeof value === "string" &&
    (PROVIDER_METHODS as readonly string[]).includes(value)
  );
}
