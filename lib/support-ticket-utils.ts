export type SupportStatus = "WAITING_FOR_SUPPORT" | "WAITING_FOR_USER" | "RESOLVED"

export function formatTicketNumber(value: bigint | number | string): string {
  return `PI-${String(value).padStart(6, "0")}`
}

export function parseTicketNumber(value: string): bigint | null {
  const match = /^PI-(\d{1,18})$/i.exec(value)
  return match ? BigInt(match[1]) : null
}

export function summarizeTicket(body: string): string {
  const first = body.split(/\r?\n/, 1)[0]?.replace(/\s+/g, " ").trim() || "Problem report"
  return first.length <= 100 ? first : `${first.slice(0, 97)}...`
}

export function statusAfterMessage(
  author: "USER" | "SUPPORT",
  visibility: "PUBLIC" | "INTERNAL",
  current: SupportStatus,
  requested?: SupportStatus,
): SupportStatus {
  if (requested) return requested
  if (visibility === "INTERNAL") return current
  return author === "USER" ? "WAITING_FOR_SUPPORT" : "WAITING_FOR_USER"
}
