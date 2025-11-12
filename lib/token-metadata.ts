export interface TokenMetadata {
  name?: string | null
  symbol?: string | null
  image?: string | null
  description?: string | null
  website?: string | null
  twitter?: string | null
  telegram?: string | null
  createdTimestamp?: number | null
  kingOfTheHillTimestamp?: number | null
}

const IPFS_PREFIX = "ipfs://"

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeUrl(value: unknown): string | null {
  const normalized = normalizeString(value)
  if (!normalized) {
    return null
  }

  if (normalized.startsWith(IPFS_PREFIX)) {
    return `https://ipfs.io/ipfs/${normalized.slice(IPFS_PREFIX.length)}`
  }

  if (normalized.startsWith("http://")) {
    return `https://${normalized.slice("http://".length)}`
  }

  return normalized
}

function parseTimestamp(value: unknown): number | null {
  if (value == null) {
    return null
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const numericValue = Math.round(value)
    if (numericValue === 0) {
      return null
    }

    return numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000
  }

  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }

    const numericValue = Number(trimmed)
    if (!Number.isNaN(numericValue)) {
      const rounded = Math.round(numericValue)
      return rounded > 1_000_000_000_000 ? rounded : rounded * 1000
    }

    const parsed = Date.parse(trimmed)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }

  return null
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeString(value)
    if (normalized) {
      return normalized
    }
  }

  return null
}

function firstNonEmptyUrl(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeUrl(value)
    if (normalized) {
      return normalized
    }
  }

  return null
}

export function normalizeTokenMetadata(raw: any): TokenMetadata {
  const metadataSource = raw?.metadata ?? raw?.meta ?? raw

  const name = firstNonEmptyString(
    raw?.name,
    metadataSource?.name,
    raw?.coin?.name,
    raw?.profile?.name,
    raw?.token?.name,
  )

  const symbol = firstNonEmptyString(
    raw?.symbol,
    metadataSource?.symbol,
    metadataSource?.ticker,
    raw?.ticker,
    raw?.token?.symbol,
  )

  const image = firstNonEmptyUrl(
    raw?.image,
    raw?.imageUrl,
    raw?.image_url,
    raw?.image_uri,
    metadataSource?.image,
    metadataSource?.imageUrl,
    metadataSource?.image_url,
    metadataSource?.image_uri,
    metadataSource?.imageUri,
    raw?.uri,
  )

  const description = firstNonEmptyString(
    raw?.description,
    metadataSource?.description,
    raw?.profile?.description,
    raw?.token?.description,
    raw?.extensions?.description,
  )

  const website = firstNonEmptyUrl(
    raw?.website,
    metadataSource?.website,
    metadataSource?.extensions?.website,
    raw?.links?.website,
    raw?.links?.websiteUrl,
    raw?.extensions?.website,
    raw?.socials?.website,
  )

  const twitter = firstNonEmptyUrl(
    raw?.twitter,
    metadataSource?.twitter,
    metadataSource?.extensions?.twitter,
    raw?.links?.twitter,
    raw?.links?.twitterUrl,
    raw?.extensions?.twitter,
    raw?.socials?.twitter,
    raw?.links?.x,
  )

  const telegram = firstNonEmptyUrl(
    raw?.telegram,
    metadataSource?.telegram,
    metadataSource?.extensions?.telegram,
    raw?.links?.telegram,
    raw?.links?.telegramUrl,
    raw?.extensions?.telegram,
    raw?.socials?.telegram,
  )

  const createdTimestamp =
    parseTimestamp(raw?.createdTimestamp) ??
    parseTimestamp(raw?.created_ts) ??
    parseTimestamp(raw?.created_at) ??
    parseTimestamp(metadataSource?.createdTimestamp) ??
    parseTimestamp(metadataSource?.created_ts) ??
    parseTimestamp(metadataSource?.created_at)

  const kingOfTheHillTimestamp =
    parseTimestamp(raw?.kingOfTheHillTimestamp) ??
    parseTimestamp(raw?.king_of_the_hill_timestamp) ??
    parseTimestamp(raw?.kothTs) ??
    parseTimestamp(metadataSource?.kingOfTheHillTimestamp) ??
    parseTimestamp(metadataSource?.king_of_the_hill_timestamp) ??
    parseTimestamp(metadataSource?.kothTs)

  return {
    name,
    symbol,
    image,
    description,
    website,
    twitter,
    telegram,
    createdTimestamp,
    kingOfTheHillTimestamp,
  }
}

export function isMetadataEmpty(metadata: TokenMetadata | null | undefined): boolean {
  if (!metadata) {
    return true
  }

  return (
    !metadata.name &&
    !metadata.symbol &&
    !metadata.image &&
    !metadata.description &&
    !metadata.website &&
    !metadata.twitter &&
    !metadata.telegram &&
    metadata.createdTimestamp == null &&
    metadata.kingOfTheHillTimestamp == null
  )
}
