"use client"

import { Users } from "lucide-react"
import { useEffect, useState } from "react"

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

const PRESENCE_HEARTBEAT_INTERVAL_MS = 25_000

interface PresenceResponse {
  activeBrowsers: number
  activeWindowSeconds: number
}

export function ActiveBrowserCount() {
  const [activeBrowsers, setActiveBrowsers] = useState<number | null>(null)
  const [activeWindowSeconds, setActiveWindowSeconds] = useState(75)

  useEffect(() => {
    let stopped = false
    let request: AbortController | null = null

    const heartbeat = async () => {
      if (document.visibilityState !== "visible") return
      request?.abort()
      request = new AbortController()
      try {
        const response = await fetch("/api/presence", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          signal: request.signal,
        })
        if (!response.ok) return
        const payload = await response.json() as PresenceResponse
        if (!stopped && Number.isInteger(payload.activeBrowsers) && payload.activeBrowsers >= 0) {
          setActiveBrowsers(payload.activeBrowsers)
          setActiveWindowSeconds(payload.activeWindowSeconds)
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.debug("[presence] heartbeat unavailable")
        }
      }
    }

    const handleVisibility = () => {
      if (document.visibilityState === "visible") void heartbeat()
    }

    void heartbeat()
    const interval = window.setInterval(() => void heartbeat(), PRESENCE_HEARTBEAT_INTERVAL_MS)
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      stopped = true
      request?.abort()
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [])

  if (activeBrowsers === null) return null

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="flex cursor-default items-center gap-1.5 text-xs text-muted-foreground"
            aria-label={`${activeBrowsers.toLocaleString()} active ${activeBrowsers === 1 ? "browser" : "browsers"}`}
            aria-live="polite"
          >
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="tabular-nums">{activeBrowsers.toLocaleString()}</span>
            <span className="hidden sm:inline">online</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {activeBrowsers.toLocaleString()} {activeBrowsers === 1 ? "browser has" : "browsers have"} used the app in the last {activeWindowSeconds} seconds.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
