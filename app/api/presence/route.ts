import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"

import { ACTIVE_BROWSER_WINDOW_MS, browserPresence } from "@/lib/browser-presence"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PRESENCE_COOKIE = "pi_browser_presence"
const PRESENCE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60
const BROWSER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function requireSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin")
  const host = request.headers.get("host")
  if (!origin || !host || new URL(origin).host !== host) {
    throw new Response("Invalid origin", { status: 403 })
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    requireSameOrigin(request)
    const supplied = request.cookies.get(PRESENCE_COOKIE)?.value
    const browserId = supplied && BROWSER_ID_PATTERN.test(supplied) ? supplied : randomUUID()
    const activeBrowsers = browserPresence.touch(browserId)
    const response = NextResponse.json({
      activeBrowsers,
      activeWindowSeconds: ACTIVE_BROWSER_WINDOW_MS / 1_000,
      checkedAt: new Date().toISOString(),
    })
    const secure =
      request.nextUrl.protocol === "https:" ||
      request.headers.get("origin")?.startsWith("https://") === true ||
      request.headers.get("cf-visitor")?.includes('"scheme":"https"') === true
    response.cookies.set(PRESENCE_COOKIE, browserId, {
      httpOnly: true,
      sameSite: "strict",
      secure,
      path: "/",
      maxAge: PRESENCE_COOKIE_MAX_AGE,
    })
    response.headers.set("Cache-Control", "private, no-store, max-age=0")
    return response
  } catch (error) {
    if (error instanceof Response) return error
    console.error("[presence] heartbeat failed", error)
    return Response.json({ error: "Presence unavailable" }, { status: 503 })
  }
}
