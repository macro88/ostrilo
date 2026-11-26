import { checkBlobDescriptor } from "@/domain/blossom/descriptor";
import {
  MAX_REPLY_BYTES,
  UPLOAD_TIMEOUT_MS,
} from "@/domain/blossom/constants";
import type { HeaderInspection } from "@/domain/blossom/image-sniff";
import {
  AUTHORISE_FAILED_MESSAGE,
  NO_KEY_MESSAGE,
  UNEXPECTED_REPLY_MESSAGE,
  inspectionFailureMessage,
  prepareFailureMessage,
  uploadFailureMessage,
  uploadedMessage,
} from "@/domain/blossom/messages";
import {
  blossomServerHost,
  findBlossomServer,
  type BlossomServer,
  type BlossomServerId,
} from "@/domain/blossom/servers";
import { PrepareImageError, type PreparedImage } from "@/ui/lib/prepare-image";

/**
 * One upload, from choosing a file to a filled field, as a single operation.
 *
 * Cancel, unmounting, a change of the selected key and the start of another
 * upload all end the whole operation, not only the request. Every stage is
 * checked on the way out of the one before it, so a cancelled upload never
 * reaches the next: no request is sent, no token is used, nothing is written.
 * Work that cannot be aborted (a decode, an RPC call) finishes and its result
 * is dropped. An operation is bound to the key and the field it started on,
 * and only one runs at a time.
 */

export type UploadField = "picture" | "banner";

export type UploadStep = "preparing" | "authorising" | "uploading";

export type UploadState =
  | { stage: "idle" }
  | { stage: "inspecting"; field: UploadField }
  | { stage: "choosing"; field: UploadField; animated: boolean }
  | { stage: "working"; field: UploadField; step: UploadStep; host: string }
  | { stage: "done"; field: UploadField; message: string }
  | { stage: "failed"; field: UploadField; message: string };

type AcceptedInspection = Extract<HeaderInspection, { ok: true }>;

export interface UploadDeps {
  /** The header inspection that runs before the dialog opens. */
  inspect(file: Blob): Promise<HeaderInspection>;
  prepare(file: Blob, inspected: AcceptedInspection): Promise<PreparedImage>;
  sha256Hex(bytes: Uint8Array): string;
  authorize(params: {
    pubkey: string;
    sha256: string;
    serverId: BlossomServerId;
  }): Promise<string>;
  fetch(url: string, init: RequestInit): Promise<Response>;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
}

export interface UploadCallbacks {
  /** Called only for the current operation, on the key and field it started on. */
  onUploaded(field: UploadField, url: string): void;
  /** Called when the user confirms the dialog, to remember the choice. */
  onServerConfirmed?(serverId: BlossomServerId): void;
}

interface Session {
  readonly field: UploadField;
  readonly file: Blob;
  inspection?: AcceptedInspection;
}

interface Operation {
  readonly pubkey: string;
  readonly field: UploadField;
  readonly controller: AbortController;
}

const CANCELLED = Symbol("cancelled");

/** At most MAX_REPLY_BYTES of a reply, parsed as JSON; undefined when it is neither small nor JSON. */
async function readBoundedJson(
  response: Response,
  stop: () => void
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_REPLY_BYTES) {
      stop();
      return undefined;
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }

  return parseJson(new TextDecoder().decode(joined));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // aislop-ignore-next-line ai-slop/silent-recovery -- a reply that is not JSON is a refusal, reported to the user as an unexpected reply by the caller; there is nothing to log and the text is remote-authored.
    return undefined;
  }
}

export class BlossomUploadController {
  private state: UploadState = { stage: "idle" };
  private readonly listeners = new Set<() => void>();
  private session: Session | null = null;
  private operation: Operation | null = null;
  private currentPubkey: string | undefined;
  private attached = true;

  constructor(
    private readonly deps: UploadDeps,
    private callbacks: UploadCallbacks
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): UploadState => this.state;

  setCallbacks(callbacks: UploadCallbacks): void {
    this.callbacks = callbacks;
  }

  /** Re-enables the controller after `detach`, as React does between development effects. */
  attach(): void {
    this.attached = true;
  }

  /** The owner is gone: end everything, and announce nothing. */
  detach(): void {
    this.attached = false;
    this.abandon();
    this.state = { stage: "idle" };
  }

  /** The key the editor is editing. A change ends an upload bound to another key. */
  setCurrentPubkey(pubkey: string | undefined): void {
    if (this.currentPubkey === pubkey) return;
    this.currentPubkey = pubkey;
    if (this.operation || this.session) this.cancel();
  }

  /** A file was chosen: inspect its header, then offer the dialog. Nothing is decoded or sent. */
  async begin(file: Blob, field: UploadField): Promise<void> {
    this.abandon();
    const session: Session = { field, file };
    this.session = session;
    this.set({ stage: "inspecting", field });

    let inspection: HeaderInspection;
    try {
      inspection = await this.deps.inspect(file);
    } catch {
      if (this.session === session) {
        this.fail(field, inspectionFailureMessage("uninspectable"));
      }
      return;
    }

    if (this.session !== session || !this.attached) return;
    if (!inspection.ok) {
      this.fail(field, inspectionFailureMessage(inspection.reason));
      return;
    }

    session.inspection = inspection;
    this.set({ stage: "choosing", field, animated: inspection.animated });
  }

