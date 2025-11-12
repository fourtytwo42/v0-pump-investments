"use client"
import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { cn } from "@/lib/utils"

interface RangeSliderProps {
  className?: string
  min: number
  max: number
  step?: number
  value: [number, number]
  onValueChange: (value: [number, number]) => void
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
  formatValue = (v) => v.toString(),
  disabled,
}: RangeSliderProps) {
  const [localValue, setLocalValue] = React.useState<[number, number]>(value)

  React.useEffect(() => {
    setLocalValue(value)
  }, [value[0], value[1]])

  const handleSliderChange = (newValues: number[]) => {
    if (newValues.length === 2) {
      const newValue: [number, number] = [newValues[0], newValues[1]]
      setLocalValue(newValue) // Update local state immediately for smooth dragging
      onValueChange(newValue)
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <SliderPrimitive.Root
        className="relative flex w-full touch-none select-none items-center"
        value={localValue}
        onValueChange={handleSliderChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        minStepsBetweenThumbs={0}
      >
        <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
          <SliderPrimitive.Range className="absolute h-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-grab active:cursor-grabbing hover:scale-110" />
        <SliderPrimitive.Thumb className="block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-grab active:cursor-grabbing hover:scale-110" />
      </SliderPrimitive.Root>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Min: {formatValue(localValue[0])}</span>
        <span>Max: {formatValue(localValue[1])}</span>
      </div>
    </div>
  )
}
