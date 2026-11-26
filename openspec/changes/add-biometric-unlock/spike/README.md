# PRF spike

Throwaway harness for task group 1. Not product code; delete it when
`prf-platform-matrix.md` is written.

## Load

1. `chrome://extensions` → Developer mode → Load unpacked → this folder.
2. The identifier must read `dekpcojmghilnlhgbjhcmlmjhhlchbpl` on every machine.
   A different one means the manifest `key` was not honoured.
3. Open the extension's options page (Details → Extension options).

## Per authenticator row (tasks 1.2, 1.3)

Type the row label first; it is written into every log line.

1. `create()`. Note which chooser appears and what you picked.
2. `get() — UV required`, twice. The second line should say
   `matchesEnrolledOutput: true`.
3. `get() — UV discouraged`. Note whether a verification prompt appeared.
   `matchesEnrolledOutput: true` together with `userVerified: false` is the
   leak that rules a class out.
4. Look in the platform's credential manager and note what entry is left.
5. `Copy log`, paste it somewhere, then `Forget stored credential` and
   `Clear log` before the next row.

## Hosts (task 1.4)

With a credential stored, run `get() — UV required` from each of: the options
tab, `Open in a created window`, the toolbar popup, and `Open side panel`. For
the background tab, use `get() — UV required, in 5 s` and switch to another tab
before it fires; `startedVisibility: "hidden"` in the log confirms the switch
was in time.

## Deleted credential (task 1.6)

Delete the entry in the platform's credential manager, then run
`get() — UV required`. The log line's `error`, `message` and `ms` are the
answer.
