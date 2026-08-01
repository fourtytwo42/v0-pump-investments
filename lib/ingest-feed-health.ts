export interface FeedHealthInput {
  nowMs: number
  connectedAtMs: number
  lastProtocolMessageAtMs: number
  lastTradeMessageAtMs: number
  protocolStaleAfterMs: number
  tradeStaleAfterMs: number
}

export type FeedStaleReason = "inbound_idle_timeout" | "trade_stream_idle_timeout"

export function getFeedStaleReason(input: FeedHealthInput): FeedStaleReason | null {
  const protocolReference = input.lastProtocolMessageAtMs || input.connectedAtMs
  if (protocolReference > 0 && input.nowMs - protocolReference >= input.protocolStaleAfterMs) {
    return "inbound_idle_timeout"
  }

  const tradeReference = input.lastTradeMessageAtMs || input.connectedAtMs
  if (tradeReference > 0 && input.nowMs - tradeReference >= input.tradeStaleAfterMs) {
    return "trade_stream_idle_timeout"
  }

  return null
}

export function isFeedFatallyStale(
  nowMs: number,
  serviceStartedAtMs: number,
  lastTradeMessageAtMs: number,
  fatalStaleAfterMs: number,
): boolean {
  const reference = lastTradeMessageAtMs || serviceStartedAtMs
  return reference > 0 && nowMs - reference >= fatalStaleAfterMs
}