  /** The user confirmed the dialog: bind an operation to the key and field, and start it. */
  confirm(serverId: BlossomServerId): void {
    const session = this.session;
    const server = findBlossomServer(serverId);
    if (!session?.inspection || !server || this.state.stage !== "choosing") return;

    const pubkey = this.currentPubkey;
    if (!pubkey) {
      this.fail(session.field, NO_KEY_MESSAGE);
      return;
    }

    const operation: Operation = {
      pubkey,
      field: session.field,
      controller: new AbortController(),
    };
    this.session = null;
    this.operation = operation;
    this.callbacks.onServerConfirmed?.(serverId);
    this.set({
      stage: "working",
      field: session.field,
      step: "preparing",
      host: blossomServerHost(server),
    });
    void this.run(operation, session.file, session.inspection, server);
  }

  /** Ends whatever is open or running, without reporting a failure. */
  cancel(): void {
    this.abandon();
    this.set({ stage: "idle" });
  }

  dismiss(): void {
    if (this.state.stage === "done" || this.state.stage === "failed") {
      this.set({ stage: "idle" });
    }
  }

  private abandon(): void {
    this.session = null;
    if (this.operation) {
      this.operation.controller.abort();
      this.operation = null;
    }
  }

  private isCurrent(operation: Operation): boolean {
    return (
      this.attached &&
      this.operation === operation &&
      !operation.controller.signal.aborted &&
      this.currentPubkey === operation.pubkey
    );
  }

  private guard(operation: Operation): void {
    if (!this.isCurrent(operation)) throw CANCELLED;
  }

  private async run(
    operation: Operation,
    file: Blob,
    inspected: AcceptedInspection,
    server: BlossomServer
  ): Promise<void> {
    const host = blossomServerHost(server);
    let step: UploadStep = "preparing";

    try {
      const prepared = await this.deps.prepare(file, inspected);
      this.guard(operation);

      const sha256 = this.deps.sha256Hex(prepared.bytes);

      step = "authorising";
      this.set({ stage: "working", field: operation.field, step, host });
      const authorization = await this.deps.authorize({
        pubkey: operation.pubkey,
        sha256,
        serverId: server.id,
      });
      this.guard(operation);

      step = "uploading";
      this.set({ stage: "working", field: operation.field, step, host });
      const reply = await this.put(operation, server, prepared, sha256, authorization);
      this.guard(operation);

      if (reply.status !== 200 && reply.status !== 201) {
        this.fail(operation.field, uploadFailureMessage(reply.status, host));
        return;
      }

      const checked = checkBlobDescriptor(reply.body, {
        sha256,
        size: prepared.bytes.length,
      });
      if (!checked.ok) {
        this.fail(operation.field, UNEXPECTED_REPLY_MESSAGE);
        return;
      }

      this.operation = null;
      this.callbacks.onUploaded(operation.field, checked.url);
      this.set({ stage: "done", field: operation.field, message: uploadedMessage(host) });
    } catch (error) {
      if (error === CANCELLED || !this.isCurrent(operation)) return;
      this.fail(operation.field, this.messageFor(error, step, host));
    }
  }

  private messageFor(error: unknown, step: UploadStep, host: string): string {
    if (error instanceof PrepareImageError) return prepareFailureMessage(error.reason);
    if (step === "authorising") return AUTHORISE_FAILED_MESSAGE;
    if (step === "uploading") return uploadFailureMessage(null, host);
    return prepareFailureMessage("decode-failed");
  }

  private async put(
    operation: Operation,
    server: BlossomServer,
    prepared: PreparedImage,
    sha256: string,
    authorization: string
  ): Promise<{ status: number; body?: unknown }> {
    const timedOut = new AbortController();
    const finished = new AbortController();
    const timer = this.deps.setTimer(() => timedOut.abort(), UPLOAD_TIMEOUT_MS);
    const signal = AbortSignal.any([
      operation.controller.signal,
      timedOut.signal,
      finished.signal,
    ]);

    try {
      const response = await this.deps.fetch(`${server.origin}/upload`, {
        method: "PUT",
        headers: {
          Authorization: authorization,
          "Content-Type": prepared.mime,
          "X-SHA-256": sha256,
        },
        body: prepared.bytes,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        redirect: "error",
        signal,
      });

      if (response.status !== 200 && response.status !== 201) {
        // The body of a refusal is remote-authored text nobody reads.
        finished.abort();
        return { status: response.status };
      }

      return {
        status: response.status,
        body: await readBoundedJson(response, () => finished.abort()),
      };
    } finally {
      this.deps.clearTimer(timer);
    }
  }

  private fail(field: UploadField, message: string): void {
    this.session = null;
    this.operation = null;
    this.set({ stage: "failed", field, message });
  }

  private set(next: UploadState): void {
    if (this.state.stage === "idle" && next.stage === "idle") return;
    this.state = next;
    if (!this.attached) return;
    for (const listener of this.listeners) listener();
  }
}
