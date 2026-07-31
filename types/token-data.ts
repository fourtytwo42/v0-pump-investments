export type GraduatedFilterValue = "all" | "bonding" | "graduated"
export type TokenLifecycleStatus = "unknown" | "bonding" | "curve_complete" | "pumpswap" | "non_launchpad"
export type TokenLaunchSource = "unknown" | "pump" | "moonshot" | "external"
export type TokenTradeVenue = "unknown" | "pump_bonding" | "pumpswap" | "raydium_v4" | "meteora_dbc"

export type TokenSortBy =
  | "marketCap"
  | "totalVolume"
  | "buyVolume"
  | "sellVolume"
  | "uniqueTraders"
  | "tokenAge"
  | "lastTrade"

export interface TokenQueryFilters {
  hideExternal?: boolean
  graduationFilter?: GraduatedFilterValue
  minMarketCap?: number
  maxMarketCap?: number
  minTotalVolume?: number
  maxTotalVolume?: number
  minBuyVolume?: number
  maxBuyVolume?: number
  minSellVolume?: number
  maxSellVolume?: number
  minUniqueTraders?: number
  maxUniqueTraders?: number
  minTradeAmount?: number
  maxTradeAmount?: number
  minTokenAgeMinutes?: number
  maxTokenAgeMinutes?: number
  favoritesOnly?: boolean
}

export interface TokenQueryOptions {
  page: number
  pageSize: number
  sortBy: TokenSortBy
  sortOrder: "asc" | "desc"
  timeRangeMinutes: number
  filters: TokenQueryFilters
}

export interface TokenQueryRequest extends TokenQueryOptions {
  favoriteMints: string[]
}

export interface TokenData {
  mint: string
  name: string
  symbol: string
  image_uri: string
  image_metadata_uri?: string | null
  metadata_uri?: string | null
  usd_market_cap: number
  market_cap: number
  price_sol?: number
  price_usd?: number
  total_volume: number
  total_volume_usd: number
  buy_volume: number
  buy_volume_usd: number
  sell_volume: number
  sell_volume_usd: number
  unique_trader_count: number
  trades: any[]
  last_trade_time: number
  last_trade_timestamp?: number
  creator: string
  creator_username: string
  total_supply: number
  virtual_sol_reserves: number
  virtual_token_reserves: number
  buy_sell_ratio: number
  created_timestamp?: number
  website?: string | null
  twitter?: string | null
  telegram?: string | null
  king_of_the_hill_timestamp?: number | null
  description?: string | null
  is_completed?: boolean
  lifecycle_status: TokenLifecycleStatus
  lifecycle_verified_at?: string | null
  pump_swap_pool?: string | null
  bonding_progress?: number | null
  bonding_curve?: string | null
  associated_bonding_curve?: string | null
  is_bonding_curve?: boolean | null
  launch_source: TokenLaunchSource
  trade_venue: TokenTradeVenue
  source_verified_at?: string | null
  trade_venue_updated_at?: string | null
}
