import { prisma } from "@/lib/prisma"
import { authenticateSupportClient, loadStoredImage, requireAdmin, responseError } from "@/lib/support-ticket"

type Context = { params: Promise<{ attachmentId: string }> }
export const runtime = "nodejs"

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const client = await authenticateSupportClient(request)
    const admin = request.headers.has("authorization") ? await requireAdmin(request).then(() => true).catch(() => false) : false
    const attachment = await prisma.supportAttachment.findFirst({
      where: { id: (await context.params).attachmentId, ...(admin ? {} : { message: { ticket: { clientId: client?.id ?? "" } } }) },
    })
    if (!attachment) return Response.json({ error: "Not found" }, { status: 404 })
    const bytes = await loadStoredImage(attachment.storageKey)
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": attachment.mimeType, "Content-Length": String(bytes.byteLength), "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } })
  } catch (error) { return responseError(error) }
}
