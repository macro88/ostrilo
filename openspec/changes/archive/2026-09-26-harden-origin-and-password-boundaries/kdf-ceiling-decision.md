# KDF ceiling: decision record

Task 5.1 asked for Argon2id to be measured at `m = 262144 KiB` in the Chrome
and Firefox service workers before the ceiling merged.

**Decision (product owner, 2026-09-26): ship 256 MiB as proposed, without the
measurement.**

Reasoning recorded at the time:

- The ceiling only ever *refuses* input. No legitimate record approaches it:
  the shipped default is `m = 19456`, more than 13x below.
- Its job is to stop a crafted backup file or tampered envelope from reaching
  the KDF with `m` in the gigabytes. Any finite ceiling in this range does that.
- A record between the default and 256 MiB would only exist if a future change
  raised the defaults, and that change owns its own responsiveness measurement
  under `vault-key-derivation`'s "Unlock Remains Responsive" requirement. The
  test asserting `KDF_DEFAULTS` sits within the bounds fails first if it does.

Residual: an envelope rewritten to exactly the ceiling still costs one
256 MiB derivation per unlock attempt on the device. That needs write access to
extension storage, which is outside this change's threat model (see design
Non-Goals).

Shipped values: `src/domain/types.ts` `KDF_CEILINGS` —
Argon2id `m 262144 / t 10 / p 4`, PBKDF2 `c 5,000,000`.
