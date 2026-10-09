import type { StoragePort } from "@/application/ports/storage";

/**
 * Per-origin rolling-window counters that survive a service-worker restart.
 *
 * The flood controls kept their windows in worker memory. MV3 ends an idle
 * worker, and a page that waits out the eviction got a full allowance back,
 * which matters most for the limits that apply while the vault is locked: no
 * keepalive runs then, so the worker is routinely evicted between calls.
 *
 * The windows are written to `storage.session`: it outlives the worker and
 * dies with the browser session, so a counter never outlasts the thing it
 * meters. Nothing sensitive goes in. A record is an origin and a list of
 * millisecond timestamps.
 *
 * Reads are validated and bounded. Whatever the stored value is, the result is
 * a well-formed window: a record that cannot be understood is an empty window.
 * That is the documented fallback, and the only thing that can write the record
 * is this class, so a malformed one means damage or a format change rather than
 * an attacker's choice.
 */

const RECORD_VERSION = 1;

/**
 * Origins tracked at once. A page cycling subdomains must not grow the record
 * without bound; past the cap the origin with the oldest activity is dropped.
 */
export const MAX_TRACKED_ORIGINS = 256;

/** An origin longer than this is not one the schema would have accepted. */
const MAX_ORIGIN_LENGTH = 2048;

export interface RollingWindowOptions {
  /** Where the windows persist. Absent: memory only. */
  storage?: StoragePort;
  /** Distinct per counter; each limiter owns its own record. */
  storageKey: string;
  windowMs: number;
  /** Timestamps kept per origin. Equal to the limit the window enforces. */
  maxPerOrigin: number;
  now?: () => number;
}

interface StoredWindows {
  v: typeof RECORD_VERSION;
  origins: Record<string, number[]>;
}

export class RollingWindowCounters {
  private windows = new Map<string, number[]>();
  private readonly hydration: Promise<void>;
  private writing: Promise<void> | undefined;
  private dirty = false;
  private readonly now: () => number;

  constructor(private readonly options: RollingWindowOptions) {
    this.now = options.now ?? (() => Date.now());
    this.hydration = this.hydrate();
  }

  /**
   * Resolves once the persisted windows have been read. A caller that is about
   * to enforce a limit awaits this first, so a request that wakes a restarted
   * worker is judged against the windows the worker had when it died.
   */
  ready(): Promise<void> {
    return this.hydration;
  }

  /** Resolves when every change made so far has been written. */
  async settled(): Promise<void> {
    await this.hydration;
    while (this.writing) await this.writing;
  }

  /** Entries this origin still has inside the window. */
  count(origin: string): number {
    return this.recent(origin).length;
  }

  /** Charges one entry to this origin. */
  record(origin: string): void {
    const kept = this.recent(origin);
    kept.push(this.now());
    this.windows.set(origin, kept.slice(-this.options.maxPerOrigin));
    this.persist();
  }

  /** Test seam, and the reset a caller may want. */
  clear(): void {
    this.windows.clear();
    this.persist();
  }

  private recent(origin: string): number[] {
    const cutoff = this.now() - this.options.windowMs;
    const kept = (this.windows.get(origin) ?? []).filter((at) => at > cutoff);
    if (kept.length > 0) {
      this.windows.set(origin, kept);
    } else {
      // An origin whose allowance has fully decayed takes no space.
      this.windows.delete(origin);
    }
    return kept;
  }

  private async hydrate(): Promise<void> {
    const { storage, storageKey } = this.options;
    if (!storage) return;
    let raw: unknown;
    try {
      raw = await storage.get<unknown>(storageKey);
    } catch (err) {
      console.warn(`[RollingWindowCounters] ${storageKey} unreadable:`, err);
      return;
    }
    // Merged rather than assigned: anything charged while the read was in
    // flight is kept, so a fast request cannot be forgotten by its own restart.
    for (const [origin, stamps] of this.parse(raw)) {
      const merged = [...(this.windows.get(origin) ?? []), ...stamps]
        .sort((a, b) => a - b)
        .slice(-this.options.maxPerOrigin);
      this.windows.set(origin, merged);
    }
    this.enforceOriginCap();
  }

  /** Every well-formed, in-window origin in `raw`; nothing else. */
  private parse(raw: unknown): Map<string, number[]> {
    const out = new Map<string, number[]>();
    if (!isPlainObject(raw) || raw.v !== RECORD_VERSION) return out;
    const origins = raw.origins;
    if (!isPlainObject(origins)) return out;

    const now = this.now();
    const cutoff = now - this.options.windowMs;
    const { maxPerOrigin } = this.options;
    for (const [origin, stamps] of Object.entries(origins)) {
      if (origin.length === 0 || origin.length > MAX_ORIGIN_LENGTH) continue;
      // A list longer than anything this class writes is not its output.
      if (!Array.isArray(stamps) || stamps.length > maxPerOrigin) continue;
      const valid = stamps
        .filter((at): at is number => typeof at === "number" && Number.isFinite(at))
        // A timestamp from the future is clamped, not trusted: left alone it
        // would hold the window open for as long as the skew.
        .map((at) => Math.min(at, now))
        .filter((at) => at > cutoff)
        .sort((a, b) => a - b);
      if (valid.length > 0) out.set(origin, valid);
      if (out.size >= MAX_TRACKED_ORIGINS * 2) break;
    }
    return out;
  }

  private enforceOriginCap(): void {
    if (this.windows.size <= MAX_TRACKED_ORIGINS) return;
    const newest = (stamps: number[]) => stamps[stamps.length - 1] ?? 0;
    const byRecency = [...this.windows.entries()].sort(
      (a, b) => newest(b[1]) - newest(a[1])
    );
    this.windows = new Map(byRecency.slice(0, MAX_TRACKED_ORIGINS));
  }

  private serialise(): StoredWindows {
    for (const origin of this.windows.keys()) this.recent(origin);
    this.enforceOriginCap();
    return {
      v: RECORD_VERSION,
      origins: Object.fromEntries(this.windows),
    };
  }

  /**
   * One write in flight at a time, each carrying the state as of when it is
   * written, so a burst of requests costs one or two writes rather than one
   * per request and the last write is always the newest.
   */
  private persist(): void {
    if (!this.options.storage) return;
    this.dirty = true;
    if (this.writing) return;
    this.writing = this.flush();
  }

  private async flush(): Promise<void> {
    const { storage, storageKey } = this.options;
    await this.hydration;
    while (this.dirty) {
      this.dirty = false;
      try {
        await storage!.set(storageKey, this.serialise());
      } catch (err) {
        // The in-memory window still applies; only restart survival is lost.
        console.warn(`[RollingWindowCounters] ${storageKey} not saved:`, err);
      }
    }
    // Cleared in the same synchronous step as the `dirty` check above, so a
    // change made after the last write always starts a new one.
    this.writing = undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
