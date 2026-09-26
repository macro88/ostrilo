# Driving the Extension

How to see Ostrilo actually run: screenshots, console output, a real signing
flow, and a short edit-to-evidence cycle. Written for an agent, useful to a
human.

Numbers are deliberately absent from this document. Run the commands.

## One-time setup

```bash
pnpm install
pnpm exec playwright install chromium
```

The second command is not optional and nothing else runs it. The repository has
no `postinstall` hook for it, so on a machine that has never downloaded
Playwright's Chromium the harness fails at launch. `channel: "chromium"` is
load-bearing: it selects Chrome for Testing, and the headless shell cannot load
MV3 extensions at all.

## The loop

```bash
cp tests/e2e/fixtures/scratch-template.ts tests/e2e/loop.scratch.spec.ts
# edit the scratch spec to drive whatever you are working on
pnpm run agent:loop 2>&1 | tail -40
```

Then read what happened:

```bash
ls test-results/agent/agent-scratch/*/          # screenshots
cat test-results/agent/agent-scratch/*/console.log
```

Edit `src/`, run `pnpm run agent:loop` again. The build is skipped when nothing
under `src/` has changed, so a spec-only edit is markedly faster than a source
edit.

When a scratch spec is worth keeping, promote it:

```bash
cp tests/e2e/loop.scratch.spec.ts tests/e2e/<feature>.spec.ts
pnpm run agent:clean
```

Scratch specs are gitignored and neither project CI pins will run them. They are
disposable by construction; the promoted copy is the durable artifact.

### Seeing a surface without writing a spec

```bash
pnpm run agent:screens
```

Seeds a vault and screenshots popup, activity, settings, side panel and options.
No assertions. Most visual questions are "what does this look like now", and this
answers them in one command.

### Watching, and taking over

`pnpm run agent:loop` runs headed, so the window is visible. Put
`await page.pause()` anywhere in a scratch spec to stop with the browser open and
Playwright Inspector attached — click around in the real extension yourself, then
resume.

## The commands

| Command | What it does |
|---|---|
| `pnpm run agent:build` | Builds `.output/chrome-mv3-agent`. |
| `pnpm run agent:loop` | Builds if needed, runs every scratch spec headed, captures artifacts. |
| `pnpm run agent:loop:prod` | The same, against the production build. |
| `pnpm run agent:screens` | Screenshots the main surfaces, no assertions. |
| `pnpm run agent:clean` | Deletes scratch specs and the run's artifacts. |

## Which build you are looking at

The loop uses `wxt build -m agent`, which lands in `.output/chrome-mv3-agent`.
Three properties matter:

- **It keeps `console.*`.** The production build compiles every call to an empty
  function, so a production run tells you nothing the extension said.
- **Its manifest is byte-identical to production**, including the static content
  script and the strict CSP. `window.nostr` is injected exactly as it ships.
- **`pnpm dev` cannot touch its directory.** `wxt dev` and `wxt build -m
  development` both write `.output/chrome-mv3-dev`, and a `wxt dev` artifact has
  no `content_scripts` key at all — WXT registers the script at runtime over a
  websocket this repository's `connect-src` blocks. The fixture refuses to launch
  against such an artifact rather than letting you debug an extension with no
  provider. A private mode name removes the collision entirely.

**Judge UI from `agent:loop:prod`.** The agent build is unminified and keeps its
logs; it is for debugging, not for deciding whether something looks right.

Every `console.log` opens with a fingerprint naming the artifact, its size and
its mtime. When a fix appears not to work, read that line first.

## Setting up state

Any extension page is a privileged RPC gateway, so a spec seeds state by calling
RPC from the popup rather than clicking through onboarding. `seedUnlockedVault`
in `tests/e2e/fixtures/agent.ts` does the usual sequence.

Free, no password:

| Call | Effect |
|---|---|
| `vault.unlock` | Password is the payload, not a gate. |
| `settings.update` with `onboardingCompleted` | Skips onboarding. |
| `policy.clearSession`, `policy.removeOrigin` | — |
| `approval.resolve` | Resolves a pending request. |

Password-gated, because each grants a standing permission:

| Call | Condition |
|---|---|
| `policy.setKindRule` | when `mode: "allow"` |
| `policy.setOrigin` | when `trustLevel: "high"` or `identityDisclosure: "allow"` |
| `settings.update` | when the patch touches `autoLockMinutes` or `sessionTTLMinutes` |
| `vault.reveal`, `vault.deleteKey` | always |

The password is verified by decrypting real key material and is never cached.

**Seeding must end with a reload.** Sending the RPC does not tell the popup's
React tree to re-read vault state: `state.getLock` reports unlocked while the
page still renders the lock screen. `seedUnlockedVault` reloads for you. A
screenshot taken without that reload shows a lock screen, and the obvious reading
of it is wrong.

**Grant `identityDisclosure` before calling `getPublicKey()`.** Without it the
call does not fail — it queues an approval and blocks for the full timeout, which
reads as flakiness rather than as a missing grant.

## Limits that apply inside a single run

These are enforced per window, not per run, so a loop that signs repeatedly will
trip them and the error will look like a bug in the code under test:

- six identity disclosures per origin per minute
- ten approval enqueues per origin per minute
- five pending approvals per origin, twenty globally
- approvals time out after sixty seconds
- unlock throttling: three free attempts, then a doubling delay

Only eleven RPC methods are reachable while the vault is locked, and `keys.list`
and `settings.get` come back redacted. Unlock first or everything returns
`LOCKED`.

## Handling captured logs

`console.log` files are build artifacts, not evidence to circulate. Do not paste
them into commits, issues or pull requests. Values shaped like an nsec or a
64-character hex string are masked before anything is written, but redaction is a
backstop, not a licence.

`.output/` and `test-results/` are gitignored and excluded from the Mozilla
source archive. `wxt zip` never builds in agent mode.

## Known traps

Each is real and currently unfixed. They are recorded here because the symptom
never points at the cause.

**The dev certificate expires and is then reused forever.** It is minted with
`-days 1`, but `ensureDevCertificate` short-circuits on existence alone, so once
it lapses the fixture server serves an expired certificate indefinitely. Symptom:
the fixture page fails to load, or `window.nostr` never appears.

```bash
rm -rf test-results/e2e-tls/
```

**An orphaned fixture server is silently adopted.** `reuseExistingServer` is on
outside CI, so a stray `http-server` on port 8765 — holding the old certificate in
memory, or serving the wrong directory — is used as-is, and `ignoreHTTPSErrors`
makes the health check pass anyway. If the page misbehaves after a certificate
regeneration, kill the listener and rerun.

**`playwright install chromium` is enforced nowhere.** See the setup section.

**Node may not match `.nvmrc`.** CI pins the `.nvmrc` version; a local shell often
does not. Check `node -v` before trusting a timing or a failure that looks like a
runtime difference.

**`docs/design-review/capture-screenshots.mjs` serves over `https://localhost`**,
not plain HTTP, specifically so the `https://*/*`-only content script picks up
`window.nostr` — see the script's own comments near its `https.createServer` call.
It is the required tool for design-review captures (`AGENTS.md`); `pnpm run
agent:screens` is a separate Playwright-based loop for driving the extension
generally, not a replacement for it.
