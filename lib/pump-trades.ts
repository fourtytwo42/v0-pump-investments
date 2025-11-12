export interface PumpUnifiedTrade {
  slotIndexId: string
  tx: string
  timestamp: string
  isBondingCurve: boolean
  program: "pump" | "pump_amm" | string
  mintAddress: string
  quoteMintAddress: string
  poolAddress: string
  userAddress: string
  type: "buy" | "sell" | string
  marketCap?: number | string
  baseAmount?: number | string
  quoteAmount?: number | string
  amountSol?: number | string
  amountUsd?: number | string
  priceQuotePerBase?: number | string
  priceBasePerQuote?: number | string
  priceUsd?: number | string
  priceSol?: number | string
  protocolFee?: number | string
  protocolFeeUsd?: number | string
  lpFee?: number | string
  lpFeeUsd?: number | string
  creatorAddress?: string
  coinMeta?: {
    name?: string
    symbol?: string
    uri?: string
    mint?: string
    bondingCurve?: string
    creator?: string
    createdTs?: number
  }
  [key: string]: unknown
}

export interface Trade {
  mint: string
  name: string
  symbol: string
  image_uri: string
  usd_market_cap: number
  market_cap: number
  sol_amount: number
  usd_amount: number
  is_buy: boolean
  user: string
  creator: string
  creator_username: string
  token_amount: number
  total_supply: number
  timestamp: number
  received_time?: number
  virtual_sol_reserves: number
  virtual_token_reserves: number
  signature: string
  created_timestamp?: number
  metadata_uri?: string | null
  website?: string | null
  twitter?: string | null
  telegram?: string | null
  king_of_the_hill_timestamp?: number | null
  description?: string | null
  is_completed?: boolean
  bonding_curve?: string | null
  associated_bonding_curve?: string | null
  is_bonding_curve?: boolean | null
  [key: string]: unknown
}

export function normalizeIpfsUri(uri: string | null | undefined): string | null {
  if (!uri) return null
  const trimmed = uri.trim()
  if (trimmed.length === 0) return null
  if (trimmed.startsWith("ipfs://")) {
    return trimmed.replace("ipfs://", "https://pump.mypinata.cloud/ipfs/")
  }
  return trimmed
}

function tryBase64Decode(value: string): string | null {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/=]+$/.test(value)) {
    return null
  }

  try {
    if (typeof atob === "function") {
      return atob(value)
    }
    if (typeof Buffer !== "undefined") {
      return Buffer.from(value, "base64").toString("utf-8")
    }
  } catch {
    // ignore
  }

  return null
}

export function decodePumpPayload(rawPayload: string): PumpUnifiedTrade | null {
  try {
    let working = rawPayload.trim()

    while (working.startsWith('"') && working.endsWith('"')) {
      try {
        working = JSON.parse(working)
      } catch {
        break
      }
    }

    const base64Decoded = tryBase64Decode(working)
    if (base64Decoded) {
      working = base64Decoded
    }

    working = working.replace(/\\"/g, '"')

    try {
      return JSON.parse(working) as PumpUnifiedTrade
    } catch {
      const lastBrace = working.lastIndexOf("}")
      if (lastBrace !== -1) {
        return JSON.parse(working.slice(0, lastBrace + 1)) as PumpUnifiedTrade
      }
    }

    return null
  } catch (error) {
    console.error("[pump] Failed to decode Pump payload:", error)
    return null
  }
}

export function convertPumpTradeToLocal(pumpTrade: PumpUnifiedTrade): Trade {
  const timestampMs =
    typeof pumpTrade.timestamp === "string" ? new Date(pumpTrade.timestamp).getTime() : Date.now()

  const metadataUri = normalizeIpfsUri(pumpTrade.coinMeta?.uri)
  const metaComplete =
    pumpTrade.coinMeta &&
    typeof (pumpTrade.coinMeta as Record<string, unknown>).complete === "boolean"
      ? ((pumpTrade.coinMeta as Record<string, unknown>).complete as boolean)
      : undefined
  const metaBondingCurve =
    typeof pumpTrade.coinMeta?.bondingCurve === "string"
      ? pumpTrade.coinMeta?.bondingCurve
      : typeof (pumpTrade.coinMeta as Record<string, unknown>).bonding_curve === "string"
        ? ((pumpTrade.coinMeta as Record<string, unknown>).bonding_curve as string)
        : undefined
  const tradeBondingFlag =
    typeof pumpTrade.isBondingCurve === "boolean" ? pumpTrade.isBondingCurve : undefined
  const completionFromTrade =
    tradeBondingFlag === false ? true : tradeBondingFlag === true ? false : undefined

  return {
    mint: (pumpTrade.mintAddress || "").trim(),
    name: pumpTrade.coinMeta?.name || "Unknown",
    symbol: pumpTrade.coinMeta?.symbol || "???",
    image_uri: "",
    usd_market_cap: Number(pumpTrade.marketCap || 0),
    market_cap: Number(pumpTrade.marketCap || 0),
    sol_amount: Number(pumpTrade.amountSol || pumpTrade.quoteAmount || 0),
    usd_amount: Number(pumpTrade.amountUsd || 0),
    is_buy: pumpTrade.type === "buy",
    user: pumpTrade.userAddress,
    creator: pumpTrade.creatorAddress || pumpTrade.coinMeta?.creator || "",
    creator_username: "",
    token_amount: Number(pumpTrade.baseAmount || 0),
    total_supply: 0,
    timestamp: Math.floor(timestampMs / 1000),
    virtual_sol_reserves: 0,
    virtual_token_reserves: 0,
    signature: pumpTrade.tx,
    created_timestamp: pumpTrade.coinMeta?.createdTs,
    metadata_uri: metadataUri,
    website: null,
    twitter: null,
    telegram: null,
    king_of_the_hill_timestamp: pumpTrade.isBondingCurve ? null : timestampMs,
    description: null,
    is_completed: metaComplete ?? completionFromTrade ?? false,
    bonding_curve: metaBondingCurve ?? null,
    associated_bonding_curve: null,
    is_bonding_curve: tradeBondingFlag ?? true,
  }
}
