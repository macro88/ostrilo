import { describe, expect, it } from "vitest";
import {
  UNEXPECTED_REPLY_MESSAGE,
  inspectionFailureMessage,
  prepareFailureMessage,
  uploadFailureMessage,
  uploadedMessage,
} from "@/domain/blossom/messages";

const HOST = "blossom.example";

describe("uploadFailureMessage", () => {
  it.each([
    [400, "The host did not accept this image."],
    [401, "The host did not accept the upload authorisation."],
    [402, "The host charges for uploads."],
    [403, "The host's rules do not allow this upload."],
    [409, "The host reports the bytes did not match. Try again."],
    [413, "The image is larger than the host allows."],
    [415, "The host does not accept this type of image."],
    [429, "The host is limiting uploads. Try again later."],
  ])("maps status %s to its fixed copy", (status, copy) => {
    expect(uploadFailureMessage(status, HOST)).toBe(copy);
  });

  it.each([404, 410, 500, 502, 503, 504, 307, 0, 600, -1])(
    "reads status %s as unreachable",
    (status) => {
      expect(uploadFailureMessage(status, HOST)).toBe(
        "Could not reach blossom.example."
      );
    }
  );

  it("reads a request that got no response as unreachable", () => {
    expect(uploadFailureMessage(null, HOST)).toBe(
      "Could not reach blossom.example."
    );
  });
});

describe("fixed copy", () => {
  it("says the reply was unexpected without echoing anything", () => {
    expect(UNEXPECTED_REPLY_MESSAGE).toBe(
      "The host returned an unexpected reply."
    );
  });

  it("says where an image was uploaded and what to do next, without claiming verification", () => {
    const message = uploadedMessage(HOST);
    expect(message).toBe("Uploaded to blossom.example. Save your profile to use it.");
    expect(message.toLowerCase()).not.toContain("verified");
    expect(message.toLowerCase()).not.toContain("guarantee");
  });

  it.each([
    ["unsupported", "Choose a JPEG, PNG, GIF or WebP image."],
    ["empty", "That file is empty."],
    ["too-large", "Image must be smaller than 5 MB."],
    ["uninspectable", "This image could not be checked."],
  ] as const)("explains an inspection refusal: %s", (reason, copy) => {
    expect(inspectionFailureMessage(reason)).toBe(copy);
  });

  it.each([
    ["unsupported", "Choose a JPEG, PNG, GIF or WebP image."],
    ["uninspectable", "This image could not be checked."],
    ["changed", "The file changed after it was chosen. Choose it again."],
    ["decode-failed", "This image could not be read."],
    ["encode-failed", "This image could not be prepared."],
    ["too-large", "The prepared image is larger than 5 MB."],
  ] as const)("explains a preparation failure: %s", (reason, copy) => {
    expect(prepareFailureMessage(reason)).toBe(copy);
  });
});
