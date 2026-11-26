/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileImageField } from "@/ui/features/profile/components/ProfileImageField";
import type { BlossomUpload } from "@/ui/features/profile/hooks/useBlossomUpload";
import type {
  UploadField,
  UploadState,
} from "@/ui/features/profile/blossom-upload.controller";
import { jpeg } from "../../../../helpers/image-bytes";
import {
  button,
  chooseFile,
  click,
  input,
  render,
  setValue,
  unmountAll,
} from "../onboarding/dom";

afterEach(() => unmountAll());

function fakeUpload(state: UploadState = { stage: "idle" }) {
  const upload: BlossomUpload = {
    state,
    begin: vi.fn(async () => {}),
    confirm: vi.fn(),
    cancel: vi.fn(),
    dismiss: vi.fn(),
  };
  return upload;
}

function mount(
  options: {
    state?: UploadState;
    field?: UploadField;
    value?: string;
    disabled?: boolean;
  } = {}
) {
  const upload = fakeUpload(options.state);
  const onChange = vi.fn();
  const field = options.field ?? "picture";
  const view = render(
    <ProfileImageField
      id={field}
      field={field}
      label={field === "picture" ? "Profile Picture URL" : "Banner Image URL"}
      value={options.value ?? ""}
      onChange={onChange}
      disabled={options.disabled}
      placeholder="https://example.com/image.jpg"
      upload={upload}
    />
  );
  return { upload, onChange, ...view };
}

const urlInput = (field = "picture") => input(document.body, `#${field}`);
const fileInput = () => input(document.body, "input[type='file']");
const uploadButton = (field = "picture") =>
  document.querySelector<HTMLButtonElement>(`#${field}-upload`);

describe("ProfileImageField: the URL input", () => {
  it("is a labelled url input that shows its value and reports edits", () => {
    const { onChange } = mount({ value: "https://example.com/a.png" });

    expect(urlInput().type).toBe("url");
    expect(urlInput().value).toBe("https://example.com/a.png");
    expect(document.querySelector("label[for='picture']")?.textContent).toBe(
      "Profile Picture URL"
    );

    setValue(urlInput(), "https://example.com/b.png");
    expect(onChange).toHaveBeenCalledWith("https://example.com/b.png");
  });

  it("still takes a pasted address with no upload at all", () => {
    const { onChange, upload } = mount();

    setValue(urlInput(), "https://cdn.example/me.webp");

    expect(onChange).toHaveBeenCalledWith("https://cdn.example/me.webp");
    expect(upload.begin).not.toHaveBeenCalled();
  });

  it("works for the banner as well", () => {
    mount({ field: "banner" });

    expect(urlInput("banner")).toBeTruthy();
    expect(document.querySelector("label[for='banner']")?.textContent).toBe(
      "Banner Image URL"
    );
  });

  it("never renders an image: the address is not previewed", () => {
    mount({ value: "https://example.com/a.png" });

    expect(document.querySelectorAll("img")).toHaveLength(0);
  });
});

describe("ProfileImageField: choosing a file", () => {
  it("offers Upload and a file input that takes the four types", () => {
    mount();

    expect(uploadButton()?.textContent).toContain("Upload image");
    expect(uploadButton()?.disabled).toBe(false);
    expect(fileInput().accept).toBe("image/jpeg,image/png,image/gif,image/webp");
  });

  it("starts the upload for this field with the chosen file", async () => {
    const { upload } = mount({ field: "banner" });
    const file = new File([jpeg().slice()], "me.jpg", { type: "image/jpeg" });

    await chooseFile(fileInput(), file);

    expect(upload.begin).toHaveBeenCalledTimes(1);
    expect(upload.begin).toHaveBeenCalledWith(file, "banner");
  });

  it("clears the file input so the same file can be chosen again", async () => {
    mount();
    const file = new File([jpeg().slice()], "me.jpg", { type: "image/jpeg" });

    await chooseFile(fileInput(), file);

    expect(fileInput().value).toBe("");
  });

  it("opens the file chooser from the Upload button", async () => {
    mount();
    const clicked = vi.spyOn(fileInput(), "click").mockImplementation(() => {});

    await click(uploadButton()!);

    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("ignores a change event that carries no file", async () => {
    const { upload } = mount();

    await chooseFile(fileInput(), undefined as unknown as File);

    expect(upload.begin).not.toHaveBeenCalled();
  });
});

describe("ProfileImageField: while an upload runs", () => {
  it.each([
    ["preparing", "Preparing image..."],
    ["authorising", "Authorising..."],
    ["uploading", "Uploading to blossom.primal.net..."],
  ] as const)("shows %s as plain text with a Cancel action, and no progress bar", (step, text) => {
    const { upload } = mount({
      state: { stage: "working", field: "picture", step, host: "blossom.primal.net" },
    });

    const status = document.querySelector("output");
    expect(status?.textContent).toContain(text);
    expect(document.querySelector("[role='progressbar']")).toBeNull();
    expect(document.querySelector("progress")).toBeNull();
    expect(status?.textContent).not.toMatch(/\d+\s*%/);
    expect(button(document.body, "Cancel")).toBeTruthy();
    expect(upload.cancel).not.toHaveBeenCalled();
  });

  it("calls cancel from the Cancel action", async () => {
    const { upload } = mount({
      state: { stage: "working", field: "picture", step: "uploading", host: "blossom.primal.net" },
    });

    await click(button(document.body, "Cancel"));

    expect(upload.cancel).toHaveBeenCalledTimes(1);
  });

  it("disables Upload on this field while it runs", () => {
    mount({
      state: { stage: "working", field: "picture", step: "uploading", host: "blossom.primal.net" },
    });

    expect(uploadButton()).toBeNull();
    expect(urlInput().disabled).toBe(true);
  });

  it("disables Upload on the other field but shows no Cancel and no status there", () => {
    mount({
      field: "banner",
      state: { stage: "working", field: "picture", step: "uploading", host: "blossom.primal.net" },
    });

    expect(uploadButton("banner")?.disabled).toBe(true);
    expect(document.querySelector("output")).toBeNull();
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (candidate) => candidate.textContent?.trim() === "Cancel"
      )
    ).toBe(false);
    expect(urlInput("banner").disabled).toBe(false);
  });

  it.each(["inspecting", "choosing"] as const)(
    "disables Upload while %s, so a second file cannot be chosen under the dialog",
    (stage) => {
      const state: UploadState =
        stage === "inspecting"
          ? { stage, field: "picture" }
          : { stage, field: "picture", animated: false };
      mount({ state });

      expect(uploadButton()?.disabled).toBe(true);
    }
  );
});

