import { NextResponse } from "next/server"
import { apiErrorResponse, readJsonBody } from "@/lib/api-request"
import {
  assertPiBotContextWithinLimit,
  DEFAULT_PI_BOT_MODEL,
  generatePiBotText,
  getPiBotContextLimit,
  PiBotError,
} from "@/lib/pi-bot-appliance"
import { z } from "zod"

const chatSchema = z.object({
  prompt: z.string().min(1).max(400_000),
  systemPrompt: z.string().max(100_000).optional(),
})

export async function POST(request: Request) {
  try {
    const baseUrl = process.env.PI_BOT_BASE_URL
    if (!baseUrl) {
      return NextResponse.json(
        { error: "PI Bot is unavailable because its appliance is not configured." },
        { status: 503 },
      )
    }
    const { prompt, systemPrompt } = await readJsonBody(request, chatSchema, 512 * 1024)
    assertPiBotContextWithinLimit(prompt, systemPrompt, getPiBotContextLimit())

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("\n"))
        const heartbeat = setInterval(() => controller.enqueue(encoder.encode(" \n")), 15_000)
        void generatePiBotText({
          baseUrl,
          apiKey: process.env.PI_BOT_API_KEY,
          model: process.env.PI_BOT_MODEL ?? DEFAULT_PI_BOT_MODEL,
          prompt,
          systemPrompt,
        })
          .then((text) => controller.enqueue(encoder.encode(JSON.stringify({ text }))))
          .catch((error: unknown) => {
            const message =
              error instanceof PiBotError ? error.message : "PI Bot could not reach its appliance."
            controller.enqueue(encoder.encode(JSON.stringify({ error: message })))
          })
          .finally(() => {
            clearInterval(heartbeat)
            controller.close()
          })
      },
    })

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache, no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    })
  } catch (error) {
    if (error instanceof PiBotError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return apiErrorResponse(error)
  }
}
