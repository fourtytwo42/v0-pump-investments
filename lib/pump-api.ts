import { normalizeIpfsUri } from "@/lib/pump-trades"

const PUMP_HEADERS = {
  accept: "application/json, text/plain, */*",
  origin: "https://pump.fun",
  referer: "https://pump.fun",
  "user-agent": "PumpFunMockTrader/1.0 (+https://pump.fun)",
}

const API_ENDPOINTS = {
  frontend: "https://frontend-api-v3.pump.fun",
  swap: "https://swap-api.pump.fun",
  advanced: "https://advanced-api-v2.pump.fun",
}

export async function fetchPumpFun<T>(url: string, options: RequestInit = {}): Promise<T | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      ...options,
      headers: {
        ...PUMP_HEADERS,
        ...(options.headers || {}),
      },
    })

    if (!res.ok) {
      console.error(`[PumpAPI] Request failed: ${url} :: ${res.status} ${res.statusText}`)
      return null
    }

    return (await res.json()) as T
  } catch (error) {
    console.error(`[PumpAPI] Request error: ${url} ::`, (error as Error).message)
    return null
  }
}

export interface TokenDetails {
  mint: string
  name: string
  symbol: string
  description?: string
  imageUri?: string
  twitter?: string
  telegram?: string
  website?: string
  creator: string
  createdTimestamp: number
  totalSupply: number
  marketCapUSD: number
  priceSOL: number
  priceUSD: number
  virtualSolReserves: number
  virtualTokenReserves: number
  bondingCurve: string
  associatedBondingCurve: string
  complete: boolean
  isLive: boolean
  kingOfTheHillTimestamp?: number
}

export async function getTokenDetails(mint: string): Promise<TokenDetails | null> {
  const url = `${API_ENDPOINTS.frontend}/coins/${mint}`
  const data = await fetchPumpFun<any>(url)

  if (!data) return null

  let metadata = data.metadata
  if (!metadata && data.metadata_uri) {
    const metadataUri = data.metadata_uri.startsWith("ipfs://")
      ? data.metadata_uri.replace("ipfs://", "https://pump.mypinata.cloud/ipfs/")
      : data.metadata_uri
    metadata = await fetchPumpFun<any>(metadataUri, {
      headers: { accept: "application/json" },
    })
  }

  const normalizedImage = normalizeIpfsUri(data.image_uri ?? metadata?.image ?? null) ?? ""

  return {
    mint: data.mint,
    name: data.name || metadata?.name || "",
    symbol: data.symbol || metadata?.symbol || "",
    description: metadata?.description || data.description || "",
    imageUri: normalizedImage,
    twitter: metadata?.twitter || data.twitter || "",
    telegram: metadata?.telegram || data.telegram || "",
    website: metadata?.website || data.website || "",
    creator: data.creator,
    createdTimestamp: Number(data.created_timestamp || 0),
    totalSupply: Number(data.total_supply || 0),
    marketCapUSD: Number(data.usd_market_cap || 0),
    priceSOL: Number(data.virtual_sol_reserves || 0) / Number(data.virtual_token_reserves || 1),
    priceUSD: Number(data.usd_market_cap || 0) / (Number(data.total_supply || 0) / 1e6),
    virtualSolReserves: Number(data.virtual_sol_reserves || 0),
    virtualTokenReserves: Number(data.virtual_token_reserves || 0),
    bondingCurve: data.bonding_curve || "",
    associatedBondingCurve: data.associated_bonding_curve || "",
    complete: Boolean(data.complete),
    isLive: Boolean(data.is_currently_live),
    kingOfTheHillTimestamp: data.king_of_the_hill_timestamp
      ? Number(data.king_of_the_hill_timestamp)
      : undefined,
  }
}

