export type GraduatedFilterValue = "all" | "bonding" | "graduated"

export type TokenSortBy =
  | "marketCap"
  | "totalVolume"
  | "buyVolume"
  | "sellVolume"
  | "uniqueTraders"
  | "tokenAge"
  | "lastTrade"

export interface TokenQueryFilters {
  hideKOTH?: boolean
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
  bonding_curve?: string | null
  associated_bonding_curve?: string | null
  is_bonding_curve?: boolean | null
}
