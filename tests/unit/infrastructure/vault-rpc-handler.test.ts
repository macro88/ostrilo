import { beforeEach, describe, expect, it } from "vitest";
import { VaultRpcHandler } from "@/infrastructure/messaging/handlers/vault-rpc";
import type { KeyListEntry } from "@/infrastructure/messaging/handlers/vault-rpc";
import { RpcRouter } from "@/infrastructure/messaging/rpc-router";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import type { RpcRequest } from "@/infrastructure/messaging/rpc";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import type { StorageSuite } from "@/application/ports/storage";
import type { KeyVaultService } from "@/application/services/key-vault.service";
import type { KeyRecord, VaultEnvelope } from "@/domain/types";
import { memoryStorage } from "../../helpers/vault";
import {
  PUBKEY_ONE,
  SECRET_ONE,
  SECRET_TWO,
  STRONG_PASSWORD,
  dataOf,
  errorCodeOf,
  realContext,
} from "./messaging-fixture";

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let handler: VaultRpcHandler;
let context: ServiceContext;
let storage: StorageSuite;
let vault: KeyVaultService;

const send = (req: RpcRequest) => handler.handleRequest(req, context);

async function storedKeys(): Promise<KeyRecord[]> {
  return (await storage.local.get<KeyRecord[]>("encryptedKeys")) ?? [];
}

async function tamperEnvelope(patch: (env: VaultEnvelope) => VaultEnvelope) {
  const env = await storage.local.get<VaultEnvelope>("vaultEnvelope");
  if (!env) throw new Error("no envelope to tamper with");
  await storage.local.set("vaultEnvelope", patch(env));
}

async function importTwoKeys(): Promise<[KeyRecord, KeyRecord]> {
  const first = dataOf<KeyRecord>(
    await send({ type: "vault.import", keyInput: SECRET_ONE, password: STRONG_PASSWORD, label: "one" })
  );
  const second = dataOf<KeyRecord>(
    await send({ type: "vault.import", keyInput: SECRET_TWO, password: STRONG_PASSWORD, label: "two" })
  );
  return [first, second];
}

beforeEach(() => {
  handler = new VaultRpcHandler();
  ({ context, storage, vault } = realContext());
});

describe("vault.unlock", () => {
  it("rejects an empty password before touching the vault", async () => {
    expect(errorCodeOf(await send({ type: "vault.unlock", password: "" }))).toBe(
      RPC_ERROR_CODES.INVALID_PASSWORD
    );
  });

  it("reports a missing vault as no key, not as a wrong password", async () => {
    const res = await send({ type: "vault.unlock", password: STRONG_PASSWORD });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.NO_KEY_SELECTED);
  });

  it("unlocks with the correct password and leaves the vault unlocked", async () => {
    await vault.importKey(SECRET_ONE, STRONG_PASSWORD, "one");
    await vault.lock();

    const res = await send({ type: "vault.unlock", password: STRONG_PASSWORD });

    expect(dataOf<{ unlockedKeyIds: string[] }>(res).unlockedKeyIds).toHaveLength(1);
    expect((await vault.getLockState()).isLocked).toBe(false);
  });

  it("refuses a wrong password and keeps the vault locked", async () => {
    await vault.importKey(SECRET_ONE, STRONG_PASSWORD);
    await vault.lock();

    const res = await send({ type: "vault.unlock", password: "not the password" });

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
    expect((await vault.getLockState()).isLocked).toBe(true);
  });

  it("announces the backoff once the free attempts are spent, then rate limits", async () => {
    await vault.importKey(SECRET_ONE, STRONG_PASSWORD);
    await vault.lock();

    const details: Array<string | undefined> = [];
    for (let i = 0; i < 4; i++) {
      const res = await send({ type: "vault.unlock", password: "wrong-guess" });
      expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
      if (!res.ok) details.push(res.error.data.details);
    }
    expect(details[0]).toBe("Incorrect password");
    expect(details[3]).toMatch(/paused for 5 seconds/);

    // Even the correct password is refused inside the lockout window.
    const locked = await send({ type: "vault.unlock", password: STRONG_PASSWORD });
    expect(errorCodeOf(locked)).toBe(RPC_ERROR_CODES.RATE_LIMITED);
    expect((await vault.getLockState()).isLocked).toBe(true);
  });

  it("reports a vault from an unsupported version as unreadable", async () => {
    await vault.importKey(SECRET_ONE, STRONG_PASSWORD);
    await vault.lock();
    await tamperEnvelope((env) => ({ ...env, v: 999 }));

    const res = await send({ type: "vault.unlock", password: STRONG_PASSWORD });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.VAULT_UNREADABLE);
  });

  it("reports a right password over records that all fail to open as unreadable, and stays locked", async () => {
    await vault.importKey(SECRET_ONE, STRONG_PASSWORD);
    await vault.lock();
    const records = (await storage.local.get("encryptedKeys")) as Array<Record<string, unknown>>;
    await storage.local.set("encryptedKeys", [{ ...records[0], pubkey: "cd".repeat(32) }]);

    const res = await send({ type: "vault.unlock", password: STRONG_PASSWORD });

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.VAULT_UNREADABLE);
    expect((await vault.getLockState()).isLocked).toBe(true);
  });

  it("reports KDF parameters weakened below the floor as unreadable", async () => {
    await vault.importKey(SECRET_ONE, STRONG_PASSWORD);
    await vault.lock();
    await tamperEnvelope((env) => ({ ...env, kdf: { ...env.kdf, m: 8, t: 1 } } as VaultEnvelope));

    const res = await send({ type: "vault.unlock", password: STRONG_PASSWORD });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.VAULT_UNREADABLE);
  });

  it("reports an unknown KDF algorithm as unreadable", async () => {
    await vault.importKey(SECRET_ONE, STRONG_PASSWORD);
    await vault.lock();
    await tamperEnvelope((env) => ({ ...env, kdf: { ...env.kdf, alg: "rot13" } } as unknown as VaultEnvelope));

    const res = await send({ type: "vault.unlock", password: STRONG_PASSWORD });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.VAULT_UNREADABLE);
  });

  it("surfaces an unexpected storage failure as a generic error with no internal text", async () => {
    const broken = memoryStorage();
    const read = broken.local.get.bind(broken.local);
    broken.local.get = async <T,>(key: string) => {
      if (key === "encryptedKeys") throw new Error("EIO /private/profile/storage.db");
      return read<T>(key);
    };
    const router = new RpcRouter();
    router.registerModule("vault", handler);

    const res = await router.handleRequest(
      { type: "vault.unlock", password: STRONG_PASSWORD },
      realContext(broken).context
    );

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.UNKNOWN_METHOD);
    expect(JSON.stringify(res)).not.toContain("storage.db");
  });
});

