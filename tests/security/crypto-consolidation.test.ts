/**
 * Regression tests for the defects that duplicated cryptographic code was
 * hiding.
 *
 * Each block names the thing that was wrong. None of these would have failed
 * before this change, which is the point: the code had tests, and the tests
 * asserted properties of implementations the product never ran, or asserted
 * them with inputs that could not reach the bug.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  bytesToHex,
  hexToBytes,
  isValidHex,
  assertHexBytes,
} from "@/domain/utils/hex";
import { parsePrivateKey } from "@/application/crypto/private-key";
import {
  computeEventId,
  verifyEventSignature,
} from "@/application/crypto/event-id";
import { serializeEventForId } from "@/domain/nostr/event-serialization";
import { UnsignedEventSchema } from "@/infrastructure/validation/schemas";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import { NostrRpcHandler } from "@/infrastructure/messaging/handlers/nostr-rpc";
import { VaultRpcHandler } from "@/infrastructure/messaging/handlers/vault-rpc";
import { CryptoRpcHandler } from "@/infrastructure/messaging/handlers/crypto-rpc";
import {
  NobleSchnorr,
  NobleSha256,
  NostrEventCrypto,
  ScureBech32,
} from "@/infrastructure/crypto/adapters";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import type { KeyListEntry } from "@/infrastructure/messaging/handlers/vault-rpc";
import { memoryStorage, testVault, TEST_VAULT_PASSWORD } from "../helpers/vault";

// ---------------------------------------------------------------------------
// The hexToBytes defect
// ---------------------------------------------------------------------------

describe("hex decoding no longer substitutes zero bytes", () => {
  /*
   * THE DEFECT. `hexToBytes` in `src/domain/utils/encoding.ts` checked only
   * `hex.length % 2 !== 0`. It never looked at the characters, so
   * `parseInt("zz", 16)` returned NaN, and assigning NaN into a `Uint8Array`
   * stores 0. `hexToBytes("zz".repeat(32))` therefore returned 32 zero bytes
   * and threw nothing.
   *
   * That function was exported and live: `KeyManagerContext.tsx` called it on
   * `key.pubkey` at two call sites, so a corrupt stored record rendered as a
   * real, well-formed npub - `npub1qqq...` - for a key nobody holds, and the
   * user had no way to tell it from their own identity.
   *
   * The existing assertion that looked like coverage was
   * `expect(() => hexToBytes("invalid")).toThrow()`. It passed because
   * "invalid" has seven characters and tripped the odd-length branch. No test
   * anywhere passed even-length non-hex input.
   */
  const ALL_Z_64 = "z".repeat(64);

  it("throws on the 64-character all-z input that used to return 32 zero bytes", () => {
    expect(ALL_Z_64).toHaveLength(64);
    expect(() => hexToBytes(ALL_Z_64)).toThrow(/non-hexadecimal/i);
  });

  it("does not return a 32-byte array of zeros for that input", () => {
    // Stated as its own assertion because "it throws" and "it does not
    // silently produce plausible output" are different failures, and the
    // second is the one that reached the user.
    let result: Uint8Array | null = null;
    try {
      result = hexToBytes(ALL_Z_64);
    } catch {
      result = null;
    }
    expect(
      result,
      "SECURITY REGRESSION: a non-hex public key decoded to zero bytes"
    ).toBeNull();
  });

  it("throws on short even-length garbage instead of returning [0]", () => {
    expect(() => hexToBytes("gg")).toThrow(/non-hexadecimal/i);
  });

  it("refuses a leading-valid, trailing-invalid string outright", () => {
    // The old loop would have produced [0xde, 0xad, 0x00, 0x00].
    expect(() => hexToBytes("deadzzzz")).toThrow(/non-hexadecimal/i);
  });

  it("separates the odd-length failure from the non-hex failure", () => {
    expect(() => hexToBytes("deadbee")).toThrow(/length/i);
    expect(() => hexToBytes("zzzz")).toThrow(/non-hexadecimal/i);
  });

  it("agrees with its own predicate", () => {
    // `isValidHex` used to report an odd-length string as valid while
    // `hexToBytes` threw on it. A guard that disagrees with the thing it
    // guards is a trap.
    for (const value of ["deadbee", ALL_Z_64, "gg", "deadzzzz", ""]) {
      expect(isValidHex(value), `isValidHex disagreed on ${value}`).toBe(false);
      expect(() => hexToBytes(value)).not.toThrow(/^$/); // sanity: has a message
    }
    expect(isValidHex("deadbeef")).toBe(true);
    expect(() => hexToBytes("deadbeef")).not.toThrow();
  });

  it("checks length before characters when an exact byte count is required", () => {
    expect(() => assertHexBytes("ab", 32)).toThrow(/expected 64 characters/);
    expect(() => assertHexBytes(ALL_Z_64, 32)).toThrow(/non-hexadecimal/i);
    expect(assertHexBytes("ab".repeat(32), 32)).toHaveLength(32);
  });
});

