import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { expect } from "vitest";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

export function render(ui: ReactNode): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  mounted.push({ root, container });
  return container;
}

export function unmountAll(): void {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
}

export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

export function buttonByText(
  scope: ParentNode,
  text: string
): HTMLButtonElement {
  const button = Array.from(scope.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text
  );
  expect(button, `no button labelled "${text}"`).toBeDefined();
  return button as HTMLButtonElement;
}

export function byLabel<T extends Element = HTMLElement>(
  scope: ParentNode,
  label: string
): T {
  const element = scope.querySelector<T>(`[aria-label="${label}"]`);
  expect(element, `no element with aria-label "${label}"`).not.toBeNull();
  return element as T;
}

export async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

export function typeInto(input: HTMLInputElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export function pressKey(element: Element, key: string): void {
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

export function reauthDialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}

/** Types the password into the open re-authentication dialog and submits it. */
export async function confirmReauth(password: string): Promise<void> {
  const dialog = reauthDialog();
  expect(dialog, "the password dialog is not open").not.toBeNull();
  const input = dialog!.querySelector<HTMLInputElement>("#reauth-password");
  expect(input).not.toBeNull();
  typeInto(input!, password);
  const form = dialog!.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  await flush();
}

export async function cancelReauth(): Promise<void> {
  const dialog = reauthDialog();
  expect(dialog, "the password dialog is not open").not.toBeNull();
  await click(buttonByText(dialog!, "Cancel"));
  await flush();
}
