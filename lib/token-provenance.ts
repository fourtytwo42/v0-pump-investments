import type { TokenLaunchSource, TokenTradeVenue } from "@/types/token-data"

export interface TokenProvenance {
  launchSource: TokenLaunchSource
  tradeVenue: TokenTradeVenue
}

export function reduceTokenProvenance(program: string, platform = ""): TokenProvenance {
  const normalizedProgram = program.toLowerCase()
  const normalizedPlatform = platform.toLowerCase()
  if (normalizedProgram === "pump") {
    return { launchSource: "pump", tradeVenue: "pump_bonding" }
  }
  if (normalizedProgram === "pump_amm") {
    return { launchSource: "unknown", tradeVenue: "pumpswap" }
  }
  if (normalizedProgram === "meteora_dbc") {
    return {
      launchSource: normalizedPlatform === "moonshot" ? "moonshot" : "unknown",
      tradeVenue: "meteora_dbc",
    }
  }
  if (normalizedProgram === "raydium_v4_amm") {
    return { launchSource: "unknown", tradeVenue: "raydium_v4" }
  }
  return { launchSource: "unknown", tradeVenue: "unknown" }
}
