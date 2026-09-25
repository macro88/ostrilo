import { useEffect, useRef, type ReactNode } from "react";
import { act } from "react";
import { expect } from "vitest";

/**
 * Stand-ins for the Radix Select and Slider, which need layout and pointer
 * capture jsdom does not provide. A native range fires `input` on each drag
 * step and `change` on release, the same split Radix draws between
 * `onValueChange` and `onValueCommit`.
 */
export const selectModule = {
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
      aria-label="native select stand-in"
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
};

function NativeSlider({
  value,
  onValueChange,
  onValueCommit,
  min = 0,
  max = 100,
  step = 1,
  "aria-label": ariaLabel,
}: {
  value: number[];
  onValueChange: (value: number[]) => void;
  onValueCommit?: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  "aria-label"?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = ref.current;
    if (!input || !onValueCommit) return;
    const commit = () => onValueCommit([Number(input.value)]);
    input.addEventListener("change", commit);
    return () => input.removeEventListener("change", commit);
  }, [onValueCommit]);

  return (
    <input
      ref={ref}
      aria-label={ariaLabel}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value[0]}
      onChange={(event) => onValueChange([Number(event.currentTarget.value)])}
    />
  );
}

export const sliderModule = { Slider: NativeSlider };

/** The select whose options include `optionValue`. */
export function selectWithOption(
  scope: ParentNode,
  optionValue: string
): HTMLSelectElement {
  const select = Array.from(scope.querySelectorAll("select")).find((candidate) =>
    Array.from(candidate.options).some((option) => option.value === optionValue)
  );
  expect(select, `no select offering "${optionValue}"`).toBeDefined();
  return select as HTMLSelectElement;
}

export async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value"
    )?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

/** Drags the range to `value` and lets go. */
export async function slideTo(input: HTMLInputElement, value: number) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}
