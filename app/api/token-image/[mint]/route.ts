import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { prisma } from "@/lib/prisma"
import { getIpfsGatewayUrls } from "@/lib/pump-trades"
import { isAllowedMetadataUrl, isHttpUrl } from "@/lib/token-image"
import { normalizeTokenMetadata } from "@/lib/token-metadata"
import { safeFetch } from "@/lib/safe-upstream"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const TIMEOUT_MS = 5_000
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_CACHE_BYTES = 512 * 1024 * 1024
const NEGATIVE_TTL_MS = 5 * 60_000
const CACHE_ENABLED = process.env.TOKEN_IMAGE_CACHE_ENABLED !== "false"
const CACHE_ROOT = process.env.TOKEN_IMAGE_CACHE_DIR ?? "server/data/images"

interface RouteParams {
  params: Promise<{ mint: string }>
}

interface CacheMeta {
  contentType: string
  size: number
  cachedAt: number
}

function pathsForMint(mint: string) {
  return {
    body: path.join(CACHE_ROOT, `${mint}.bin`),
    meta: path.join(CACHE_ROOT, `${mint}.json`),
    negative: path.join(CACHE_ROOT, `${mint}.negative`),
  }
}

async function fetchFirst(uri: string, accept: string): Promise<Response | null> {
  const candidates = [...new Set(getIpfsGatewayUrls(uri))].filter(isHttpUrl)
  for (const candidate of candidates) {
    try {
      const response = await safeFetch(candidate, {
        cache: "no-store",
        headers: { accept, "user-agent": "pump-investments/4.0" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (response.ok) return response
    } catch {}
  }
  return null
}

async function resolveImageUri(imageUri: string | null, metadataUri: string | null): Promise<string | null> {
  if (imageUri && isHttpUrl(imageUri)) return imageUri
  if (!metadataUri || !isAllowedMetadataUrl(metadataUri)) return null
  const response = await fetchFirst(metadataUri, "application/json")
  if (!response) return null
  try {
    return normalizeTokenMetadata(await response.json()).image ?? null
  } catch {
    return null
  }
}

async function readLimitedImage(response: Response): Promise<Uint8Array | null> {
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? ""
  if (!contentType.startsWith("image/")) return null
  const declared = Number(response.headers.get("content-length") ?? 0)
  if (declared > MAX_IMAGE_BYTES || !response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

async function cleanupCache(): Promise<void> {
  const entries = (await readdir(CACHE_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".bin"))
  const files = await Promise.all(entries.map(async (entry) => {
    const file = path.join(CACHE_ROOT, entry.name)
    const info = await stat(file)
    return { file, size: info.size, mtime: info.mtimeMs }
  }))
  let total = files.reduce((sum, file) => sum + file.size, 0)
  for (const file of files.sort((a, b) => a.mtime - b.mtime)) {
    if (total <= MAX_CACHE_BYTES) break
    total -= file.size
    await Promise.all([
      rm(file.file, { force: true }),
      rm(file.file.replace(/\.bin$/, ".json"), { force: true }),
    ])
  }
}

function imageResponse(body: Uint8Array, meta: CacheMeta): Response {
  const payload = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
  return new Response(payload, {
    headers: {
      "Content-Type": meta.contentType,
      "Content-Length": String(meta.size),
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  const { mint: rawMint } = await params
  const mint = decodeURIComponent(rawMint ?? "").trim()
  if (!/^[A-Za-z0-9]{32,50}$/.test(mint)) {
    return Response.json({ error: "Invalid mint address" }, { status: 400 })
  }
  if (CACHE_ENABLED) await mkdir(CACHE_ROOT, { recursive: true })
  const cache = pathsForMint(mint)
  if (CACHE_ENABLED) {
    try {
      const [body, rawMeta] = await Promise.all([readFile(cache.body), readFile(cache.meta, "utf8")])
      return imageResponse(body, JSON.parse(rawMeta) as CacheMeta)
    } catch {}
    try {
      if (Date.now() - (await stat(cache.negative)).mtimeMs < NEGATIVE_TTL_MS) {
        return Response.json({ error: "Token image unavailable" }, { status: 404 })
      }
    } catch {}
  }

  const token = await prisma.token.findUnique({
    where: { mintAddress: mint },
    select: { id: true, imageUri: true, metadataUri: true },
  })
  if (!token) return Response.json({ error: "Token not found" }, { status: 404 })
  const imageUri = await resolveImageUri(token.imageUri, token.metadataUri)
  const upstream = imageUri ? await fetchFirst(imageUri, "image/avif,image/webp,image/*") : null
  const image = upstream ? await readLimitedImage(upstream) : null
  const contentType = upstream?.headers.get("content-type")?.split(";")[0]?.trim() ?? ""
  if (!image || !contentType.startsWith("image/")) {
    if (CACHE_ENABLED) await writeFile(cache.negative, String(Date.now()), "utf8")
    await prisma.tokenImageStatus.upsert({
      where: { tokenId: token.id },
      create: { tokenId: token.id, status: "missing", checkedAt: new Date(), nextAttemptAt: new Date(Date.now() + NEGATIVE_TTL_MS) },
      update: { status: "missing", checkedAt: new Date(), nextAttemptAt: new Date(Date.now() + NEGATIVE_TTL_MS) },
    }).catch(() => undefined)
    return Response.json({ error: "Token image unavailable" }, { status: 404 })
  }

  const meta: CacheMeta = { contentType, size: image.byteLength, cachedAt: Date.now() }
  if (!CACHE_ENABLED) return imageResponse(image, meta)
  const bodyTemp = `${cache.body}.tmp`
  const metaTemp = `${cache.meta}.tmp`
  await Promise.all([writeFile(bodyTemp, image), writeFile(metaTemp, JSON.stringify(meta), "utf8")])
  await Promise.all([rename(bodyTemp, cache.body), rename(metaTemp, cache.meta), rm(cache.negative, { force: true })])
  await prisma.tokenImageStatus.upsert({
    where: { tokenId: token.id },
    create: { tokenId: token.id, resolvedUrl: imageUri, contentType, byteSize: image.byteLength, cachePath: cache.body, status: "cached", checkedAt: new Date() },
    update: { resolvedUrl: imageUri, contentType, byteSize: image.byteLength, cachePath: cache.body, status: "cached", checkedAt: new Date(), lastError: null },
  }).catch(() => undefined)
  void cleanupCache().catch((error) => console.warn("[token-image] cache cleanup failed", error))
  return imageResponse(image, meta)
}
