import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CeremonyError } from "@/application/ports/webauthn";
import { BrowserWebAuthnCeremony } from "@/infrastructure/webauthn/webauthn-ceremony.adapter";

/**
 * The ceremony adapter against a stand-in for the browser's WebAuthn API.
 *
 * This proves the shape of what the adapter asks for and what it accepts back.
 * It proves nothing about a real authenticator or a real passkey provider;
 * `openspec/changes/add-biometric-unlock/prf-platform-matrix.md` is where
 * those are measured.
 */

const SALT = new Uint8Array(32).fill(7);
const CREDENTIAL_ID = Uint8Array.from([1, 2, 3, 4]);
const FLAG_UP_UV = 0x05;
const FLAG_BACKUP_ELIGIBLE = 0x08;

class FakePublicKeyCredential {
  static isUserVerifyingPlatformAuthenticatorAvailable = vi.fn(async () => true);
  static getClientCapabilities = vi.fn(
    async (): Promise<Record<string, boolean>> => ({ "extension:prf": true })
  );
  static signalUnknownCredential = vi.fn(async () => undefined);

  rawId = CREDENTIAL_ID.buffer;
  constructor(
    readonly response: unknown,
    private extensionResults: unknown
  ) {}
  getClientExtensionResults() {
    return this.extensionResults;
  }
}

function authenticatorData(flags: number, length = 37): ArrayBuffer {
  const data = new Uint8Array(length);
  if (length > 32) data[32] = flags;
  return data.buffer;
}

function created(flags = FLAG_UP_UV | FLAG_BACKUP_ELIGIBLE, dataLength = 37) {
  return new FakePublicKeyCredential(
    {
      getTransports: () => ["internal", "hybrid"],
      getAuthenticatorData: () => authenticatorData(flags, dataLength),
    },
    { prf: { enabled: true } }
  );
}

function asserted(output: ArrayBuffer | undefined) {
  return new FakePublicKeyCredential(
    {},
    output ? { prf: { results: { first: output } } } : {}
  );
}

const prfBuffer = (length = 32) => new Uint8Array(length).fill(0x5a).buffer;

let create: ReturnType<typeof vi.fn>;
let get: ReturnType<typeof vi.fn>;

