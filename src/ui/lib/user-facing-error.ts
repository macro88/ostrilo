/**
 * The sentence to show a user for a failed operation.
 *
 * An RPC failure's message is the machine string `rpc:<method>:<code>`, and
 * transport failures carry the same prefix, so neither is ever shown. A surface
 * passes the copy it wants for the codes it can explain; anything else gets
 * that surface's fallback.
 */
export function userFacingError(
  error: unknown,
  fallback: string,
  messages: Partial<Record<string, string>> = {}
): string {
  const code = (error as { errorCode?: unknown } | null)?.errorCode;
  if (typeof code === "string") {
    const known = messages[code];
    return known === undefined ? fallback : known;
  }
  if (error instanceof Error && error.message && !error.message.startsWith("rpc:")) {
    return error.message;
  }
  return fallback;
}
