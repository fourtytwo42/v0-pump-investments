import "server-only"

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { mkdir, readFile, rename, rm, statfs, writeFile } from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getTokenStreamMetrics } from "@/lib/token-stream"
import { getAlertStreamMetrics } from "@/lib/alert-stream"
import { getImageCacheProcessMetrics } from "@/lib/image-cache-manager"
export { formatTicketNumber, parseTicketNumber, summarizeTicket } from "@/lib/support-ticket-utils"
import { formatTicketNumber } from "@/lib/support-ticket-utils"

export const SUPPORT_COOKIE = "pi_support_session"
export const SUPPORT_COOKIE_MAX_AGE = 365 * 24 * 60 * 60
export const SUPPORT_DIAGNOSTIC_SCHEMA_VERSION = 1
export const SUPPORT_ATTACHMENT_ROOT =
  process.env.SUPPORT_ATTACHMENT_DIR ?? path.join(process.cwd(), "server", "data", "support-attachments")

const errorSchema = z.object({
  at: z.string().max(40),
  kind: z.string().max(40),
  message: z.string().max(500),
  url: z.string().max(500).optional(),
  status: z.number().int().min(0).max(599).optional(),
  durationMs: z.number().min(0).max(300_000).optional(),
}).strip()

export const frontendDiagnosticSchema = z.object({
  appVersion: z.string().max(40),
  capturedAt: z.string().datetime(),
  route: z.string().max(500),
  browser: z.object({
    userAgent: z.string().max(600),
    platform: z.string().max(120),
    language: z.string().max(40),
    timezone: z.string().max(100),
    viewport: z.object({ width: z.number().int().min(0).max(20_000), height: z.number().int().min(0).max(20_000) }),
    pixelRatio: z.number().min(0).max(20),
    online: z.boolean(),
    visibility: z.string().max(30),
    connection: z.object({ effectiveType: z.string().max(30).optional(), downlink: z.number().optional(), rtt: z.number().optional(), saveData: z.boolean().optional() }).optional(),
  }).strip(),
  app: z.object({
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    timeRangeMinutes: z.number().min(1).max(60).optional(),
    sortBy: z.string().max(50).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
    filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    paused: z.boolean().optional(),
    loading: z.boolean().optional(),
    connected: z.boolean().optional(),
    visibleCount: z.number().int().min(0).optional(),
    totalCount: z.number().int().min(0).optional(),
    totalPages: z.number().int().min(0).optional(),
  }).strip(),
  errors: z.array(errorSchema).max(20).default([]),
}).strip()

export const createTicketPayloadSchema = z.object({
  category: z.enum(["FEED", "BONDING_GRADUATION", "TOKEN_DATA", "IMAGES", "SETTINGS_UI", "PI_BOT", "OTHER"]),
  body: z.string().trim().min(10).max(5000),
  frontend: frontendDiagnosticSchema,
  turnstileToken: z.string().max(4096).optional(),
})

export const replyPayloadSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  frontend: frontendDiagnosticSchema.optional(),
})

export const adminMessageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  visibility: z.enum(["PUBLIC", "INTERNAL"]).default("PUBLIC"),
  status: z.enum(["WAITING_FOR_SUPPORT", "WAITING_FOR_USER", "RESOLVED"]).optional(),
  expectedRevision: z.number().int().min(1),
})

export const adminUpdateSchema = z.object({
  status: z.enum(["WAITING_FOR_SUPPORT", "WAITING_FOR_USER", "RESOLVED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  expectedRevision: z.number().int().min(1),
}).refine((value) => value.status || value.priority, "A status or priority is required")

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function newSupportIdentity(): { publicId: string; token: string; cookieValue: string } {
  const publicId = randomUUID()
  const token = randomBytes(32).toString("base64url")
  return { publicId, token, cookieValue: `${publicId}.${token}` }
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? ""
  const item = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null
}

export async function authenticateSupportClient(request: Request) {
  const value = cookieValue(request, SUPPORT_COOKIE)
  if (!value) return null
  const separator = value.indexOf(".")
  if (separator <= 0) return null
  const publicId = value.slice(0, separator)
  const token = value.slice(separator + 1)
  const client = await prisma.supportClient.findUnique({ where: { publicId } })
  if (!client || client.expiresAt <= new Date()) return null
  const supplied = Buffer.from(hashSessionToken(token), "hex")
  const expected = Buffer.from(client.sessionTokenHash, "hex")
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null
  await prisma.supportClient.update({
    where: { id: client.id },
    data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SUPPORT_COOKIE_MAX_AGE * 1000) },
  })
  return client
}

