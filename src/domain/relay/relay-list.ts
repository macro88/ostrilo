import { RELAY_BOUNDS } from "./constants";
import { RelayUrlSchema } from "./url";

export const RELAY_LIST_KIND = 10002;
export interface RelayListEntry {
  url: string;
  read: boolean;
  write: boolean;
  routable: boolean;
}
export type RelayPermissions = Omit<RelayListEntry, "routable">;

export function normalizedRelayUrl(url: string): string {
  const parsed = new URL(url);
  return (
    parsed.origin +
    parsed.pathname.replace(/\/$/, "") +
    parsed.search +
    parsed.hash
  );
}

function publicIPv4(first: number, second: number): boolean {
  return !(
    [0, 10, 127].includes(first) ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function isRoutableRelayHost(url: string): boolean {
  const host = new URL(url).hostname.replace(/\.$/, "");
  if (/(^|\.)(localhost|local|internal)$/.test(host)) return false;
  if (host.startsWith("[")) {
    const address = host.slice(1, -1);
    const mapped = /^::ffff:([a-f0-9]+):[a-f0-9]+$/.exec(address);
    if (mapped) {
      const upper = Number("0x" + mapped[1]);
      return publicIPv4(upper >>> 8, upper & 255);
    }
    const [prefix] = address.split(":");
    const group = Number("0x" + prefix);
    return (
      address !== "::" &&
      address !== "::1" &&
      (group & 0xfe00) !== 0xfc00 &&
      (group & 0xffc0) !== 0xfe80
    );
  }
  if (!/^\d+(?:\.\d+){3}$/.test(host)) return true;
  const [first, second] = host.split(".").map(Number);
  return publicIPv4(first, second);
}

export function parseRelayList(event: { tags: string[][]; content?: string }) {
  const entries = new Map<string, RelayListEntry>();
  let droppedCount = 0;
  for (const [tag, raw, marker, ...extra] of event.tags) {
    if (
      tag !== "r" ||
      !RelayUrlSchema.safeParse(raw).success ||
      (marker !== undefined && marker !== "read" && marker !== "write") ||
      extra.length
    ) {
      droppedCount++;
      continue;
    }
    const url = normalizedRelayUrl(raw);
    const existing = entries.get(url);
    entries.set(url, {
      url,
      read: marker !== "write" || existing?.read === true,
      write: marker !== "read" || existing?.write === true,
      routable: isRoutableRelayHost(url),
    });
    if (entries.size > RELAY_BOUNDS.MAX_RELAY_LIST_ENTRIES) return null;
  }
  return { entries: [...entries.values()], droppedCount };
}

export function relayListTags(entries: readonly RelayPermissions[]): string[][] {
  return entries.map(({ url, read, write }) =>
    read && write ? ["r", url] : ["r", url, read ? "read" : "write"],
  );
}

export function selectPublishRelays(
  next: RelayListEntry[],
  previous: RelayListEntry[],
  discovery: string[],
) {
  const urls = new Set(discovery.map(normalizedRelayUrl));
  for (const entry of [...next, ...previous]) {
    if (entry.write && isRoutableRelayHost(entry.url)) urls.add(entry.url);
  }
  return [...urls].slice(0, RELAY_BOUNDS.MAX_PUBLISH_RELAYS);
}
