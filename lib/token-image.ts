const ALLOWED_METADATA_HOSTS = new Set([
  "api.vortexdeployer.com",
  "meta.sdfgsdfsdf.uk",
  "metadata.j7tracker.com",
  "metadata.j7tracker.io",
])

export function tokenImagePath(mint: string): string {
  return `/api/token-image/${encodeURIComponent(mint)}`
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

export function isIpfsBackedUrl(value: string): boolean {
  return value.startsWith("ipfs://") || /^https?:\/\/[^/]+\/ipfs\//i.test(value)
}

export function isAllowedMetadataUrl(value: string): boolean {
  if (isIpfsBackedUrl(value)) return true
  try {
    return ALLOWED_METADATA_HOSTS.has(new URL(value).hostname.toLowerCase())
  } catch {
    return false
  }
}
