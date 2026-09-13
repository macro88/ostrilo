/**
 * Loader for the vendored interop vectors.
 *
 * Two jobs, in this order:
 *
 * 1. Re-hash every vector file and compare against the SHA-256 recorded in
 *    `provenance.json`. A vector file that has drifted - edited by hand, munged
 *    by a line-ending filter, or refreshed without re-recording provenance - is
 *    a loud failure rather than a quietly weakened known-answer test.
 * 2. Parse the files into typed vectors. Nothing here touches Ostrilo's crypto,
 *    so the loader cannot mask a defect in the code under test.
 *
 * The suites are hermetic: these are vendored files on disk and no test reaches
 * the network. See `README.md` for the refresh procedure.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VECTOR_DIR = path.dirname(fileURLToPath(import.meta.url));

export interface VectorFileProvenance {
  official: boolean;
  description: string;
  upstream_url: string | null;
  retrieved: string;
  sha256: string;
  vector_count: number;
  notes?: string;
}

interface ProvenanceDocument {
  files: Record<string, VectorFileProvenance>;
}

const provenanceDocument = JSON.parse(
  readFileSync(path.join(VECTOR_DIR, "provenance.json"), "utf8")
) as ProvenanceDocument;

export const provenance = provenanceDocument.files;

/**
 * Read a vendored vector file and assert its recorded checksum.
 *
 * The file is read as raw bytes and hashed before any decoding, so line-ending
 * normalisation is caught too - the BIP-340 file is vendored with its upstream
 * CRLF endings and converting them would change the hash.
 */
export function readVerifiedVectorFile(fileName: string): string {
  const recorded = provenance[fileName];
  if (!recorded) {
    throw new Error(
      `tests/vectors/provenance.json has no entry for "${fileName}". ` +
        `Every vendored vector file must record its upstream source, retrieval date and SHA-256.`
    );
  }

  const filePath = path.join(VECTOR_DIR, fileName);
  const bytes = readFileSync(filePath);
  const actual = createHash("sha256").update(bytes).digest("hex");

  if (actual !== recorded.sha256) {
    throw new Error(
      `Vector file drift detected in tests/vectors/${fileName}.\n` +
        `  recorded sha256: ${recorded.sha256}\n` +
        `  actual sha256:   ${actual}\n` +
        `The vendored vectors no longer match the bytes whose provenance is recorded, so the ` +
        `known-answer tests built on them prove nothing. Restore the file, or refresh it and ` +
        `re-record its provenance following tests/vectors/README.md.`
    );
  }

  return bytes.toString("utf8");
}

// ---------------------------------------------------------------------------
// BIP-340
// ---------------------------------------------------------------------------

export interface Bip340Vector {
  /** Upstream row index, 0-18. */
  index: number;
  /** 32-byte hex secret key, or null for verification-only vectors. */
  secretKey: string | null;
  /** 32-byte hex x-only public key. */
  publicKey: string;
  /** 32-byte hex auxiliary randomness, or null for verification-only vectors. */
  auxRand: string | null;
  /** Hex message. Usually 32 bytes, but vectors 15-18 are 0, 1, 17 and 100 bytes. */
  message: string;
  /** 64-byte hex signature. */
  signature: string;
  /** Whether verification is expected to succeed. */
  expectedValid: boolean;
  /** Upstream comment. For invalid vectors this is the documented reason it fails. */
  comment: string;
  /** True when `message` is exactly 32 bytes, i.e. Nostr-event-id shaped. */
  messageIs32Bytes: boolean;
}

function parseBip340Csv(csv: string): Bip340Vector[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const header = lines.shift();
  const expectedHeader =
    "index,secret key,public key,aux_rand,message,signature,verification result,comment";
  if (header !== expectedHeader) {
    throw new Error(
      `Unexpected BIP-340 vector header.\n  expected: ${expectedHeader}\n  actual:   ${header}`
    );
  }

  return lines.map((line) => {
    // The comment is the last column and may itself contain commas, so only the
    // first seven separators are structural.
    const parts = line.split(",");
    const [index, secretKey, publicKey, auxRand, message, signature, result] =
      parts;
    const comment = parts.slice(7).join(",");

    if (result !== "TRUE" && result !== "FALSE") {
      throw new Error(
        `BIP-340 vector ${index} has a non-boolean verification result: "${result}"`
      );
    }

    return {
      index: Number(index),
      secretKey: secretKey === "" ? null : secretKey.toLowerCase(),
      publicKey: publicKey.toLowerCase(),
      auxRand: auxRand === "" ? null : auxRand.toLowerCase(),
      message: message.toLowerCase(),
      signature: signature.toLowerCase(),
      expectedValid: result === "TRUE",
      comment,
      messageIs32Bytes: message.length === 64,
    };
  });
}

export function loadBip340Vectors(): Bip340Vector[] {
  const fileName = "bip340-schnorr.csv";
  const vectors = parseBip340Csv(readVerifiedVectorFile(fileName));
  const expected = provenance[fileName]!.vector_count;
  if (vectors.length !== expected) {
    throw new Error(
      `Expected ${expected} BIP-340 vectors (per provenance.json) but parsed ${vectors.length}.`
    );
  }
  return vectors;
}

// ---------------------------------------------------------------------------
// NIP-01
// ---------------------------------------------------------------------------

export interface Nip01Event {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface Nip01Attestation {
  implementation: string;
  role: string;
  source: string;
  [key: string]: unknown;
}

export interface Nip01Vector {
  name: string;
  exercises: string;
  event: Nip01Event;
  provenance: {
    class: string;
    /**
     * Distinct named external implementations that published or served this
     * exact event. Recorded honestly: some vectors carry only one.
     */
    distinct_implementations: string[];
    attestations: Nip01Attestation[];
  };
}

interface Nip01Document {
  _count: number;
  vectors: Nip01Vector[];
}

export function loadNip01Vectors(): Nip01Vector[] {
  const fileName = "nip01-events.json";
  const parsed = JSON.parse(
    readVerifiedVectorFile(fileName)
  ) as Nip01Document;
  const expected = provenance[fileName]!.vector_count;
  if (parsed.vectors.length !== expected) {
    throw new Error(
      `Expected ${expected} NIP-01 vectors (per provenance.json) but parsed ${parsed.vectors.length}.`
    );
  }
  return parsed.vectors;
}

// ---------------------------------------------------------------------------
// Shared hex helpers. Deliberately independent of `src/`, so a bug in Ostrilo's
// own hex handling cannot cancel itself out inside an assertion.
// ---------------------------------------------------------------------------

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`Odd-length hex string: "${hex}"`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`Invalid hex string: "${hex}"`);
    }
    out[i] = byte;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
