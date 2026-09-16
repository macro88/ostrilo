import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          "bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1"
        )}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn(
            "bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
          )}
        />
      </SliderPrimitive.Track>
      {/*
        Radix puts `role="slider"` on the Thumb, not on the Root, so a label
        left on the Root names nothing: the control a screen reader reaches
        announces itself as "slider" with a bare number and no indication of
        what it sets. Both settings this drives — auto-lock and session
        lifetime — decide how long an unlocked vault stays unlocked, so an
        unlabelled control here is a security surface nobody can read.

        Named per thumb, and only when there is one thumb: a range slider's two
        thumbs would otherwise share one name and be indistinguishable.
      */}
      {/*
        Keyed by thumb POSITION, deliberately. A thumb's identity on a slider is
        where it sits in the value tuple - thumb 0 is the low thumb, thumb 1 the
        high one - and that never reorders or filters. The value is not identity
        here, it is the state the thumb carries.

        The previous key folded the value in (`${index}-${valueAtThumb}`), which
        changed on every step of a drag, so React unmounted and remounted the
        thumb each time. Every consumer of this component is controlled and
        single-thumb (auto-lock, session lifetime, activity retention), so that
        remount landed on the element holding DOM focus: arrow-keying one of
        these controls dropped focus after each keypress, on settings that
        decide how long an unlocked vault stays unlocked.
      */}
      {_values.map((_valueAtThumb, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          aria-label={_values.length === 1 ? ariaLabel : undefined}
          aria-labelledby={_values.length === 1 ? ariaLabelledBy : undefined}
          key={index}
          className="seal border-primary bg-primary ring-ring/35 block size-4 shrink-0 border transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
