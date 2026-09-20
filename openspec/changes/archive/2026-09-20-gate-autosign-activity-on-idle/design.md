## Context

The inactivity deadline is written in four places, all in `KeyVaultService`: unlock (`key-vault.service.ts:662`), lock (`:772`), the worker-eviction correction (`:861`), and `touchActivity()` (`:918`). `touchActivity()` is reached only through `state.touch` (`state-rpc.ts:43`), called only by the throttled client reporter (`client.ts:271`) from five UI call sites. `state` is not page-reachable (`rpc-router.ts:67`), so today a page cannot move the deadline at all.

That is a correct security property and a bad product. Kind `7` reactions are signed without a prompt under high trust (`trust-definitions.ts:48`). A user reacting to posts is doing nothing the extension counts as activity, so the vault locks under them at the default five-minute timeout while they read.

The first version of this change proposed deleting the spec scenario that requires signatures to record activity. That was wrong: it used "signed without a prompt" as a proxy for "nobody is here", and reacting-while-reading is exactly the case that proxy gets backwards. This version keeps the requirement and fixes the proxy.

Three constraints shape the design.

**Presence must be attested by something the page cannot reach.** The page originates the request, so nothing derived from the request — its origin, its kind, how often it arrives, how trusted it is — is evidence that a human is present. `chrome.idle` reports operating-system input and is not observable or forgeable from page script.

**This change is sequenced behind `add-auto-lock-countdown`.** That change is implemented but not archived and modifies the same requirement. The `MODIFIED` block here is written against the post-countdown text, so archiving in the other order drops the countdown's surfaces clause and its two scenarios.

**The MV3 worker must not be woken.** `LOCK_POLL_MS` is 5s specifically so an idle options page does not keep the worker alive. Nothing here may regress that.

## Goals / Non-Goals

**Goals:**

- A user actively using a Nostr client keeps their vault open, without touching the extension.
- A client signing on a timer with nobody at the machine does not.
- The distinction rests on evidence a page cannot manufacture.
- No new background wake-ups, no new polling, no new traffic.

**Non-Goals:**

- Changing what deliberate action in an extension surface does. Those five call sites and the client-side throttle stay exactly as they are.
- A hard ceiling on total session length (see Decisions).
- Changing the trust model, the high-trust kind allowlist, the timeout range, or session grants.
- Making the countdown ring reflect presence. It reports the deadline the background gives it; that stays the whole of its contract.

## Decisions

### Gate on `chrome.idle`, with the inactivity window as the detection interval

`chrome.idle.queryState(detectionIntervalInSeconds)` returns `active`, `idle`, or `locked`. It reports `active` when the user has generated input within the interval. The auto-sign path queries it with the configured `autoLockMinutes` converted to seconds, and records activity only on `active`.

*Why the full window rather than a short interval:* a short interval asks "did the user touch the machine in the last fifteen seconds?", which the reading user fails just as badly as the current implementation does. The full window asks "has the user touched the machine at any point during the period that is about to expire?", which is the question the deadline is actually about. The API floor is 15s and `AUTO_LOCK_BOUNDS.min` is 1 minute, so the configured value is always above the floor; it is clamped anyway rather than relying on that.

*Why `locked` does not count:* an OS lock screen means the machine is explicitly not attended, which is a stronger signal than `idle`. Treating it as presence would keep a vault open behind a locked screen, which is the scenario the auto-lock exists for.

*Alternatives considered:* (a) a content-script presence report — rejected, it is page-reachable by construction and therefore forgeable by the thing it is supposed to be evidence against; (b) `chrome.idle.onStateChanged` with cached state — a listener is a wake-up source and adds state to keep correct across worker eviction, where `queryState` on a path that is already awake costs nothing extra; (c) treating a signature as presence if the same origin has a visible focused tab — rejected, "a tab is focused" is not "a human is there", and it hands the page influence over the evidence.

### Query on a path that is already awake, never on a schedule

The check runs inside the auto-sign branch, after the signature succeeds. The worker is necessarily running at that moment — it is producing a signature — so the query adds no wake-up and no keep-alive. Nothing polls idle state.

*Why after the signature rather than before:* the presence check is about postponing the lock, not about permitting the signature. A failed check must never turn into a refused signature; the vault was unlocked and the policy allowed it, so the signature is owed regardless of where the user's mouse has been.