describe("vault.lock", () => {
  it("locks an unlocked vault", async () => {
    await vault.importKey(SECRET_ONE, STRONG_PASSWORD);
    await vault.unlock(STRONG_PASSWORD);

    expect(await send({ type: "vault.lock" })).toEqual({ ok: true, data: null });
    expect((await vault.getLockState()).isLocked).toBe(true);
  });
});

describe("vault.generate", () => {
  it("rejects an empty password", async () => {
    expect(errorCodeOf(await send({ type: "vault.generate", password: "" }))).toBe(
      RPC_ERROR_CODES.INVALID_PASSWORD
    );
    expect(await storedKeys()).toHaveLength(0);
  });

  it("rejects an oversized label and stores nothing", async () => {
    const res = await send({ type: "vault.generate", password: STRONG_PASSWORD, label: "x".repeat(101) });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
    expect(await storedKeys()).toHaveLength(0);
  });

  it("applies the new-password policy to the first key", async () => {
    const res = await send({ type: "vault.generate", password: "short1" });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
    expect(await storedKeys()).toHaveLength(0);
  });

  it("rejects a first password that contains the key's own label", async () => {
    const res = await send({
      type: "vault.generate",
      password: "Umbral-Pinecone-Marigold-47",
      label: "marigold",
    });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
  });

  it("creates and selects the first key under a policy-compliant password", async () => {
    const record = dataOf<KeyRecord>(
      await send({ type: "vault.generate", password: STRONG_PASSWORD, label: "main" })
    );

    const keys = await storedKeys();
    expect(keys.map((k) => k.id)).toEqual([record.id]);
    expect(keys[0].isSelected).toBe(true);
    await expect(vault.verifyPassword(STRONG_PASSWORD)).resolves.toBeUndefined();
  });

  it("does not re-apply the new-password policy to an existing vault's password", async () => {
    // A vault created before the policy existed, under a password it would refuse.
    const legacyPassword = "hunter2";
    await vault.generateKey(legacyPassword, "old");

    const res = await send({ type: "vault.generate", password: legacyPassword, label: "new" });

    expect(res.ok).toBe(true);
    expect(await storedKeys()).toHaveLength(2);
  });

  it("refuses a second key under a different password than the vault's", async () => {
    await vault.generateKey(STRONG_PASSWORD);

    const res = await send({ type: "vault.generate", password: "Another-Distinct-Phrase-93" });

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
    expect(await storedKeys()).toHaveLength(1);
  });

  it("propagates a vault it cannot read rather than masking it as a password error", async () => {
    await vault.generateKey(STRONG_PASSWORD);
    await tamperEnvelope((env) => ({ ...env, kdf: { ...env.kdf, alg: "rot13" } } as unknown as VaultEnvelope));

    await expect(
      send({ type: "vault.generate", password: STRONG_PASSWORD })
    ).rejects.toThrow("kdf_unknown_algorithm");
  });
});

