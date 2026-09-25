import { vi } from "vitest";
import { CryptoRpcHandler } from "@/infrastructure/messaging/handlers/crypto-rpc";
import {
  RPC_ERROR_CODES,
  createRpcErrorResponse,
  type RpcErrorCode,
} from "@/infrastructure/messaging/error-codes";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";

/**
 * Stands in for the extension's service worker at the one boundary the UI
 * really has: `browser.runtime.sendMessage`.
 *
 * Everything above it is production code - the RPC client, the key manager
 * context, the forms. `crypto.*` requests are answered by the real
 * `CryptoRpcHandler`, so key validation and password policy are the shipped
 * parser and the shipped blocklist. Vault requests, which would need a whole
 * storage suite, get scripted answers, and every request is recorded so a test
 * can assert what actually crossed the boundary.
 */

export interface RecordedRequest {
  type: string;
  [field: string]: unknown;
}

type Responder = (request: RecordedRequest) => unknown;

const cryptoHandler = new CryptoRpcHandler();
const noContext = {} as ServiceContext;

const defaultResponders: Record<string, Responder> = {
  "state.getLock": () => ({ ok: true, data: { isLocked: false } }),
  "state.touch": () => ({ ok: true, data: null }),
  "keys.list": () => ({ ok: true, data: [] }),
  "vault.generate": (request) => ({
    ok: true,
    data: { id: "generated-key", label: request.label },
  }),
  "vault.import": (request) => ({
    ok: true,
    data: { id: "imported-key", label: request.label },
  }),
  "vault.unlock": () => ({ ok: true, data: {} }),
};

let responders: Record<string, Responder> = { ...defaultResponders };

export const background = {
  requests: [] as RecordedRequest[],

  respond(type: string, responder: Responder) {
    responders[type] = responder;
  },

  fail(type: string, code: RpcErrorCode, details?: string) {
    responders[type] = () =>
      createRpcErrorResponse(code, { details, method: type });
  },

  /** Holds `type` until the returned `release` is called. */
  hold(type: string) {
    const previous = responders[type] ?? (() => ({ ok: true, data: null }));
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    responders[type] = async (request) => {
      await gate;
      return previous(request);
    };
    return () => release();
  },

  sent(type: string): RecordedRequest[] {
    return this.requests.filter((request) => request.type === type);
  },

  reset() {
    this.requests = [];
    responders = { ...defaultResponders };
  },
};

async function sendMessage(message: RecordedRequest): Promise<unknown> {
  background.requests.push(message);
  const responder = responders[message.type];
  if (!responder && message.type.startsWith("crypto.")) {
    return cryptoHandler.handleRequest(
      message as Parameters<CryptoRpcHandler["handleRequest"]>[0],
      noContext
    );
  }
  if (!responder) {
    return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, {
      details: message.type,
      method: message.type,
    });
  }
  return responder(message);
}

/** The `wxt/browser` module as the UI sees it. */
export const wxtBrowserModule = {
  browser: {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  },
};
