import type { HeaderInspection } from "./image-sniff";

/**
 * Everything the upload path tells the user, as fixed text.
 *
 * Nothing here quotes a remote party: a server's `X-Reason` header and reply
 * body are free text written by someone else, and BUD-02 says a client must not
 * act on them, so they are never displayed. Failures are chosen by status.
 */

export const UNEXPECTED_REPLY_MESSAGE = "The host returned an unexpected reply.";

export const AUTHORISE_FAILED_MESSAGE = "Ostrilo could not authorise this upload.";

export const NO_KEY_MESSAGE = "Choose a key before uploading.";

export function uploadFailureMessage(status: number | null, host: string): string {
  switch (status) {
    case 400:
      return "The host did not accept this image.";
    case 401:
      return "The host did not accept the upload authorisation.";
    case 402:
      return "The host charges for uploads.";
    case 403:
      return "The host's rules do not allow this upload.";
    case 409:
      return "The host reports the bytes did not match. Try again.";
    case 413:
      return "The image is larger than the host allows.";
    case 415:
      return "The host does not accept this type of image.";
    case 429:
      return "The host is limiting uploads. Try again later.";
    default:
      return `Could not reach ${host}.`;
  }
}

/** Says where it went and what to do next. It never says "verified". */
export function uploadedMessage(host: string): string {
  return `Uploaded to ${host}. Save your profile to use it.`;
}

type InspectionRefusal = Extract<HeaderInspection, { ok: false }>["reason"];

export function inspectionFailureMessage(reason: InspectionRefusal): string {
  switch (reason) {
    case "unsupported":
      return "Choose a JPEG, PNG, GIF or WebP image.";
    case "empty":
      return "That file is empty.";
    case "too-large":
      return "Image must be smaller than 5 MB.";
    case "uninspectable":
      return "This image could not be checked.";
  }
}

export type PrepareFailureReason =
  | "unsupported"
  | "uninspectable"
  | "changed"
  | "decode-failed"
  | "encode-failed"
  | "too-large";

export function prepareFailureMessage(reason: PrepareFailureReason): string {
  switch (reason) {
    case "unsupported":
      return "Choose a JPEG, PNG, GIF or WebP image.";
    case "uninspectable":
      return "This image could not be checked.";
    case "changed":
      return "The file changed after it was chosen. Choose it again.";
    case "decode-failed":
      return "This image could not be read.";
    case "encode-failed":
      return "This image could not be prepared.";
    case "too-large":
      return "The prepared image is larger than 5 MB.";
  }
}
