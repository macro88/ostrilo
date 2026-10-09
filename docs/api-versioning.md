# API versioning and deprecation policy

This is what Ostrilo promises the people who write dApps against it: which parts of the extension are public API, how a release number tells you whether your dApp can break, and how a change is announced before it lands.

## What is public API

The public API is what a web page can observe or call. It is the following, and nothing else.

1. **The `window.nostr` methods and their behaviour.** `getPublicKey()` and `signEvent(event)`: their parameters, what they resolve with, and the conditions under which they resolve, wait or reject. The NIP-07 text defines the method shapes; this policy covers what Ostrilo does with them, including consent and approval. Requiring the user's consent before `getPublicKey()` answers, for example, is behaviour a dApp can depend on, so changing it is a change to the public API.
2. **The page-facing error codes and response shape.** A `window.nostr` call that fails rejects with `new Error(code)`, where `error.message` is one of the codes marked "Page" in [RPC error codes](rpc-error-codes.md), and nothing else about the failure reaches the page. Which code means what is public. The numeric codes, `details` and `debug` fields are not: they never leave the extension.
3. **`window.nostr.capabilities`.** A frozen `{ methods: string[] }` listing the provider methods this build implements. See [Feature detection](#feature-detection).

What the user sees (popup, approval window, settings) is product, not API. It can change in any release.

## What is not public

These can change in any release, with no deprecation period and no `BREAKING (API)` mark, because no page can reach them or a dApp has no business depending on them:

- **The internal RPC namespaces.** `vault`, `policy`, `settings`, `approval`, `activity`, `profile`, `avatar`, `backup`, `keys`, `crypto` and `state` are the protocol between the extension's own pages and its background worker. They are not reachable from a web page; the router refuses every namespace but `nostr` from a page's content script. Their request types, parameters, responses and error codes (for example `key_already_exists` from `vault.generate`) may change whenever the extension's own pages change with them. The `nostr.*` request types are internal too: the content script builds them from a `window.nostr` call, and the page never sends one.
- **The page-to-content-script message protocol** (`OSTRILO_NOSTR_REQUEST`, `OSTRILO_NOSTR_RESPONSE`, `OSTRILO_NOSTR_CANCEL`) between `injected.ts` and `content.ts`. Do not post these yourself.
- **Storage layout and file formats**, including the vault. [Vault storage format](vault-storage-format.md) states its own rules for changing it, and those govern data at rest, not dApps.
- **Timing figures** such as the approval deadline, the auto-sign budget, rate-limit sizes and the page-side backstop. A dApp should handle `timeout` and `rate_limited`, not assume a number of seconds or requests.
- **Anything an extension page can do that a web page cannot**, and anything in the source tree, tests or build output.

## How versions map to the API

Ostrilo releases follow [semantic versioning](https://semver.org/). There is one version number, the extension's. There is no separate API version, and `window.nostr` does not report one; see [Why capabilities carries no version](#why-capabilities-carries-no-version).

| Release | What it may contain for the public API |
| --- | --- |
| **Patch** (`x.y.Z`) | Fixes that make Ostrilo do what this document and the specs already say. No public API change. |
| **Minor** (`x.Y.0`) | Additions that leave a correct dApp working: a new method (and the matching entry in `capabilities.methods`), a new page-facing error code for a case that used to be reported some other way, a new optional field. A `Deprecated` notice. |
| **Major** (`X.0.0`) | Anything that can break a dApp that worked before: removing or renaming a method, changing what one resolves with, changing the meaning of an error code, removing a code, turning a call that used to succeed into one that asks or refuses. The removal of something deprecated. |

A dApp that is correct against this document should treat an error code it does not recognise as a failure, not as a reason to crash, because a minor release can add one.

Before 1.0.0, semver lets any release break anything. Ostrilo does not use that latitude silently: a breaking change before 1.0.0 still carries `BREAKING (API)` and, because it cannot wait for a major release that does not exist yet, raises the **minor** number. The release that first reaches 1.0.0 is the first one this table binds in full.

## Deprecation policy

When something public is going to be removed or changed incompatibly:

1. **Announce it.** The release that deprecates it adds a `Deprecated` entry to [`CHANGELOG.md`](../CHANGELOG.md) naming what is deprecated, what to use instead, and the earliest release it can be removed in.
2. **Keep it working** until that release. A deprecated method or code behaves as before.
3. **Remove it no earlier than the next major release** after the one that announced the deprecation. Removal is a breaking change and is marked as one.

Breaking changes are marked **`BREAKING (API)`** in the CHANGELOG entry that ships them, so a dApp author can search the file for the string. The entry says what changed, what a dApp saw before and sees now, and what to do about it. Internal RPC changes that a web page cannot observe use `BREAKING (RPC)` instead, and only matter to people building against the extension's own messaging.

One exception. A change needed to close a security hole in the signer, in the consent it enforces or in what a page can learn, may take effect without a deprecation period. It is still marked `BREAKING (API)`, still raises the version as the table above says, and the entry says why it could not wait. The 0.9.0 consent requirement on `getPublicKey()` is the model.

## Feature detection

`window.nostr.capabilities` lets a page ask what the provider implements without calling a method and interpreting its failure.

```typescript
// An object with a methods array, or nothing. Another signer may own window.nostr.
const methods = window.nostr?.capabilities?.methods;

if (!window.nostr) {
  showInstallPrompt();
} else if (methods === undefined) {
  // A provider that does not report capabilities: another signer, or a build
  // that predates it. This is "unknown", not "none". Fall back to calling the
  // method and handling the rejection.
  tryAndHandleErrors();
} else if (methods.includes("signEvent")) {
  enableSigning();
}
```

What it guarantees:

- `capabilities` and `capabilities.methods` are frozen. Neither a dApp nor any other script on the page can change what Ostrilo reports.
- `methods` lists exactly the methods the provider implements. One constant, `PROVIDER_METHODS` in `src/domain/nostr/provider-methods.ts`, builds the provider, feeds `capabilities.methods` and gates what the content script will relay, so the three cannot disagree.
- `nip04` and `nip44` are absent from `window.nostr` and from `methods`, because they are not implemented. `if (window.nostr.nip44)` is a truthful check.
- If another signer already defined `window.nostr`, Ostrilo leaves it in place and adds nothing to it, `capabilities` included. Read `capabilities` as belonging to whichever provider is there.

A capability being listed says the method exists. It does not say the call will succeed: the vault may be locked, the site may be refused, the user may say no. Those arrive as the error codes in [RPC error codes](rpc-error-codes.md).

### Why capabilities carries no version

It holds method names and nothing else, deliberately. An extension version or build identifier would let any page, and any script on it, read exactly which build the user runs, tell which known bugs apply to them, and tell two users apart who share a method set. Every site could collect it without asking, and the user cannot opt out. A dApp has no need for it: what a dApp needs to know is whether a method exists, and `methods` says that. If a future change needs to describe a new behaviour, it will add a named capability, not a number to compare.

## Where this is enforced

| Rule | Where |
| --- | --- |
| The provider, `capabilities.methods` and the relay allowlist share one list | `src/domain/nostr/provider-methods.ts`; `tests/unit/extension/injected-capabilities.test.ts` |
| `capabilities` is frozen and the page cannot alter it | `tests/security/provider-capabilities.test.ts`; `tests/e2e/nip07-provider.spec.ts` |
| Page-facing codes are canonical and documented | `tests/unit/infrastructure/error-code-coverage.test.ts` |
| Only the `nostr` namespace is reachable from a page | `src/infrastructure/messaging/rpc-router.ts`; `tests/security/rpc-privilege-boundary.test.ts` |
| The requirements | `openspec/specs/nip07-provider/` and `openspec/specs/provider-trust-boundary/` |
