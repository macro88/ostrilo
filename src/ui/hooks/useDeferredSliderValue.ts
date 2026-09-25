import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Lets a slider bound to a password-gated setting be dragged.
 *
 * Both timeout sliders render the *stored* setting, and storing it costs a
 * password. Wiring the write to `onValueChange` meant the dialog opened on the
 * first step of a drag, took the pointer, and killed it: the control could only
 * ever be moved one step at a time, and only to wherever that step landed. So
 * the drag moves a local draft, and only letting go asks.
 *
 * The draft is also what makes the gesture possible at all. Radix fires
 * `onValueCommit` only when the controlled value differs from what it was at
 * slide start, and the persisted value cannot move until the password is given,
 * so without a draft the commit would never fire and the thumb would never
 * leave its starting position.
 *
 * ---
 *
 * The pointer release is ours to detect, and this is the subtle part.
 *
 * Radix decides whether a drag changed anything by reading the controlled value
 * out of the render closure its `onSlideEnd` was created in:
 *
 *     const hasChanged = String(values) !== String(valuesBeforeSlideStartRef.current);
 *     if (hasChanged) onValueCommit(values);
 *
 * `pointermove` is a continuous-priority event in React and `pointerup` a
 * discrete one, so a quick flick delivers the release before React has
 * committed the render carrying the new draft. Both sides of that comparison
 * are then the value the drag started from, `hasChanged` is false, and the
 * commit never happens - while the draft, set synchronously, has already moved
 * the thumb. The slider sits there showing a timeout the vault is not using.
 * That is the worst failure available to this particular control, and it is
 * silent.
 *
 * So the pointer release is handled here, off a ref written synchronously in
 * `onValueChange`, where no render has to have happened for it to be right.
 * `onValueCommit` is still honoured because the keyboard path needs it - there
 * Radix commits the values it has just computed inside its own state updater,
 * which are never stale - and `send` refuses a repeat of a value already in
 * flight, so the slow drag that fires both routes still asks exactly once.
 *
 * @param stored  the persisted value, already normalized for display
 * @param commit  writes the value; must reject if refused or cancelled
 */
export function useDeferredSliderValue(
  stored: number,
  commit: (value: number) => Promise<unknown>
) {
  const [draft, setDraft] = useState<number | null>(null);
  const [draftBasis, setDraftBasis] = useState(stored);
  const draftRef = useRef<number | null>(null);
  const storedRef = useRef(stored);
  const inFlightRef = useRef<number | null>(null);

  /*
    The store is authoritative the moment it speaks, so the draft retires then
    - not when `commit` resolves.

    Those are different instants. `commit` resolves as soon as the background
    has written, but `stored` only catches up afterwards, over a broadcast and
    a second round trip. Dropping the draft on resolve would snap the thumb
    back to the old value until that landed: a visible bounce, on the one
    control where "did that actually take?" is the question you least want to
    leave a user asking.

    The state reset happens during render, so the retired draft is never
    painted; the refs follow in an effect, since render must not write them.
  */
  if (stored !== draftBasis) {
    setDraftBasis(stored);
    setDraft(null);
  }
  useEffect(() => {
    storedRef.current = stored;
    draftRef.current = null;
  }, [stored]);

  const send = useCallback(
    async (next: number) => {
      // Nothing to write, and nothing to ask about.
      if (next === storedRef.current) return;
      // Already asking for exactly this. Guards the slow drag, where Radix's
      // own commit arrives just behind the pointer release handled below.
      if (next === inFlightRef.current) return;

      inFlightRef.current = next;
      draftRef.current = next;
      setDraft(next);
      try {
        await commit(next);
      } catch {
        // Refused or cancelled. Nothing moved, so the thumb goes back to where
        // it was: a draft left standing here would show a timeout the vault is
        // not actually using.
        draftRef.current = null;
        setDraft(null);
      } finally {
        inFlightRef.current = null;
      }
    },
    [commit]
  );

  const value = draft ?? stored;

  return {
    value,
    sliderProps: {
      value: [value],

      onValueChange: (values: number[]) => {
        draftRef.current = values[0];
        setDraft(values[0]);
      },

      // Keyboard only in practice: Radix passes the values it computed inside
      // its state updater, so these are always current. A drag that reaches
      // here too is absorbed by the in-flight check in `send`.
      onValueCommit: (values: number[]) => {
        void send(values[0]);
      },

      // Runs before Radix's own handler, which is where the value for this
      // gesture gets set, so the previous gesture's draft cannot leak into it.
      onPointerDown: () => {
        draftRef.current = null;
      },

      onPointerUp: () => {
        const next = draftRef.current;
        if (next !== null) void send(next);
      },

      // A cancelled gesture is not a decision. Radix does not end the slide on
      // this event, so without it the draft would be stranded on screen.
      onPointerCancel: () => {
        draftRef.current = null;
        setDraft(null);
      },
    },
  };
}
