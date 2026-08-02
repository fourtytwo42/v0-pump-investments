import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { authenticateSupportClient, hashSessionToken, newSupportIdentity, requireSameOrigin, responseError, SUPPORT_COOKIE, SUPPORT_COOKIE_MAX_AGE } from "@/lib/support-ticket"

export const runtime = "nodejs"

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request)
    const existing = await authenticateSupportClient(request)
    if (existing) return NextResponse.json({ installationId: existing.publicId })
    const identity = newSupportIdentity()
    await prisma.supportClient.create({ data: { publicId: identity.publicId, sessionTokenHash: hashSessionToken(identity.token), expiresAt: new Date(Date.now() + SUPPORT_COOKIE_MAX_AGE * 1000) } })
    const response = NextResponse.json({ installationId: identity.publicId }, { status: 201 })
    const secure = new URL(request.url).protocol === "https:" || request.headers.get("origin")?.startsWith("https://") === true || request.headers.get("cf-visitor")?.includes('"scheme":"https"') === true
    response.cookies.set(SUPPORT_COOKIE, identity.cookieValue, { httpOnly: true, sameSite: "strict", secure, path: "/", maxAge: SUPPORT_COOKIE_MAX_AGE })
    return response
  } catch (error) {
    return responseError(error)
  }
}
