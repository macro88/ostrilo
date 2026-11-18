/**
 * The Blossom servers an upload may go to.
 *
 * A shipped list, not a setting: the manifest's `connect-src` is generated from
 * it, so an extension page can reach exactly these origins and no others. None
 * is selected on a fresh install. A server joins the list only after passing
 * the vetting recorded in `openspec/changes/add-blossom-profile-image-upload`.
 */

export interface BlossomServer {
  readonly id: BlossomServerId;
  readonly name: string;
  /** A bare `https://host` origin. Uploads go to `/upload` on it (BUD-02). */
  readonly origin: string;
}

export const BLOSSOM_SERVER_IDS = ["primal", "nostr-build", "nostrcheck"] as const;

export type BlossomServerId = (typeof BLOSSOM_SERVER_IDS)[number];

function server(id: BlossomServerId, name: string, host: string): BlossomServer {
  // aislop-ignore-next-line ai-slop/hardcoded-url -- the one place a listed host gets its scheme: the list is the curated, vetted egress set and the manifest connect-src is generated from it
  return { id, name, origin: `https://${host}` };
}

const SERVERS_BY_ID: Record<BlossomServerId, BlossomServer> = {
  primal: server("primal", "Primal", "blossom.primal.net"),
  "nostr-build": server("nostr-build", "nostr.build", "blossom.nostr.build"),
  nostrcheck: server("nostrcheck", "nostrcheck.me", "cdn.nostrcheck.me"),
};

export const BLOSSOM_SERVERS: readonly BlossomServer[] = BLOSSOM_SERVER_IDS.map(
  (id) => SERVERS_BY_ID[id]
);

function isBlossomServerId(value: unknown): value is BlossomServerId {
  return (
    typeof value === "string" &&
    BLOSSOM_SERVER_IDS.some((id) => id === value)
  );
}

export function findBlossomServer(id: unknown): BlossomServer | undefined {
  return isBlossomServerId(id) ? SERVERS_BY_ID[id] : undefined;
}

/** A stored value read back as a listed id, or undefined if it is anything else. */
export function normalizeBlossomServer(
  value: unknown
): BlossomServerId | undefined {
  return isBlossomServerId(value) ? value : undefined;
}

export function blossomServerHost(server: BlossomServer): string {
  return new URL(server.origin).host;
}
