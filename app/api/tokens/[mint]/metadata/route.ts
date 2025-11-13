import { NextResponse } from "next/server"
import { getTokenDetails } from "@/lib/pump-api"

interface RouteParams {
  params: {
    mint: string
  }
}

export async function GET(_request: Request, { params }: RouteParams) {
  const mintAddress = decodeURIComponent(params.mint)

  try {
    const details = await getTokenDetails(mintAddress)
    if (!details) {
      return NextResponse.json({ error: "Token metadata unavailable" }, { status: 404 })
    }

    return NextResponse.json({
      mintAddress,
      name: details.name || null,
      symbol: details.symbol || null,
      imageUri: details.imageUri || null,
      twitter: details.twitter || null,
      telegram: details.telegram || null,
      website: details.website || null,
    })
  } catch (error) {
    console.warn(`[metadata-route] Failed to fetch metadata for ${mintAddress}:`, (error as Error).message)
    return NextResponse.json({ error: "Metadata fetch failed" }, { status: 502 })
  }
}

