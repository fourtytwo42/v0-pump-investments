"use client"

import { ModeToggle } from "./mode-toggle"
import { Badge } from "@/components/ui/badge"
import NextImage from "next/image"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Changelog } from "./changelog"
import { Roadmap } from "./roadmap"
import { History, Map, MessageCircle } from "lucide-react"
import { Quicksand } from "next/font/google"
import { useTokenContext } from "@/contexts/token-context"
import { useState, useEffect } from "react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { changelogData } from "./changelog"
import { useLocalStorage } from "@/hooks/use-local-storage"

// Initialize the Quicksand font
const quicksand = Quicksand({ subsets: ["latin"], weight: ["300"] })

/**
 * VERSIONING REMINDER
 * ==================
 * When updating the application:
 * 1. Update the version badge below
 * 2. Update the version in package.json
 * 3. Add your changes to the changelog
 *
 * See components/changelog.tsx for detailed versioning guidelines.
 */

export default function Header() {
  // Get solPrice from context
  const { solPrice, isConnected } = useTokenContext()

  useEffect(() => {
    console.log("[Header] isConnected (from context) changed to:", isConnected)
  }, [isConnected])

  const latestChangelogVersion = changelogData[0]?.version
  const [lastSeenChangelogVersion, setLastSeenChangelogVersion] = useLocalStorage<string | null>(
    "lastSeenChangelogVersion",
    null, // Initialize with null if nothing is in localStorage
  )
  const [showNewChangelogIndicator, setShowNewChangelogIndicator] = useState(false)

  useEffect(() => {
    // Show indicator if there's a latest version AND
    // (the user has never seen a version (null) OR the seen version is older than the latest)
    if (
      latestChangelogVersion &&
      (lastSeenChangelogVersion === null || lastSeenChangelogVersion !== latestChangelogVersion)
    ) {
      setShowNewChangelogIndicator(true)
    } else {
      setShowNewChangelogIndicator(false)
    }
  }, [latestChangelogVersion, lastSeenChangelogVersion])

  const handleChangelogOpen = (isOpen: boolean) => {
    if (isOpen && latestChangelogVersion) {
      // If the sheet is opening and there's a latest version to mark as seen
      setLastSeenChangelogVersion(latestChangelogVersion)
      setShowNewChangelogIndicator(false) // Hide indicator immediately
    }
  }

  return (
    <header className="border-b sticky top-0 z-10 bg-background">
      <div className="container mx-auto px-4 py-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <NextImage src="/logo.png" alt="Pump.Investments Logo" width={32} height={32} className="rounded-full" />
          <div className="flex items-baseline md:flex hidden">
            <h1 className="text-xl font-bold">Pump.Investments</h1>
            <span
              className={`${quicksand.className} ml-1.5 text-sm font-light bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent px-1.5 py-0.5 rounded-sm`}
              style={{ letterSpacing: "0.05em" }}
            >
              Lite
            </span>
          </div>
          <Badge variant="outline" className="ml-1 hidden md:flex">
            v3.0.30
          </Badge>
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          <div className="hidden md:block">
            <Badge variant="outline" className="font-mono">
              SOL: ${solPrice ? solPrice.toFixed(2) : "0.00"}
            </Badge>
          </div>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 cursor-default">
                  <span
                    className={`h-2.5 w-2.5 rounded-full transition-colors duration-300 ${isConnected ? "bg-green-500" : "bg-red-500"}`}
                  />
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {isConnected ? "Connected" : "Offline"}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {isConnected
                    ? "Connected to pump.fun real-time data feed."
                    : "Disconnected from pump.fun real-time data feed. Market data may be stale."}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Telegram Group Link */}
          <a
            href="https://t.me/+gZJpn2VahHxmYmEx"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex"
            title="Join our Telegram group"
            data-onboarding="telegram-button"
          >
            <Button variant="ghost" size="icon" className="h-8 w-8 md:h-9 md:w-9">
              <MessageCircle className="h-[1.1rem] w-[1.1rem] md:h-[1.2rem] md:w-[1.2rem] text-blue-500" />
            </Button>
          </a>

          {/* Roadmap Sheet */}
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 md:h-9 md:w-9"
                title="View Roadmap"
                data-onboarding="roadmap-button"
              >
                <Map className="h-[1.1rem] w-[1.1rem] md:h-[1.2rem] w-[1.2rem]" />
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md flex flex-col">
              <SheetHeader>
                <SheetTitle>Roadmap</SheetTitle>
                <SheetDescription>See what features are coming to Pump.Investments Lite</SheetDescription>
              </SheetHeader>
              <div className="mt-6 flex-1 overflow-y-auto">
                <Roadmap />
              </div>
            </SheetContent>
          </Sheet>

          {/* Changelog Sheet */}
          <Sheet onOpenChange={handleChangelogOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 md:h-9 md:w-9 relative" // Added relative
                title="View Changelog"
                data-onboarding="changelog-button"
              >
                <History className="h-[1.1rem] w-[1.1rem] md:h-[1.2rem] md:w-[1.2rem]" />
                {showNewChangelogIndicator && (
                  <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                  </span>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md flex flex-col">
              <SheetHeader>
                <SheetTitle>Changelog</SheetTitle>
                <SheetDescription>Track updates and new features in Pump.Investments Lite</SheetDescription>
              </SheetHeader>
              <div className="mt-6 flex-1 overflow-y-auto">
                <Changelog />
              </div>
            </SheetContent>
          </Sheet>

          <ModeToggle />
        </div>
      </div>
    </header>
  )
}