describe("vault.import", () => {
  it("rejects malformed key input before checking the password", async () => {
    const res = await send({ type: "vault.import", keyInput: "not-a-key", password: "" });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_KEY_INPUT);
  });

  it("rejects an empty password", async () => {
    const res = await send({ type: "vault.import", keyInput: SECRET_ONE, password: "" });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
  });

  it("rejects an oversized label", async () => {
    const res = await send({
      type: "vault.import",
      keyInput: SECRET_ONE,
      password: STRONG_PASSWORD,
      label: "y".repeat(101),
    });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
  });

  it("applies the new-password policy to the first imported key", async () => {
    const res = await send({ type: "vault.import", keyInput: SECRET_ONE, password: "password" });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
    expect(await storedKeys()).toHaveLength(0);
  });

  it("imports a key whose stored public key matches the secret", async () => {
    const record = dataOf<KeyRecord>(
      await send({ type: "vault.import", keyInput: SECRET_ONE, password: STRONG_PASSWORD })
    );
    expect(record.pubkey).toBe(PUBKEY_ONE);
    expect((await storedKeys())[0].pubkey).toBe(PUBKEY_ONE);
  });

  it("refuses to import the same key twice", async () => {
    await send({ type: "vault.import", keyInput: SECRET_ONE, password: STRONG_PASSWORD });

    const res = await send({ type: "vault.import", keyInput: SECRET_ONE, password: STRONG_PASSWORD });

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.KEY_ALREADY_EXISTS);
    expect(await storedKeys()).toHaveLength(1);
  });

  it("refuses a second key under the wrong vault password", async () => {
    await send({ type: "vault.import", keyInput: SECRET_ONE, password: STRONG_PASSWORD });

    const res = await send({ type: "vault.import", keyInput: SECRET_TWO, password: "Different-Phrase-Entirely-5" });

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
    expect(await storedKeys()).toHaveLength(1);
  });

  it("propagates an unexpected vault failure", async () => {
    await vault.generateKey(STRONG_PASSWORD);
    await tamperEnvelope((env) => ({ ...env, kdf: { ...env.kdf, alg: "rot13" } } as unknown as VaultEnvelope));

    await expect(
      send({ type: "vault.import", keyInput: SECRET_TWO, password: STRONG_PASSWORD })
    ).rejects.toThrow("kdf_unknown_algorithm");
  });
});

describe("vault.select", () => {
  it("rejects an id that is not a UUID", async () => {
    expect(errorCodeOf(await send({ type: "vault.select", id: "k1" }))).toBe(
      RPC_ERROR_CODES.INVALID_PARAMS
    );
  });

  it("moves the selection to the named key", async () => {
    const [first, second] = await importTwoKeys();

    expect(await send({ type: "vault.select", id: second.id })).toEqual({ ok: true, data: null });

    const keys = await storedKeys();
    expect(keys.find((k) => k.id === second.id)?.isSelected).toBe(true);
    expect(keys.find((k) => k.id === first.id)?.isSelected).toBe(false);
  });
});

