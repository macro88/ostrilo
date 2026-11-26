// Throwaway measurement harness for add-biometric-unlock task group 1.
// Nothing here is product code. The stored credential and the log live in
// localStorage so that every host (popup, side panel, options tab, created
// window) of this extension origin sees the same ones.

const CREDENTIAL_KEY = "prf-spike-credential";
const LOG_KEY = "prf-spike-log";
const ROW_KEY = "prf-spike-row";
const DELAY_MS = 5000;

const host = new URLSearchParams(location.search).get("host") ?? "tab";
const byId = (id) => document.getElementById(id);

const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const randomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

const readJson = (key, fallback) => JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));

// The harness never prints PRF output. A truncated SHA-256 is enough to tell
// whether two assertions returned the same bytes.
async function fingerprint(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

function readFlags(authenticatorData) {
  const data = new Uint8Array(authenticatorData);
  if (data.length < 33) return { error: `authenticator data is ${data.length} bytes` };
  const flags = data[32];
  return {
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    backupEligible: (flags & 0x08) !== 0,
    backupState: (flags & 0x10) !== 0,
  };
}

function render() {
  const credential = readJson(CREDENTIAL_KEY, null);
  byId("credential").textContent = credential
    ? JSON.stringify({ ...credential, salt: "(32 bytes)" }, null, 2)
    : "none stored";
  byId("log").textContent = readJson(LOG_KEY, [])
    .map((entry) => JSON.stringify(entry))
    .join("\n");
}

function record(step, result) {
  const entry = {
    at: new Date().toISOString(),
    row: byId("row").value,
    host,
    visibility: document.visibilityState,
    focused: document.hasFocus(),
    step,
    ...result,
  };
  writeJson(LOG_KEY, [...readJson(LOG_KEY, []), entry]);
  render();
}

// Runs one ceremony and logs its outcome either way. The elapsed time is what
// separates a refusal from a cancelled prompt from a timeout in task 1.6.
async function measure(step, ceremony) {
  const startedVisibility = document.visibilityState;
  const started = performance.now();
  try {
    const result = await ceremony();
    record(step, { ok: true, ms: Math.round(performance.now() - started), startedVisibility, ...result });
  } catch (error) {
    record(step, {
      ok: false,
      ms: Math.round(performance.now() - started),
      startedVisibility,
      error: error.name,
      message: error.message,
    });
  }
}

async function create() {
  const algorithms = byId("es256-only").checked ? [-7] : [-7, -257];
  const salt = randomBytes(32);
  const credential = await navigator.credentials.create({
    publicKey: {
      rp: { name: "Ostrilo PRF spike" },
      user: { id: randomBytes(16), name: "ostrilo-spike", displayName: "Ostrilo PRF spike" },
      challenge: randomBytes(32),
      pubKeyCredParams: algorithms.map((alg) => ({ type: "public-key", alg })),
      attestation: "none",
      authenticatorSelection: { userVerification: "required", residentKey: "discouraged" },
      extensions: { prf: {} },
    },
  });
  const extensions = credential.getClientExtensionResults();
  const transports = credential.response.getTransports();
  writeJson(CREDENTIAL_KEY, {
    id: toBase64(credential.rawId),
    transports,
    salt: toBase64(salt),
    fingerprintWithUv: null,
  });
  return {
    offered: algorithms,
    algorithm: credential.response.getPublicKeyAlgorithm(),
    attachment: credential.authenticatorAttachment,
    transports,
    prfEnabled: extensions.prf?.enabled ?? null,
    prfResultsAtCreate: extensions.prf?.results?.first !== undefined,
    credProps: extensions.credProps ?? null,
    ...readFlags(credential.response.getAuthenticatorData()),
  };
}

async function assert(userVerification) {
  const stored = readJson(CREDENTIAL_KEY, null);
  if (!stored) throw new Error("no stored credential — run create() first");
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [
        { type: "public-key", id: fromBase64(stored.id), transports: stored.transports },
      ],
      userVerification,
      extensions: { prf: { eval: { first: fromBase64(stored.salt) } } },
    },
  });
  const output = assertion.getClientExtensionResults().prf?.results?.first;
  const flags = readFlags(assertion.response.authenticatorData);
  if (!output) return { prfBytes: 0, ...flags };

  const print = await fingerprint(output);
  const result = {
    prfBytes: output.byteLength,
    fingerprint: print,
    matchesEnrolledOutput: stored.fingerprintWithUv === null ? null : stored.fingerprintWithUv === print,
    ...flags,
  };
  if (userVerification === "required" && stored.fingerprintWithUv === null) {
    writeJson(CREDENTIAL_KEY, { ...stored, fingerprintWithUv: print });
  }
  return result;
}

async function describeEnvironment() {
  const lines = [
    `host: ${host}`,
    `origin: ${location.origin}`,
    `userAgent: ${navigator.userAgent}`,
  ];
  const platform = await navigator.userAgentData?.getHighEntropyValues(["platformVersion"]);
  if (platform) lines.push(`platform: ${platform.platform} ${platform.platformVersion}`);
  if (!window.PublicKeyCredential) {
    lines.push("PublicKeyCredential: missing");
  } else {
    lines.push(
      `platform authenticator available: ${await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()}`,
    );
    if (PublicKeyCredential.getClientCapabilities) {
      const capabilities = await PublicKeyCredential.getClientCapabilities();
      lines.push(`client capabilities: ${JSON.stringify(capabilities)}`);
    }
  }
  byId("env").textContent = lines.join("\n");
  return lines;
}

byId("row").value = localStorage.getItem(ROW_KEY) ?? "";
byId("row").addEventListener("input", () => localStorage.setItem(ROW_KEY, byId("row").value));

byId("create").addEventListener("click", () => measure("create", create));
byId("get-required").addEventListener("click", () =>
  measure("get uv=required", () => assert("required")),
);
byId("get-discouraged").addEventListener("click", () =>
  measure("get uv=discouraged", () => assert("discouraged")),
);
// For the background-tab row of task 1.4: click, then switch to another tab
// before the delay ends. `startedVisibility` in the log says whether it worked.
byId("get-delayed").addEventListener("click", () => {
  setTimeout(() => measure("get uv=required delayed", () => assert("required")), DELAY_MS);
});
byId("forget").addEventListener("click", () => {
  localStorage.removeItem(CREDENTIAL_KEY);
  render();
});

byId("open-window").addEventListener("click", () =>
  chrome.windows.create({
    url: chrome.runtime.getURL("spike.html?host=window"),
    type: "popup",
    width: 420,
    height: 640,
  }),
);
byId("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
byId("open-sidepanel").addEventListener("click", async () => {
  const current = await chrome.windows.getCurrent();
  await chrome.sidePanel.open({ windowId: current.id });
});

byId("copy").addEventListener("click", async () => {
  const environment = await describeEnvironment();
  await navigator.clipboard.writeText(`${environment.join("\n")}\n\n${byId("log").textContent}`);
});
byId("clear").addEventListener("click", () => {
  localStorage.removeItem(LOG_KEY);
  render();
});

window.addEventListener("storage", render);
describeEnvironment();
render();
