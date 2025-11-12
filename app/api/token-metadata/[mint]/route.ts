import { NextResponse } from "next/server"
import { normalizeTokenMetadata } from "@/lib/token-metadata"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = {
  params: {
    mint: string
  }
}

const METADATA_ENDPOINTS: ((mint: string) => string)[] = [
  (mint) => `https://frontend-api.pump.fun/coins/${mint}`,
  (mint) => `https://frontend-api.pump.fun/coins/metadata/${mint}`,
  (mint) => `https://pump.fun/coin-metadata/${mint}`,
]

const REQUEST_HEADERS: HeadersInit = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": "pump-investments-lite/3.0 (+https://pump.investments)",
  Referer: "https://pump.investments",
}

export async function GET(_request: Request, { params }: RouteParams) {
  const mint = params?.mint?.trim()

  if (!mint) {
    return NextResponse.json({ error: "Mint address is required" }, { status: 400 })
  }

  let lastError: unknown = null

  for (const endpointFactory of METADATA_ENDPOINTS) {
    const url = endpointFactory(mint)

    try {
      const response = await fetch(url, {
        headers: REQUEST_HEADERS,
        cache: "no-store",
      })

      if (!response.ok) {
        lastError = new Error(`Metadata endpoint ${url} responded with status ${response.status}`)
        continue
      }

      const raw = await response.json().catch((error) => {
        throw new Error(`Failed to parse metadata response from ${url}: ${error instanceof Error ? error.message : String(error)}`)
      })

      const metadata = normalizeTokenMetadata(raw)

      return NextResponse.json(
        { metadata },
        {
          status: 200,
          headers: {
            "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
          },
        },
      )
    } catch (error) {
      lastError = error
    }
  }

  console.error(`[v0] Failed to fetch metadata for mint ${mint}:`, lastError)
  return NextResponse.json({ error: "Failed to fetch token metadata" }, { status: 502 })
}
