import { resolveTokenMetadata } from "@/lib/metadata-service"

interface RouteParams {
  params: Promise<{ mint: string }>
}

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  const { mint: rawMint } = await params
  const mint = decodeURIComponent(rawMint ?? "").trim()
  if (!/^[A-Za-z0-9]{32,50}$/.test(mint)) {
    return Response.json({ error: "Invalid mint address" }, { status: 400 })
  }
  const metadata = await resolveTokenMetadata(mint)
  if (!metadata) return Response.json({ error: "Token metadata unavailable" }, { status: 404 })
  return Response.json(
    { mintAddress: mint, ...metadata },
    { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } },
  )
}
