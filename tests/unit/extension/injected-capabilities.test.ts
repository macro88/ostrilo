import { afterEach, describe, expect, it, vi } from "vitest";
import { loadInjectedProvider } from "../../helpers/load-injected-provider";
import {
  PROVIDER_METHODS,
  isProviderMethod,
} from "@/domain/nostr/provider-methods";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Provider = {
  capabilities: { methods: string[] };
  [name: string]: unknown;
};

describe("window.nostr.capabilities", () => {
  it("lists exactly the methods the provider implements", async () => {
    const { window } = await loadInjectedProvider();
    const nostr = window.nostr as Provider;

    const implemented = Object.keys(nostr)
      .filter((name) => typeof nostr[name] === "function")
      .sort();

    expect([...nostr.capabilities.methods].sort()).toEqual(implemented);
    expect([...nostr.capabilities.methods]).toEqual([...PROVIDER_METHODS]);
  });

  it("is a bare { methods } object with nothing about the extension in it", async () => {
    const { window } = await loadInjectedProvider();
    const { capabilities } = window.nostr as Provider;

    expect(Object.keys(capabilities)).toEqual(["methods"]);
    expect(Object.getOwnPropertySymbols(capabilities)).toEqual([]);
    expect(capabilities.methods.every((m) => typeof m === "string")).toBe(true);
    expect(JSON.stringify(capabilities)).toBe(
      JSON.stringify({ methods: [...PROVIDER_METHODS] })
    );
  });

  it("does not advertise the encryption namespaces Ostrilo lacks", async () => {
    const { window } = await loadInjectedProvider();
    const nostr = window.nostr as Provider;

    expect(nostr.nip04).toBeUndefined();
    expect(nostr.nip44).toBeUndefined();
    expect(nostr.capabilities.methods).not.toContain("nip04");
    expect(nostr.capabilities.methods).not.toContain("nip44");
  });

  it("is frozen, as is its method list", async () => {
    const { window } = await loadInjectedProvider();
    const { capabilities } = window.nostr as Provider;

    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(Object.isFrozen(capabilities.methods)).toBe(true);
  });

  it("leaves an existing window.nostr, and its lack of capabilities, in place", async () => {
    const existing = { getPublicKey: async () => "other-signer" };
    const { window, warnings } = await loadInjectedProvider(existing);

    expect(window.nostr).toBe(existing);
    expect((window.nostr as Provider).capabilities).toBeUndefined();
    expect(warnings.some((w) => w.includes("already defined"))).toBe(true);
  });
});

describe("building the provider does not run page-patchable code", () => {
  it("is unaffected by a replaced Array iterator", async () => {
    const proto = Array.prototype as unknown as Record<symbol, unknown>;
    const original = proto[Symbol.iterator];
    let iteratorCalls = 0;
    let built: Awaited<ReturnType<typeof loadInjectedProvider>>;

    try {
      built = await loadInjectedProvider(undefined, () => {
        // What a page that ran first could install: an iterator that reports
        // calls and yields nothing.
        proto[Symbol.iterator] = function* () {
          iteratorCalls++;
        };
      });
    } finally {
      proto[Symbol.iterator] = original;
    }

    const nostr = built.window.nostr as Provider;
    expect(iteratorCalls).toBe(0);
    expect([...nostr.capabilities.methods]).toEqual([...PROVIDER_METHODS]);
    expect(Object.isFrozen(nostr.capabilities.methods)).toBe(true);
    for (const name of PROVIDER_METHODS) {
      expect(Object.isFrozen(nostr[name])).toBe(true);
    }
    expect(Object.isFrozen(nostr)).toBe(true);
  });
});

describe("the provider method list", () => {
  it("recognises exactly its own members", () => {
    for (const name of PROVIDER_METHODS) expect(isProviderMethod(name)).toBe(true);
    for (const other of ["nip04", "capabilities", "toString", "", 1, null]) {
      expect(isProviderMethod(other)).toBe(false);
    }
  });
});
