#!/bin/sh
set -u

# aislop after every agent edit batch. Companion to react-doctor.sh: React
# Doctor judges React correctness, accessibility and bundle shape; aislop
# judges what an agent left behind - narrative comments, swallowed
# exceptions, `as any`, console leftovers, dead code, oversized functions.
#
# This wraps `aislop hook claude`, aislop's own Claude Code callback, rather
# than reimplementing it: that callback owns the baseline, the regression
# comparison and the `aislop.hook.v2` feedback shape the agent reads.
#
# Two things the wrapper adds:
#
#  1. It runs on PostToolBatch, not PostToolUse. A scoped aislop run costs
#     ~10s. Per-edit that is a minute of latency on a six-edit batch, and the
#     agent is not in a position to act on findings until the batch is done
#     anyway. aislop's own installer registers PostToolUse, so it is not used
#     here. The batch's edited paths are collected and handed over as one run.
#
#  2. It calls the pinned binary. aislop's installer writes a bare `aislop`,
#     which resolves to nothing for a devDependency, and the published CI
#     snippets use `npx aislop@latest`. See the react-doctor.sh note and
#     AGENTS.md: this repository does not fetch and execute an unpinned
#     dependency tree after every file edit on a machine holding signing keys.

input_file=$(mktemp "${TMPDIR:-/tmp}/aislop-agent-hook.XXXXXX")
payload_file=$(mktemp "${TMPDIR:-/tmp}/aislop-agent-hook-payload.XXXXXX")
output_file=$(mktemp "${TMPDIR:-/tmp}/aislop-agent-hook-output.XXXXXX")
trap 'rm -f "$input_file" "$payload_file" "$output_file"' EXIT
cat > "$input_file"

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
project_root=${CLAUDE_PROJECT_DIR:-}
if [ -z "$project_root" ]; then
  project_root=$(CDPATH= cd "$script_dir/../.." && pwd)
fi
if ! cd "$project_root"; then
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  exit 0
fi

# Collects the edited paths out of the batch and rewrites them into the
# single-call shape `aislop hook claude` reads (`tool_input.edits[].file_path`).
# Exits 10 when the batch touched no files, which means there is nothing to
# scan rather than nothing to report.
build_payload() {
  node - "$input_file" > "$payload_file" <<'NODE'
const fs = require('node:fs');
const editToolNames = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'ApplyPatch']);
const files = new Set();

const collect = (toolInput) => {
  if (!toolInput || typeof toolInput !== 'object') return;
  if (typeof toolInput.file_path === 'string' && toolInput.file_path) files.add(toolInput.file_path);
  if (Array.isArray(toolInput.edits)) {
    for (const edit of toolInput.edits) {
      if (edit && typeof edit.file_path === 'string' && edit.file_path) files.add(edit.file_path);
    }
  }
};

let input;
try {
  input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8') || '{}');
} catch {
  process.exit(10);
}

const toolCalls = Array.isArray(input.tool_calls) ? input.tool_calls : [];
if (toolCalls.length > 0) {
  for (const toolCall of toolCalls) {
    if (editToolNames.has(toolCall?.tool_name)) collect(toolCall.tool_input);
  }
} else if (!input.tool_name || editToolNames.has(input.tool_name)) {
  collect(input.tool_input);
}

if (files.size === 0) process.exit(10);

process.stdout.write(JSON.stringify({
  hook_event_name: 'PostToolUse',
  tool_name: 'MultiEdit',
  cwd: input.cwd || process.cwd(),
  session_id: input.session_id,
  tool_input: { edits: [...files].map((file_path) => ({ file_path })) },
}));
NODE
}

# Re-emits aislop's response under the event name that actually fired, or
# passes a plain message through as context when there is no response to
# rewrite. Reads the message from stdin so a `set -u` shell never interpolates
# tool output into an argument.
emit_context() {
  node - "$input_file" "$output_file" "$1" <<'NODE'
const fs = require('node:fs');
const [, , inputPath, outputPath, mode] = process.argv;

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
  } catch {
    return {};
  }
};

const input = readJson(inputPath);
const eventName = input.hook_event_name === 'PostToolBatch' ? 'PostToolBatch' : 'PostToolUse';
const raw = fs.readFileSync(outputPath, 'utf8').trim();
if (!raw) process.exit(0);

let context = raw;
if (mode === 'aislop') {
  // aislop already answers in hook shape; only the event name needs to match
  // the event that fired. Anything unparseable is passed through verbatim
  // rather than dropped - a scanner whose output we cannot read is a finding.
  try {
    const parsed = JSON.parse(raw);
    const inner = parsed?.hookSpecificOutput?.additionalContext;
    if (typeof inner === 'string') context = inner;
  } catch {}
}

console.log(JSON.stringify({
  hookSpecificOutput: { hookEventName: eventName, additionalContext: context },
}));
NODE
}

if ! build_payload; then
  exit 0
fi

if [ ! -x ./node_modules/.bin/aislop ]; then
  printf '%s\n' \
    'aislop: pinned binary not found at ./node_modules/.bin/aislop.' \
    'Install it with:  pnpm install --frozen-lockfile' \
    'Refusing to skip: a quality gate that cannot run is a failure, not a pass.' \
    'Do not substitute `npx aislop@latest` - see AGENTS.md.' > "$output_file"
  emit_context message
  exit 0
fi

./node_modules/.bin/aislop hook claude < "$payload_file" > "$output_file" 2>&1 || true
emit_context aislop
