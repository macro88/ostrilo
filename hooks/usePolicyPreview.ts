import { useCallback, useMemo, useState } from "react";
import { evaluatePolicy } from "@/src/infrastructure/messaging/client";

export function usePolicyPreview(origin?: string) {
  const [kind, setKind] = useState<number | null>(null);

  const preview = useCallback(async () => {
    if (!origin || kind == null) return undefined;
    return evaluatePolicy(origin, kind);
  }, [origin, kind]);

  return useMemo(() => ({ kind, setKind, preview }), [kind, preview]);
}
