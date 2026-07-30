export const DEFAULT_PI_BOT_MODEL = "ornith-1.0-35b-Q5_K_M-688b8d0a"
export const DEFAULT_PI_BOT_CONTEXT_TOKENS = 100_000
export const MAX_PI_BOT_CONTEXT_TOKENS = 100_000
export const DEFAULT_PI_BOT_OUTPUT_TOKENS = 3_000
export const DEFAULT_PI_BOT_TIMEOUT_MS = 180_000

export class PiBotError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "PiBotError"
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getPiBotContextLimit(value = process.env.PI_BOT_MAX_CONTEXT_TOKENS): number {
  return Math.min(positiveInteger(value, DEFAULT_PI_BOT_CONTEXT_TOKENS), MAX_PI_BOT_CONTEXT_TOKENS)
}

export function estimateContextTokens(...parts: Array<string | undefined>): number {
  const text = parts.filter(Boolean).join("\n")
  const utf8Bytes = Buffer.byteLength(text, "utf8")
  const unicodeCharacters = Array.from(text).length

  // The appliance tokenizer is model-specific. Using the larger of Unicode
  // characters and one token per four UTF-8 bytes is deliberately conservative.
  return Math.max(unicodeCharacters, Math.ceil(utf8Bytes / 4))
}

export function assertPiBotContextWithinLimit(
  prompt: string,
  systemPrompt: string | undefined,
  limit = getPiBotContextLimit(),
): number {
  const estimatedTokens = estimateContextTokens(systemPrompt, prompt)
  if (estimatedTokens > limit) {
    throw new PiBotError(`PI Bot context exceeds the ${limit.toLocaleString()} token limit.`, 413)
  }
  return estimatedTokens
}

function chatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "")
  return normalized.endsWith("/v1") ? `${normalized}/chat/completions` : `${normalized}/v1/chat/completions`
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : null
}

export function extractChatCompletionText(payload: unknown): string {
  const record = asRecord(payload)
  if (!record) return ""
  const choices = Array.isArray(record.choices) ? record.choices : []
  const choice = asRecord(choices[0])
  const message = asRecord(choice?.message)
  return typeof message?.content === "string" ? message.content : ""
}

export function removeModelThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*<think>[\s\S]*$/i, "")
    .trim()
}

export async function generatePiBotText(options: {
  baseUrl: string
  apiKey?: string
  model?: string
  prompt: string
  systemPrompt?: string
  timeoutMs?: number
  maxOutputTokens?: number
}): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_PI_BOT_TIMEOUT_MS,
  )

  try {
    const response = await fetch(chatCompletionsUrl(options.baseUrl), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: options.model ?? DEFAULT_PI_BOT_MODEL,
        messages: [
          ...(options.systemPrompt ? [{ role: "system", content: options.systemPrompt }] : []),
          { role: "user", content: options.prompt },
        ],
        max_tokens: options.maxOutputTokens ?? DEFAULT_PI_BOT_OUTPUT_TOKENS,
        chat_template_kwargs: { enable_thinking: false },
        reasoning_budget: 0,
        reasoning_format: "none",
        stream: false,
      }),
      signal: controller.signal,
      cache: "no-store",
    })
    const body = await response.text()
    if (!response.ok) {
      console.error(`[PI Bot] Appliance returned ${response.status}: ${body.slice(0, 1_000)}`)
      throw new PiBotError("PI Bot's appliance is temporarily unavailable.", 503)
    }

    const text = removeModelThinking(extractChatCompletionText(JSON.parse(body)))
    if (!text) throw new PiBotError("PI Bot's appliance returned an empty response.", 503)
    return text
  } catch (error) {
    if (error instanceof PiBotError) throw error
    if (error instanceof Error && error.name === "AbortError") {
      throw new PiBotError("PI Bot's appliance took too long to respond.", 504, error)
    }
    throw new PiBotError("PI Bot could not reach its appliance.", 503, error)
  } finally {
    clearTimeout(timeout)
  }
}
