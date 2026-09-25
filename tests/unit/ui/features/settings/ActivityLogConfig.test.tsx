/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityLogConfig } from "@/ui/features/settings/components/shared";
import { buttonByText, byLabel, click, render, unmountAll } from "./settings-dom";
import { slideTo } from "./settings-native-controls";

vi.mock("@/components/ui/slider", async () =>
  (await import("./settings-native-controls")).sliderModule
);

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe("ActivityLogConfig", () => {
  it("reports the retention and emits the new value when the slider moves", async () => {
    const onChange = vi.fn();
    const container = render(
      <ActivityLogConfig maxEntries={50} onChange={onChange} onClear={vi.fn()} />
    );

    expect(container.textContent).toContain("50 entries");
    const slider = byLabel<HTMLInputElement>(container, "Max entries to keep");
    expect([slider.min, slider.max, slider.step]).toEqual(["10", "500", "10"]);

    await slideTo(slider, 120);

    expect(onChange).toHaveBeenLastCalledWith(120);
  });

  it("clears the log only when the confirmation is accepted", async () => {
    const onClear = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    const container = render(
      <ActivityLogConfig maxEntries={50} onChange={vi.fn()} onClear={onClear} />
    );

    await click(buttonByText(container, "Clear Log"));
    expect(confirm).toHaveBeenCalledWith(
      "Clear all activity log entries? This action cannot be undone."
    );
    expect(onClear).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    await click(buttonByText(container, "Clear Log"));

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("offers no export row without an export handler", () => {
    const container = render(
      <ActivityLogConfig maxEntries={50} onChange={vi.fn()} onClear={vi.fn()} />
    );

    expect(container.textContent).not.toContain("Export");
  });

  it("exports through the handler under the caller's label and honours disabling", async () => {
    const onExport = vi.fn();
    const container = render(
      <ActivityLogConfig
        maxEntries={50}
        onChange={vi.fn()}
        onClear={vi.fn()}
        onExport={onExport}
        exportLabel="Exporting…"
        exportDisabled
      />
    );

    const button = buttonByText(container, "Exporting…");
    expect(button.disabled).toBe(true);

    unmountAll();
    const enabled = render(
      <ActivityLogConfig
        maxEntries={50}
        onChange={vi.fn()}
        onClear={vi.fn()}
        onExport={onExport}
      />
    );
    await click(buttonByText(enabled, "Export Log"));

    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
