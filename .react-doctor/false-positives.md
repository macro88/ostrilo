# Reviewed React Doctor findings

Findings that have been investigated and rejected, with the evidence and the
predicate that makes them a false positive. A finding belongs here only when
the reviewed conclusion is that the flagged code is CORRECT — never as a way
to quiet a finding nobody has looked at.

A suppression recorded here is valid only while every predicate below still
holds. Re-check the predicate before relying on an entry; if the code has moved
on, delete the entry rather than stretching it.

## `react-doctor/no-array-index-as-key` — `src/ui/components/ui/slider.tsx`

**Occurrence:** the `key={index}` on `SliderPrimitive.Thumb`.

**Predicate (all must hold):**

1. The mapped array is the slider's value tuple (`_values`), which is derived
   from `value`, `defaultValue`, or `[min, max]`.
2. That tuple is positional and fixed-length: thumb 0 is the low thumb, thumb 1
   the high one. It is never reordered, sorted, or filtered.
3. The thumbs carry no per-item identity of their own — no id, no slug, nothing
   stable but their position.

**Why the rule's remedy is wrong here.** The rule asks for a stable per-item id.
A slider thumb's only stable identity IS its position, so the index is that id.
The code previously did try to key on data — `key={`${index}-${valueAtThumb}`}`
— and that was the actual defect: every consumer of this component is a
controlled, single-thumb slider (auto-lock timeout, session lifetime, activity
log retention), so folding the value into the key remounted the thumb on every
step of a drag, dropping DOM focus from the element the user was arrow-keying.
Keying on data made a reorder-safety rule pass while breaking the control.

**How it is suppressed.** `react-doctor rules disable` is repository-wide, and
this rule earns its place on the genuine lists elsewhere in the UI, so it is not
disabled. An inline `oxlint-disable-next-line` comment was tried and does not
apply. Instead `doctor.config.jsonc` carries an `ignore.overrides` entry scoped
to this one rule in this one file, pointing back here. If any predicate above
stops holding, delete that override along with this entry.

**Also:** `key={index}` is the upstream shadcn/ui form of this component.
Keeping it keeps future shadcn updates diffable.

**Reviewed:** 2026-09-16, against react-doctor 0.9.14. Override added 2026-09-25.