### Throttle in the background, not only in the client

The existing 30s throttle lives in `client.ts:265` and is per-surface, which is right while every caller is a UI surface. The signing path is a background caller and bypasses it entirely. It gets its own throttle in the same helper as the presence check, so a client signing in a burst produces one idle query and one write rather than one per event.

*Why co-located with the presence check:* the throttle also bounds how often `chrome.idle` is queried. Keeping them apart would let a refactor drop one and keep the other, which is the failure mode the guard test in the task list is written against.

### No hard ceiling on total session length

A ceiling of `unlockTime + autoLockMinutes` that page activity could shorten but never exceed was considered and rejected.

*Why:* it bounds the present-user case, which is the case this change exists to fix. A user at their desk for three hours with a Nostr client open would be logged out on a fixed schedule for no security gain — they are present, and the timeout is about absence. The ceiling protects against a threat the idle gate already covers, at the cost of the behaviour the idle gate is for.

*Consequence, stated plainly:* a user who stays at their machine with a client auto-signing in a background tab keeps the vault unlocked indefinitely. That is intended. It is also a real change from today, where the vault locks five minutes after the last popup interaction regardless, and it belongs in the changelog rather than in a footnote.

### The spec constrains the source of the evidence, not the method name

The new requirement is phrased as "page-originated activity requires attested user presence" rather than "no page-reachable method may record activity", because the second is now false — a page-originated request does postpone the deadline, given presence.

*Why this phrasing:* it survives the next refactor. A rule naming methods goes stale when the call graph moves; a rule about what may count as evidence applies to a path nobody has written yet. It also makes the reviewable question concrete: *what is the evidence, and could the page have produced it?*

## Risks / Trade-offs

**A user reading motionless for longer than the window — no scroll, no mouse, no key — still gets locked out.** → Narrower than it sounds, since scrolling is input and reading a feed involves scrolling, but it is real and it is the residual form of the original complaint. The honest answer is that the OS cannot distinguish a motionless reader from an empty chair, and between those two the lock should win. A user who hits it can raise the timeout, which now means what it says.

**Idle state is machine-wide, not extension-specific.** Working in another application counts as presence. → Correct by intent: the threat is an unattended machine, and the user is attending it. The cost is that the vault stays open longer during a working day than it does today, which is why it is called out as a posture change in the proposal rather than buried.

**`chrome.idle` needs a new permission, on a security extension where permissions are scrutiny surface.** → `idle` grants no data access: it returns one of three words about input recency and nothing about what was typed, which application had focus, or what is on screen. The trade is one coarse enum against a lock that currently interrupts ordinary use. Worth stating in the store listing rather than letting a reviewer find it.

**A refactor drops the presence check and leaves the `touchActivity()` call behind**, silently restoring the unbounded-session hole with a green suite. → This is the specific regression the guard test in the task list targets: the auto-sign path must not be able to record activity without consulting presence. A test that only asserts "signing postpones the deadline" would pass after exactly this mistake.

**Archiving out of order drops the countdown change's spec additions.** → Called out in Context; task 1.1 is a hard stop.

## Migration Plan

No data migration. A stored deadline means the same thing before and after; only what can move it changes.

Deployment is a manifest permission change, so an existing install shows a permission prompt on update. That is a real friction point and an argument for shipping it alongside the countdown rather than on its own — a user asked for a new permission reads it better next to a visible feature than as a silent update.

Rollback is removing the call site: the presence helper becomes unreferenced and the deadline stops moving from signatures. No stored state is left inconsistent by that, because nothing persists presence.

## Open Questions

- Should the auto-lock slider copy change? It currently says the timeout is measured from "your last activity in the extension", which becomes too narrow — signing from a site now counts while you are present. Wording is a design-review call, not a spec one, but the current sentence will be wrong.
- Should the countdown ring distinguish "postponed by a signature" from "postponed by your click"? Probably not — the ring reports a deadline and adding provenance makes it a log — but a user who sees the ring jump without having touched the extension may reasonably wonder why.
- Is `approval.resolve` being ungated by password (`approval-rpc.ts:50`) worth its own change? One click at an unlocked keyboard mints a persistent per-kind rule for kinds 0/3/4 (`:161` → `policy.service.ts:206`). Unrelated mechanism, but a longer unlocked window raises what it is worth.
