import { describe, expect, it, vi } from "vitest";
import { VaultKdf } from "@/infrastructure/crypto/adapters";
import { KDF_CEILINGS } from "@/domain/types";
import {
  BACKUP_DECRYPT_FAILURE_MESSAGE,
  KeyBackupError,
  backupFileName,
  createKeyBackup,
  isKeyBackupEnvelope,
  openKeyBackup,
  parseKeyBackupEnvelope,
  serializeKeyBackup,
  type KeyBackupEnvelopeV1,
  type KeyBackupPayload,
} from "@/ui/features/onboarding/backup/key-backup-envelope";

/**
 * The file that replaced the plaintext key download.
 *
 * `handleDownloadKey` wrote `{ name, privateKey: nsec, privateKeyHex }` to disk
 * with no encryption, no passphrase and the key's name in the filename. These
 * assertions are the ones that make a regression to that behaviour fail rather
 * than ship: if any of them stops holding, the file is readable again.
 */

const PAYLOAD: KeyBackupPayload = {
  nsec: "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5",
  hex: "67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa",
  name: "Alice's everyday identity",
};

const PASSPHRASE = "correct-horse-battery-staple-42";

describe("encrypted key backup envelope", () => {
  it("round-trips with the correct passphrase", async () => {
    const envelope = await createKeyBackup(PAYLOAD, PASSPHRASE);
    const recovered = await openKeyBackup(envelope, PASSPHRASE);

    expect(recovered.nsec).toBe(PAYLOAD.nsec);
    expect(recovered.hex).toBe(PAYLOAD.hex);
    expect(recovered.name).toBe(PAYLOAD.name);
  });

  it("puts nothing readable in the file", async () => {
    const envelope = await createKeyBackup(PAYLOAD, PASSPHRASE);
    const onDisk = serializeKeyBackup(envelope);

    // The three strings the old exporter wrote in the clear.
    expect(onDisk).not.toContain(PAYLOAD.nsec);
    expect(onDisk).not.toContain(PAYLOAD.hex);
    expect(onDisk).not.toContain(PAYLOAD.name);
    // And the field names that made it obvious what the file was.
    expect(onDisk).not.toMatch(/"privateKey"/);
    expect(onDisk).not.toMatch(/"privateKeyHex"/);
    expect(onDisk).not.toMatch(/nsec1/);
  });

  it("fails closed on the wrong passphrase, disclosing nothing", async () => {
    const envelope = await createKeyBackup(PAYLOAD, PASSPHRASE);

    await expect(
      openKeyBackup(envelope, "correct-horse-battery-staple-43")
    ).rejects.toThrow(KeyBackupError);

    const error = await openKeyBackup(envelope, "nope").catch((e) => e);
    expect(error.message).toBe(BACKUP_DECRYPT_FAILURE_MESSAGE);
    // The message must not leak the key, the name, or the real passphrase.
    expect(error.message).not.toContain(PAYLOAD.nsec.slice(0, 12));
    expect(error.message).not.toContain(PASSPHRASE);
    expect(error.message).not.toContain(PAYLOAD.name);
  });

  it("rejects an empty passphrase on both sides", async () => {
    await expect(createKeyBackup(PAYLOAD, "")).rejects.toThrow(KeyBackupError);
    const envelope = await createKeyBackup(PAYLOAD, PASSPHRASE);
    await expect(openKeyBackup(envelope, "")).rejects.toThrow(KeyBackupError);
  });

  it("refuses a header whose KDF cost has been rolled back", async () => {
    const envelope = await createKeyBackup(PAYLOAD, PASSPHRASE);
    // An attacker who can hand the user a file can also rewrite its header.
    const weakened = {
      ...envelope,
      kdf: { ...envelope.kdf, alg: "pbkdf2-sha256" as const, c: 1 },
    };

    await expect(
      openKeyBackup(weakened as typeof envelope, PASSPHRASE)
    ).rejects.toThrow(BACKUP_DECRYPT_FAILURE_MESSAGE);
  });

  it("authenticates the header, so a rewritten IV fails to decrypt", async () => {
    const envelope = await createKeyBackup(PAYLOAD, PASSPHRASE);
    const ivBytes = atob(envelope.cipher.iv).split("");
    ivBytes[0] = String.fromCharCode(ivBytes[0].charCodeAt(0) ^ 0xff);
    const tampered = {
      ...envelope,
      cipher: { ...envelope.cipher, iv: btoa(ivBytes.join("")) },
    };

    await expect(openKeyBackup(tampered, PASSPHRASE)).rejects.toThrow(
      BACKUP_DECRYPT_FAILURE_MESSAGE
    );
  });

  it("fails on a truncated ciphertext rather than returning partial material", async () => {
    const envelope = await createKeyBackup(PAYLOAD, PASSPHRASE);
    const truncated = { ...envelope, ct: envelope.ct.slice(0, 20) };

    await expect(openKeyBackup(truncated, PASSPHRASE)).rejects.toThrow(
      KeyBackupError
    );
  });

  it("uses a fresh salt and IV for every file", async () => {
    const a = await createKeyBackup(PAYLOAD, PASSPHRASE);
    const b = await createKeyBackup(PAYLOAD, PASSPHRASE);

    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("names the file by date only - no key name, no key material", () => {
    const name = backupFileName(new Date("2026-09-13T09:30:00.000Z"));

    expect(name).toBe("ostrilo-backup-2026-09-13.json");
    expect(name).not.toContain("Alice");
    expect(name).not.toContain("nsec");
  });

  it("recognises its own files and declines everything else", async () => {
    const envelope = await createKeyBackup(PAYLOAD, PASSPHRASE);

    expect(isKeyBackupEnvelope(envelope)).toBe(true);
    expect(parseKeyBackupEnvelope(serializeKeyBackup(envelope))).not.toBeNull();
    // The legacy plaintext export must NOT be mistaken for an envelope.
    expect(
      parseKeyBackupEnvelope(
        JSON.stringify({ name: "k", privateKey: PAYLOAD.nsec })
      )
    ).toBeNull();
    expect(parseKeyBackupEnvelope("nsec1notjson")).toBeNull();
    expect(parseKeyBackupEnvelope("")).toBeNull();
  });

  it("refuses a header whose argon2id memory cost has been lowered", async () => {
    const envelope = await createKeyBackup(PAYLOAD, PASSPHRASE);
    const weakened = { ...envelope, kdf: { ...envelope.kdf, m: 8 } };

    await expect(openKeyBackup(weakened, PASSPHRASE)).rejects.toThrow(
      BACKUP_DECRYPT_FAILURE_MESSAGE
    );
  });

  it.each([
    ["memory cost", { m: KDF_CEILINGS.argon2id.m + 1 }],
    ["time cost", { t: KDF_CEILINGS.argon2id.t + 1 }],
    ["parallelism", { p: KDF_CEILINGS.argon2id.p + 1 }],
  ])(
    "refuses a header whose argon2id %s exceeds the ceiling, without deriving",
    async (_name, raised) => {
      const envelope = await createKeyBackup(PAYLOAD, PASSPHRASE);
      const crafted = { ...envelope, kdf: { ...envelope.kdf, ...raised } };
      const derive = vi.spyOn(VaultKdf, "deriveKey");

      await expect(openKeyBackup(crafted, PASSPHRASE)).rejects.toThrow(
        BACKUP_DECRYPT_FAILURE_MESSAGE
      );
      expect(
        derive,
        "a crafted file must be refused before it can stall the page"
      ).not.toHaveBeenCalled();
      derive.mockRestore();
    }
  );

  it("refuses a header whose salt has been shortened", async () => {
    const envelope = await createKeyBackup(PAYLOAD, PASSPHRASE);
    const shortened = { ...envelope, kdf: { ...envelope.kdf, salt: btoa("abc") } };

    await expect(openKeyBackup(shortened, PASSPHRASE)).rejects.toThrow(
      BACKUP_DECRYPT_FAILURE_MESSAGE
    );
  });

  it(
    "fails closed when the header names a different KDF than the one that sealed it",
    { timeout: 30_000 },
    async () => {
      const envelope = await createKeyBackup(PAYLOAD, PASSPHRASE);
      const swapped: KeyBackupEnvelopeV1 = {
        ...envelope,
        kdf: { alg: "pbkdf2-sha256", c: 600_000, salt: envelope.kdf.salt },
      };

      await expect(openKeyBackup(swapped, PASSPHRASE)).rejects.toThrow(
        new KeyBackupError(BACKUP_DECRYPT_FAILURE_MESSAGE)
      );
    }
  );

  it("fails closed when the sealed payload is not a key", async () => {
    const notAKey: KeyBackupPayload = JSON.parse('{"hex":"00","name":"k"}');
    const envelope = await createKeyBackup(notAKey, PASSPHRASE);

    await expect(openKeyBackup(envelope, PASSPHRASE)).rejects.toThrow(
      new KeyBackupError(BACKUP_DECRYPT_FAILURE_MESSAGE)
    );
  });

  it("recovers a key sealed without a name as an unnamed key", async () => {
    // What a backup sealed without a name decodes to; the type requires one.
    const unnamed = { nsec: PAYLOAD.nsec, hex: PAYLOAD.hex } as KeyBackupPayload;
    const envelope = await createKeyBackup(unnamed, PASSPHRASE);

    await expect(openKeyBackup(envelope, PASSPHRASE)).resolves.toEqual({
      nsec: PAYLOAD.nsec,
      hex: PAYLOAD.hex,
      name: "",
    });
  });

  it("declines values that are not envelope-shaped", async () => {
    const envelope = await createKeyBackup(PAYLOAD, PASSPHRASE);

    expect(isKeyBackupEnvelope(null)).toBe(false);
    expect(isKeyBackupEnvelope("ostrilo-key-backup")).toBe(false);
    expect(isKeyBackupEnvelope({ ...envelope, v: 2 })).toBe(false);
    expect(isKeyBackupEnvelope({ ...envelope, ct: 7 })).toBe(false);
    expect(isKeyBackupEnvelope({ ...envelope, cipher: {} })).toBe(false);
    expect(isKeyBackupEnvelope({ ...envelope, kdf: { alg: "scrypt" } })).toBe(false);
    expect(
      isKeyBackupEnvelope({
        ...envelope,
        kdf: { alg: "pbkdf2-sha256", c: 600_000, salt: envelope.kdf.salt },
      })
    ).toBe(true);
  });
});
