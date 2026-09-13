/**
 * How a requesting origin is shown to the user at a decision point.
 *
 * The approval dialog rendered `new URL(origin).hostname`, which drops the
 * scheme. A hijacked `http://example.com` therefore rendered identically to
 * the real `https://example.com` - the one piece of information that would
 * have told the user the connection was not authenticated was the piece the
 * formatter discarded. The string was also CSS-truncated, so the tail of a
 * long hostname could be hidden.
 *
 * `URL.hostname` already returns the punycode ASCII form for an IDN, which is
 * what resists homoglyph spoofing: a hostname written with a Cyrillic "a"
 * arrives as `xn--...` and looks wrong, which is the point. That behaviour is
 * kept deliberately.
 */

export interface FormattedOrigin {
  /** The full display string: scheme, host, and port when non-default. */
  display: string;
  /** Punycode ASCII hostname. */
  hostname: string;
  /** Scheme with its colon, e.g. "https:". */
  scheme: string;
  /** True when the connection was not authenticated. */
  insecure: boolean;
  /** True when the input did not parse as a URL at all. */
  malformed: boolean;
}

const DEFAULT_PORTS: Record<string, string> = {
  "http:": "80",
  "https:": "443",
  "ws:": "80",
  "wss:": "443",
};

export function formatOrigin(origin: string): FormattedOrigin {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    // Shown verbatim rather than prettified. An origin the extension cannot
    // parse is one the user should see exactly as it arrived.
    return {
      display: origin,
      hostname: origin,
      scheme: "",
      insecure: true,
      malformed: true,
    };
  }

  const port =
    url.port && url.port !== DEFAULT_PORTS[url.protocol] ? `:${url.port}` : "";

  return {
    display: `${url.protocol}//${url.hostname}${port}`,
    hostname: url.hostname,
    scheme: url.protocol,
    insecure: url.protocol !== "https:",
    malformed: false,
  };
}
