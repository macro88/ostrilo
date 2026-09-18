## 1. Expose the inactivity deadline

- [ ] 1.1 Extract the deadline computation in `key-vault.service.ts` into one private helper returning the absolute deadline from `lastActivity` and the normalized `autoLockMinutes`; rewrite `isPastAutoLockDeadline()` to compare against it, so enforcement and reporting share one formula
- [ ] 1.2 Return `lockAt?: number` from `getLockState()` when the vault is unlocked; omit it on every locked return path, including the deadline-passed path and the worker-eviction correction
- [ ] 1.3 Widen the `state.getLock` response type in `rpc.ts`, `client.ts` and `handlers/state-rpc.ts` to carry the optional `lockAt`
- [ ] 1.4 Confirm the locked-response redaction in `rpc-router.ts` covers `lockAt`; add it to the redaction path if the existing reduction does not already drop unknown fields
- [ ] 1.5 Unit test: `lockAt` is present and correct while unlocked, absent while locked, and recomputed after a timeout change

## 2. Record activity from the surfaces

- [ ] 2.1 Add a throttle (30s window) around `touchActivity()` in `client.ts` so repeated interaction collapses to one RPC per surface
- [ ] 2.2 Call the throttled reporter from the deliberate actions the spec names: unlock completion, key selection, approval resolution, and settings mutations
- [ ] 2.3 Verify no call is reachable from lock-state polling, broadcast handling, or countdown rendering; `touchActivity()` must remain unreachable from the lock screen
- [ ] 2.4 Extend `tests/security/auto-lock.test.ts` to drive activity through the `state.touch` RPC path, asserting that the deadline slides and that a locked vault is never revived
- [ ] 2.5 Test that an idle open surface still locks on schedule with the reporter wired up

## 3. Build the countdown component

- [ ] 3.1 Add `useAutoLockCountdown` hook: reads `lockAt` from the lock-state source, ticks at 1Hz, suspends on `document.hidden` and resyncs on `visibilitychange`, returns remaining ms plus a display state (`minutes` / `seconds` / `expired` / `unavailable`)
- [ ] 3.2 Build `AutoLockCountdown` as an inline SVG ring — muted track, arc via `stroke-dasharray`/`stroke-dashoffset`, `size` prop for `sm` (header) and `lg` (settings); no gradient, no new dependency
- [ ] 3.3 Implement the display rules: minutes rounded up above 60s, seconds and the `destructive` role at or below 60s, a locked reading at zero, and nothing rendered when `lockAt` is absent
- [ ] 3.4 Add the accessibility contract: `role="timer"`, `aria-live="off"`, an `aria-label` carrying the full phrase and refreshed on tick, `aria-hidden` on the arc, and a stepped (non-eased) arc update under `prefers-reduced-motion`
- [ ] 3.5 Unit test the component: minute rounding, the sub-minute transition, the expired boundary, the absent-`lockAt` case, and the accessible name at each state

## 4. Carry `lockAt` to the surfaces

- [ ] 4.1 Extend `UILockState` and the 5s poll in `KeyManagerContext.tsx` to carry `lockAt`, clearing it whenever the vault reports locked
- [ ] 4.2 Confirm the poll interval is unchanged and that the countdown adds no RPC of its own

## 5. Place the countdown

- [ ] 5.1 Options → Security tab: `lg` ring beside the auto-lock slider in `SecuritySettingsTab.tsx`
- [ ] 5.2 Popup Settings: ring beside the popup auto-lock slider in `BasicSettings.tsx`, within popup dimensions and without displacing existing controls
- [ ] 5.3 Popup/sidepanel header: `sm` ring around the existing lock button's footprint in `Header.tsx`; the lock button stays a distinct, operable control
- [ ] 5.4 Reconcile the header tooltip copy with the now-visible countdown so the two do not state the same fact twice
- [ ] 5.5 Confirm the approval window carries no countdown

## 6. Verify

- [ ] 6.1 `pnpm run compile`
- [ ] 6.2 `pnpm run test` — unit, integration and security suites
- [ ] 6.3 Extend `tests/e2e/vault-lock.spec.ts`: the ring renders on each carrying surface, drains, and is replaced by the lock screen at the deadline
- [ ] 6.4 `pnpm run build` and `pnpm run build:firefox`
- [ ] 6.5 `pnpm run doctor` — address findings in changed files, report the score
- [ ] 6.6 `pnpm run slop:changes` — address findings in changed files; the gate blocks below the configured floor
- [ ] 6.7 Screenshot review in both themes against a populated vault per `AGENTS.md`; judge the header placement at popup width and drop it if it crowds the key selector; record the result in `docs/design-review/README.md`
- [ ] 6.8 Add a changelog entry covering both the countdown and the change in observed session lifetime now that the deadline slides
