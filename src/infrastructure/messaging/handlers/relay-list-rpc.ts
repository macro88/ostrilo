import {
  RelayListKeyParams,
  RelayListPublishParams,
} from "@/infrastructure/validation/schemas";
import { createRpcErrorResponse, RPC_ERROR_CODES } from "../error-codes";
import type { RpcRequest, RpcResponse } from "../rpc";
import type { RpcModule, ServiceContext } from "../rpc-router";

export class RelayListRpcHandler implements RpcModule {
  async handleRequest(
    message: RpcRequest,
    context: ServiceContext,
  ): Promise<RpcResponse> {
    const method = message.type;
    if (
      message.type !== "relayList.get" &&
      message.type !== "relayList.publish" &&
      message.type !== "relayList.publishStarter"
    ) {
      return createRpcErrorResponse(RPC_ERROR_CODES.UNKNOWN_METHOD, { method });
    }
    const params = RelayListKeyParams.safeParse(message.params);
    if (!params.success)
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, { method });
    const key = (await context.vault.listKeys()).find(
      (k) => k.id === params.data.keyId,
    );
    if (!key || key.id !== (await context.settings.get())?.selectedKeyId) {
      return createRpcErrorResponse(RPC_ERROR_CODES.NO_KEY_SELECTED, {
        method,
      });
    }
    if (message.type === "relayList.get")
      return { ok: true, data: await context.relayList.lookup(key.pubkey) };
    const edit = RelayListPublishParams.safeParse(
      message.type === "relayList.publish"
        ? message.params
        : {
            keyId: key.id,
            entries: context.relayList.starterEntries(),
            baseEventId: null,
          },
    );
    if (!edit.success)
      return createRpcErrorResponse(RPC_ERROR_CODES.INVALID_PARAMS, { method });
    const data = await context.relayList.publish(
      key.id,
      key.pubkey,
      edit.data.entries,
      edit.data.baseEventId,
    );
    return { ok: true, data };
  }
}
