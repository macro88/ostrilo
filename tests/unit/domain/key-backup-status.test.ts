import { describe, expect, it } from "vitest";
import {
  parseKeyBackupRecord,
  serializeKeyBackupRecord,
} from "@/domain/backup/status";

const ID = "11111111-1111-4111-8111-111111111111";

describe("parseKeyBackupRecord", () => {
  it("round-trips what it serialises", () => {
    const entries = new Map([[ID, { state: "verified" as const, at: 5 }]]);
    expect(parseKeyBackupRecord(serializeKeyBackupRecord(entries))).toEqual(entries);
  });

  it.each([undefined, null, "x", 3, [], {}, { __version: "other", keys: {} }])(
    "reads %j as no record at all",
    (raw) => {
      expect(parseKeyBackupRecord(raw).size).toBe(0);
    }
  );

  it("drops a malformed entry and keeps its neighbours", () => {
    const other = "22222222-2222-4222-8222-222222222222";
    const parsed = parseKeyBackupRecord({
      __version: "keyBackup.v1",
      keys: {
        [ID]: { state: "pending", at: 1 },
        [other]: { state: "done", at: 1 },
        "33333333-3333-4333-8333-333333333333": { state: "verified", at: "now" },
      },
    });
    expect([...parsed.keys()]).toEqual([ID]);
  });

  it("refuses an entry key that is not a key id", () => {
    const raw = JSON.parse(
      '{"__version":"keyBackup.v1","keys":{"__proto__":{"state":"pending","at":1},"constructor":{"state":"pending","at":1}}}'
    );
    expect(parseKeyBackupRecord(raw).size).toBe(0);
  });
});