export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin")
  const host = request.headers.get("host")
  if (!origin || !host || new URL(origin).host !== host) throw new Response("Invalid origin", { status: 403 })
}

export async function requireAdmin(request: Request): Promise<void> {
  const expected = process.env.SUPPORT_ADMIN_TOKEN
  const supplied = request.headers.get("authorization")
  if (!expected || !supplied?.startsWith("Bearer ")) throw new Response("Not found", { status: 404 })
  const a = Buffer.from(supplied.slice(7))
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Response("Not found", { status: 404 })
}

export function responseError(error: unknown): Response {
  if (error instanceof Response) return error
  if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
  console.error("[support] request failed", error)
  return Response.json({ error: "Support service unavailable" }, { status: 503 })
}

export async function readMultipart<T>(request: Request, schema: z.ZodType<T>): Promise<{ payload: T; files: File[] }> {
  const form = await request.formData()
  const raw = form.get("payload")
  if (typeof raw !== "string" || raw.length > 64 * 1024) throw new Response("Invalid payload", { status: 400 })
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Response("Invalid payload", { status: 400 }) }
  const files = form.getAll("images").filter((entry): entry is File => entry instanceof File)
  if (files.length > 3) throw new Response("Maximum three images per message", { status: 413 })
  return { payload: schema.parse(parsed), files }
}

export interface StoredSupportImage {
  storageKey: string
  originalName: string
  mimeType: string
  byteSize: number
  sha256: string
  width: number
  height: number
}

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"])
const acceptedFormats = new Set(["jpeg", "png", "webp"])

export async function storeSupportImages(files: File[]): Promise<StoredSupportImage[]> {
  if (!files.length) return []
  await mkdir(SUPPORT_ATTACHMENT_ROOT, { recursive: true })
  const disk = await statfs(SUPPORT_ATTACHMENT_ROOT)
  if (Number(disk.bavail) * Number(disk.bsize) < 5 * 1024 ** 3) throw new Response("Image uploads are temporarily unavailable", { status: 503 })
  const stored: StoredSupportImage[] = []
  try {
    for (const file of files) {
      if (!acceptedTypes.has(file.type) || file.size > 5 * 1024 ** 2) throw new Response("Invalid or oversized image", { status: 413 })
      const source = Buffer.from(await file.arrayBuffer())
      const pipeline = sharp(source, { limitInputPixels: 25_000_000, failOn: "warning" })
      const metadata = await pipeline.metadata()
      if (!metadata.format || !acceptedFormats.has(metadata.format) || !metadata.width || !metadata.height) throw new Response("Invalid image", { status: 400 })
      const output = await pipeline.rotate().resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true })
      const storageKey = `${randomUUID()}.webp`
      const temporary = path.join(SUPPORT_ATTACHMENT_ROOT, `${storageKey}.tmp`)
      const destination = path.join(SUPPORT_ATTACHMENT_ROOT, storageKey)
      await writeFile(temporary, output.data, { flag: "wx", mode: 0o600 })
      await rename(temporary, destination)
      stored.push({
        storageKey,
        originalName: path.basename(file.name || "screenshot").slice(0, 120),
        mimeType: "image/webp",
        byteSize: output.data.byteLength,
        sha256: createHash("sha256").update(output.data).digest("hex"),
        width: output.info.width,
        height: output.info.height,
      })
    }
    return stored
  } catch (error) {
    await deleteStoredImages(stored.map((item) => item.storageKey))
    throw error
  }
}

export async function deleteStoredImages(keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => rm(path.join(SUPPORT_ATTACHMENT_ROOT, path.basename(key)), { force: true }).catch(() => undefined)))
}

export async function loadStoredImage(storageKey: string): Promise<Buffer> {
  return readFile(path.join(SUPPORT_ATTACHMENT_ROOT, path.basename(storageKey)))
}

