import { NextResponse } from "next/server"
import { fetchPumpCoin } from "@/lib/pump-coin"
import { prisma } from "@/lib/prisma"
import { normalizeTokenMetadata } from "@/lib/token-metadata"
import { normalizeIpfsUri } from "@/lib/pump-trades"

export const dynamic = "force-dynamic"

interface RouteParams {
  params: {
    mint: string
  }
}

function looksLikeMintPrefix(value: string | null | undefined, mint: string): boolean {
  if (!value) return true
  const cleaned = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
  if (!cleaned) return true
  if (cleaned.length < 3) return false
  return mint.toUpperCase().startsWith(cleaned)
}

export async function GET(_request: Request, { params }: RouteParams) {
  const mint = params.mint

  if (!mint) {
    return NextResponse.json({ error: "Mint is required" }, { status: 400 })
  }

  try {
    const decodedMint = decodeURIComponent(mint)

    const dbToken = await prisma.token.findUnique({
      where: { mintAddress: decodedMint },
      select: {
        name: true,
        symbol: true,
        imageUri: true,
        metadataUri: true,
        description: true,
        twitter: true,
        telegram: true,
        website: true,
        completed: true,
        kingOfTheHillTimestamp: true,
        bondingCurve: true,
        associatedBondingCurve: true,
      },
    })

    if (dbToken) {
      const metadataFromDb = {
        name: dbToken.name ?? null,
        symbol: dbToken.symbol ?? null,
        imageUri: dbToken.imageUri ?? null,
        metadataUri: dbToken.metadataUri ?? null,
        description: dbToken.description ?? null,
        twitter: dbToken.twitter ?? null,
        telegram: dbToken.telegram ?? null,
        website: dbToken.website ?? null,
        completed: dbToken.completed,
        kingOfTheHillTimestamp: dbToken.kingOfTheHillTimestamp
          ? Number(dbToken.kingOfTheHillTimestamp)
          : null,
        bondingCurve: dbToken.bondingCurve ?? null,
        associatedBondingCurve: dbToken.associatedBondingCurve ?? null,
      }

      const hasImage = Boolean(metadataFromDb.imageUri)
      const nameLooksMint = looksLikeMintPrefix(metadataFromDb.name, decodedMint)
      const symbolLooksMint = looksLikeMintPrefix(metadataFromDb.symbol, decodedMint)

      if (hasImage && !nameLooksMint && !symbolLooksMint) {
        return NextResponse.json({
          source: "db",
          metadata: metadataFromDb,
        })
      }
    }

    const coin = await fetchPumpCoin(decodedMint)
    if (!coin) {
      return NextResponse.json(
        {
          source: "remote",
          metadata: {},
          coin: null,
          error: "Coin not found",
        },
        { status: 404 },
      )
    }

    const normalizedMetadataUri = normalizeIpfsUri(
      (coin as Record<string, unknown>).metadataUri ??
        (coin as Record<string, unknown>).metadata_uri ??
        (coin as Record<string, unknown>).uri ??
        null,
    )

    let normalizedMetadata = normalizeTokenMetadata(
      (coin as Record<string, unknown>).metadata ?? (coin as Record<string, unknown>),
    )

    if (normalizedMetadataUri) {
      normalizedMetadata = {
        ...normalizedMetadata,
        metadataUri: normalizedMetadataUri,
      }
    }

    const responseMetadata = {
      name: normalizedMetadata.name ?? null,
      symbol: normalizedMetadata.symbol ?? null,
      imageUri: normalizedMetadata.image ? normalizeIpfsUri(normalizedMetadata.image) : null,
      metadataUri: normalizedMetadataUri ?? null,
      description: normalizedMetadata.description ?? null,
      twitter: normalizedMetadata.twitter ?? null,
      telegram: normalizedMetadata.telegram ?? null,
      website: normalizedMetadata.website ?? null,
      completed:
        typeof (coin as Record<string, unknown>).complete === "boolean"
          ? ((coin as Record<string, unknown>).complete as boolean)
          : normalizedMetadata.complete ?? null,
      kingOfTheHillTimestamp: (coin as Record<string, unknown>).king_of_the_hill_timestamp
        ? Number((coin as Record<string, unknown>).king_of_the_hill_timestamp)
        : (coin as Record<string, unknown>).kingOfTheHillTimestamp
          ? Number((coin as Record<string, unknown>).kingOfTheHillTimestamp)
          : normalizedMetadata.kingOfTheHillTimestamp ?? null,
      bondingCurve:
        ((coin as Record<string, unknown>).bonding_curve as string | undefined) ??
        normalizedMetadata.bondingCurve ??
        null,
      associatedBondingCurve:
        ((coin as Record<string, unknown>).associated_bonding_curve as string | undefined) ??
        normalizedMetadata.associatedBondingCurve ??
        null,
    }

    return NextResponse.json({
      source: "remote",
      metadata: responseMetadata,
      coin,
    })
  } catch (error) {
    console.error("[api/pump-coin] Failed to fetch pump coin:", error)
    return NextResponse.json({ error: "Failed to fetch coin" }, { status: 502 })
  }
}

