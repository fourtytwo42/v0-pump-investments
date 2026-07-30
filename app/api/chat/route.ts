import { NextResponse } from "next/server"
import { generateText } from "ai"
import { groq } from "@ai-sdk/groq"
import { apiErrorResponse, readJsonBody } from "@/lib/api-request"
import { z } from "zod"

const chatSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  systemPrompt: z.string().max(25_000).optional(),
})

export async function POST(request: Request) {
  try {
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: "PI Bot is unavailable because no Groq API key is configured." },
        { status: 503 },
      )
    }
    const { prompt, systemPrompt } = await readJsonBody(request, chatSchema, 128 * 1024)

    const { text } = await generateText({
      model: groq("openai/gpt-oss-20b"),
      prompt,
      system: systemPrompt,
      maxOutputTokens: 3000, // Increased from 1000 to 3000
    })

    return NextResponse.json({ text })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
