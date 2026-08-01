import { NextResponse } from "next/server"

import { getConsistentTokenSnapshot } from "@/lib/token-query"
import type { TokenQueryRequest } from "@/types/token-data"
import { apiErrorResponse, readJsonBody, tokenQuerySchema } from "@/lib/api-request"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request, tokenQuerySchema, 64 * 1024) as Partial<TokenQueryRequest>
    const snapshot = await getConsistentTokenSnapshot(body)
    return NextResponse.json({ ...snapshot, revision: snapshot.revision.toString() })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
