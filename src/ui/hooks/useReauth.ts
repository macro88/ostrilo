import { useCallback, useState } from "react";

/**
 * Drives a single ReauthDialog for a screen that has several high-risk actions.
 *
 * `request()` returns a promise that resolves when the action completes and
 * rejects when the user cancels, so a caller reads top to bottom:
 *
 *     await reauth.request(
 *       { action: "Delete “Trading key”.", consequence: "This cannot be undone." },
 *       (password) => deleteKey(id, password)
 *     );
 *
 * The password is passed to the action and never stored here. Nothing is
 * remembered between actions: a second high-risk action asks again, which is
 * the point - a "verified for the next few minutes" window is the same
 * unbounded-authority problem in a smaller box.
 */
export interface ReauthPrompt {
  action: string;
  consequence?: string;
}

interface Pending extends ReauthPrompt {
  run: (password: string) => Promise<unknown>;
  resolve: () => void;
  reject: (reason: Error) => void;
}

export function useReauth() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const request = useCallback(
    (prompt: ReauthPrompt, run: (password: string) => Promise<unknown>) =>
      new Promise<void>((resolve, reject) => {
        setError(undefined);
        setBusy(false);
        setPending({ ...prompt, run, resolve, reject });
      }),
    []
  );

  const onConfirm = useCallback(
    async (password: string) => {
      if (!pending) return;
      setBusy(true);
      setError(undefined);
      try {
        await pending.run(password);
        pending.resolve();
        setPending(null);
      } catch (e) {
        // The dialog stays open so the user can retry, but the message is
        // whatever the background chose to disclose - never anything derived
        // from the password itself.
        setError(
          e instanceof Error && e.message ? e.message : "Incorrect password"
        );
      } finally {
        setBusy(false);
      }
    },
    [pending]
  );

  const onCancel = useCallback(() => {
    pending?.reject(new Error("cancelled"));
    setPending(null);
    setError(undefined);
    setBusy(false);
  }, [pending]);

  return {
    request,
    dialogProps: {
      open: pending !== null,
      action: pending?.action ?? "",
      consequence: pending?.consequence,
      error,
      busy,
      onConfirm,
      onCancel,
    },
  };
}
