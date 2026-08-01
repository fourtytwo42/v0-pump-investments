import { z } from "zod"

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 | 429 | 503,
  ) {
    super(message)
  }
}

export async function readJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes: number,
): Promise<T> {
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > maxBytes) throw new ApiRequestError("Request body too large", 413)
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new ApiRequestError("Request body too large", 413)
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new ApiRequestError("Invalid JSON request", 400)
  }
  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new ApiRequestError(result.error.issues[0]?.message ?? "Invalid request", 400)
  }
  return result.data
}

const optionalNumber = z.number().finite().optional()
export const tokenQuerySchema = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  sortBy: z
    .enum(["marketCap", "totalVolume", "buyVolume", "sellVolume", "uniqueTraders", "tokenAge", "lastTrade"])
    .optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  timeRangeMinutes: z.number().min(1).max(60).optional(),
  favoriteMints: z.array(z.string().min(32).max(50)).max(100).optional(),
  filters: z
    .object({
      hideExternal: z.boolean().optional(),
      graduationFilter: z.enum(["all", "bonding", "graduated"]).optional(),
      minMarketCap: optionalNumber,
      maxMarketCap: optionalNumber,
      minTotalVolume: optionalNumber,
      maxTotalVolume: optionalNumber,
      minBuyVolume: optionalNumber,
      maxBuyVolume: optionalNumber,
      minSellVolume: optionalNumber,
      maxSellVolume: optionalNumber,
      minUniqueTraders: optionalNumber,
      maxUniqueTraders: optionalNumber,
      minTradeAmount: optionalNumber,
      maxTradeAmount: optionalNumber,
      minTokenAgeMinutes: optionalNumber,
      maxTokenAgeMinutes: optionalNumber,
      favoritesOnly: z.boolean().optional(),
    })
    .optional(),
})

export const alertStreamSchema = z.object({
  mints: z.array(z.string().regex(/^[A-Za-z0-9]{32,50}$/)).min(1).max(100),
})

const connectionCounts = new Map<string, { count: number; touchedAt: number }>()

export function acquireClientConnection(request: Request, limit = 5): () => void {
  const key =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "direct"
  const current = connectionCounts.get(key) ?? { count: 0, touchedAt: Date.now() }
  if (current.count >= limit) throw new ApiRequestError("Too many streaming connections", 429)
  current.count += 1
  current.touchedAt = Date.now()
  connectionCounts.set(key, current)
  return () => {
    const active = connectionCounts.get(key)
    if (!active) return
    active.count -= 1
    active.touchedAt = Date.now()
    if (active.count <= 0) connectionCounts.delete(key)
  }
}

export function apiErrorResponse(error: unknown): Response {
  if (error instanceof ApiRequestError) {
    return Response.json({ error: error.message }, { status: error.status })
  }
  console.error("[api] unexpected request failure", error)
  return Response.json({ error: "Service unavailable" }, { status: 503 })
}
