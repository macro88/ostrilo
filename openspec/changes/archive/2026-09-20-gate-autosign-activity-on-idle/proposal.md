## Why

`session-auto-lock` requires that a signature produced without an approval prompt records activity (`openspec/specs/session-auto-lock/spec.md:164`). Nothing implements it: `nostr-rpc.ts` contains no reference to `touchActivity` or `lastActivity`, and `KeyVaultService.sign()` touches no storage.

That gap is a real UX defect, not a harmless omission. Reacting to a post is kind `7`, which high trust signs without a prompt (`trust-definitions.ts:48`). So a user reacts to a post, reads the next one for six minutes, reacts again — and the second reaction fails, because the extension saw six minutes of "inactivity" while the user was sitting there reading. The default timeout is five minutes (`AUTO_LOCK_BOUNDS.default`), so this is the ordinary case, not an edge.

The obvious fix — let any auto-signed request postpone the deadline — opens a hole instead. The auto-sign branch (`nostr-rpc.ts:376`) bypasses both rate limiters in that file, and the high-trust allowlist is `6, 7, 16, 10000-10003, 30078`, described in `trust-definitions.ts:44` as *"state that clients must maintain to function"*: precisely what a client rewrites on a timer with nobody at the keyboard. One pinned tab would turn "locks after N idle minutes" into "never locks", and would void the reasoning in `session-grants.ts:18`, which justifies the 60-minute grant ceiling on the grounds that *"the vault now locks after at most 60 minutes"*.

Both failures come from the same mistake: treating "was this signed without a prompt?" as a proxy for "is anyone here?". It is not. The question the deadline actually wants answered is whether a human is present, and the browser will answer that directly — `chrome.idle` reports OS-level input, which a page cannot forge and a timer-driven client cannot produce.

## What Changes

- **An auto-signed request postpones the inactivity deadline only while the user is present at the machine**, as reported by `chrome.idle.queryState()`. Present means `active`; `idle` and `locked` do not postpone.
- **The idle query uses the configured auto-lock window as its detection interval**, so "present" means the user gave the machine some input at some point inside the window that is about to expire — not that they touched it in the last fifteen seconds.
- **A background-side throttle** limits how often the auto-sign path may record activity. The existing 30s throttle is client-side (`client.ts:265`) and does not cover a background caller.
- **New manifest permission: `idle`** (`wxt.config.ts:139`, currently `["storage", "windows", "alarms"]`). Chrome and Firefox both support it.
- **The deadline's page-reachability rule is stated, in its true narrow form.** A page-originated request can postpone the deadline, but never on its own: it also requires user presence the page cannot fabricate. Previously this was true only by omission and written down nowhere.
- **Deliberate action in an extension surface is unchanged and stays ungated.** A click in the popup is presence; it needs no second opinion from the OS.
- **BREAKING for the security posture in one direction, stated plainly:** a user who stays at their machine with a Nostr client open in a background tab will keep the vault unlocked for as long as they are there. That is the intended trade — the timeout exists to bound an *unattended* vault — but it is a real change from a vault that locks five minutes after the last popup interaction regardless.

## Capabilities

### New Capabilities

<!-- None. This change modifies existing session-auto-lock requirements. -->

### Modified Capabilities

- `session-auto-lock`: the "Recorded Activity Postpones The Lock" requirement gains the user-presence condition on auto-signed requests and a background throttle obligation; a new requirement states that page-originated activity requires attested user presence.

## Impact

**Background**
- `src/infrastructure/messaging/handlers/nostr-rpc.ts` — the auto-sign branch (`:376`) reports activity after a successful signature, subject to the presence check and throttle.
- A new presence/throttle helper in the application or infrastructure layer. It owns the `chrome.idle` call, the detection interval, and the throttle, so the RPC handler does not grow policy.
- `src/application/services/key-vault.service.ts` — unchanged. `touchActivity()` already refuses a locked vault and an expired deadline, which is the behaviour this path needs.

**Manifest**
- `wxt.config.ts:139` — add `idle`. Both build targets.

**Specs**
- `openspec/specs/session-auto-lock/spec.md` — one `MODIFIED` requirement, one `ADDED` requirement.

**Tests**
- `tests/security/auto-lock.test.ts` — an auto-signed request postpones the deadline when present, does not when idle or OS-locked, and cannot hold the vault open across an idle window.
- A guard asserting the auto-sign path cannot record activity without consulting presence, so the check cannot be dropped in a later refactor and leave the call behind.

**Documentation**
- `CHANGELOG.md` — what now keeps the vault open, and the fact that a site signing on your behalf does not keep it open on its own.
- The auto-lock slider copy says "your last activity in the extension". That is now too narrow; signing from a site counts while you are at the machine.

**Not in scope**
- A hard ceiling on total session length. Considered and recorded in the design: it would bound the present-user case too, and the timeout's purpose is the unattended one.
- The `approval.resolve` password gate (`approval-rpc.ts:50`), where one click mints a persistent per-kind rule for kinds 0/3/4. Worth its own change.
- Any change to the trust model, the high-trust kind allowlist, the timeout range, or session grants.
