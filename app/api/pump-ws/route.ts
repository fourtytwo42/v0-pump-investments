export const runtime = "edge"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  // Check if this is a WebSocket upgrade request
  const upgrade = request.headers.get("upgrade")
  if (upgrade !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 })
  }

  try {
    // Create a WebSocket connection to the Pump.fun NATS server
    const ws = new WebSocket("wss://unified-prod.nats.realtime.pump.fun/")

    return new Response(null, {
      status: 101,
      statusText: "Switching Protocols",
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
      },
    })
  } catch (error) {
    console.error("[v0] WebSocket proxy error:", error)
    return new Response("WebSocket proxy failed", { status: 500 })
  }
}
