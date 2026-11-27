import { useState } from "react";

export function useStarterRelayChoice(disabled: boolean) {
  const [publishStarter, setPublishStarter] = useState(true);
  const choice = (
    <label className="mt-3 flex items-start gap-2 text-[13px]">
      <input
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--ink-violet)]"
        type="checkbox"
        disabled={disabled}
        checked={publishStarter}
        onChange={(event) => setPublishStarter(event.target.checked)}
      />
      Publish my starter relay list so other Nostr apps can find this key.
    </label>
  );
  return { publishStarter, choice };
}
