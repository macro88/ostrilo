/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayList } from "@/ui/features/settings/components/shared";
import {
  byLabel,
  click,
  pressKey,
  render,
  typeInto,
  unmountAll,
} from "./settings-dom";

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

function help(container: HTMLElement) {
  return container.querySelector("#relay-url-help")!;
}

describe("RelayList", () => {
  it("says no relays are configured when the list is empty", () => {
    const container = render(
      <RelayList relays={[]} onAdd={vi.fn()} onRemove={vi.fn()} />
    );

    expect(container.textContent).toContain("No relays configured.");
    expect(container.querySelector('[aria-label="Configured relays"]')).toBeNull();
  });

  it("asks for a URL instead of adding a blank entry", async () => {
    const onAdd = vi.fn();
    const container = render(
      <RelayList relays={[]} onAdd={onAdd} onRemove={vi.fn()} />
    );

    typeInto(byLabel(container, "Relay URL"), "   ");
    await click(byLabel(container, "Add relay"));

    expect(onAdd).not.toHaveBeenCalled();
    expect(help(container).getAttribute("role")).toBe("alert");
    expect(help(container).textContent).toBe("Enter a relay URL before adding it.");
  });

  it.each(["ws://relay.example.com", "wss//relay", "not a url"])(
    "refuses %s with the secure-address message",
    async (url) => {
      const onAdd = vi.fn();
      const container = render(
        <RelayList relays={[]} onAdd={onAdd} onRemove={vi.fn()} />
      );

      typeInto(byLabel(container, "Relay URL"), url);
      await click(byLabel(container, "Add relay"));

      expect(onAdd).not.toHaveBeenCalled();
      expect(help(container).textContent).toBe(
        "Enter a secure relay address: wss://host, with no username or password."
      );
    }
  );

  it("refuses a relay already in the list", async () => {
    const onAdd = vi.fn();
    const container = render(
      <RelayList
        relays={["wss://relay.example.com"]}
        onAdd={onAdd}
        onRemove={vi.fn()}
      />
    );

    typeInto(byLabel(container, "Relay URL"), "wss://relay.example.com");
    await click(byLabel(container, "Add relay"));

    expect(onAdd).not.toHaveBeenCalled();
    expect(help(container).textContent).toBe("That relay is already in the list.");
  });

  it("clears the error as soon as the user edits the address", async () => {
    const container = render(
      <RelayList relays={[]} onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    const input = byLabel<HTMLInputElement>(container, "Relay URL");

    typeInto(input, "ws://relay.example.com");
    await click(byLabel(container, "Add relay"));
    expect(help(container).getAttribute("role")).toBe("alert");

    typeInto(input, "wss://relay.example.com");

    expect(help(container).getAttribute("role")).toBeNull();
    expect(help(container).textContent).toBe(
      "Relays must use secure WebSocket URLs that start with wss://."
    );
  });

  it("adds a trimmed secure relay on Enter and empties the field", () => {
    const onAdd = vi.fn();
    const container = render(
      <RelayList relays={[]} onAdd={onAdd} onRemove={vi.fn()} />
    );
    const input = byLabel<HTMLInputElement>(container, "Relay URL");

    typeInto(input, "  wss://relay.example.com  ");
    pressKey(input, "Enter");

    expect(onAdd).toHaveBeenCalledWith("wss://relay.example.com");
    expect(input.value).toBe("");
  });

  it("removes the relay whose remove button was pressed", async () => {
    const onRemove = vi.fn();
    const container = render(
      <RelayList
        relays={["wss://a.example.com", "wss://b.example.com"]}
        onAdd={vi.fn()}
        onRemove={onRemove}
      />
    );

    await click(byLabel(container, "Remove wss://b.example.com"));

    expect(onRemove).toHaveBeenCalledWith("wss://b.example.com");
  });
});
