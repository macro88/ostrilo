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
  OriginPolicyTable,
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
    disabled,
    onCheckedChange,
    "aria-label": ariaLabel,
    "aria-describedby": ariaDescribedBy,
  }: {
    checked: boolean;
    disabled?: boolean;
    onCheckedChange: (checked: boolean) => void;
    "aria-label"?: string;
    "aria-describedby"?: string;
  }) => (
    <input
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      type="checkbox"
      checked={checked}
      disabled={disabled}
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
    expect(container.textContent).toContain("Enter a secure relay address");

    changeTextInput(input, "ws://relay.example.com");
    click(addButton);

    expect(onAdd).not.toHaveBeenCalled();

    changeTextInput(input, "wss://user:pass@relay.example.com");
    click(addButton);

    expect(onAdd).not.toHaveBeenCalled();

    changeTextInput(input, "wss://relay.example.com");
    click(addButton);

    expect(onAdd).toHaveBeenCalledWith("wss://relay.example.com");
  });

  it("discloses that a single relay sees every identity", () => {
    const single = render(
      <RelayList
        relays={["wss://relay.example.com"]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(single.textContent).toContain(
      "that relay sees every identity this extension looks up"
    );

    const several = render(
      <RelayList
        relays={["wss://relay-a.example.com", "wss://relay-b.example.com"]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(several.textContent).toContain(
      "no single relay sees every identity you hold"
    );
  });

  it("refuses to add more than the configured relay bound", () => {
    const onAdd = vi.fn();
    const relays = Array.from(
      { length: 10 },
      (_, index) => `wss://relay-${index}.example.com`
    );
    const container = render(
      <RelayList relays={relays} onAdd={onAdd} onRemove={vi.fn()} />
    );
    const input = container.querySelector("input")!;
    const addButton = container.querySelector(
      'button[aria-label="Add relay"]'
    )!;

    changeTextInput(input, "wss://relay-11.example.com");
    click(addButton);

    expect(onAdd).not.toHaveBeenCalled();
    expect(container.textContent).toContain("at most 10 relays");
  });

  it("labels medium trust toggles by event kind", () => {
    const onToggle = vi.fn();
    const container = render(
      <MediumKindToggles mediumAllowKinds={[7]} onToggle={onToggle} />
    );
    const kindSevenToggle = container.querySelector(
      'input[aria-label="Allow kind 7 for medium trust origins"]'
    ) as HTMLInputElement;

    expect(kindSevenToggle.checked).toBe(true);
    click(kindSevenToggle);

    expect(onToggle).toHaveBeenCalledWith(7, false);
  });

  it("blocks protected kinds from medium trust auto-allow controls", () => {
    const onToggle = vi.fn();
    const container = render(
      <MediumKindToggles mediumAllowKinds={[1, 9734]} onToggle={onToggle} />
    );
    const kindOneToggle = container.querySelector(
      'input[aria-label="Kind 1 always requires approval"]'
    ) as HTMLInputElement;
    const zapRequestToggle = container.querySelector(
      'input[aria-label="Kind 9734 always requires approval"]'
    ) as HTMLInputElement;

    expect(kindOneToggle.checked).toBe(false);
    expect(kindOneToggle.disabled).toBe(true);
    expect(zapRequestToggle.checked).toBe(false);
    expect(zapRequestToggle.disabled).toBe(true);
    expect(container.textContent).toContain(
      "Short Text Note always requires approval"
    );
    expect(container.textContent).toContain(
      "Zap Request always requires approval"
    );
    expect(container.textContent).toContain("Zap Receipt");

    click(kindOneToggle);

    expect(onToggle).not.toHaveBeenCalled();
  });

  it("shows common per-origin policy kinds with reversible rules", () => {
    const onSetPerKindRule = vi.fn();
    const container = render(
      <OriginPolicyTable
        origins={[
          {
            origin: "https://primal.net",
            trustLevel: "medium",
            rules: { 10002: "allow" },
            updatedAt: 1,
          },
        ]}
        onRemove={vi.fn()}
        onToggleSession={vi.fn()}
        onSetPerKindRule={onSetPerKindRule}
      />
    );

    expect(container.textContent).toContain("Profile Metadata");
    expect(container.textContent).toContain("Contacts");
    expect(container.textContent).toContain("Mute List");
    expect(container.textContent).toContain("Pin List");
    expect(container.textContent).toContain("Relay List");
    expect(container.textContent).toContain("Application Data");

    const relayListRow = container.querySelector(
      '[data-testid="origin-policy-kind-10002"]'
    )!;
    const askButton = Array.from(relayListRow.querySelectorAll("button")).find(
      (button) => button.textContent === "Ask"
    )!;
    click(askButton);

    const denyButton = Array.from(relayListRow.querySelectorAll("button")).find(
      (button) => button.textContent === "Deny"
    )!;
    click(denyButton);

    expect(onSetPerKindRule).toHaveBeenNthCalledWith(
      1,
      "https://primal.net",
      10002,
      "ask"
    );
    expect(onSetPerKindRule).toHaveBeenNthCalledWith(
      2,
      "https://primal.net",
      10002,
      "deny"
    );
  });

  it("does not offer protected kinds as auto-allow policy candidates", () => {
    const container = render(
      <OriginPolicyTable
        origins={[
          {
            origin: "https://primal.net",
            trustLevel: "medium",
            rules: { 1: "allow", 9734: "deny" },
            updatedAt: 1,
          },
        ]}
        onRemove={vi.fn()}
        onToggleSession={vi.fn()}
        onSetPerKindRule={vi.fn()}
      />
    );

    const shortTextRow = container.querySelector(
      '[data-testid="origin-policy-kind-1"]'
    )!;
    const zapRequestRow = container.querySelector(
      '[data-testid="origin-policy-kind-9734"]'
    )!;

    expect(shortTextRow.textContent).toContain(
      "Always requires approval before signing"
    );
    expect(zapRequestRow.textContent).toContain(
      "Always requires approval before signing"
    );
    expect(
      Array.from(shortTextRow.querySelectorAll("button")).map(
        (button) => button.textContent
      )
    ).toEqual(["Ask", "Deny"]);
    expect(
      Array.from(zapRequestRow.querySelectorAll("button")).map(
        (button) => button.textContent
      )
    ).toEqual(["Ask", "Deny"]);
  });

  describe("effective decisions", () => {
    function pressed(row: Element, label: string): string | null {
      const button = Array.from(row.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === label
      );
      return button?.getAttribute("aria-pressed") ?? null;
    }

    it("does not show a trust-allowed kind as Ask", () => {
      const container = render(
        <OriginPolicyTable
          origins={[
            {
              origin: "https://primal.net",
              trustLevel: "medium",
              rules: {},
              updatedAt: 1,
            },
          ]}
          mediumAllowKinds={[6, 16, 7, 10002]}
          onRemove={vi.fn()}
          onToggleSession={vi.fn()}
          onSetPerKindRule={vi.fn()}
        />
      );

      const reactionRow = container.querySelector(
        '[data-testid="origin-policy-kind-7"]'
      )!;
      expect(pressed(reactionRow, "Allow")).toBe("true");
      expect(pressed(reactionRow, "Ask")).toBe("false");
      expect(reactionRow.textContent).toContain("this site's trust level");
    });

    it("shows a kind outside the high-trust allowlist as Ask", () => {
      const container = render(
        <OriginPolicyTable
          origins={[
            {
              origin: "https://primal.net",
              trustLevel: "high",
              rules: {},
              updatedAt: 1,
            },
          ]}
          onRemove={vi.fn()}
          onToggleSession={vi.fn()}
          onSetPerKindRule={vi.fn()}
        />
      );

      // Kind 0 is profile metadata: sensitive, reversible, and deliberately
      // absent from every trust allowlist.
      const profileRow = container.querySelector(
        '[data-testid="origin-policy-kind-0"]'
      )!;
      expect(pressed(profileRow, "Ask")).toBe("true");
      expect(profileRow.textContent).toContain("Asks every time");
    });

    it("never shows a stored allow on a protected kind as active auto-allow", () => {
      const container = render(
        <OriginPolicyTable
          origins={[
            {
              origin: "https://primal.net",
              trustLevel: "high",
              rules: { 1: "allow", 27235: "allow" },
              updatedAt: 1,
            },
          ]}
          onRemove={vi.fn()}
          onToggleSession={vi.fn()}
          onSetPerKindRule={vi.fn()}
        />
      );

      for (const kind of [1, 27235]) {
        const row = container.querySelector(
          `[data-testid="origin-policy-kind-${kind}"]`
        )!;
        expect(pressed(row, "Ask")).toBe("true");
        expect(row.textContent).toContain(
          "Always requires approval before signing"
        );
        expect(
          Array.from(row.querySelectorAll("button")).map(
            (button) => button.textContent
          )
        ).not.toContain("Allow");
      }
    });

    it("shows an explicit deny as denied and names the rule as its source", () => {
      const container = render(
        <OriginPolicyTable
          origins={[
            {
              origin: "https://primal.net",
              trustLevel: "high",
              rules: { 7: "deny" },
              updatedAt: 1,
            },
          ]}
          onRemove={vi.fn()}
          onToggleSession={vi.fn()}
          onSetPerKindRule={vi.fn()}
        />
      );

      const reactionRow = container.querySelector(
        '[data-testid="origin-policy-kind-7"]'
      )!;
      expect(pressed(reactionRow, "Deny")).toBe("true");
      expect(reactionRow.textContent).toContain("a rule you set");
    });

    it("shows the untrusted fallback for a record with no usable trust level", () => {
      const container = render(
        <OriginPolicyTable
          origins={[
            {
              origin: "https://primal.net",
              rules: {},
              updatedAt: 1,
            } as never,
          ]}
          onRemove={vi.fn()}
          onToggleSession={vi.fn()}
          onSetPerKindRule={vi.fn()}
        />
      );

      const reactionRow = container.querySelector(
        '[data-testid="origin-policy-kind-7"]'
      )!;
      expect(pressed(reactionRow, "Ask")).toBe("true");
    });
  });

  describe("trust level control", () => {
    it("exposes a trust control and reports what each level permits", () => {
      const onUpdateTrust = vi.fn();
      const container = render(
        <OriginPolicyTable
          origins={[
            {
              origin: "https://primal.net",
              trustLevel: "high",
              rules: { 5: "deny" },
              updatedAt: 1,
            },
          ]}
          onUpdateTrust={onUpdateTrust}
          onRemove={vi.fn()}
          onToggleSession={vi.fn()}
          onSetPerKindRule={vi.fn()}
        />
      );

      const trustRow = container.querySelector(
        '[data-testid="origin-trust-https://primal.net"]'
      )!;
      const buttons = Array.from(trustRow.querySelectorAll("button"));
      expect(buttons.map((button) => button.textContent)).toEqual([
        "Low",
        "Medium",
        "High",
      ]);
      // "High" must not read as "signs anything".
      expect(trustRow.textContent).toContain("Everything else still asks");

      const low = buttons.find((button) => button.textContent === "Low")!;
      click(low);
      expect(onUpdateTrust).toHaveBeenCalledWith("https://primal.net", "low");
    });

    it("hides the trust control when no handler is supplied", () => {
      const container = render(
        <OriginPolicyTable
          origins={[
            {
              origin: "https://primal.net",
              trustLevel: "high",
              rules: {},
              updatedAt: 1,
            },
          ]}
          onRemove={vi.fn()}
          onToggleSession={vi.fn()}
          onSetPerKindRule={vi.fn()}
        />
      );

      expect(
        container.querySelector('[data-testid="origin-trust-https://primal.net"]')
      ).toBeNull();
    });
  });
});