describe("vault.reveal", () => {
  it("rejects an empty password", async () => {
    expect(errorCodeOf(await send({ type: "vault.reveal", password: "" }))).toBe(
      RPC_ERROR_CODES.INVALID_PASSWORD
    );
  });

  it("rejects a key id that is not a UUID", async () => {
    const res = await send({ type: "vault.reveal", password: STRONG_PASSWORD, keyId: "k1" });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
  });

  it("releases the secret of the selected key only for the vault password", async () => {
    await importTwoKeys();

    const res = await send({ type: "vault.reveal", password: STRONG_PASSWORD });

    const revealed = dataOf<{ nsec: string; hex: string }>(res);
    expect(revealed.hex).toBe(SECRET_ONE);
    expect(revealed.nsec.startsWith("nsec1")).toBe(true);
  });

  it("re-verifies the password even while the vault is unlocked", async () => {
    await importTwoKeys();
    await vault.unlock(STRONG_PASSWORD);

    const res = await send({ type: "vault.reveal", password: "wrong-password-here" });

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
    expect(JSON.stringify(res)).not.toContain(SECRET_ONE);
  });

  it("releases a named key", async () => {
    const [, second] = await importTwoKeys();

    const res = await send({ type: "vault.reveal", password: STRONG_PASSWORD, keyId: second.id });

    expect(dataOf<{ hex: string }>(res).hex).toBe(SECRET_TWO);
  });

  it("reports an unknown key id as not found", async () => {
    await importTwoKeys();
    const res = await send({ type: "vault.reveal", password: STRONG_PASSWORD, keyId: UNKNOWN_ID });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.KEY_NOT_FOUND);
  });

  it("refuses as locked when no key is named and none is selected", async () => {
    await importTwoKeys();
    await storage.local.remove("appSettings");

    const res = await send({ type: "vault.reveal", password: STRONG_PASSWORD });

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.LOCKED);
  });

  it("releases nothing from a record whose public key was rewritten", async () => {
    await importTwoKeys();
    const keys = await storedKeys();
    await storage.local.set("encryptedKeys", [{ ...keys[0], pubkey: keys[1].pubkey }, keys[1]]);

    const res = await send({ type: "vault.reveal", password: STRONG_PASSWORD, keyId: keys[0].id });

    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain(SECRET_ONE);
    expect(JSON.stringify(res)).not.toContain(SECRET_TWO);
  });
});

describe("keys.list", () => {
  it("adds the bech32 npub to each well-formed record", async () => {
    await send({ type: "vault.import", keyInput: SECRET_ONE, password: STRONG_PASSWORD });

    const [entry] = dataOf<KeyListEntry[]>(await send({ type: "keys.list" }));

    expect(entry.pubkey).toBe(PUBKEY_ONE);
    expect(entry.npub).toBe("npub10xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqpkge6d");
  });

  it("gives a record with a corrupt public key no npub at all", async () => {
    await send({ type: "vault.import", keyInput: SECRET_ONE, password: STRONG_PASSWORD });
    const [record] = await storedKeys();
    await storage.local.set("encryptedKeys", [{ ...record, pubkey: "zz".repeat(32) }]);

    const [entry] = dataOf<KeyListEntry[]>(await send({ type: "keys.list" }));

    expect(entry.npub).toBeUndefined();
  });
});

describe("vault.renameKey", () => {
  it("rejects an id that is not a UUID", async () => {
    expect(errorCodeOf(await send({ type: "vault.renameKey", id: "k1", label: "x" }))).toBe(
      RPC_ERROR_CODES.INVALID_PARAMS
    );
  });

  it("rejects an oversized label and keeps the old one", async () => {
    const [first] = await importTwoKeys();

    const res = await send({ type: "vault.renameKey", id: first.id, label: "z".repeat(101) });

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
    expect((await storedKeys())[0].label).toBe("one");
  });

  it("reports an unknown key as not found", async () => {
    const res = await send({ type: "vault.renameKey", id: UNKNOWN_ID, label: "x" });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.KEY_NOT_FOUND);
  });

  it("stores the new label", async () => {
    const [first] = await importTwoKeys();

    expect(await send({ type: "vault.renameKey", id: first.id, label: "renamed" })).toEqual({
      ok: true,
      data: null,
    });
    expect((await storedKeys())[0].label).toBe("renamed");
  });
});

