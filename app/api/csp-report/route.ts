export const dynamic = "force-dynamic"

export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > 16 * 1024) return new Response(null, { status: 413 })
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > 16 * 1024) return new Response(null, { status: 413 })
  console.warn(`[csp-report] ${text.slice(0, 16 * 1024)}`)
  return new Response(null, { status: 204 })
}
