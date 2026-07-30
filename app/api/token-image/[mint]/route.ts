import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { getIpfsGatewayUrls } from "@/lib/pump-trades"
import { isAllowedMetadataUrl, isHttpUrl, isIpfsBackedUrl } from "@/lib/token-image"
import { normalizeTokenMetadata } from "@/lib/token-metadata"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const REQUEST_TIMEOUT_MS = 4_000
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
interface RouteParams {
  params: {
    mint: string
  }
}

function uniqueCandidates(uri: string): string[] {
  return Array.from(new Set(getIpfsGatewayUrls(uri))).filter(isHttpUrl)
}

async function fetchCandidate(url: string, accept: string): Promise<Response | null> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        accept,
        "user-agent": "pump-investments-lite/3.1",
      },
      redirect: isIpfsBackedUrl(url) ? "follow" : "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return response.ok ? response : null
  } catch {
    return null
  }
}

async function fetchFirst(uri: string, accept: string): Promise<Response | null> {
  for (const candidate of uniqueCandidates(uri)) {
    const response = await fetchCandidate(candidate, accept)
    if (response) return response
  }
  return null
}

async function resolveImageUri(imageUri: string | null, metadataUri: string | null): Promise<string | null> {
  if (imageUri && isHttpUrl(imageUri)) return imageUri
  if (!metadataUri || !isAllowedMetadataUrl(metadataUri)) return null

  const metadataResponse = await fetchFirst(metadataUri, "application/json")
  if (!metadataResponse) return null

  try {
    const raw = await metadataResponse.json()
    return normalizeTokenMetadata(raw).image ?? null
  } catch {
    return null
  }
}

async function readImage(response: Response): Promise<ArrayBuffer | null> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0)
  if (declaredLength > MAX_IMAGE_BYTES || !response.body) return null

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
  return body.buffer as ArrayBuffer
}

export async function GET(_request: Request, { params }: RouteParams) {
  const mint = decodeURIComponent(params.mint ?? "").trim()
  if (!/^[A-Za-z0-9]{32,50}$/.test(mint)) {
    return NextResponse.json({ error: "Invalid mint address" }, { status: 400 })
  }

  const token = await prisma.token.findUnique({
    where: { mintAddress: mint },
    select: { imageUri: true, metadataUri: true },
  })
  if (!token) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 })
  }

  const imageUri = await resolveImageUri(token.imageUri, token.metadataUri)
  if (!imageUri || !isHttpUrl(imageUri)) {
    return NextResponse.json(
      { error: "Token image unavailable" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    )
  }

  if (!isIpfsBackedUrl(imageUri)) {
    return NextResponse.redirect(imageUri, 307)
  }

  const imageResponse = await fetchFirst(imageUri, "image/avif,image/webp,image/*,*/*;q=0.8")
  if (!imageResponse) {
    return NextResponse.json(
      { error: "Token image unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    )
  }

  const image = await readImage(imageResponse)
  if (!image) {
    return NextResponse.json({ error: "Token image is too large" }, { status: 413 })
  }

  const contentType = imageResponse.headers.get("content-type") ?? "application/octet-stream"
  return new Response(image, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
