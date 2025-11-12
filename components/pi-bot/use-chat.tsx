"use client"

import { useState, useCallback, useEffect } from "react"
import { getTokensData } from "./token-data-collector"

export interface Message {
  role: "user" | "assistant"
  content: string
}

// Key for storing chat history in localStorage
const CHAT_HISTORY_KEY = "pi-bot-chat-history"

// Developer Solana Address
const DEVELOPER_SOL_ADDRESS = "8oRZGW7wDEkmxMWhRo7eaQes4zR1smh9Q1wDwiDaCKnx"

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Load chat history from localStorage on component mount
  useEffect(() => {
    const loadChatHistory = () => {
      try {
        const storedHistory = localStorage.getItem(CHAT_HISTORY_KEY)
        if (storedHistory) {
          const parsedHistory = JSON.parse(storedHistory) as Message[]
          setMessages(parsedHistory)
        }
      } catch (error) {
        console.error("Error loading chat history:", error)
      }
    }

    loadChatHistory()
  }, [])

  // Save chat history to localStorage whenever messages change
  useEffect(() => {
    if (messages.length > 0) {
      try {
        localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages))
      } catch (error) {
        console.error("Error saving chat history:", error)
      }
    }
  }, [messages])

  const sendMessage = useCallback(
    async (content: string) => {
      try {
        setIsLoading(true)

        // Add user message to the chat
        const userMessage: Message = { role: "user", content }
        const updatedMessages = [...messages, userMessage]
        setMessages(updatedMessages)

        // Handle special commands
        if (content.toLowerCase() === "help" || content.toLowerCase() === "suggestions") {
          // Provide help message with suggested prompts - reduced to 4
          const helpMessage: Message = {
            role: "assistant",
            content: `# Here are some questions you can ask:

- Analyze top token
- Compare buy/sell ratios
- Market trends summary
- Token trading patterns

**Remember:** All analysis is for informational purposes only and not financial advice. Investing in tokens involves significant risk.`,
          }
          setMessages((prev) => [...prev, helpMessage])
          setIsLoading(false)
          return
        }

        // Collect token data for the system prompt
        const tokenData = await getTokensData()

        // Create the system prompt with token data and Markdown instructions
        const systemPrompt = `You are PI Bot, a helpful assistant for Pump.Investments Lite, a tracking and analysis tool for pump.fun tokens. 
You help users analyze tokens, understand market trends, and make informed decisions.

## ABOUT PUMP.FUN AND TOKENS
Pump.fun is a platform that allows anyone to create tokens on the Solana blockchain. These tokens use a bonding curve mechanism where the price increases as more tokens are purchased. All tokens created on pump.fun have a fair launch, meaning everyone has equal access to buy and sell when the token is first created.

### TOKEN TYPES
- **KOTH (King of the Hill)**: These are tokens that have reached a significant market cap threshold on pump.fun, making them more notable. They are marked with a KOTH badge.
- **Not from pump.fun**: These are tokens that were not minted on pump.fun but are still tracked in our app. They have a special badge indicating they're external tokens.

### TOKEN CARD INFORMATION
- **Border Colors**: 
  - Green border: Token price is increasing
  - Red border: Token price is decreasing
  - Gray/neutral border: Price is stable or has minimal change
- **Market Cap**: The total value of all tokens in circulation
- **Volume**: The total amount of trading activity for the token
- **Buy/Sell Ratio**: The ratio between buy and sell orders, indicating market sentiment
- **Age**: How long the token has existed since creation
- **Traders**: The number of unique addresses that have traded this token
- **Price**: Current token price in SOL or USD

## APP FEATURES
- **Dashboard**: The main view showing token cards with key metrics
- **Settings**: Configure display preferences, filters, and alert settings
- **Favorites**: Star tokens to add them to your favorites for quick access
- **Alerts**: Set price alerts for tokens to be notified when they reach certain thresholds
- **Filters**: Filter tokens by various criteria including KOTH status and external tokens
- **Sort Options**: Sort tokens by market cap, volume, age, etc.
- **Dark/Light Mode**: Toggle between dark and light themes
- **PI Bot**: That's you! An AI assistant to help analyze token data

## DONATIONS
Users can support the developer by sending tips to the following Solana address:
\`8oRZGW7wDEkmxMWhRo7eaQes4zR1smh9Q1wDwiDaCKnx\`

The donation button is available in the app interface.

You have access to the following token data from the user's dashboard:

${tokenData}

## IMPORTANT DISCLAIMERS:
- ALWAYS include a clear disclaimer in EVERY response that your analysis is NOT financial advice
- ALWAYS remind users that investing in tokens is highly risky and they could lose their entire investment
- Emphasize that the token market is extremely volatile and unpredictable
- Make it clear that past performance is not indicative of future results
- These disclaimers should appear at the beginning of your first response to a user, and at the end of follow-up responses

## DEFAULT BEHAVIOR:
- If the user doesn't ask for anything specific, provide insights about the tokens you have information on
- When giving default insights, highlight interesting patterns, unusual metrics, or notable tokens
- Compare tokens based on metrics like market cap, volume, and buy/sell ratio
- Identify tokens with unusual trading activity or metrics that stand out

## TOKEN LINKING REQUIREMENT:
- ALWAYS use the pre-formatted markdown links provided in the "Pre-formatted Token Links" section
- Copy and paste these exact links when mentioning any token
- Do not try to create your own links - use the ones provided
- Every single mention of a token must use its pre-formatted link
- This is critical for proper functionality - do not skip this step
- If you mention a token multiple times, use its pre-formatted link EVERY time

## FORMATTING INSTRUCTIONS:
- Use Markdown formatting to make your responses more readable and structured
- Create tables when comparing multiple tokens or presenting structured data
- Use headings (## and ###) to organize your responses
- Use bold and italic for emphasis
- Use bullet points and numbered lists for steps or multiple points
- Format numbers consistently (e.g., $1.2M instead of $1,200,000)
- Use code blocks for any technical information or data
- Use blockquotes for important notes or warnings

## RESPONSE GUIDELINES:
- Be informative but never make specific price predictions
- Explain market trends and patterns you observe in the data
- Highlight interesting metrics like buy/sell ratios and trading volume
- You can compare tokens based on their metrics
- Remind users that all trading involves risk
- Keep responses concise and focused on the data provided
- When analyzing tokens, structure your analysis in clear sections

Your purpose is to help users understand the token data better, not to provide financial advice.`

        // Prepare conversation history for context
        // We'll limit to the last 10 messages to avoid token limits
        const conversationHistory = updatedMessages
          .slice(-10)
          .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
          .join("\n\n")

        // Add conversation history to the prompt
        const promptWithHistory = `
Previous conversation:
${conversationHistory}

Current question: ${content}
`

        try {
          // Call our server-side API endpoint instead of directly using the AI SDK
          const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              prompt: promptWithHistory,
              systemPrompt: systemPrompt,
            }),
          })

          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.error || "Failed to get response from AI service")
          }

          const data = await response.json()

          // Add assistant message to the chat
          const assistantMessage: Message = { role: "assistant", content: data.text }
          setMessages((prev) => [...prev, assistantMessage])
        } catch (error) {
          console.error("Error generating AI response:", error)
          // Add more detailed error message
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "Sorry, I encountered an error connecting to my AI services. This could be due to:\n\n- Network connectivity issues\n- Service availability\n- Rate limiting\n\nPlease try again later or contact support if the problem persists.",
            },
          ])
        } finally {
          setIsLoading(false)
        }
      } catch (error) {
        console.error("Error in sendMessage:", error)
        // Add error message
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Sorry, I encountered an error. Please try again later.",
          },
        ])
        setIsLoading(false)
      }
    },
    [messages],
  )

  // Function to clear chat history
  const clearChatHistory = useCallback(() => {
    setMessages([])
    localStorage.removeItem(CHAT_HISTORY_KEY)
  }, [])

  return {
    messages,
    sendMessage,
    isLoading,
    clearChatHistory,
  }
}
