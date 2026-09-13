/**
 * Entropy coverage for key generation.
 *
 * There is no test that proves a generator is random. This file therefore
 * splits into three parts of very different strength, and each part says
 * which it is:
 *
 *   Part A - Known-answer tests for the deterministic part (PBKDF2).
 *            These are real proofs of correctness. Expected values were
 *            produced by OpenSSL through Node's `crypto.pbkdf2Sync`, an
 *            implementation entirely independent of the code under test,
 *            and are hard-coded below.
 *
 *   Part B - Source assertions for the non-deterministic part. These prove
 *            that generated key material comes from the platform CSPRNG and
 *            that there is no fallback when the CSPRNG is unavailable. This
 *            is what actually catches production code that stops using
 *            `crypto.getRandomValues`.
 *
 *   Part C - A statistical smoke check, explicitly bounded.
 *
 * WHAT PART C CANNOT DO. A monobit count and a byte-frequency chi-square
 * pass for any competent stream cipher and for plenty of broken generators;
 * AES in counter mode with a key the attacker knows passes both perfectly.
 * These checks detect gross breakage only: a constant byte, a short
 * repeating pattern, truncated entropy, a stuck bit, or an over-uniform
 * source such as a byte counter. This is a smoke alarm, not a proof, and it
 * must never be described as verifying entropy quality. The protection
 * against a swapped source is Part B; Part C is the backstop for the case
 * where the platform entry point itself returns garbage.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  generatePrivateKey,
  deriveKeyFromPassword,
} from "@/domain/utils/crypto";
import { KeyVaultService } from "@/application/services/key-vault.service";
import {
  WebCryptoAesGcm,
  NoblePbkdf2,
  NobleSchnorr,
} from "@/infrastructure/crypto/adapters";
import type { StorageSuite } from "@/application/ports/storage";
import type { SecretBytes } from "@/application/ports/crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMemoryStorage(): StorageSuite {
  const make = (m: Map<string, unknown>) => ({
    async get<T>(key: string): Promise<T | undefined> {
      return m.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T): Promise<void> {
      m.set(key, value);
    },
    async remove(key: string): Promise<void> {
      m.delete(key);
    },
  });
  return {
    local: make(new Map()),
    sync: make(new Map()),
    session: make(new Map()),
  };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): SecretBytes {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Part A - Known-answer tests for PBKDF2 (a real proof of correctness)
// ---------------------------------------------------------------------------

/**
 * PBKDF2-HMAC-SHA256, c = 100,000, dkLen = 32 - the parameters both
 * `NoblePbkdf2.deriveKey` and `deriveKeyFromPassword` hard-code.
 *
 * Each expected value was computed once with OpenSSL, not with the function
 * under test. Reproduce with:
 *
 *   node -e 'const c=require("node:crypto");
 *     console.log(c.pbkdf2Sync(Buffer.from(PASSWORD,"utf8"),
 *       Buffer.from(SALT_HEX,"hex"), 100000, 32, "sha256").toString("hex"))'
 *
 * A change to the algorithm, the iteration count, the derived length, or the
 * password encoding turns these red.
 */
const PBKDF2_VECTORS = [
  {
    name: "ascii password, binary salt",
    password: "correct horse battery staple",
    saltHex: "000102030405060708090a0b0c0d0e0f",
    expectedHex:
      "49d49c25f597846209f0d92e7770ab64e1c75e94b4ce6c509265ee67175d2a1e",
  },
  {
    name: "ascii password, ascii salt",
    password: "ostrilo-kat-password",
    saltHex: "6f737472696c6f2d6b61742d73616c742d31",
    expectedHex:
      "38352638d7ef001b0b7e679e63b37b226b46fa234742b3f281158be5db5446a6",
  },
  {
    name: "non-ascii password (pins UTF-8 encoding of the password)",
    password: "pässwörd-🔐",
    saltHex: "fffefdfcfbfaf9f8f7f6f5f4f3f2f1f0",
    expectedHex:
      "ec45e1c54f028850a91ff6396d5f3d59849cd2151f0bd6e8a2aabf26985d724c",
  },
] as const;

describe("Entropy - Part A: PBKDF2 known-answer tests", () => {
  for (const vector of PBKDF2_VECTORS) {
    it(`NoblePbkdf2.deriveKey reproduces the OpenSSL value: ${vector.name}`, async () => {
      const derived = await NoblePbkdf2.deriveKey(
        vector.password,
        fromHex(vector.saltHex)
      );
      expect(derived).toHaveLength(32);
      expect(toHex(derived)).toBe(vector.expectedHex);
    });

    it(`deriveKeyFromPassword reproduces the OpenSSL value: ${vector.name}`, async () => {
      const derived = await deriveKeyFromPassword(
        vector.password,
        fromHex(vector.saltHex)
      );
      expect(derived).toHaveLength(32);
      expect(toHex(derived)).toBe(vector.expectedHex);
    });
  }

  it("the two derivation paths agree byte for byte", async () => {
    const salt = fromHex(PBKDF2_VECTORS[0].saltHex);
    const viaPort = await NoblePbkdf2.deriveKey("shared-password", salt);
    const viaDomain = await deriveKeyFromPassword("shared-password", salt);
    expect(toHex(viaPort)).toBe(toHex(viaDomain));
  });
});

