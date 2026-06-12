/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import {
  AutoLockSlider,
  KeySelectorCard,
  MediumKindToggles,
  RelayList,
  ThemeSelector,
} from "@/ui/features/settings/components/shared";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <select
      aria-label="Theme"
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: ReactNode;
  }) => <option value={value}>{children}</option>,
}));

vi.mock("@/components/ui/slider", () => ({
  Slider: ({
    value,
    onValueChange,
    min = 0,
    max = 100,
    step = 1,
    "aria-label": ariaLabel,
  }: {
    value: number[];
    onValueChange: (value: number[]) => void;
    min?: number;
    max?: number;
    step?: number;
    "aria-label"?: string;
  }) => (
    <input
      aria-label={ariaLabel}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value[0]}
      onChange={(event) =>
        onValueChange([Number(event.currentTarget.value)])
      }
    />
  ),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    "aria-label": ariaLabel,
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    "aria-label"?: string;
  }) => (
    <input
      aria-label={ariaLabel}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
    />
  ),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function render(ui: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(ui);
  });

  mountedRoots.push({ root, container });
  return container;
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function changeInput(input: HTMLInputElement | HTMLSelectElement, value: string) {
  act(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value"
    );
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function changeTextInput(input: HTMLInputElement, value: string) {
  act(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    );
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

afterEach(() => {
  for (const { root, container } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
});

describe("settings shared components", () => {
  it("wires ThemeSelector changes to the caller", () => {
    const onChange = vi.fn();
    const container = render(
      <ThemeSelector value="light" onChange={onChange} />
    );

    changeInput(container.querySelector("select")!, "dark");

    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("formats AutoLockSlider values and emits numeric changes", () => {
    const onChange = vi.fn();
    const container = render(
      <AutoLockSlider value={15} onChange={onChange} />
    );

    expect(container.textContent).toContain("15 min");
    const slider = container.querySelector(
      'input[aria-label="Auto-lock timeout"]'
    ) as HTMLInputElement;
    changeInput(slider, "30");

    expect(onChange).toHaveBeenCalledWith(30);
  });

  it("renders key state and calls selection actions", () => {
    const onSelectKey = vi.fn();
    const container = render(
      <KeySelectorCard
        keys={[
          {
            id: "key-1",
            label: "Main",
            publicKeyBech32: "npub1main000000000000000000000000000000000",
            publicKeyHex: "abc",
          },
          {
            id: "key-2",
            label: "Backup",
            publicKeyBech32: "npub1backup00000000000000000000000000000",
            publicKeyHex: "def",
          },
        ]}
        selectedKeyId="key-1"
        profiles={new Map()}
        onSelectKey={onSelectKey}
      />
    );

    expect(container.textContent).toContain("Main");
    expect(container.textContent).toContain("Active");

    const setActiveButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Set Active");
    expect(setActiveButton).toBeDefined();
    click(setActiveButton!);

    expect(onSelectKey).toHaveBeenCalledWith("key-2");
  });

  it("prevents deleting the last key", () => {
    const container = render(
      <KeySelectorCard
        keys={[
          {
            id: "key-1",
            label: "Main",
            publicKeyBech32: "npub1main000000000000000000000000000000000",
            publicKeyHex: "abc",
          },
        ]}
        selectedKeyId="key-1"
        profiles={new Map()}
        onDelete={vi.fn()}
      />
    );

    const deleteButton = container.querySelector(
      'button[aria-label="Delete Main"]'
    ) as HTMLButtonElement;

    expect(deleteButton.disabled).toBe(true);
  });

  it("validates relay URLs and adds secure relays", () => {
    const onAdd = vi.fn();
    const container = render(
      <RelayList relays={[]} onAdd={onAdd} onRemove={vi.fn()} />
    );
    const input = container.querySelector("input")!;
    const addButton = container.querySelector(
      'button[aria-label="Add relay"]'
    )!;

    changeTextInput(input, "http://relay.example.com");
    click(addButton);

    expect(onAdd).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Relay URL must start with wss://");

    changeTextInput(input, "wss://relay.example.com");
    click(addButton);

    expect(onAdd).toHaveBeenCalledWith("wss://relay.example.com");
  });

  it("labels medium trust toggles by event kind", () => {
    const onToggle = vi.fn();
    const container = render(
      <MediumKindToggles mediumAllowKinds={[1]} onToggle={onToggle} />
    );
    const kindOneToggle = container.querySelector(
      'input[aria-label="Allow kind 1 for medium trust origins"]'
    ) as HTMLInputElement;

    expect(kindOneToggle.checked).toBe(true);
    click(kindOneToggle);

    expect(onToggle).toHaveBeenCalledWith(1, false);
  });
});
