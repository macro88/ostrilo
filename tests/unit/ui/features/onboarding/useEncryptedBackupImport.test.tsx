/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useEncryptedBackupImport,
  type EncryptedBackupImport,
} from "@/ui/features/onboarding/backup/useEncryptedBackupImport";
import {
  BACKUP_DECRYPT_FAILURE_MESSAGE,
  createKeyBackup,
  serializeKeyBackup,
  type KeyBackupPayload,
} from "@/ui/features/backup/key-backup-envelope";
import { render, unmountAll } from "./dom";

const PAYLOAD: KeyBackupPayload = {
  nsec: "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5",
  hex: "67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa",
  name: "Everyday",
};
const PASSPHRASE = "Amber-Lantern-Fjord-3196-heron";

function mountHook(onRecovered: (payload: KeyBackupPayload) => void) {
  const handle: { current: EncryptedBackupImport | null } = { current: null };
  function Probe() {
    handle.current = useEncryptedBackupImport(onRecovered);
    return null;
  }
  render(<Probe />);
  return () => {
    if (!handle.current) throw new Error("hook did not mount");
    return handle.current;
  };
}

async function sealed() {
  return serializeKeyBackup(await createKeyBackup({ ...PAYLOAD }, PASSPHRASE));
}

afterEach(() => {
  unmountAll();
});

describe("encrypted backup import", () => {
  it("leaves files that are not Ostrilo backups to the caller", () => {
    const hook = mountHook(vi.fn());

    let taken = true;
    act(() => {
      taken = hook().offerFile('{"privateKey":"nsec1x"}', "old.json");
    });

    expect(taken).toBe(false);
    expect(hook().fileName).toBe("");
  });

  it("does nothing when asked to unlock before a file is offered", async () => {
    const onRecovered = vi.fn();
    const hook = mountHook(onRecovered);
    act(() => hook().setPassphrase(PASSPHRASE));

    await act(async () => {
      await hook().unlock();
    });

    expect(onRecovered).not.toHaveBeenCalled();
    expect(hook().error).toBe("");
    expect(hook().busy).toBe(false);
  });

  it("hands over the key, then scrubs the payload and its own state", async () => {
    const received: KeyBackupPayload[] = [];
    const seenAtCall: string[] = [];
    const hook = mountHook((payload) => {
      received.push(payload);
      seenAtCall.push(payload.nsec);
    });
    const file = await sealed();
    act(() => {
      hook().offerFile(file, "ostrilo-backup.json");
    });
    act(() => hook().setPassphrase(PASSPHRASE));

    await act(async () => {
      await hook().unlock();
    });

    expect(seenAtCall).toEqual([PAYLOAD.nsec]);
    expect(received[0].nsec).toBe("");
    expect(received[0].hex).toBe("");
    expect(hook().fileName).toBe("");
    expect(hook().passphrase).toBe("");
    expect(hook().error).toBe("");

    await act(async () => {
      await hook().unlock();
    });
    expect(seenAtCall).toHaveLength(1);
  });

  it("reports the uniform failure when the caller cannot take the key", async () => {
    const hook = mountHook(() => {
      throw new TypeError("input detached");
    });
    const file = await sealed();
    act(() => {
      hook().offerFile(file, "ostrilo-backup.json");
    });
    act(() => hook().setPassphrase(PASSPHRASE));

    await act(async () => {
      await hook().unlock();
    });

    expect(hook().error).toBe(BACKUP_DECRYPT_FAILURE_MESSAGE);
    expect(hook().busy).toBe(false);
    expect(hook().fileName).toBe("ostrilo-backup.json");
  });

  it("keeps the file for another attempt after a wrong passphrase", async () => {
    const onRecovered = vi.fn();
    const hook = mountHook(onRecovered);
    const file = await sealed();
    act(() => {
      hook().offerFile(file, "ostrilo-backup.json");
    });
    act(() => hook().setPassphrase("wrong"));
    await act(async () => {
      await hook().unlock();
    });
    expect(hook().error).toBe(BACKUP_DECRYPT_FAILURE_MESSAGE);

    act(() => hook().setPassphrase(PASSPHRASE));
    await act(async () => {
      await hook().unlock();
    });

    expect(onRecovered).toHaveBeenCalledTimes(1);
    expect(hook().error).toBe("");
  });

  it("forgets the file and the passphrase on cancel", async () => {
    const onRecovered = vi.fn();
    const hook = mountHook(onRecovered);
    const file = await sealed();
    act(() => {
      hook().offerFile(file, "ostrilo-backup.json");
    });
    act(() => hook().setPassphrase(PASSPHRASE));

    act(() => hook().cancel());
    await act(async () => {
      await hook().unlock();
    });

    expect(hook().fileName).toBe("");
    expect(hook().passphrase).toBe("");
    expect(onRecovered).not.toHaveBeenCalled();
  });
});
