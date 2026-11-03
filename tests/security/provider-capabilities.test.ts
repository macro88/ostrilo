import { afterEach, describe, expect, it, vi } from "vitest";
import { loadInjectedProvider } from "../helpers/load-injected-provider";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Provider = {
  capabilities: { methods: string[] };
  getPublicKey: unknown;
  signEvent: unknown;
};

/**
 * `capabilities` is read by dApps to decide what to call. A page that could
 * rewrite it could make another script believe the signer supports a method it
 * does not, or hide one it does. It must be as immutable as the methods beside
 * it, and adding it must not loosen the protections those already have.
 */
describe("a page cannot alter window.nostr.capabilities", () => {
  it("cannot reassign, redefine or delete it", async () => {
    const { window } = await loadInjectedProvider();
    const nostr = window.nostr as Provider;
    const original = nostr.capabilities;

    expect(Reflect.set(nostr, "capabilities", { methods: ["nip44"] })).toBe(false);
    expect(
      Reflect.defineProperty(nostr, "capabilities", { value: { methods: [] } })
    ).toBe(false);
    expect(Reflect.deleteProperty(nostr, "capabilities")).toBe(false);

    expect(nostr.capabilities).toBe(original);
  });

  it("cannot reassign, redefine or delete the methods list", async () => {
    const { window } = await loadInjectedProvider();
    const { capabilities } = window.nostr as Provider;

    expect(Reflect.set(capabilities, "methods", ["nip44"])).toBe(false);
    expect(
      Reflect.defineProperty(capabilities, "methods", { value: [] })
    ).toBe(false);
    expect(Reflect.deleteProperty(capabilities, "methods")).toBe(false);
    expect(capabilities.methods).toEqual(["getPublicKey", "signEvent"]);
  });

  it("cannot add, remove or overwrite entries in the methods list", async () => {
    const { window } = await loadInjectedProvider();
    const { methods } = (window.nostr as Provider).capabilities;

    expect(() => methods.push("nip44")).toThrow(TypeError);
    expect(() => methods.pop()).toThrow(TypeError);
    expect(() => {
      "use strict";
      methods[0] = "nip44";
    }).toThrow(TypeError);
    expect(Reflect.set(methods, "length", 0)).toBe(false);
    expect(methods).toEqual(["getPublicKey", "signEvent"]);
  });

  it("cannot add properties to capabilities", async () => {
    const { window } = await loadInjectedProvider();
    const { capabilities } = window.nostr as Provider;

    expect(Reflect.set(capabilities, "version", "1.0.0")).toBe(false);
    expect(Object.isExtensible(capabilities)).toBe(false);
  });
});

describe("existing provider protections still hold", () => {
  it("keeps window.nostr non-writable and non-configurable", async () => {
    const { window } = await loadInjectedProvider();
    const descriptor = Object.getOwnPropertyDescriptor(window, "nostr");

    expect(descriptor?.writable).toBe(false);
    expect(descriptor?.configurable).toBe(false);
    expect(Reflect.deleteProperty(window, "nostr")).toBe(false);
  });

  it("keeps the provider and its methods frozen", async () => {
    const { window } = await loadInjectedProvider();
    const nostr = window.nostr as Provider;
    const signEvent = nostr.signEvent;

    expect(Object.isFrozen(nostr)).toBe(true);
    expect(Object.isFrozen(nostr.getPublicKey)).toBe(true);
    expect(Object.isFrozen(nostr.signEvent)).toBe(true);
    expect(Reflect.set(nostr, "signEvent", () => {})).toBe(false);
    expect(nostr.signEvent).toBe(signEvent);
  });
});
