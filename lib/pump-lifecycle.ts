import { PUMP_HEADERS } from "@/lib/pump-coin"
import type { PumpLifecyclePayload } from "@/lib/token-lifecycle"

const PUMP_BATCH_URL = "https://frontend-api-v3.pump.fun/coins-v2/mints"
const PUMP_SINGLE_URL = (mint: string) =>
  `https://frontend-api-v3.pump.fun/coins-v3/${encodeURIComponent(mint)}?includeLiveStreamInfo=false`

export const DEFAULT_LIFECYCLE_BATCH_SIZE = 50

export class PumpLifecycleRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryAfterMs: number | null,
  ) {
    super(message)
    this.name = "PumpLifecycleRequestError"
  }
}

function parseRetryAfterMs(response: Response): number | null {
  const retryAfter = response.headers.get("retry-after")
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
    const date = Date.parse(retryAfter)
    if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  }

  const reset = Number(response.headers.get("x-ratelimit-reset"))
  return Number.isFinite(reset) && reset > 0 ? reset * 1000 : null
}

async function parsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("json")) {
    throw new PumpLifecycleRequestError(
      `Pump lifecycle response was not JSON (${response.status})`,
      response.status,
      parseRetryAfterMs(response),
    )
  }
  return response.json()
}

export async function fetchPumpLifecycleBatch(
  mints: string[],
  signal?: AbortSignal,
): Promise<PumpLifecyclePayload[]> {
  const response = await fetch(PUMP_BATCH_URL, {
    method: "POST",
    headers: { ...PUMP_HEADERS, "content-type": "application/json" },
    body: JSON.stringify({ mints, includeNsfw: true, include_nsfw: true }),
    cache: "no-store",
    signal,
  })

  if (!response.ok) {
    throw new PumpLifecycleRequestError(
      `Pump lifecycle batch failed with status ${response.status}`,
      response.status,
      parseRetryAfterMs(response),
    )
  }

  const payload = await parsePayload(response)
  if (!Array.isArray(payload)) {
    throw new PumpLifecycleRequestError("Pump lifecycle batch returned an invalid payload", response.status, null)
  }
  return payload as PumpLifecyclePayload[]
}

export async function fetchPumpLifecycleSingle(
  mint: string,
  signal?: AbortSignal,
): Promise<PumpLifecyclePayload | null> {
  const response = await fetch(PUMP_SINGLE_URL(mint), {
    headers: PUMP_HEADERS,
    cache: "no-store",
    signal,
  })

  if (response.status === 404) return null
  if (!response.ok) {
    throw new PumpLifecycleRequestError(
      `Pump lifecycle single request failed with status ${response.status}`,
      response.status,
      parseRetryAfterMs(response),
    )
  }
  return (await parsePayload(response)) as PumpLifecyclePayload
}
