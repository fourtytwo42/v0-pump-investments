import { NextResponse } from "next/server"

import { getTokenDataRevision, queryTokenSnapshot } from "@/lib/token-query"
import type { TokenQueryRequest } from "@/types/token-data"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<TokenQueryRequest>
    const [snapshot, revision] = await Promise.all([queryTokenSnapshot(body), getTokenDataRevision()])
    return NextResponse.json({ ...snapshot, revision: revision.toString() })
  } catch (error) {
    console.error("[api/tokens] Failed to fetch tokens:", error)
    return NextResponse.json({ error: "Failed to fetch tokens" }, { status: 500 })
  }
}
