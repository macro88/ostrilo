/** @vitest-environment jsdom */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicRelayEditor } from "@/ui/features/settings/components/PublicRelayEditor";
import { button, click, render, settle, unmountAll } from "../onboarding/dom";
import {
  getRelayList,
  publishRelayList,
  publishStarterList,
} from "@/infrastructure/messaging/client";

vi.mock("@/infrastructure/messaging/client", () => ({
  getRelayList: vi.fn(),
  publishRelayList: vi.fn(),
  publishStarterList: vi.fn(),
}));
const relay = "wss://relay.example";
const list = {
  eventId: "one",
  createdAt: 1,
  droppedCount: 0,
  entries: [
    { url: relay, read: true, write: true, routable: true },
    { url: "wss://localhost", read: true, write: false, routable: false },
  ],
};
function mount() {
  return render(<PublicRelayEditor keyId="key" discovery={[relay]} />)
    .container;
}
afterEach(() => {
  unmountAll();
  vi.resetAllMocks();
});

describe("public relay editor", () => {
  it("shows progress, then a starter action and a replacement warning", async () => {
    vi.mocked(getRelayList).mockResolvedValue({ status: "none" });
    vi.mocked(publishStarterList).mockResolvedValue({
      status: "blocked",
      reason: "unreachable",
    });
    const view = mount();
    expect(view.textContent).toContain("Looking up");
    await settle(() => view.textContent!.includes("Publish starter list"));
    expect(view.textContent).toContain("can replace a list");
    await click(button(view, "Publish starter list"));
    expect(view.textContent).toContain("Some relays did not answer");
  });

  it("refuses unreadable data", async () => {
    vi.mocked(getRelayList).mockResolvedValue({ status: "unreadable" });
    const view = mount();
    await settle(() => view.textContent!.includes("could not read"));
    expect(view.querySelector("select")).toBeNull();
  });

  it("keeps a conflict visible until the newer list is reviewed", async () => {
    vi.mocked(getRelayList).mockResolvedValue({ status: "found", list });
    vi.mocked(publishRelayList).mockResolvedValue({
      status: "changed",
      current: { status: "found", list: { ...list, eventId: "two" } },
    });
    const view = mount();
    await settle(() => view.querySelector("select") !== null);
    expect(view.textContent).toContain("Not used by Ostrilo");
    const marker = view.querySelector("select")!;
    marker.focus();
    expect(document.activeElement).toBe(marker);
    act(() => {
      marker.value = "write";
      marker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const remove = button(view, "Remove public relay wss://localhost");
    remove.focus();
    expect(document.activeElement).toBe(remove);
    await click(remove);
    expect(view.textContent).toContain("Not published");
    await click(button(view, "Publish relay list"));
    expect(view.textContent).toContain("Another app changed this list");
    await click(button(view, "Use latest list"));
    expect(view.textContent).not.toContain("Not published");
    expect(view.textContent).toContain("Not used by Ostrilo");
  });
});