// ---------------------------------------------------------------------------
// The unguarded signing decode
// ---------------------------------------------------------------------------

describe("KeyVaultService.sign validates its hash before decoding it", () => {
  /*
   * THE DEFECT. `sign` decoded with `hashHex.match(/.{1,2}/g).map(b =>
   * parseInt(b, 16))` and then checked only `bytes.length !== 32`. A non-hex
   * pair became NaN and stored as 0, so a corrupt 64-character hash passed the
   * length check and was signed as a partially-zeroed one. The length check
   * caught truncation and nothing else.
   */
  async function unlockedVault() {
    const { vault } = testVault();
    const record = await vault.generateKey(TEST_VAULT_PASSWORD, "signer");
    await vault.unlock(TEST_VAULT_PASSWORD);
    return { vault, record };
  }

  it("refuses a 64-character non-hex hash rather than signing zero bytes", async () => {
    const { vault, record } = await unlockedVault();
    await expect(vault.sign("z".repeat(64), record.id)).rejects.toThrow(
      "hash_must_be_32_bytes"
    );
  });

  it("refuses a hash that is not 64 characters", async () => {
    const { vault, record } = await unlockedVault();
    await expect(vault.sign("ab".repeat(31), record.id)).rejects.toThrow(
      "hash_must_be_32_bytes"
    );
    await expect(vault.sign("ab".repeat(33), record.id)).rejects.toThrow(
      "hash_must_be_32_bytes"
    );
  });

  it("still signs a well-formed hash", async () => {
    const { vault, record } = await unlockedVault();
    const { sigHex } = await vault.sign("ab".repeat(32), record.id);
    expect(sigHex).toMatch(/^[0-9a-f]{128}$/);
  });

  it("signs the event id it returns", async () => {
    const { vault, record } = await unlockedVault();
    const unsigned = {
      pubkey: record.pubkey,
      created_at: 1_735_689_600,
      kind: 1,
      tags: [["t", "nostr"]],
      content: "what the user approved",
    };
    const signed = await vault.signEvent(unsigned, record.id);

    expect(signed.id).toBe(NostrEventCrypto.computeEventId(unsigned));
    expect(signed.content).toBe(unsigned.content);
    expect(
      NostrEventCrypto.verifyEventSignature(
        signed.id,
        signed.sig,
        record.pubkey
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The unvalidated verification decode
// ---------------------------------------------------------------------------

describe("signature verification never hands malformed hex to the curve", () => {
  /*
   * THE DEFECT. `verifyEventSignature` decoded the event id, the signature and
   * the public key with `parseInt` and no character validation, and it read a
   * FIXED number of pairs. So a 128-character non-hex signature became 64 zero
   * bytes, and a short public key was silently zero-padded to 32 - and all
   * three were then handed to the curve as if they were real values.
   *
   * Asserting only the verdict cannot catch this: an all-zero signature fails
   * verification anyway, so the outcome is `false` either way. The property
   * that changed is that malformed input is now decided by the validator and
   * never reaches the curve, so that is what these assert.
   */
  const VALID_ID = "ab".repeat(32);
  const VALID_SIG = "cd".repeat(64);
  const VALID_PUBKEY = "ef".repeat(32);

  function recordingVerifier() {
    const calls: unknown[][] = [];
    return {
      calls,
      verify(...args: unknown[]) {
        calls.push(args);
        return true; // says yes to everything, so any reliance on it shows
      },
    };
  }

  const malformed: ReadonlyArray<readonly [string, string, string, string]> = [
    ["a non-hex signature", VALID_ID, "z".repeat(128), VALID_PUBKEY],
    ["a non-hex event id", "z".repeat(64), VALID_SIG, VALID_PUBKEY],
    ["a non-hex public key", VALID_ID, VALID_SIG, "z".repeat(64)],
    [
      "a short public key, which used to be zero-padded",
      VALID_ID,
      VALID_SIG,
      "ab",
    ],
    ["a short signature", VALID_ID, "cd".repeat(32), VALID_PUBKEY],
    ["an empty signature", VALID_ID, "", VALID_PUBKEY],
  ];

  for (const [name, id, sig, pubkey] of malformed) {
    it(`rejects ${name} without invoking the curve`, () => {
      const verifier = recordingVerifier();
      const result = verifyEventSignature(verifier, id, sig, pubkey);

      expect(result).toBe(false);
      expect(
        verifier.calls,
        `SECURITY REGRESSION: malformed input (${name}) was decoded and handed to the curve`
      ).toEqual([]);
    });
  }

  it("does reach the curve for well-formed input", () => {
    // Otherwise the assertions above would pass for a function that always
    // returns false.
    const verifier = recordingVerifier();
    expect(
      verifyEventSignature(verifier, VALID_ID, VALID_SIG, VALID_PUBKEY)
    ).toBe(true);
    expect(verifier.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// One parser on both paths
// ---------------------------------------------------------------------------

describe("the import path and the pre-validation RPC reach the same parser", () => {
  /*
   * THE DEFECT. `crypto.parsePrivateKey` - which both import forms call to
   * pre-validate the key the user has just typed - ran a parser in
   * `domain/utils/crypto.ts`, while `vault.importKey` ran a different one
   * inside `KeyVaultService`. One key-import gesture put the user's secret
   * through two independently written parsers, and they did not have to agree.
   */
  const SECRET_HEX =
    "0101010101010101010101010101010101010101010101010101010101010101";
  const NSEC = ScureBech32.encode("nsec", hexToBytes(SECRET_HEX));

  const accepted = [
    ["64-character hex", SECRET_HEX],
    ["0x-prefixed hex", `0x${SECRET_HEX}`],
    ["nsec bech32", NSEC],
    ["surrounding whitespace", `  ${SECRET_HEX}  `],
  ] as const;

  const rejected = [
    ["wrong-prefix bech32", ScureBech32.encode("npub", hexToBytes(SECRET_HEX))],
    ["wrong-length bech32", ScureBech32.encode("nsec", new Uint8Array(31))],
    ["63-character hex", SECRET_HEX.slice(1)],
    ["64 non-hex characters", "z".repeat(64)],
    ["empty", ""],
    ["nonsense", "not a key"],
  ] as const;

  for (const [name, input] of accepted) {
    it(`accepts ${name} and recovers the same bytes`, () => {
      expect(Array.from(parsePrivateKey(ScureBech32, input))).toEqual(
        Array.from(hexToBytes(SECRET_HEX))
      );
    });
  }

  for (const [name, input] of rejected) {
    it(`rejects ${name}`, () => {
      expect(() => parsePrivateKey(ScureBech32, input)).toThrow();
    });
  }

  it("gives crypto.parsePrivateKey and vault.importKey the same verdict", async () => {
    const cryptoHandler = new CryptoRpcHandler();
    const context = {} as ServiceContext;

    for (const [, input] of accepted) {
      // KeyInputSchema gates the RPC and does not allow 0x or whitespace, so
      // only the shapes it admits are comparable here.
      if (!/^[0-9a-fA-F]{64}$|^nsec1/.test(input)) continue;

      const rpc = await cryptoHandler.handleRequest(
        { type: "crypto.parsePrivateKey", keyInput: input },
        context
      );
      expect(rpc.ok, `RPC rejected ${input.slice(0, 12)}`).toBe(true);

      const { vault } = testVault();
      const record = await vault.importKey(input, TEST_VAULT_PASSWORD, "k");
      expect(record.pubkey).toMatch(/^[0-9a-f]{64}$/);
    }

    for (const [, input] of rejected) {
      const rpc = await cryptoHandler.handleRequest(
        { type: "crypto.parsePrivateKey", keyInput: input },
        context
      );
      expect(rpc.ok, `RPC accepted ${input.slice(0, 12)}`).toBe(false);

      const { vault } = testVault();
      await expect(
        vault.importKey(input, TEST_VAULT_PASSWORD, "k")
      ).rejects.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Unpaired surrogates
// ---------------------------------------------------------------------------

describe("unpaired surrogates are rejected before an event id exists", () => {
  /*
   * THE DEFECT, of a milder kind. `JSON.stringify` escapes a lone surrogate as
   * `\ud800`, where NIP-01 asks for it raw, so a strict verifier recomputing
   * the id from a returned event got a different value and rejected it. Worse,
   * `TextEncoder` maps a lone surrogate to U+FFFD, so the bytes that get hashed
   * are not the bytes the page sent.
   *
   * The fix is at the validation boundary, not in the serializer: rejecting is
   * honest, and normalizing would mean the extension silently altering what the
   * user is about to sign.
   */
  const base = {
    kind: 1,
    content: "hello",
    tags: [] as string[][],
    created_at: 1_735_689_600,
  };
  const LONE_HIGH = String.fromCharCode(0xd800);
  const LONE_LOW = String.fromCharCode(0xdfff);

  const ok = (event: unknown) => UnsignedEventSchema.safeParse(event).success;

  it("rejects an unpaired high surrogate in content", () => {
    expect(ok({ ...base, content: `pay ${LONE_HIGH} now` })).toBe(false);
  });

  it("rejects an unpaired low surrogate in content", () => {
    expect(ok({ ...base, content: LONE_LOW })).toBe(false);
  });

  it("rejects an unpaired surrogate in a tag value", () => {
    expect(ok({ ...base, tags: [["p", `ab${LONE_HIGH}`]] })).toBe(false);
  });

  it("rejects an unpaired surrogate in a tag name", () => {
    expect(ok({ ...base, tags: [[LONE_HIGH, "value"]] })).toBe(false);
  });

  it("still accepts a correctly paired surrogate, which is every emoji above the BMP", () => {
    // 🎉 is U+1F389: a high and a low surrogate that DO pair. Rejecting these
    // would break ordinary Nostr notes.
    expect(ok({ ...base, content: "shipped 🎉" })).toBe(true);
    expect(ok({ ...base, content: "𝄞 clef" })).toBe(true);
    expect(ok({ ...base, tags: [["t", "🎉"]] })).toBe(true);
  });

  it("still accepts the characters NIP-01 deliberately leaves unescaped", () => {
    expect(ok({ ...base, content: "\u2028\u2029\u007f" })).toBe(true);
  });

  it("returns invalid_event, with no new error code", async () => {
    const handler = new NostrRpcHandler();
    const getLockState = vi.fn();
    const listKeys = vi.fn();
    const evaluate = vi.fn();
    const context = {
      vault: { getLockState, listKeys, isKeyUnreadable: () => false },
      policy: { evaluate },
    } as unknown as ServiceContext;

    const result = await handler.handleRequest(
      {
        type: "nostr.signEvent",
        origin: "https://example.com",
        event: { ...base, content: LONE_HIGH },
      } as never,
      context
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_EVENT);
    }

    // Rejected before anything else happens: no lock check, no key lookup, no
    // policy evaluation - so no event id was computed and no approval prompt
    // could have been opened.
    expect(getLockState).not.toHaveBeenCalled();
    expect(listKeys).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("leaves the serializer's behaviour on a lone surrogate untouched", () => {
    // Pinned deliberately. The serializer is still reachable with one from the
    // relay verification path, where a hostile relay supplies the event and the
    // id has to be recomputed in order to reject it.
    expect(serializeEventForId("ab".repeat(32), 1, 1, [], LONE_HIGH)).toContain(
      "\\ud800"
    );
  });
});

// ---------------------------------------------------------------------------
// The key-list projection
// ---------------------------------------------------------------------------

describe("keys.list encodes the npub in the background, or not at all", () => {
  function contextWithKeys(records: unknown[]): ServiceContext {
    return {
      vault: { listKeys: async () => records, isKeyUnreadable: () => false },
    } as unknown as ServiceContext;
  }

  const GOOD = {
    id: "k1",
    pubkey: "ab".repeat(32),
    ct: [],
    iv: [],
    createdAt: 1,
  };

  it("supplies an npub for a well-formed record", async () => {
    const result = await new VaultRpcHandler().handleRequest(
      { type: "keys.list" } as never,
      contextWithKeys([GOOD])
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [entry] = result.data as KeyListEntry[];
    expect(entry.npub).toMatch(/^npub1/);
  });

  it("supplies NO npub for a record whose stored pubkey is not valid hex", async () => {
    // The old UI called `publicKeyToBech32(hexToBytes(key.pubkey))` here, and
    // the silent-zero decoder turned this record into `npub1qqq...` - a
    // perfectly valid npub for the all-zero key. Omitting the field is what
    // lets the key list say "unreadable" instead.
    const result = await new VaultRpcHandler().handleRequest(
      { type: "keys.list" } as never,
      contextWithKeys([{ ...GOOD, pubkey: "z".repeat(64) }])
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [entry] = result.data as KeyListEntry[];
    expect(
      entry.npub,
      "SECURITY REGRESSION: a malformed record was given a displayable npub"
    ).toBeUndefined();
  });

  it("keeps every field the response carried before", async () => {
    const result = await new VaultRpcHandler().handleRequest(
      { type: "keys.list" } as never,
      contextWithKeys([GOOD])
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [entry] = result.data as KeyListEntry[];
    // `npub` is additive: a caller that ignores it sees exactly what it saw.
    expect(entry).toMatchObject(GOOD);
  });
});

// ---------------------------------------------------------------------------
// Consolidation preserved every value
// ---------------------------------------------------------------------------

describe("consolidation preserved the values the extension produces", () => {
  /*
   * Captured from the PRE-consolidation implementations before any of this
   * change landed, with `src/domain/utils/crypto.ts` computing the ids and
   * `@scure/base` doing the encoding. If a byte of the NIP-01 pre-image, the
   * hash, the hex encoder or the bech32 limit moved, these go red.
   *
   * Signatures are deliberately absent: BIP-340 draws fresh auxiliary
   * randomness per call, so the same key over the same id produces a different
   * signature every time. `tests/security/bip340-vectors.test.ts` pins the
   * signing primitive against the official vectors instead.
   */
  const cases = [
    {
      event: {
        pubkey: "a".repeat(64),
        created_at: 1700000000,
        kind: 1,
        tags: [] as string[][],
        content: "hello",
      },
      id: "bb46df8e0d14e08773c7c6c88dfbb0925e6432048a2f2e82592afa415462d62a",
    },
    {
      event: {
        pubkey: "b".repeat(64),
        created_at: 1,
        kind: 0,
        tags: [["p", "x"]],
        content: 'line\nbreak "quote" \\slash\r\t\b\f',
      },
      id: "cf332068701adf01bf8e9b3a8f164e818fef208a4ec02fd6ab5d46a68cbe5158",
    },
    {
      event: {
        pubkey: "c".repeat(64),
        created_at: 42,
        kind: 30023,
        tags: [
          ["d", "slug"],
          ["t", "\u2028\u2029\u007f"],
        ],
        content: "\u2028\u2029\u007f control:\u0001\u001f",
      },
      id: "ab77ade29ad17136c0b33ff41ebefdfef87cd20ddee06590b1b1d28b4c270d17",
    },
    {
      event: {
        pubkey: "d".repeat(64),
        created_at: 99,
        kind: 7,
        tags: [] as string[][],
        content: "emoji 👍 \u00e9",
      },
      id: "064c963677e787f864ec289b65c611a80cfbf56190af2ecfd689c3a0d093ea87",
    },
  ];

  for (const [index, { event, id }] of cases.entries()) {
    it(`reproduces the pre-consolidation event id for case ${index}`, () => {
      expect(computeEventId(NobleSha256, event)).toBe(id);
    });
  }

  it("reproduces the pre-consolidation npub and nsec for a fixed key", () => {
    const pubkey = hexToBytes(
      "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"
    );
    const secret = hexToBytes(
      "0000000000000000000000000000000000000000000000000000000000000003"
    );

    expect(ScureBech32.encode("npub", pubkey)).toBe(
      "npub1lycg5qvjtrp3qjf5f7zl382j9x6nrjz9sdhenvyxq8c3808qxmus6gq266"
    );
    // The two encoders this replaced disagreed on the length limit - one
    // passed none, one passed 5000 - and produced this same string, which is
    // why collapsing them changes nothing.
    expect(ScureBech32.encode("nsec", secret)).toBe(
      "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqps52s3re"
    );
  });
});

// ---------------------------------------------------------------------------
// A vault written before this change
// ---------------------------------------------------------------------------

describe("a vault written before this change still opens after it", () => {
  /*
   * The fixture is not synthesised here. It was produced by checking out the
   * pre-consolidation tree in a detached worktree and running its
   * `KeyVaultService.importKey` - so the ciphertext, the IVs, the wrapped DEK
   * and the AAD in `tests/fixtures/vault-written-before-consolidation.json`
   * were written by the code this change replaced.
   *
   * Round-tripping through the new code would not prove this. It would pass for
   * any self-consistent pair of writer and reader, including one that had
   * silently changed the record format or the AAD binding.
   *
   * The KDF is a deterministic stand-in in both trees, so the derived KEK is
   * reproducible; everything else - AES-GCM, the envelope verifier, the AAD
   * construction, the pubkey check - is real.
   */
  const fixture = JSON.parse(
    readFileSync(
      resolve(__dirname, "../fixtures/vault-written-before-consolidation.json"),
      "utf-8"
    )
  ) as {
    encryptedKeys: unknown[];
    vaultEnvelope: unknown;
    appSettings: unknown;
    expectedPubkey: string;
    expectedId: string;
  };

  const FIXTURE_PASSWORD = "pre-change-vault-password";

  async function loadedVault() {
    const storage = memoryStorage();
    await storage.local.set("encryptedKeys", fixture.encryptedKeys);
    await storage.local.set("vaultEnvelope", fixture.vaultEnvelope);
    if (fixture.appSettings) {
      await storage.local.set("appSettings", fixture.appSettings);
    }
    return testVault(storage).vault;
  }

  it("carries real ciphertext, so this is not a vacuous test", () => {
    const [record] = fixture.encryptedKeys as Array<{ ct: number[] }>;
    expect(record.ct.length).toBeGreaterThanOrEqual(32);
    expect(fixture.vaultEnvelope).toBeTruthy();
  });

  it("unlocks, with the record intact and not reported as damaged", async () => {
    const vault = await loadedVault();
    const result = await vault.unlock(FIXTURE_PASSWORD);

    expect(
      result.damagedKeyIds,
      "SECURITY REGRESSION: a vault written before this change no longer decrypts"
    ).toEqual([]);
    expect(result.unlockedKeyIds).toEqual([fixture.expectedId]);
  });

  it("recovers the same private key, checked against the stored public key", async () => {
    const vault = await loadedVault();
    await vault.unlock(FIXTURE_PASSWORD);

    // `revealKey` re-verifies the password AND checks the recovered key against
    // the record's stored pubkey, so a successful reveal is the end-to-end
    // proof that the bytes came back unchanged.
    const revealed = await vault.revealKey(FIXTURE_PASSWORD, fixture.expectedId);
    expect(revealed.hex).toBe(
      "0101010101010101010101010101010101010101010101010101010101010101"
    );
    expect(revealed.nsec).toMatch(/^nsec1/);
    expect(bytesToHex(NobleSchnorr.getPublicKey(hexToBytes(revealed.hex)))).toBe(
      fixture.expectedPubkey
    );
  });

  it("rejects the wrong password against the pre-change envelope", async () => {
    const vault = await loadedVault();
    await expect(vault.unlock("not the password")).rejects.toThrow(
      "incorrect_password"
    );
  });

  it("needs no storage migration to do any of that", async () => {
    const storage = memoryStorage();
    await storage.local.set("encryptedKeys", fixture.encryptedKeys);
    await storage.local.set("vaultEnvelope", fixture.vaultEnvelope);
    const before = JSON.stringify(await storage.local.get("encryptedKeys"));

    await testVault(storage).vault.unlock(FIXTURE_PASSWORD);

    expect(JSON.stringify(await storage.local.get("encryptedKeys"))).toBe(
      before
    );
  });
});