// ---------------------------------------------------------------------------
// Part B - Source assertions (what actually catches an RNG swap)
// ---------------------------------------------------------------------------

interface PlatformDraw {
  requestedBytes: number;
  returnedBytes: Uint8Array;
}

/**
 * Observes the platform CSPRNG without replacing it: every call is forwarded
 * to the real `crypto.getRandomValues`, and the bytes it produced are
 * snapshotted so the test can compare them with what the code under test
 * ultimately returns. The unit under test is never mocked.
 */
function observePlatformCsprng(): PlatformDraw[] {
  const draws: PlatformDraw[] = [];
  const platform = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((<
    T extends ArrayBufferView | null
  >(
    array: T
  ): T => {
    const filled = platform(array as never) as T;
    if (ArrayBuffer.isView(filled)) {
      draws.push({
        requestedBytes: filled.byteLength,
        returnedBytes: new Uint8Array(
          filled.buffer as ArrayBuffer,
          filled.byteOffset,
          filled.byteLength
        ).slice(),
      });
    }
    return filled;
  }) as typeof globalThis.crypto.getRandomValues);
  return draws;
}

/** A `crypto` object that has everything except the CSPRNG entry point. */
function cryptoWithoutGetRandomValues(): Crypto {
  const real = globalThis.crypto;
  return {
    subtle: real.subtle,
    randomUUID: real.randomUUID?.bind(real),
  } as unknown as Crypto;
}

