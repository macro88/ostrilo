# Verification evidence

Tasks 12.4 and 12.5. Every security test added by this change was shown to fail
for the right reason: the protection it guards was reverted in the working tree,
the test was run, the failure observed, and the revert discarded.

An invariant test that has never been seen failing is an assumption, not a
regression fence. This file is the record that each one has been seen failing.

Run date: 2026-09-13. Branch: `security/remediation-programme`.

## Memory zeroization

### Removing `zeroize(rawKey)` from `KeyVaultService.unlock`

```
× zeroizes the derived key after a successful unlock
× zeroizes the derived key when AEAD decrypt rejects
× zeroizes one derived key per record, for every record
  Tests  3 failed | 10 passed (13)
```

Three tests red. The suite this replaced asserted `expect(zeroizeSpy).toHaveBeenCalledWith(...)`
against a mocked-out `zeroize`, and would have stayed green through this change.

### Reintroducing the `toArrayBuffer` defensive copy in the AEAD adapter

```
× passes the caller's buffer to crypto.subtle.importKey, not a clone
  Tests  1 failed | 12 passed (13)
```

This is the test that makes the copy-removal durable. Without it, someone
reinstating "defensive" copying would silently restore three unzeroized clones
of key material per operation.

### Removing `zeroize(sk)` from `KeyVaultService.generateKey`

```
× zeroizes the generated private key after the call resolves
× zeroizes the generated private key even when the call rejects
  Tests  2 failed | 11 passed (13)
```

## Policy invariants

### Disabling the locked-vault guard in `evaluatePolicy`

```
AssertionError: SECURITY REGRESSION (policy-guard-lock): a locked vault
returned "ask" for unknown origin. A locked vault must deny unconditionally,
before trust levels, session grants or explicit rules are consulted.
```

### Disabling the protected-kind gate

```
AssertionError: SECURITY REGRESSION (policy-guard-protected-kind): protected
kind 1 returned "allow" under session grant. Protected kinds must always
prompt for approval before signing.
```

### Deleting the explicit-deny early return

```
AssertionError: SECURITY REGRESSION (policy-guard-deny-precedence): a session
grant overrode an explicit deny and returned "allow". An explicit deny is the
user's most specific instruction and must be evaluated first.
```

## A demonstration that silently did nothing

Worth recording, because it is the same failure mode this change exists to
remove, encountered while doing the work.

The first attempt at the deny-precedence demonstration reported **7 passed** —
suggesting the test could not detect the removed protection. It had not. The
mutation was applied with a multi-line Python string using `\n`, while
`src/domain/policy/evaluate.ts` uses CRLF line endings, so the pattern never
matched and the file was never modified. The "demonstration" proved nothing and
looked like a pass.

Re-run with a CRLF-aware mutation and an assertion that the pattern was actually
found, it failed correctly, as recorded above.

The lesson generalises: a verification step that cannot distinguish "the thing I
was testing held" from "my test did not run" is not a verification step. Any
future revert demonstration should assert that its mutation applied before
trusting the result.

## Coverage against the invariant table

Rows marked DEFERRED in `design.md` are written against behaviour that does not
exist yet and ship with their companion change, so they have no demonstration
here. See the status table in `tasks.md` under task 8.9.

| Invariant | Demonstrated |
|---|---|
| `policy-guard-lock` | Yes, above |
| `policy-guard-protected-kind` | Yes, above |
| `policy-guard-deny-precedence` | Yes, above |
| `policy-fallback-ask` | Covered by the same suite; guard is the final fallback branch |
| `no-unzeroized-key-copy` | Yes, above (toArrayBuffer reinstatement) |
| `password-not-retained` | Asserted; not separately demonstrated |
| `rng-source-pinned` | Demonstrated in the entropy suite |
| `kdf-parameters-pinned` | Deferred to `harden-vault-key-derivation` |
| `password-gate-required` | Deferred to `remove-key-exfiltration-surface` |
| `password-policy-enforced` | Deferred to `enforce-password-policy` |
| `lock-state-fails-closed` | Deferred to `implement-session-auto-lock` |
