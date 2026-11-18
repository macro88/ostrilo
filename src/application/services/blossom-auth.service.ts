import {
  buildUploadAuthEvent,
  encodeAuthorizationHeader,
  type UnsignedUploadAuth,
} from "@/domain/blossom/auth-event";
import {
  UPLOAD_AUTH_CONTENT,
  UPLOAD_AUTH_KIND,
} from "@/domain/blossom/constants";
import {
  blossomServerHost,
  findBlossomServer,
} from "@/domain/blossom/servers";
import type { ActivityLogEntry, SignedEvent } from "@/domain/types";

/** The part of the vault this service needs: find a key, sign for it. */
export interface UploadAuthVault {
  listKeys(): Promise<Array<{ id: string; pubkey: string }>>;
  signEvent(event: UnsignedUploadAuth, keyId: string): Promise<SignedEvent>;
}

export interface UploadAuthActivity {
  addEntry(entry: Omit<ActivityLogEntry, "id" | "timestamp">): Promise<void>;
}

export class UploadAuthKeyNotFoundError extends Error {
  constructor() {
    super("No key in the vault has this public key");
    this.name = "UploadAuthKeyNotFoundError";
  }
}

export class UploadAuthServerError extends Error {
  constructor() {
    super("Not a server on the curated list");
    this.name = "UploadAuthServerError";
  }
}

export interface UploadAuthRequest {
  pubkey: string;
  sha256: string;
  serverId: string;
}

/**
 * Issues the `Authorization` header for one upload.
 *
 * The caller names a key, a blob hash and a server id. Everything else about
 * the event is built here, so the page that asked cannot choose what is signed.
 * A token is handed out only after the activity entry for it is written: a
 * token that could not be logged is discarded rather than returned.
 */
export class BlossomAuthService {
  constructor(
    private readonly vault: UploadAuthVault,
    private readonly activity: UploadAuthActivity,
    private readonly clock: () => number = Date.now
  ) {}

  async authorizeUpload(request: UploadAuthRequest): Promise<string> {
    const server = findBlossomServer(request.serverId);
    if (!server) {
      throw new UploadAuthServerError();
    }

    const key = (await this.vault.listKeys()).find(
      (record) => record.pubkey === request.pubkey
    );
    if (!key) {
      throw new UploadAuthKeyNotFoundError();
    }

    const unsigned = buildUploadAuthEvent({
      pubkey: request.pubkey,
      sha256: request.sha256,
      serverHost: blossomServerHost(server),
      now: Math.floor(this.clock() / 1000),
    });
    const signed = await this.vault.signEvent(unsigned, key.id);
    if (signed.pubkey !== request.pubkey || signed.kind !== UPLOAD_AUTH_KIND) {
      throw new Error("The signer returned an unexpected event");
    }

    await this.activity.addEntry({
      origin: "extension://profile",
      kind: UPLOAD_AUTH_KIND,
      decision: "allow",
      contentPreview: UPLOAD_AUTH_CONTENT,
      keyId: key.id,
    });

    return encodeAuthorizationHeader(signed);
  }
}