beforeEach(() => {
  create = vi.fn(async () => created());
  get = vi.fn(async () => asserted(prfBuffer()));
  vi.stubGlobal("PublicKeyCredential", FakePublicKeyCredential);
  vi.stubGlobal("navigator", { credentials: { create, get } });
  vi.stubGlobal("location", { origin: "chrome-extension://abc" });
  FakePublicKeyCredential.signalUnknownCredential.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebAuthn ceremony adapter", () => {
  describe("enrolment", () => {
    it("creates a credential and then asserts it", async () => {
      const { factor, prfOutput } = await BrowserWebAuthnCeremony.enroll(SALT);

      expect(create).toHaveBeenCalledTimes(1);
      expect(get).toHaveBeenCalledTimes(1);
      expect(factor).toEqual({
        credentialId: [1, 2, 3, 4],
        transports: ["internal", "hybrid"],
        prfSalt: Array.from(SALT),
        backupEligible: true,
      });
      expect(Array.from(prfOutput)).toEqual(new Array(32).fill(0x5a));
    });

    it("asks for user verification, no attestation, and no relying-party id", async () => {
      await BrowserWebAuthnCeremony.enroll(SALT);
      const { publicKey } = create.mock.calls[0][0];

      expect(publicKey.rp).toEqual({ name: "Ostrilo" });
      expect(publicKey.attestation).toBe("none");
      expect(publicKey.authenticatorSelection).toEqual({
        userVerification: "required",
        residentKey: "discouraged",
      });
      expect(publicKey.pubKeyCredParams.map((p: { alg: number }) => p.alg)).toEqual([-7, -257]);
      // PRF is requested, but never evaluated per-credential at creation.
      expect(publicKey.extensions).toEqual({ prf: {} });

      const assertion = get.mock.calls[0][0].publicKey;
      expect(assertion).not.toHaveProperty("rpId");
      expect(assertion.userVerification).toBe("required");
      expect(assertion.allowCredentials).toHaveLength(1);
      expect(Array.from(assertion.extensions.prf.eval.first)).toEqual(Array.from(SALT));
    });

    it("reads the backup-eligible bit from the flags byte", async () => {
      create.mockResolvedValueOnce(created(FLAG_UP_UV));
      const { factor } = await BrowserWebAuthnCeremony.enroll(SALT);
      expect(factor.backupEligible).toBe(false);
    });

    it("does not treat `prf.enabled` as delivery", async () => {
      get.mockResolvedValueOnce(asserted(undefined));

      const failure = await BrowserWebAuthnCeremony.enroll(SALT).catch((e) => e);

      expect(failure).toBeInstanceOf(CeremonyError);
      expect(failure).toMatchObject({ failure: "no_output", entryMayRemain: true });
      expect(FakePublicKeyCredential.signalUnknownCredential).toHaveBeenCalledWith({
        rpId: "chrome-extension://abc",
        credentialId: "AQIDBA",
      });
    });

    it("refuses an output that is not exactly 32 bytes", async () => {
      get.mockResolvedValueOnce(asserted(prfBuffer(31)));
      await expect(BrowserWebAuthnCeremony.enroll(SALT)).rejects.toMatchObject({
        failure: "no_output",
      });
    });

    it("refuses authenticator data too short to hold the flags byte", async () => {
      create.mockResolvedValueOnce(created(FLAG_UP_UV, 32));
      await expect(BrowserWebAuthnCeremony.enroll(SALT)).rejects.toMatchObject({
        failure: "no_output",
        entryMayRemain: true,
      });
      expect(get).not.toHaveBeenCalled();
    });

    it("reports a refused creation as cancelled, with nothing left behind", async () => {
      create.mockRejectedValueOnce(new DOMException("nope", "NotAllowedError"));
      await expect(BrowserWebAuthnCeremony.enroll(SALT)).rejects.toMatchObject({
        failure: "cancelled",
        entryMayRemain: false,
      });
      expect(get).not.toHaveBeenCalled();
    });

    it("says an entry may remain when the assertion after creation is cancelled", async () => {
      get.mockRejectedValueOnce(new DOMException("nope", "NotAllowedError"));
      await expect(BrowserWebAuthnCeremony.enroll(SALT)).rejects.toMatchObject({
        failure: "cancelled",
        entryMayRemain: true,
      });
    });
  });

  describe("assertion", () => {
    const request = {
      credentialId: [1, 2, 3, 4],
      transports: ["internal"],
      prfSalt: Array.from(SALT),
    };

    it("returns an owned copy and clears the buffer the browser returned", async () => {
      const fromBrowser = prfBuffer();
      get.mockResolvedValueOnce(asserted(fromBrowser));

      const output = await BrowserWebAuthnCeremony.assert(request);

      expect(Array.from(output)).toEqual(new Array(32).fill(0x5a));
      expect(output.buffer).not.toBe(fromBrowser);
      expect(new Uint8Array(fromBrowser).every((b) => b === 0)).toBe(true);
    });

    it("reports a dismissed prompt as cancelled", async () => {
      get.mockRejectedValueOnce(new DOMException("nope", "NotAllowedError"));
      await expect(BrowserWebAuthnCeremony.assert(request)).rejects.toMatchObject({
        failure: "cancelled",
      });
    });

    it("reports a null result as cancelled", async () => {
      get.mockResolvedValueOnce(null);
      await expect(BrowserWebAuthnCeremony.assert(request)).rejects.toMatchObject({
        failure: "cancelled",
      });
    });
  });

  describe("capability probe", () => {
    it("is true when the browser reports PRF support", async () => {
      expect(await BrowserWebAuthnCeremony.probe()).toBe(true);
    });

    it("is false when the browser reports no PRF support", async () => {
      FakePublicKeyCredential.getClientCapabilities.mockResolvedValueOnce({
        "extension:prf": false,
      });
      expect(await BrowserWebAuthnCeremony.probe()).toBe(false);
    });

    it("falls back to the platform authenticator check", async () => {
      FakePublicKeyCredential.getClientCapabilities.mockResolvedValueOnce({});
      FakePublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockResolvedValueOnce(
        false
      );
      expect(await BrowserWebAuthnCeremony.probe()).toBe(false);
    });

    it("is false where WebAuthn does not exist", async () => {
      vi.stubGlobal("PublicKeyCredential", undefined);
      expect(await BrowserWebAuthnCeremony.probe()).toBe(false);
    });

    it("is false when the check itself throws", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      FakePublicKeyCredential.getClientCapabilities.mockRejectedValueOnce(new Error("boom"));
      expect(await BrowserWebAuthnCeremony.probe()).toBe(false);
    });
  });
});
