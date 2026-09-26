/**
 * Runs async sections one at a time, in call order.
 *
 * A failing section does not poison the queue: the next one runs regardless,
 * and the failure reaches only the caller whose section threw. Not reentrant:
 * a section that awaits `run` on the same lock waits for itself forever, so
 * callers inside a section use the unlocked implementation directly.
 */
export class SerialLock {
  private tail: Promise<void> = Promise.resolve();

  run<T>(section: () => Promise<T>): Promise<T> {
    const result = this.tail.then(section);
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
