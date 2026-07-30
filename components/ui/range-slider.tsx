"use client"
import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { cn } from "@/lib/utils"
import { normalizeSliderRange } from "@/lib/slider-values"

interface RangeSliderProps {
  className?: string
  min: number
  max: number
  step?: number
  value: [number, number]
  onValueChange?: (value: [number, number]) => void
  onValueCommit?: (value: [number, number]) => void
  formatValue?: (value: number) => string
  disabled?: boolean
}

export function RangeSlider({
  className,
  min,
  max,
  step = 1,
  value,
  onValueChange,
  onValueCommit,
  formatValue = (v) => v.toString(),
  disabled,
}: RangeSliderProps) {
  const [localValue, setLocalValue] = React.useState<[number, number]>(() =>
    normalizeSliderRange(value, min, max, step),
  )
  const localValueRef = React.useRef(localValue)
  const lastCommittedValueRef = React.useRef(localValue)

  React.useEffect(() => {
    const nextValue = normalizeSliderRange(value, min, max, step)
    localValueRef.current = nextValue
    lastCommittedValueRef.current = nextValue
    setLocalValue(nextValue)
  }, [value[0], value[1], min, max, step])

  const handleSliderChange = (newValues: number[]) => {
    if (newValues.length === 2) {
      const nextValue = normalizeSliderRange(newValues, min, max, step)
      localValueRef.current = nextValue
      setLocalValue(nextValue)
      onValueChange?.(nextValue)
    }
  }

  const commitValue = (nextValue: [number, number]) => {
    const previous = lastCommittedValueRef.current
    if (nextValue[0] === previous[0] && nextValue[1] === previous[1]) return
    lastCommittedValueRef.current = nextValue
    localValueRef.current = nextValue
    setLocalValue(nextValue)
    onValueCommit?.(nextValue)
  }

  const handleSliderCommit = (newValues: number[]) => {
    if (newValues.length !== 2) return
    commitValue(normalizeSliderRange(newValues, min, max, step))
  }

  return (
    <div className={cn("space-y-2", className)}>
      <SliderPrimitive.Root
        className="relative flex w-full touch-none select-none items-center py-3"
        value={localValue}
        onValueChange={handleSliderChange}
        onValueCommit={handleSliderCommit}
        onPointerUp={() => commitValue(localValueRef.current)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        minStepsBetweenThumbs={0}
      >
        <SliderPrimitive.Track className="relative h-2.5 w-full grow overflow-hidden rounded-full bg-secondary">
          <SliderPrimitive.Range className="absolute h-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label="Minimum"
          className="relative block h-7 w-7 shrink-0 touch-none rounded-full border-2 border-primary bg-background shadow-sm ring-offset-background after:absolute after:-inset-2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-grab active:cursor-grabbing"
        />
        <SliderPrimitive.Thumb
          aria-label="Maximum"
          className="relative block h-7 w-7 shrink-0 touch-none rounded-full border-2 border-primary bg-background shadow-sm ring-offset-background after:absolute after:-inset-2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-grab active:cursor-grabbing"
        />
      </SliderPrimitive.Root>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Min: {formatValue(localValue[0])}</span>
        <span>Max: {formatValue(localValue[1])}</span>
      </div>
    </div>
  )
}
