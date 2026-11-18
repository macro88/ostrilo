import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { inspectImageHeader } from "@/domain/blossom/image-sniff";
import type { BlossomServerId } from "@/domain/blossom/servers";
import { bytesToHex } from "@/domain/utils/hex";
import { NobleSha256 } from "@/infrastructure/crypto/adapters";
import { authorizeBlossomUpload } from "@/infrastructure/messaging/client";
import { fileHeaderReader, prepareImage } from "@/ui/lib/prepare-image";
import {
  BlossomUploadController,
  type UploadDeps,
  type UploadField,
  type UploadState,
} from "../blossom-upload.controller";

const realDeps: UploadDeps = {
  inspect: (file) => inspectImageHeader(fileHeaderReader(file)),
  prepare: prepareImage,
  sha256Hex: (bytes) => bytesToHex(NobleSha256.sha256(bytes)),
  authorize: authorizeBlossomUpload,
  fetch: (url, init) => fetch(url, init),
  setTimer: (callback, ms) => window.setTimeout(callback, ms),
  clearTimer: (id) => {
    if (typeof id === "number") window.clearTimeout(id);
  },
};

interface Options {
  /** The key the editor is editing. A change ends an upload bound to another key. */
  pubkey: string | undefined;
  onUploaded: (field: UploadField, url: string) => void;
  onServerConfirmed?: (serverId: BlossomServerId) => void;
  /** Stands in for the browser, crypto and RPC the upload uses. */
  deps?: UploadDeps;
}

export interface BlossomUpload {
  state: UploadState;
  begin: (file: Blob, field: UploadField) => Promise<void>;
  confirm: (serverId: BlossomServerId) => void;
  cancel: () => void;
  dismiss: () => void;
}

/** The profile editor's upload: choose a file, pick a host in a dialog, fill a field. */
export function useBlossomUpload({
  pubkey,
  onUploaded,
  onServerConfirmed,
  deps = realDeps,
}: Options): BlossomUpload {
  const [controller] = useState(
    () => new BlossomUploadController(deps, { onUploaded, onServerConfirmed })
  );

  useEffect(() => {
    controller.setCallbacks({ onUploaded, onServerConfirmed });
  }, [controller, onUploaded, onServerConfirmed]);

  // Attach and detach rather than create and dispose: React runs a development
  // effect, its cleanup and the effect again, and the controller must survive it.
  useEffect(() => {
    controller.attach();
    return () => controller.detach();
  }, [controller]);

  // Before paint, so an upload is never left bound to the previous key.
  useLayoutEffect(() => {
    controller.setCurrentPubkey(pubkey);
  }, [controller, pubkey]);

  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  const actions = useMemo(
    () => ({
      begin: (file: Blob, field: UploadField) => controller.begin(file, field),
      confirm: (serverId: BlossomServerId) => controller.confirm(serverId),
      cancel: () => controller.cancel(),
      dismiss: () => controller.dismiss(),
    }),
    [controller]
  );

  return { state, ...actions };
}
