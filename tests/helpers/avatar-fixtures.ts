/**
 * Encoded avatars for tests. Only the headers matter to the policy under test,
 * but the PNG is a real decodable 1x1 image so a browser-backed test can show it.
 */
export const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** A RIFF/WEBP container header followed by padding; enough for the type check. */
export const WEBP_DATA_URL = `data:image/webp;base64,${Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from("WEBPVP8L"),
  Buffer.alloc(16),
]).toString("base64")}`;

export const SOURCE_URL = "https://images.example/avatar.png";
