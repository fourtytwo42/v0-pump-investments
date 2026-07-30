function decimalPlaces(value: number): number {
  const text = value.toString()
  return text.includes(".") ? text.length - text.indexOf(".") - 1 : 0
}

export function normalizeSliderValue(value: number, min: number, max: number, step = 1): number {
  const safeMin = Number.isFinite(min) ? min : 0
  const safeMax = Number.isFinite(max) && max >= safeMin ? max : safeMin
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1
  const finiteValue = Number.isFinite(value) ? value : safeMin
  const clamped = Math.min(safeMax, Math.max(safeMin, finiteValue))
  const snapped = safeMin + Math.round((clamped - safeMin) / safeStep) * safeStep
  const precision = Math.max(decimalPlaces(safeMin), decimalPlaces(safeStep))
  return Number(Math.min(safeMax, Math.max(safeMin, snapped)).toFixed(precision))
}

export function normalizeSliderRange(
  value: readonly number[],
  min: number,
  max: number,
  step = 1,
): [number, number] {
  const first = normalizeSliderValue(value[0], min, max, step)
  const second = normalizeSliderValue(value[1], min, max, step)
  return first <= second ? [first, second] : [second, first]
}
