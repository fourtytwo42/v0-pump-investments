"use client"

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { normalizeSliderValue } from "@/lib/slider-values"
import { cn } from "@/lib/utils"

interface SliderProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>,
    "value" | "defaultValue" | "onValueChange" | "onValueCommit"
  > {
  value: number[]
  onValueChange?: (value: number[]) => void
  onValueCommit?: (value: number[]) => void
  thumbLabel?: string
}

const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  (
    {
      className,
      value,
      min = 0,
      max = 100,
      step = 1,
      onValueChange,
      onValueCommit,
      thumbLabel = "Value",
      ...props
    },
    ref,
  ) => {
    const normalizedValue = normalizeSliderValue(value[0], min, max, step)
    const [localValue, setLocalValue] = React.useState(() => [normalizedValue])
    const localValueRef = React.useRef(localValue)
    const lastCommittedValueRef = React.useRef(normalizedValue)

    React.useEffect(() => {
      const nextValue = [normalizeSliderValue(value[0], min, max, step)]
      localValueRef.current = nextValue
      lastCommittedValueRef.current = nextValue[0]
      setLocalValue(nextValue)
    }, [value[0], min, max, step])

    const handleChange = (next: number[]) => {
      const normalized = [normalizeSliderValue(next[0], min, max, step)]
      localValueRef.current = normalized
      setLocalValue(normalized)
      onValueChange?.(normalized)
    }

    const commitValue = (normalized: number[]) => {
      if (normalized[0] === lastCommittedValueRef.current) return
      lastCommittedValueRef.current = normalized[0]
      localValueRef.current = normalized
      setLocalValue(normalized)
      onValueCommit?.(normalized)
    }

    const handleCommit = (next: number[]) => {
      commitValue([normalizeSliderValue(next[0], min, max, step)])
    }

    return (
      <SliderPrimitive.Root
        ref={ref}
        className={cn("relative flex w-full touch-none select-none items-center py-3", className)}
        value={localValue}
        min={min}
        max={max}
        step={step}
        onValueChange={handleChange}
        onValueCommit={handleCommit}
        onPointerUp={() => commitValue(localValueRef.current)}
        {...props}
      >
        <SliderPrimitive.Track className="relative h-2.5 w-full grow overflow-hidden rounded-full bg-secondary">
          <SliderPrimitive.Range className="absolute h-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label={thumbLabel}
          className="relative block h-7 w-7 shrink-0 touch-none rounded-full border-2 border-primary bg-background shadow-sm ring-offset-background after:absolute after:-inset-2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-grab active:cursor-grabbing"
        />
      </SliderPrimitive.Root>
    )
  },
)
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
