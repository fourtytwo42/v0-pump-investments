import { DEFAULT_PI_BOT_MODEL, generatePiBotText } from "../lib/pi-bot-appliance"

async function main(): Promise<void> {
  const baseUrl = process.env.PI_BOT_BASE_URL
  if (!baseUrl) throw new Error("PI_BOT_BASE_URL is required")

  const text = await generatePiBotText({
    baseUrl,
    apiKey: process.env.PI_BOT_API_KEY,
    model: process.env.PI_BOT_MODEL ?? DEFAULT_PI_BOT_MODEL,
    systemPrompt: "Reply exactly as requested.",
    prompt: "Reply with exactly: PI BOT READY",
    maxOutputTokens: 64,
  })

  console.log(text)
}

void main()
