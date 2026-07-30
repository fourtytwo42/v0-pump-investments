import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

function isBlockedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number)
  if (octets.length !== 4) return true
  const [a, b] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  )
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase()
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  )
}

export async function assertPublicHttpUrl(value: string): Promise<URL> {
  const url = new URL(value)
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported URL scheme")
  if (url.username || url.password) throw new Error("Credentialed URL blocked")
  const literalFamily = isIP(url.hostname)
  if (literalFamily === 4 && isBlockedIpv4(url.hostname)) throw new Error("Private address blocked")
  if (literalFamily === 6 && isBlockedIpv6(url.hostname)) throw new Error("Private address blocked")
  const addresses = await lookup(url.hostname, { all: true, verbatim: true })
  if (
    addresses.length === 0 ||
    addresses.some((entry) =>
      entry.family === 4 ? isBlockedIpv4(entry.address) : isBlockedIpv6(entry.address),
    )
  ) {
    throw new Error("Non-public upstream address blocked")
  }
  return url
}

export async function safeFetch(
  value: string,
  init: RequestInit,
  maxRedirects = 3,
): Promise<Response> {
  let current = value
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    await assertPublicHttpUrl(current)
    const response = await fetch(current, { ...init, redirect: "manual" })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get("location")
    if (!location || redirect === maxRedirects) throw new Error("Unsafe or excessive redirect")
    current = new URL(location, current).toString()
  }
  throw new Error("Redirect limit reached")
}