describe("Entropy - Part B: key material comes from the platform CSPRNG", () => {
  it("generatePrivateKey requests exactly 32 bytes and returns them unmodified", () => {
    const draws = observePlatformCsprng();

    const key = generatePrivateKey();

    expect(draws).toHaveLength(1);
    expect(draws[0].requestedBytes).toBe(32);
    expect(key).toHaveLength(32);
    // The key IS the platform's bytes. A post-processing step, a counter, or
    // a second source would break this equality.
    expect(toHex(key)).toBe(toHex(draws[0].returnedBytes));
  });

  it("generatePrivateKey never touches Math.random", () => {
    const mathRandom = vi.spyOn(Math, "random");
    generatePrivateKey();
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it("KeyVaultService.generateKey draws its private key from the 32-byte CSPRNG request", async () => {
    const vault = new KeyVaultService(
      createMemoryStorage(),
      WebCryptoAesGcm,
      NoblePbkdf2,
      NobleSchnorr
    );
    const draws = observePlatformCsprng();

    const record = await vault.generateKey("entropy-source-password", "src");

    // Every draw in this path goes through the one platform entry point: the
    // 32-byte private key, the 16-byte PBKDF2 salt and the 12-byte AES-GCM IV
    // from encryptPrivateKey, plus a 16-byte scalar-blinding draw that
    // @noble/curves takes inside getPublicKey. Assert the sizes that carry
    // meaning rather than an exact sequence, so an added or removed incidental
    // draw elsewhere in the path cannot break this for a non-entropy reason.
    const sizes = draws.map((draw) => draw.requestedBytes);
    expect(sizes).toContain(16); // PBKDF2 salt
    expect(sizes).toContain(12); // AES-GCM IV

    // The real invariant: exactly one 32-byte request, and the key that was
    // stored is the bytes the platform returned for it. Deriving the public
    // key from those bytes has to reproduce the stored pubkey.
    const keyDraws = draws.filter((draw) => draw.requestedBytes === 32);
    expect(
      keyDraws,
      "KeyVaultService.generateKey must take its private key from a single " +
        "32-byte crypto.getRandomValues request"
    ).toHaveLength(1);
    const expectedPubkey = toHex(
      schnorr.getPublicKey(keyDraws[0].returnedBytes)
    );
    expect(record.pubkey).toBe(expectedPubkey);
  });

  it("generatePrivateKey throws when crypto.getRandomValues is missing, with no fallback", () => {
    vi.stubGlobal("crypto", cryptoWithoutGetRandomValues());
    const mathRandom = vi.spyOn(Math, "random");

    expect(() => generatePrivateKey()).toThrow(
      /crypto\.getRandomValues must be defined/
    );
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it("generatePrivateKey throws when globalThis.crypto is absent entirely", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => generatePrivateKey()).toThrow();
  });

  it("KeyVaultService.generateKey rejects when crypto.getRandomValues is missing, and stores nothing", async () => {
    const storage = createMemoryStorage();
    const vault = new KeyVaultService(
      storage,
      WebCryptoAesGcm,
      NoblePbkdf2,
      NobleSchnorr
    );
    vi.stubGlobal("crypto", cryptoWithoutGetRandomValues());
    const mathRandom = vi.spyOn(Math, "random");

    await expect(
      vault.generateKey("no-csprng-password", "should not exist")
    ).rejects.toThrow();

    expect(mathRandom).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    expect(await vault.listKeys()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Part C - Statistical smoke check, explicitly bounded
// ---------------------------------------------------------------------------

/*
 * SAMPLE SIZE AND THRESHOLDS - the arithmetic, once, here.
 *
 *   keys                4,000 drawn from generatePrivateKey()
 *   bytes               4,000 x 32          = 128,000
 *   bits                128,000 x 8         = 1,024,000
 *
 * Monobit (count of one bits), two-sided:
 *   mean                1,024,000 / 2       = 512,000
 *   sd                  sqrt(1,024,000 x 0.25) = 505.96
 *   threshold           5 sd, rounded up    = 2,530
 *   false-failure p     erfc(5 / sqrt 2)    = 5.7e-7  (~6 in 10,000,000)
 *
 * Byte-frequency chi-square, 256 buckets, 255 degrees of freedom, expected
 * count 500 per bucket, TWO-SIDED:
 *   upper threshold     385   -> upper-tail p = 2.5e-7
 *   lower threshold     157   -> lower-tail p = 2.4e-7
 *
 * The lower bound is not decoration. A byte-wise monotonic counter produces a
 * perfectly flat histogram - chi-square 0.000 - and exactly 50% one bits, so
 * it passes the monobit test and the usual one-sided chi-square test. Real
 * randomness is never that uniform, and the lower bound is what catches it.
 *
 * Combined false-failure probability for the whole check:
 *   5.7e-7 + 2.5e-7 + 2.4e-7 = 1.1e-6, roughly 1 in 1,000,000.
 *
 * Tail probabilities were computed from the regularized incomplete gamma
 * function; reproduce them with any chi-square CDF at df = 255.
 *
 * Operational rule: a lone statistical failure is re-run once before it is
 * investigated as a defect. Two failures in a row are not chance.
 *
 * The draw goes through generatePrivateKey() only, never through
 * KeyVaultService.generateKey, whose 100,000-iteration PBKDF2 would make a
 * 4,000-iteration loop unusable. Measured cost of the draw: ~5 ms.
 */
const KEYS_IN_SAMPLE = 4_000;
const SAMPLE_BYTES = KEYS_IN_SAMPLE * 32; // 128,000
const SAMPLE_BITS = SAMPLE_BYTES * 8; // 1,024,000
const MONOBIT_MEAN = SAMPLE_BITS / 2; // 512,000
const MONOBIT_TOLERANCE = 2_530; // ceil(5 * 505.96)
const CHI_SQUARE_UPPER = 385;
const CHI_SQUARE_LOWER = 157;

interface EntropySmokeResult {
  onesCount: number;
  onesDelta: number;
  chiSquare: number;
  failures: string[];
}

/**
 * Pure function over a byte array so the check itself can be tested against
 * known-bad input. Takes bytes, returns a verdict; no globals, no I/O.
 */
function entropySmokeCheck(bytes: Uint8Array): EntropySmokeResult {
  if (bytes.length !== SAMPLE_BYTES) {
    throw new Error(
      `entropySmokeCheck expects exactly ${SAMPLE_BYTES} bytes (the size the ` +
        `thresholds were computed for), got ${bytes.length}`
    );
  }

  let onesCount = 0;
  const histogram = new Uint32Array(256);
  for (let i = 0; i < bytes.length; i++) {
    const value = bytes[i];
    histogram[value]++;
    let bits = value;
    while (bits) {
      onesCount += bits & 1;
      bits >>= 1;
    }
  }

  const expectedPerByte = bytes.length / 256;
  let chiSquare = 0;
  for (let value = 0; value < 256; value++) {
    const deviation = histogram[value] - expectedPerByte;
    chiSquare += (deviation * deviation) / expectedPerByte;
  }

  const onesDelta = onesCount - MONOBIT_MEAN;
  const failures: string[] = [];
  if (Math.abs(onesDelta) > MONOBIT_TOLERANCE) {
    failures.push(
      `monobit: ${onesCount} one bits, ${onesDelta} from the expected ` +
        `${MONOBIT_MEAN}, outside the +/-${MONOBIT_TOLERANCE} (5 sigma) band`
    );
  }
  if (chiSquare > CHI_SQUARE_UPPER) {
    failures.push(
      `byte-frequency chi-square ${chiSquare.toFixed(2)} above ` +
        `${CHI_SQUARE_UPPER}: the byte distribution is too lumpy`
    );
  }
  if (chiSquare < CHI_SQUARE_LOWER) {
    failures.push(
      `byte-frequency chi-square ${chiSquare.toFixed(2)} below ` +
        `${CHI_SQUARE_LOWER}: the byte distribution is too flat to be random`
    );
  }

  return { onesCount, onesDelta, chiSquare, failures };
}

function drawSampleFromGeneratePrivateKey(): Uint8Array<ArrayBuffer> {
  const sample = new Uint8Array(SAMPLE_BYTES);
  for (let i = 0; i < KEYS_IN_SAMPLE; i++) {
    sample.set(generatePrivateKey(), i * 32);
  }
  return sample;
}

/**
 * Replaces the platform CSPRNG with a deliberately broken filler, then draws
 * the sample through the real `generatePrivateKey()`. Nothing about the code
 * under test is mocked - only the platform source beneath it.
 */
function drawWithBrokenSource(
  fill: (array: Uint8Array, callIndex: number) => void
): Uint8Array<ArrayBuffer> {
  let callIndex = 0;
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((<
    T extends ArrayBufferView | null
  >(
    array: T
  ): T => {
    if (ArrayBuffer.isView(array)) {
      fill(
        new Uint8Array(
          array.buffer as ArrayBuffer,
          array.byteOffset,
          array.byteLength
        ),
        callIndex++
      );
    }
    return array;
  }) as typeof globalThis.crypto.getRandomValues);
  return drawSampleFromGeneratePrivateKey();
}

describe("Entropy - Part C: statistical smoke check", () => {
  it("real generatePrivateKey output passes the monobit and chi-square bands", () => {
    // 4,000 keys = 128,000 bytes = 1,024,000 bits.
    // Monobit band 512,000 +/- 2,530 (5 sigma, false-failure p = 5.7e-7).
    // Chi-square band [157, 385] at df = 255 (false-failure p = 4.9e-7).
    // Combined false-failure probability ~1.1e-6, roughly 1 in 1,000,000.
    // This is a smoke check for gross breakage. It does NOT prove randomness
    // quality, and no reader should treat a pass as evidence that it does.
    const result = entropySmokeCheck(drawSampleFromGeneratePrivateKey());
    expect(result.failures).toEqual([]);
  });

  it("rejects a constant byte", () => {
    const result = entropySmokeCheck(new Uint8Array(SAMPLE_BYTES).fill(0xab));
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures.join(" ")).toMatch(/too lumpy/);
  });

  it("rejects a short repeating pattern", () => {
    const pattern = [0xde, 0xad, 0xbe, 0xef];
    const sample = new Uint8Array(SAMPLE_BYTES);
    for (let i = 0; i < sample.length; i++) sample[i] = pattern[i % 4];
    const result = entropySmokeCheck(sample);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures.join(" ")).toMatch(/too lumpy/);
  });

  it("rejects a stuck bit", () => {
    // Real entropy with the high bit of every byte forced to zero: the byte
    // histogram alone is badly skewed and the one-bit count collapses.
    const sample = drawSampleFromGeneratePrivateKey();
    for (let i = 0; i < sample.length; i++) sample[i] &= 0x7f;
    const result = entropySmokeCheck(sample);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures.join(" ")).toMatch(/monobit/);
  });

  it("rejects a byte-wise monotonic counter drawn through generatePrivateKey", () => {
    // The adversarial case for this check: a counter that cycles 0..255 has
    // exactly 50% one bits and a perfectly flat histogram. Only the lower
    // chi-square bound catches it.
    let next = 0;
    const sample = drawWithBrokenSource((array) => {
      for (let i = 0; i < array.length; i++) array[i] = next++ & 0xff;
    });

    const result = entropySmokeCheck(sample);
    expect(Math.abs(result.onesDelta)).toBeLessThanOrEqual(MONOBIT_TOLERANCE);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures.join(" ")).toMatch(/too flat to be random/);
  });

  it("rejects a big-endian 32-byte counter drawn through generatePrivateKey", () => {
    const sample = drawWithBrokenSource((array, callIndex) => {
      array.fill(0);
      let value = callIndex + 1;
      for (let i = array.length - 1; i >= 0 && value > 0; i--) {
        array[i] = value & 0xff;
        value >>>= 8;
      }
    });

    const result = entropySmokeCheck(sample);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures.join(" ")).toMatch(/monobit/);
    expect(result.failures.join(" ")).toMatch(/too lumpy/);
  });

  it("refuses to run on a sample of the wrong size", () => {
    // The thresholds are tied to the sample size; a silently resized sample
    // would quietly invalidate them.
    expect(() => entropySmokeCheck(new Uint8Array(1024))).toThrow(
      /expects exactly 128000 bytes/
    );
  });
});
