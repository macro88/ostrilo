# KDF measurements

Task group 1. The design deliberately refused to name shipping parameters until
they were measured, and that refusal paid off: **the runtime that matters is
6.2x slower than Node**, and the design's stated target misses its own budget
there.

Date: 2026-09-13. Budget: unlock under 1 second.

## Reference laptop (Node)

Node v24.16.0, darwin/arm64 (Apple Silicon). Median of 5 runs after a warm-up.

| Configuration | Median |
|---|---|
| Argon2id `m=65536` (64 MiB) `t=3` `p=1` | 501 ms |
| Argon2id `m=65536` `t=2` `p=1` | 340 ms |
| Argon2id `m=32768` (32 MiB) `t=3` `p=1` | 249 ms |
| Argon2id `m=19456` (19 MiB) `t=2` `p=1` | 98 ms |
| PBKDF2 pure-JS `c=100,000` (**currently shipping**) | 60 ms |
| PBKDF2 pure-JS `c=600,000` | 360 ms |
| PBKDF2 native WebCrypto `c=100,000` | 8 ms |
| PBKDF2 native WebCrypto `c=600,000` | 46 ms |
| PBKDF2 native WebCrypto `c=1,000,000` | 76 ms |

One claim from the security review is confirmed here: native PBKDF2 at 600,000
iterations (46 ms) costs **less** than the currently shipping pure-JS PBKDF2 at
100,000 (60 ms). Six times the work factor for less wall-clock time.

## Chrome MV3 service worker (the runtime that ships)

Measured inside the extension's own service worker via Playwright, HeadlessChrome
153, same machine. Median of 3 runs.

| Configuration | Median | vs Node |
|---|---|---|
| Argon2id `m=65536` `t=3` `p=1` | **3,098 ms** | 6.2x slower |
| Argon2id `m=32768` `t=3` `p=1` | 1,559 ms | 6.3x slower |
| Argon2id `m=19456` `t=2` `p=1` | **611 ms** | 6.2x slower |
| PBKDF2 native `c=600,000` | 186 ms | 4.0x slower |
| PBKDF2 native `c=100,000` | 34 ms | 4.3x slower |

A Node benchmark alone would have shipped Argon2id at 64 MiB believing it cost
half a second. It costs over three seconds in the service worker, three times the
budget.

### Incidental finding: no dynamic import in a service worker

The first attempt measured via `await import(...)` inside the worker and failed:

```
TypeError: import() is disallowed on ServiceWorkerGlobalScope
by the HTML specification.
```

This constrains the implementation, not just the benchmark: **the KDF must be
statically imported into the background bundle.** It is also worth auditing the
existing `await import(...)` calls in `src/infrastructure/messaging/handlers/`
(`crypto-rpc.ts` uses two) - they work today only because the bundler inlines
them, and would break at runtime if a build ever emitted them as a separate
chunk.

Verified against the current build: `.output/chrome-mv3/background.js` contains
zero `import(` calls and carries `evaluatePasswordStrength` inline, so all three
are currently inlined and safe. This is a latent hazard dependent on bundler
configuration, not a live defect.

## Decision for `v: 1`

**Argon2id, `m=19456` (19 MiB), `t=2`, `p=1`, `dkLen=32`.**

Measured 611 ms in the MV3 service worker, inside the sub-1-second budget.

Reasoning:

- Memory-hardness is the property that matters against the actual threat, which
  is offline GPU cracking of a stolen vault. PBKDF2 at any iteration count is
  exactly the workload GPUs are best at. Argon2id at 19 MiB forces roughly 19 MiB
  of state per parallel guess, which collapses the parallelism a GPU can bring:
  a 24 GB card sustains on the order of a thousand concurrent guesses rather
  than the hundreds of thousands PBKDF2 permits. That is worth far more than the
  difference between 100,000 and 600,000 PBKDF2 iterations.
- `m=19456, t=2, p=1` is a configuration OWASP lists for Argon2id. It is the
  floor, not below it, so this does not weaken Argon2id to fit a budget.
- The design's documented fallback was native PBKDF2 at 600,000 if Argon2id
  missed the budget. Argon2id at 64 MiB does miss it. But Argon2id at the OWASP
  floor does not, and a memory-hard KDF at its floor beats a non-memory-hard one
  at six times its current cost. The fallback exists for the case where no
  Argon2id configuration fits; that is not the case here.

### Residual risk, stated plainly

611 ms was measured on Apple Silicon. A low-end machine could plausibly be two
to four times slower, putting unlock at 1.2-2.4 seconds. That is the cost of
memory-hardness and it is accepted, for two reasons:

1. The KEK/DEK envelope means **one** derivation per unlock regardless of how
   many keys the vault holds. Today's code derives once per key record, so a
   five-key vault already pays five times the cost.
2. The parameters are now recorded in the vault record rather than implied by
   code. That is the whole point of the schema change: they can be tuned later,
   per record, without a migration that guesses how an existing record was
   encrypted.

`alg: "pbkdf2-sha256"` remains in the schema as a supported variant so that
existing records can be read and lazily re-encrypted, and so a future device
class that cannot afford Argon2id has a recorded, versioned path.

## How to reproduce

The Node benchmark and the temporary Playwright spec were both removed after
measurement. To re-measure in the service worker, add a static import of
`argon2idAsync` to `src/extension/background.ts`, expose a timing function on
`globalThis`, build, and call it from a Playwright test via
`extensionContext.serviceWorkers()`. Dynamic import will not work.
