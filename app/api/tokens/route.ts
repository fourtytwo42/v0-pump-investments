import { NextResponse } from "next/server"

import { getTokenDataRevision, queryTokenSnapshot } from "@/lib/token-query"
import type { TokenQueryRequest } from "@/types/token-data"
import { apiErrorResponse, readJsonBody, tokenQuerySchema } from "@/lib/api-request"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request, tokenQuerySchema, 64 * 1024) as Partial<TokenQueryRequest>
    let snapshot
    let revisionBefore
    let revisionAfter
    do {
      revisionBefore = await getTokenDataRevision()
      snapshot = await queryTokenSnapshot(body)
      revisionAfter = await getTokenDataRevision()
    } while (revisionBefore !== revisionAfter)
    return NextResponse.json({ ...snapshot, revision: revisionAfter.toString() })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