export async function verifyTurnstile(request: Request, token?: string): Promise<boolean> {
  const requestHostname = new URL(request.url).hostname
  if (process.env.SUPPORT_TURNSTILE_LOOPBACK_TEST_BYPASS === "1" && ["127.0.0.1", "localhost", "::1"].includes(requestHostname)) return true
  if (request.headers.get("x-pump-trusted-lan") === "1") return true
  const secret = process.env.SUPPORT_TURNSTILE_SECRET_KEY
  if (!secret) return true
  if (!token) return false
  const body = new URLSearchParams({ secret, response: token })
  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(5000) })
  const payload = await result.json() as { success?: boolean }
  return payload.success === true
}

export async function collectBackendDiagnostics(request: Request): Promise<Record<string, unknown>> {
  const started = Date.now()
  const requestId = randomUUID()
  const address = request.headers.get("x-real-ip") ?? request.headers.get("cf-connecting-ip") ?? "unknown"
  const hashKey = process.env.SUPPORT_NETWORK_HASH_KEY ?? "support-network-development-key"
  const day = new Date().toISOString().slice(0, 10)
  try {
    const [latestTrade, runtime, revision, lifecycleDue, sol] = await Promise.race([
      Promise.all([
        prisma.trade.findFirst({ orderBy: { timestamp: "desc" }, select: { timestamp: true, createdAt: true } }),
        prisma.runtimeHealthState.findUnique({ where: { key: "ingester" } }),
        prisma.tokenDataRevision.findUnique({ where: { key: "tokens" } }),
        prisma.tokenLifecycleCheck.count({ where: { nextAttemptAt: { lte: new Date() } } }),
        prisma.solPriceState.findUnique({ where: { key: "sol-usd" } }),
      ]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("diagnostic timeout")), 2000)),
    ])
    const disk = await statfs(process.cwd()).catch(() => null)
    return {
      schemaVersion: SUPPORT_DIAGNOSTIC_SCHEMA_VERSION,
      requestId,
      version: process.env.APP_VERSION ?? "4.0.11",
      commit: process.env.APP_COMMIT ?? null,
      capturedAt: new Date().toISOString(),
      databaseLatencyMs: Date.now() - started,
      networkHash: createHmac("sha256", hashKey).update(`${day}:${address}`).digest("hex").slice(0, 20),
      feed: latestTrade ? { eventAgeMs: Date.now() - Number(latestTrade.timestamp), persistedLagMs: latestTrade.createdAt.getTime() - Number(latestTrade.timestamp) } : null,
      ingester: runtime ? { updatedAt: runtime.updatedAt.toISOString(), payload: runtime.payload } : null,
      revision: revision?.revision.toString() ?? null,
      lifecycleDue,
      solPriceAgeMs: sol ? Date.now() - sol.updatedAt.getTime() : null,
      realtime: { token: getTokenStreamMetrics(), alerts: getAlertStreamMetrics() },
      imageCache: getImageCacheProcessMetrics(),
      disk: disk ? { availableBytes: Number(disk.bavail) * Number(disk.bsize), totalBytes: Number(disk.blocks) * Number(disk.bsize) } : null,
    }
  } catch (error) {
    return { schemaVersion: SUPPORT_DIAGNOSTIC_SCHEMA_VERSION, requestId, capturedAt: new Date().toISOString(), partial: true, error: error instanceof Error ? error.message.slice(0, 200) : "unavailable" }
  }
}

export function serializeTicket(ticket: any, detail = false) {
  const publicMessages = detail ? (ticket.messages ?? []).filter((message: any) => message.visibility === "PUBLIC") : undefined
  const unread = Boolean(ticket.messages?.some((message: any) => message.author === "SUPPORT" && (!ticket.userLastReadAt || message.createdAt > ticket.userLastReadAt)))
  return {
    ticketNumber: formatTicketNumber(ticket.ticketNumber),
    category: ticket.category,
    status: ticket.status,
    priority: ticket.priority,
    summary: ticket.summary,
    revision: ticket.revision,
    unread,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    ...(detail ? { messages: publicMessages.map((message: any) => ({ id: message.id, author: message.author, body: message.body, createdAt: message.createdAt.toISOString(), attachments: message.attachments.map((attachment: any) => ({ id: attachment.id, name: attachment.originalName, mimeType: attachment.mimeType, byteSize: attachment.byteSize, width: attachment.width, height: attachment.height, url: `/api/support/attachments/${attachment.id}` })) })) } : {}),
  }
}
