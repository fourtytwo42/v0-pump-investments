import { NextResponse } from "next/server"
import { generateText } from "ai"
import { groq } from "@ai-sdk/groq"

export async function POST(request: Request) {
  try {
    const { prompt, systemPrompt } = await request.json()

    if (!prompt) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const { text } = await generateText({
      model: groq("llama3-8b-8192"),
      prompt,
      system: systemPrompt,
      maxTokens: 3000, // Increased from 1000 to 3000
    })

    return NextResponse.json({ text })
  } catch (error) {
    console.error("Error in chat API:", error)
    return NextResponse.json({ error: "Failed to generate response" }, { status: 500 })
  }
}
