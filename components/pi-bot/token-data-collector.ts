"use client"

// This function collects token data from the dashboard
export async function getTokensData(): Promise<string> {
  try {
    // Check if window is defined (client-side)
    if (typeof window === "undefined") {
      return "No token data available (server-side rendering)"
    }

    // Check if the data is available
    const pumpData = (window as any).__pumpInvestments
    if (!pumpData || !pumpData.visibleTokens) {
      console.warn("Token data not found in window object")
      return "No token data available. Please refresh the page or check if tokens are loaded."
    }

    // Get the tokens from the window object
    const tokens = pumpData.visibleTokens
    const solPrice = pumpData.solPrice || 0

    if (!tokens || tokens.length === 0) {
      return "No tokens are currently visible in the dashboard."
    }

    // Format the token data as a string
    let tokenDataString = `# Current Token Data\n\n`
    tokenDataString += `SOL Price: $${solPrice.toFixed(2)}\n`
    tokenDataString += `Number of Visible Tokens: ${tokens.length}\n\n`

    // Add data for each token (limit to top 10 for performance)
    const topTokens = tokens.slice(0, 10)
    tokenDataString += `## Token Details\n\n`

    // Pre-formatted token links section
    tokenDataString += `## Pre-formatted Token Links\n`
    topTokens.forEach((token: any) => {
      const symbol = token.symbol || "Unknown"
      const name = token.name || "Unknown Token"
      tokenDataString += `[${symbol}](https://pump.fun/token/${token.mint}) `
    })
    tokenDataString += `\n\n`

    topTokens.forEach((token: any, index: number) => {
      try {
        const marketCap = token.usd_market_cap ? `$${token.usd_market_cap.toLocaleString()}` : "Unknown"
        const buyVolume = token.buy_volume ? `${token.buy_volume.toFixed(2)} SOL` : "Unknown"
        const sellVolume = token.sell_volume ? `${token.sell_volume.toFixed(2)} SOL` : "Unknown"
        const buyToSellRatio = token.buy_sell_ratio ? token.buy_sell_ratio.toFixed(2) : "Unknown"
        const uniqueTraders = token.unique_trader_count || "Unknown"

        tokenDataString += `### ${index + 1}. ${token.name || "Unknown Token"} (${token.symbol || "??"})\n`
        tokenDataString += `- Market Cap: ${marketCap}\n`
        tokenDataString += `- Buy Volume: ${buyVolume}\n`
        tokenDataString += `- Sell Volume: ${sellVolume}\n`
        tokenDataString += `- Buy/Sell Ratio: ${buyToSellRatio}\n`
        tokenDataString += `- Unique Traders: ${uniqueTraders}\n`
        tokenDataString += `- Token Address: ${token.mint}\n\n`
      } catch (err) {
        console.error(`Error formatting token ${index}:`, err)
        tokenDataString += `### ${index + 1}. Error formatting token data\n\n`
      }
    })

    return tokenDataString
  } catch (error) {
    console.error("Error collecting token data:", error)
    return "Error collecting token data. Please refresh the page and try again."
  }
}

// Helper functions for formatting
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + "M"
  } else if (num >= 1000) {
    return (num / 1000).toFixed(2) + "K"
  } else {
    return num.toFixed(2)
  }
}

function formatAge(timestamp: number): string {
  const now = Date.now()
  const ageMs = now - timestamp
  const days = Math.floor(ageMs / (1000 * 60 * 60 * 24))

  if (days > 0) {
    return `${days} day${days === 1 ? "" : "s"}`
  }

  const hours = Math.floor(ageMs / (1000 * 60 * 60))
  if (hours > 0) {
    return `${hours} hour${hours === 1 ? "" : "s"}`
  }

  const minutes = Math.floor(ageMs / (1000 * 60))
  return `${minutes} minute${minutes === 1 ? "" : "s"}`
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now() / 1000
  const secondsAgo = now - timestamp

  if (secondsAgo < 60) {
    return "Just now"
  }

  const minutesAgo = Math.floor(secondsAgo / 60)
  if (minutesAgo < 60) {
    return `${minutesAgo} minute${minutesAgo === 1 ? "" : "s"} ago`
  }

  const hoursAgo = Math.floor(minutesAgo / 60)
  if (hoursAgo < 24) {
    return `${hoursAgo} hour${hoursAgo === 1 ? "" : "s"} ago`
  }

  const daysAgo = Math.floor(hoursAgo / 24)
  return `${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`
}
