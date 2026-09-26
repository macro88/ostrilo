// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useReauth } from "@/ui/hooks/useReauth";
import { RpcClientError } from "@/infrastructure/messaging/client";
import { RPC_ERROR_CODES, type RpcErrorCode } from "@/infrastructure/messaging/error-codes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Reauth = ReturnType<typeof useReauth>;

let container: HTMLDivElement;
let root: Root;
let current: Reauth | null;

function Harness() {
  current = useReauth();
  return null;
}

function reauth(): Reauth {
  if (!current) throw new Error("harness has not rendered");
  return current;
}

function track(promise: Promise<void>) {
  const outcome: { state: "pending" | "resolved" | "rejected"; reason?: Error } = {
    state: "pending",
  };
  promise.then(
    () => {
      outcome.state = "resolved";
    },
    (reason: Error) => {
      outcome.state = "rejected";
      outcome.reason = reason;
    }
  );
  return outcome;
}

describe("useReauth", () => {
  beforeEach(() => {
    current = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("starts with the dialog closed", () => {
    expect(reauth().dialogProps).toMatchObject({
      open: false,
      action: "",
      busy: false,
      error: undefined,
    });
  });

  it("opens the dialog with the prompt and resolves after the action succeeds", async () => {
    const passwords: string[] = [];
    let outcome!: ReturnType<typeof track>;
    act(() => {
      outcome = track(
        reauth().request(
          { action: "Delete key.", consequence: "This cannot be undone." },
          async (password) => {
            passwords.push(password);
          }
        )
      );
    });

    expect(reauth().dialogProps).toMatchObject({
      open: true,
      action: "Delete key.",
      consequence: "This cannot be undone.",
    });

    await act(async () => {
      await reauth().dialogProps.onConfirm("hunter2");
    });

    expect(passwords).toEqual(["hunter2"]);
    expect(outcome.state).toBe("resolved");
    expect(reauth().dialogProps.open).toBe(false);
    expect(reauth().dialogProps.busy).toBe(false);
  });

  it("shows busy while the action runs", async () => {
    let finish!: () => void;
    act(() => {
      void reauth().request({ action: "Reveal key." }, () => {
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      });
    });

    let confirming!: Promise<void>;
    act(() => {
      confirming = reauth().dialogProps.onConfirm("pw");
    });
    expect(reauth().dialogProps.busy).toBe(true);

    await act(async () => {
      finish();
      await confirming;
    });
    expect(reauth().dialogProps.busy).toBe(false);
  });

  it("keeps the dialog open with the background's message when the action fails, then succeeds on retry", async () => {
    let attempts = 0;
    let outcome!: ReturnType<typeof track>;
    act(() => {
      outcome = track(
        reauth().request({ action: "Raise trust." }, async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("Wrong password, 4 attempts left");
        })
      );
    });

    await act(async () => {
      await reauth().dialogProps.onConfirm("wrong");
    });

    expect(reauth().dialogProps.open).toBe(true);
    expect(reauth().dialogProps.error).toBe("Wrong password, 4 attempts left");
    expect(outcome.state).toBe("pending");

    await act(async () => {
      await reauth().dialogProps.onConfirm("right");
    });

    expect(reauth().dialogProps.error).toBeUndefined();
    expect(outcome.state).toBe("resolved");
  });

  describe("a refusal from the background", () => {
    const refusal = (errorCode: RpcErrorCode, details?: string) =>
      new RpcClientError("policy.setOrigin", {
        code: -32000,
        message: "refused",
        data: { errorCode, details, method: "policy.setOrigin" },
      });

    async function failWith(error: unknown): Promise<string | undefined> {
      act(() => {
        void reauth()
          .request({ action: "Raise trust." }, () => Promise.reject(error))
          .catch(() => undefined);
      });
      await act(async () => {
        await reauth().dialogProps.onConfirm("pw");
      });
      return reauth().dialogProps.error;
    }

    it("shows the throttle's remaining wait rather than an incorrect password", async () => {
      const shown = await failWith(
        refusal(RPC_ERROR_CODES.RATE_LIMITED, "Too many failed attempts. Try again in 12 seconds.")
      );
      expect(shown).toBe("Too many failed attempts. Try again in 12 seconds.");
    });

    it("still reads as a wait when the refusal carries no countdown", async () => {
      expect(await failWith(refusal(RPC_ERROR_CODES.RATE_LIMITED))).toMatch(
        /too many failed attempts/i
      );
    });

    it("shows the pause an incorrect password just earned", async () => {
      const shown = await failWith(
        refusal(
          RPC_ERROR_CODES.INVALID_PASSWORD,
          "Incorrect password. Further attempts are paused for 5 seconds."
        )
      );
      expect(shown).toBe("Incorrect password. Further attempts are paused for 5 seconds.");
    });

    it("never shows the machine string", async () => {
      const shown = await failWith(refusal(RPC_ERROR_CODES.INVALID_PARAMS, "patch.rules: x"));
      expect(shown).not.toMatch(/^rpc:/);
      expect(shown).toBe("Incorrect password");
    });
  });

  it("falls back to a generic message when the failure carries none", async () => {
    act(() => {
      void reauth().request({ action: "Export." }, async () => {
        throw new Error("");
      });
    });

    await act(async () => {
      await reauth().dialogProps.onConfirm("pw");
    });
    expect(reauth().dialogProps.error).toBe("Incorrect password");

    act(() => {
      void reauth().request({ action: "Export." }, () => Promise.reject("bare string"));
    });
    expect(reauth().dialogProps.error).toBeUndefined();

    await act(async () => {
      await reauth().dialogProps.onConfirm("pw");
    });
    expect(reauth().dialogProps.error).toBe("Incorrect password");
  });

  it("rejects the request as cancelled and closes when the user cancels", async () => {
    let ran = false;
    let outcome!: ReturnType<typeof track>;
    act(() => {
      outcome = track(
        reauth().request({ action: "Delete key." }, async () => {
          ran = true;
        })
      );
    });

    await act(async () => {
      reauth().dialogProps.onCancel();
    });

    expect(outcome.state).toBe("rejected");
    expect(outcome.reason?.message).toBe("cancelled");
    expect(ran).toBe(false);
    expect(reauth().dialogProps.open).toBe(false);
  });

  it("does nothing when confirmed or cancelled with no request open", async () => {
    await act(async () => {
      await reauth().dialogProps.onConfirm("pw");
      reauth().dialogProps.onCancel();
    });

    expect(reauth().dialogProps.open).toBe(false);
    expect(reauth().dialogProps.error).toBeUndefined();
  });
});
