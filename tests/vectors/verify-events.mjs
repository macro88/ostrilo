// Independent, non-circular verification for NIP-01 event vectors.
//
// Recomputes each event id and verifies each signature using @noble directly,
// NOT Ostrilo's own crypto. That matters: selecting vectors with the same code
// the vectors are meant to test would be circular, and would happily bless a
// wrong-but-self-consistent implementation.
//
// Usage, from the repo root:
//   node tests/vectors/verify-events.mjs tests/vectors/nip01-events.json
//
// Every event must print "id: OK  sig: OK" before it is accepted as a vector.
// See README.md for the full refresh and checksum procedure.
import { readFileSync } from "node:fs";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";

const hex = (u8) =>
  Array.from(u8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const unhex = (s) => Uint8Array.from(Buffer.from(s, "hex"));

export function check(e) {
  const ser = JSON.stringify([
    0,
    e.pubkey,
    e.created_at,
    e.kind,
    e.tags,
    e.content,
  ]);
  const id = hex(sha256(new TextEncoder().encode(ser)));
  const idOk = id === e.id;
  let sigOk = false;
  try {
    sigOk = schnorr.verify(unhex(e.sig), unhex(e.id), unhex(e.pubkey));
  } catch {}
  return { idOk, sigOk, computed: id };
}

if (process.argv[2]) {
  const data = JSON.parse(readFileSync(process.argv[2], "utf8"));
  // Accepts: a bare array of events, { vectors: [{ event, ... }] }, or an
  // object whose values carry an `event` field.
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data.vectors)
      ? data.vectors
      : Object.values(data);
  const events = rows
    .map((r) => (r && typeof r === "object" && r.event ? r.event : r))
    .filter((e) => e && typeof e === "object" && e.id && e.sig);

  if (events.length === 0) {
    console.error(
      "No events found. Expected an array, or an object whose values carry an `event` field."
    );
    process.exit(1);
  }

  let bad = 0;
  for (const e of events) {
    const r = check(e);
    if (!r.idOk || !r.sigOk) bad++;
    console.log(
      e.id.slice(0, 16),
      "kind",
      String(e.kind).padStart(5),
      "id:",
      r.idOk ? "OK " : "BAD",
      "sig:",
      r.sigOk ? "OK " : "BAD",
      r.idOk ? "" : "computed=" + r.computed
    );
  }

  console.log(`\n${events.length - bad}/${events.length} verified`);
  // Exit non-zero on any failure so this cannot silently "pass" in a pipeline.
  process.exit(bad === 0 ? 0 : 1);
}