describe("ProfileImageField: outcomes", () => {
  it("shows a failure as an alert beside the field it belongs to", () => {
    mount({
      state: { stage: "failed", field: "picture", message: "Could not reach blossom.primal.net." },
    });

    expect(document.querySelector("[role='alert']")?.textContent).toBe(
      "Could not reach blossom.primal.net."
    );
  });

  it("leaves the field's value alone on a failure", () => {
    mount({
      value: "https://example.com/keep.png",
      state: { stage: "failed", field: "picture", message: "The host's rules do not allow this upload." },
    });

    expect(urlInput().value).toBe("https://example.com/keep.png");
  });

  it("shows a failure for the other field nowhere here", () => {
    mount({
      field: "banner",
      state: { stage: "failed", field: "picture", message: "Could not reach blossom.primal.net." },
    });

    expect(document.querySelector("[role='alert']")).toBeNull();
  });

  it("shows success as a status that says where it went and what to do next", () => {
    mount({
      state: {
        stage: "done",
        field: "picture",
        message: "Uploaded to blossom.primal.net. Save your profile to use it.",
      },
    });

    const status = document.querySelector("output");
    expect(status?.textContent).toBe(
      "Uploaded to blossom.primal.net. Save your profile to use it."
    );
    expect(status?.textContent?.toLowerCase()).not.toContain("verified");
  });

  it("clears a finished status when the user edits the address", () => {
    const { upload } = mount({
      state: { stage: "done", field: "picture", message: "Uploaded to blossom.primal.net. Save your profile to use it." },
    });

    setValue(urlInput(), "https://example.com/other.png");

    expect(upload.dismiss).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss another field's status when editing this one", () => {
    const { upload } = mount({
      field: "banner",
      state: { stage: "failed", field: "picture", message: "Could not reach blossom.primal.net." },
    });

    setValue(urlInput("banner"), "https://example.com/b.png");

    expect(upload.dismiss).not.toHaveBeenCalled();
  });
});

describe("ProfileImageField: removing the image", () => {
  const removeButton = () =>
    Array.from(document.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "Remove"
    );

  it("offers Remove only when the field has a value", () => {
    mount({ value: "" });
    expect(removeButton()).toBeUndefined();

    unmountAll();
    mount({ value: "https://example.com/a.png" });
    expect(removeButton()).toBeDefined();
    expect(removeButton()?.getAttribute("title")).toBe("Remove image");
  });

  it("clears the field from Remove, without touching the upload", async () => {
    const { onChange, upload } = mount({ value: "https://example.com/a.png" });

    await click(removeButton()!);

    expect(onChange).toHaveBeenCalledWith("");
    expect(upload.begin).not.toHaveBeenCalled();
  });

  it("clears a finished status when Remove is used", async () => {
    const { upload } = mount({
      value: "https://example.com/a.png",
      state: { stage: "done", field: "picture", message: "Uploaded to blossom.primal.net. Save your profile to use it." },
    });

    await click(removeButton()!);

    expect(upload.dismiss).toHaveBeenCalledTimes(1);
  });

  it("is unavailable while an upload runs or the profile saves", () => {
    mount({
      value: "https://example.com/a.png",
      state: { stage: "working", field: "picture", step: "uploading", host: "blossom.primal.net" },
    });
    expect(removeButton()).toBeUndefined();

    unmountAll();
    mount({ value: "https://example.com/a.png", disabled: true });
    expect(removeButton()?.disabled).toBe(true);

    unmountAll();
    mount({
      value: "https://example.com/a.png",
      field: "banner",
      state: { stage: "working", field: "picture", step: "uploading", host: "blossom.primal.net" },
    });
    expect(removeButton()?.disabled).toBe(true);
  });
});

describe("ProfileImageField: help text", () => {
  it("says what can be pasted or uploaded", () => {
    mount();

    expect(document.body.textContent).toContain(
      "Paste an https:// address, or upload a JPEG, PNG, GIF or WebP up to 5 MB."
    );
  });
});

describe("ProfileImageField: messages and help", () => {
  it("puts a failure directly under the controls, before the help text", () => {
    mount({
      state: { stage: "failed", field: "picture", message: "Could not reach blossom.primal.net." },
    });

    const alert = document.querySelector("[role='alert']")!;
    const help = document.getElementById("picture-help")!;
    expect(
      alert.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("ties the help text to the input", () => {
    mount();

    expect(urlInput().getAttribute("aria-describedby")).toBe("picture-help");
    expect(document.getElementById("picture-help")?.textContent).toContain("up to 5 MB");
  });
});

describe("ProfileImageField: disabled", () => {
  it("disables the input and the Upload button while the profile is saving", () => {
    mount({ disabled: true });

    expect(urlInput().disabled).toBe(true);
    expect(uploadButton()?.disabled).toBe(true);
  });
});