describe("vault.deleteKey", () => {
  it("rejects an id that is not a UUID", async () => {
    const res = await send({ type: "vault.deleteKey", id: "k1", password: STRONG_PASSWORD });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
  });

  it("refuses without a password and deletes nothing", async () => {
    const [first] = await importTwoKeys();
    await vault.unlock(STRONG_PASSWORD);

    const res = await send({ type: "vault.deleteKey", id: first.id } as RpcRequest);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
    expect(await storedKeys()).toHaveLength(2);
  });

  it("refuses a wrong password on an unlocked vault and deletes nothing", async () => {
    const [first] = await importTwoKeys();
    await vault.unlock(STRONG_PASSWORD);

    const res = await send({ type: "vault.deleteKey", id: first.id, password: "wrong-password-here" });

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
    expect(await storedKeys()).toHaveLength(2);
  });

  it("refuses as locked when there is no vault to verify against", async () => {
    const res = await send({ type: "vault.deleteKey", id: UNKNOWN_ID, password: STRONG_PASSWORD });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.LOCKED);
  });

  it("reports an unknown key as not found", async () => {
    await importTwoKeys();
    const res = await send({ type: "vault.deleteKey", id: UNKNOWN_ID, password: STRONG_PASSWORD });
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.KEY_NOT_FOUND);
    expect(await storedKeys()).toHaveLength(2);
  });

  it("refuses to delete the last remaining key", async () => {
    const record = dataOf<KeyRecord>(
      await send({ type: "vault.import", keyInput: SECRET_ONE, password: STRONG_PASSWORD })
    );

    const res = await send({ type: "vault.deleteKey", id: record.id, password: STRONG_PASSWORD });

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
    expect(await storedKeys()).toHaveLength(1);
  });

  it("propagates a storage failure during deletion instead of reporting success", async () => {
    const [first] = await importTwoKeys();
    storage.local.set = async () => {
      throw new Error("quota exceeded");
    };

    await expect(
      send({ type: "vault.deleteKey", id: first.id, password: STRONG_PASSWORD })
    ).rejects.toThrow("quota exceeded");
  });

  it("propagates a storage failure during rename", async () => {
    const [first] = await importTwoKeys();
    storage.local.set = async () => {
      throw new Error("quota exceeded");
    };

    await expect(send({ type: "vault.renameKey", id: first.id, label: "x" })).rejects.toThrow(
      "quota exceeded"
    );
  });

  it("deletes the selected key and selects the survivor", async () => {
    const [first, second] = await importTwoKeys();

    const res = await send({ type: "vault.deleteKey", id: first.id, password: STRONG_PASSWORD });

    expect(dataOf<{ newSelectedKeyId?: string }>(res).newSelectedKeyId).toBe(second.id);
    const keys = await storedKeys();
    expect(keys.map((k) => k.id)).toEqual([second.id]);
    expect(keys[0].isSelected).toBe(true);
  });
});

describe("vault.changePassword", () => {
  const NEW_PASSWORD = "Lichen-Harbour-Quill-2026";
  const change = (currentPassword: string, newPassword = NEW_PASSWORD) =>
    send({ type: "vault.changePassword", currentPassword, newPassword });

  beforeEach(async () => {
    await importTwoKeys();
    await vault.unlock(STRONG_PASSWORD);
  });

  it("rotates the password and reports success with no data", async () => {
    expect(await change(STRONG_PASSWORD)).toEqual({ ok: true, data: null });
    const unlocked = await vault.unlock(NEW_PASSWORD);
    expect(unlocked.unlockedKeyIds).toHaveLength(2);
  });

  it("rejects an empty field before touching the vault", async () => {
    expect(errorCodeOf(await change(""))).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
    expect(errorCodeOf(await change(STRONG_PASSWORD, ""))).toBe(
      RPC_ERROR_CODES.INVALID_PASSWORD
    );
  });

  it("names damaged records by key id and changes nothing", async () => {
    const records = await storedKeys();
    records[1].wrappedDek!.ct[0] ^= 0xff;
    await storage.local.set("encryptedKeys", records);

    const res = await change(STRONG_PASSWORD);

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.VAULT_RECORDS_DAMAGED);
    if (!res.ok) expect(res.error.data.details).toContain(records[1].id);
    expect(await storedKeys()).toEqual(records);
  });

  it("asks for a migration while a legacy record remains", async () => {
    const records = await storedKeys();
    await storage.local.set("encryptedKeys", [
      ...records,
      { ...records[0], id: "legacy-record", v: undefined, salt: [1, 2, 3] },
    ]);

    expect(errorCodeOf(await change(STRONG_PASSWORD))).toBe(
      RPC_ERROR_CODES.VAULT_MIGRATION_PENDING
    );
  });

  it("reports a vault with unacceptable parameters as unreadable, not a wrong password", async () => {
    await tamperEnvelope((env) => ({ ...env, v: 99 }));
    expect(errorCodeOf(await change(STRONG_PASSWORD))).toBe(
      RPC_ERROR_CODES.VAULT_UNREADABLE
    );
  });

  it("never echoes either password", async () => {
    const res = await change("Wrong-Current-Password-1");
    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
    expect(JSON.stringify(res)).not.toContain("Wrong-Current-Password-1");
    expect(JSON.stringify(res)).not.toContain(NEW_PASSWORD);
  });
  it("reports an empty vault as locked", async () => {
    ({ context, storage, vault } = realContext());
    expect(errorCodeOf(await change(STRONG_PASSWORD))).toBe(RPC_ERROR_CODES.LOCKED);
  });

  it("lets an unexpected service failure propagate rather than guessing a code", async () => {
    context.vault.changePassword = async () => {
      throw new Error("storage exploded");
    };
    await expect(change(STRONG_PASSWORD)).rejects.toThrow("storage exploded");
  });
});
