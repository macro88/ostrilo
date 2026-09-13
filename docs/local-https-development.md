# Testing against a local dapp

The NIP-07 content script matches `https://*/*` only. A dapp served over
`http://localhost` will not receive `window.nostr` at all — not a broken
provider, no provider.

## Why

The provider used to be injected into plaintext pages too. On such a page any
on-path attacker — a hostile access point, a compromised router, an ISP proxy —
can rewrite the document and drive `window.nostr` **as the origin the user
trusts**. The approval dialog then shows that trusted origin, because it *is*
that origin. Nothing the dialog does can fix an attacker who controls the page,
so the boundary is drawn before the dialog: no TLS, no provider.

`http://localhost` is a special case in most browser security models, treated
as a secure context because it is not reachable from the network. That
exception is not available here: extension content-script match patterns match
on scheme, and there is no pattern that says "https, or localhost". Allowing
`http://localhost/*` would ship a rule that any page on any port of the user's
own machine can use, which is exactly the access a local malware sample has.

## What to do instead

Serve your dapp over TLS with any self-signed certificate and launch the
browser so it tolerates it:

```bash
# Any static server that speaks TLS will do.
npx http-server ./public -S -C cert.pem -K key.pem -p 8765

# Chrome/Chromium, for development only:
chromium --ignore-certificate-errors --user-data-dir=/tmp/ostrilo-dev
```

Generate a throwaway certificate with:

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout key.pem -out cert.pem -days 1 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

Do not add that certificate to a trust store, and do not reuse it. It is a
development artifact with a one-day lifetime.

## In this repository

`playwright.config.ts` does exactly the above: `tests/e2e/fixtures/make-dev-cert.ts`
generates a fresh certificate into `test-results/e2e-tls/` on each run, the
fixture server is started with `-S`, and the test browser is launched with
`--ignore-certificate-errors` and `ignoreHTTPSErrors`. Nothing outside that
browser instance ever trusts it.
