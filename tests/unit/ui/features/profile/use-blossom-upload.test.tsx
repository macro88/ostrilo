/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  useBlossomUpload,
  type BlossomUpload,
} from "@/ui/features/profile/hooks/useBlossomUpload";
import type { UploadDeps, UploadField } from "@/ui/features/profile/blossom-upload.controller";
import { inspectImageHeader } from "@/domain/blossom/image-sniff";
import { bytesToHex } from "@/domain/utils/hex";
import { NobleSha256 } from "@/infrastructure/crypto/adapters";
import { fileHeaderReader } from "@/ui/lib/prepare-image";
import { jpeg } from "../../../../helpers/image-bytes";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const PUBKEY = "ab".repeat(32);
const OTHER = "cd".repeat(32);
const BYTES = jpeg();
const HASH = bytesToHex(NobleSha256.sha256(BYTES));

function descriptorResponse() {
  return new Response(
    JSON.stringify({
      url: `https://blossom.primal.net/${HASH}.jpg`,
      sha256: HASH,
      size: BYTES.length,
    }),
    { status: 201 }
  );
}

let container: HTMLDivElement;
let root: Root;
let latest: BlossomUpload;
let writes: Array<{ field: UploadField; url: string }>;
let confirmed: string[];
let gate: { promise: Promise<void>; open: () => void };

function newGate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

function makeDeps(): UploadDeps {
  return {
    inspect: (file) => inspectImageHeader(fileHeaderReader(file)),
    prepare: async () => {
      await gate.promise;
      return { bytes: BYTES, mime: "image/jpeg", reencoded: true };
    },
    sha256Hex: (bytes) => bytesToHex(NobleSha256.sha256(bytes)),
    authorize: async () => "Nostr dG9rZW4",
    fetch: async () => descriptorResponse(),
    setTimer: (callback, ms) => window.setTimeout(callback, ms),
    clearTimer: (id) => window.clearTimeout(id as number),
  };
}

function Harness({ pubkey, deps }: { pubkey: string | undefined; deps: UploadDeps }) {
  latest = useBlossomUpload({
    pubkey,
    deps,
    onUploaded: (field, url) => writes.push({ field, url }),
    onServerConfirmed: (id) => confirmed.push(id),
  });
  return <output>{latest.state.stage}</output>;
}

const stage = () => container.querySelector("output")?.textContent;
const file = () => new Blob([BYTES.slice()]);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function mount(pubkey: string | undefined, deps: UploadDeps, strict = false) {
  const tree = <Harness pubkey={pubkey} deps={deps} />;
  act(() => root.render(strict ? <StrictMode>{tree}</StrictMode> : tree));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  writes = [];
  confirmed = [];
  gate = newGate();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("useBlossomUpload", () => {
  it("starts idle and walks a file through the dialog to a filled field", async () => {
    gate.open();
    mount(PUBKEY, makeDeps());
    expect(stage()).toBe("idle");

    await act(async () => latest.begin(file(), "picture"));
    expect(stage()).toBe("choosing");

    act(() => latest.confirm("primal"));
    await settle();

    expect(stage()).toBe("done");
    expect(writes).toEqual([
      { field: "picture", url: `https://blossom.primal.net/${HASH}.jpg` },
    ]);
    expect(confirmed).toEqual(["primal"]);
  });

  it("works under StrictMode, which runs each effect, its cleanup and the effect again", async () => {
    gate.open();
    mount(PUBKEY, makeDeps(), true);

    await act(async () => latest.begin(file(), "banner"));
    act(() => latest.confirm("nostr-build"));
    await settle();

    expect(stage()).toBe("done");
    expect(writes.map((w) => w.field)).toEqual(["banner"]);
  });

  it("cancels an upload bound to the previous key when the selected key changes", async () => {
    mount(PUBKEY, makeDeps());
    await act(async () => latest.begin(file(), "picture"));
    act(() => latest.confirm("primal"));
    expect(stage()).toBe("working");

    mount(OTHER, makeDeps());
    gate.open();
    await settle();

    expect(stage()).toBe("idle");
    expect(writes).toEqual([]);
  });

  it("writes nothing and makes no later request once unmounted", async () => {
    const deps = makeDeps();
    const fetchSpy = vi.spyOn(deps, "fetch");
    mount(PUBKEY, deps);
    await act(async () => latest.begin(file(), "picture"));
    act(() => latest.confirm("primal"));

    act(() => root.unmount());
    gate.open();
    await new Promise((r) => setTimeout(r, 0));

    expect(writes).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    root = createRoot(container);
  });

  it("uses the callbacks of the latest render", async () => {
    gate.open();
    const first: string[] = [];
    const second: string[] = [];
    const deps = makeDeps();

    function Swap({ sink }: { sink: string[] }) {
      latest = useBlossomUpload({
        pubkey: PUBKEY,
        deps,
        onUploaded: (_field, url) => sink.push(url),
      });
      return null;
    }

    act(() => root.render(<Swap sink={first} />));
    await act(async () => latest.begin(file(), "picture"));
    act(() => root.render(<Swap sink={second} />));
    act(() => latest.confirm("primal"));
    await settle();

    expect(first).toEqual([]);
    expect(second).toHaveLength(1);
  });

  it("returns stable actions across renders", async () => {
    gate.open();
    mount(PUBKEY, makeDeps());
    const before = { begin: latest.begin, cancel: latest.cancel };

    await act(async () => latest.begin(file(), "picture"));

    expect(latest.begin).toBe(before.begin);
    expect(latest.cancel).toBe(before.cancel);
  });
});
