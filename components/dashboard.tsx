"use client"

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Pause, Play, Settings, Star } from "lucide-react"
import TokenCard from "./token-card"
import Header from "./header"
import { useLocalStorage } from "@/hooks/use-local-storage"
import NextImage from "next/image"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import DonationButton from "./donation-button"
import { db } from "@/lib/db"
import { useOnboardingStore } from "./onboarding/onboarding-store"
import { useTokenContext } from "@/contexts/token-context"

// Import custom hooks
// import { useWebSocketTrades } from "@/hooks/use-websocket-trades"; // Removed as it's in TokenProvider
import { useSettings } from "@/hooks/use-settings"
import { usePiBotData } from "@/hooks/use-pi-bot-data"
import { useAlertChecker } from "@/hooks/use-alert-checker"
import type { TokenSortBy } from "@/types/token-data"
import { useAlertModalStore } from "@/stores/alert-modal-store"

const OnboardingGuide = lazy(() =>
  import("./onboarding/onboarding-guide").then((module) => ({ default: module.OnboardingGuide })),
)
const ChatBubble = lazy(() =>
  import("./pi-bot/chat-bubble").then((module) => ({ default: module.ChatBubble })),
)
const AlertSettingsModal = lazy(() =>
  import("./alert-settings-modal").then((module) => ({ default: module.AlertSettingsModal })),
)
const SettingsSheet = lazy(() =>
  import("./settings-sheet").then((module) => ({ default: module.SettingsSheet })),
)

export default function Dashboard() {
  // Get values from context
  const {
    tokens,
    visibleTokens,
    solPrice,
    isLoading,
    showFavorites,
    setShowFavorites,
    isPaused,
    setIsPaused,
    totalPages,
    queryOptions,
    setTokenQueryOptions,
    favorites, // Access favorites from the context
  } = useTokenContext()

  // Use localStorage for timeRange and sortBy to persist user preferences
  const [timeRange, setTimeRange] = useLocalStorage<string>("pump-investments-time-range", "10")
  const [sortBy, setSortBy] = useLocalStorage<TokenSortBy>("pump-investments-sort-by", "marketCap")
  const [currentPage, setCurrentPage] = useState<number>(queryOptions.page ?? 1)
  const [chatOpen, setChatOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const isAlertModalOpen = useAlertModalStore((state) => state.isOpen)

  // Onboarding state
  const { isOnboardingActive, setOnboardingActive } = useOnboardingStore()

  // Use settings hook
  const { settings, updateSettings, updateSettingsBatch, restartOnboarding } = useSettings(setOnboardingActive) // Added updateSettingsBatch

  // Reset pagination when filter or sort criteria changes (unless paused)
  useEffect(() => {
    if (!isPaused) {
      setCurrentPage(1)
    }
  }, [
    sortBy,
    timeRange,
    settings.tokensPerPage,
    settings.hideExternal,
    settings.graduationFilter,
    settings.minMarketCap,
    settings.maxMarketCap,
    settings.minTotalVolume,
    settings.maxTotalVolume,
    settings.minBuyVolume,
    settings.maxBuyVolume,
    settings.minSellVolume,
    settings.maxSellVolume,
    settings.minUniqueTraders,
    settings.maxUniqueTraders,
    settings.minMarketCapFilter,
    settings.maxMarketCapFilter,
    settings.minUniqueTraderCountFilter,
    settings.maxUniqueTraderCountFilter,
    settings.minTradeAmountFilter,
    settings.maxTradeAmountFilter,
    settings.minTokenAgeMinutes,
    settings.maxTokenAgeMinutes,
    showFavorites,
    isPaused,
  ])

  // Keep local page in sync with provider state
  useEffect(() => {
    if (queryOptions.page !== currentPage) {
      setCurrentPage(queryOptions.page)
    }
  }, [queryOptions.page])

  // Ensure current page never exceeds total pages
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages === 0 ? 1 : totalPages)
    }
  }, [currentPage, totalPages])

  const computedQueryOptions = useMemo(() => {
    const safeTimeRange = Number(timeRange)

    return {
      page: currentPage,
      pageSize: settings.tokensPerPage,
      sortBy,
      sortOrder: "desc" as const,
      timeRangeMinutes: Number.isFinite(safeTimeRange) ? safeTimeRange : 10,
      filters: {
        hideExternal: settings.hideExternal,
        graduationFilter: settings.graduationFilter,
        minMarketCap: settings.minMarketCapFilter,
        maxMarketCap: settings.maxMarketCapFilter,
        minTotalVolume: settings.minTotalVolume,
        maxTotalVolume: settings.maxTotalVolume,
        minBuyVolume: settings.minBuyVolume,
        maxBuyVolume: settings.maxBuyVolume,
        minSellVolume: settings.minSellVolume,
        maxSellVolume: settings.maxSellVolume,
        minUniqueTraders: settings.minUniqueTraderCountFilter,
        maxUniqueTraders: settings.maxUniqueTraderCountFilter,
        minTradeAmount: settings.minTradeAmountFilter,
        maxTradeAmount: settings.maxTradeAmountFilter,
        minTokenAgeMinutes: settings.minTokenAgeMinutes > 0 ? settings.minTokenAgeMinutes : undefined,
        maxTokenAgeMinutes: settings.maxTokenAgeMinutes < 10080 ? settings.maxTokenAgeMinutes : undefined,
        favoritesOnly: showFavorites,
      },
    }
  }, [
    currentPage,
    settings.tokensPerPage,
    sortBy,
    timeRange,
    settings.hideExternal,
    settings.graduationFilter,
    settings.minMarketCapFilter,
    settings.maxMarketCapFilter,
    settings.minTotalVolume,
    settings.maxTotalVolume,
    settings.minBuyVolume,
    settings.maxBuyVolume,
    settings.minSellVolume,
    settings.maxSellVolume,
    settings.minUniqueTraderCountFilter,
    settings.maxUniqueTraderCountFilter,
    settings.minTradeAmountFilter,
    settings.maxTradeAmountFilter,
    settings.minTokenAgeMinutes,
    settings.maxTokenAgeMinutes,
    showFavorites,
  ])

  useEffect(() => {
    setTokenQueryOptions(computedQueryOptions)
  }, [computedQueryOptions, setTokenQueryOptions])

  // Use PI Bot data hook
  usePiBotData({
    paginatedTokens: visibleTokens,
    solPrice,
    timeRange,
    sortBy,
  })

  // Use alert checker hook
  useAlertChecker(tokens)

  // Check if onboarding should be shown
  useEffect(() => {
    const checkOnboardingStatus = async () => {
      const hasCompleted = await db.hasCompletedOnboarding()
      setOnboardingActive(!hasCompleted)
    }

    checkOnboardingStatus()
  }, [setOnboardingActive])

  // Clean up alerts for non-favorite tokens
  useEffect(() => {
    const cleanupAlerts = async () => {
      await db.removeAllAlertsForNonFavorites()
    }

    cleanupAlerts()
  }, [favorites])

  const tokenCards = useMemo(() => {
    return visibleTokens.map((token, index) => (
      <div
        key={token.mint}
        data-onboarding={index === 4 ? "token-card" : undefined}
        id={index === 4 ? "featured-token-card" : undefined}
      >
        <TokenCard
          mint={token.mint}
          size="medium"
          showAlertSettings={showFavorites} // Only show alert settings in favorites view
          showBonkBotLogo={settings.showBonkBotLogo} // Pass BonkBot setting to TokenCard
        />
      </div>
    ))
  }, [visibleTokens, settings.showBonkBotLogo, showFavorites])

  const showInitialLoading = isLoading && visibleTokens.length === 0

  if (showInitialLoading) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header />
        <div className="container mx-auto px-4 py-6 flex items-center justify-center h-[50vh]">
          <div className="text-center">
            <h2 className="text-xl font-semibold mb-2">Loading data...</h2>
            <p className="text-muted-foreground">Please wait while we fetch the latest token information</p>
          </div>
        </div>
      </div>
    )
  }


  return (
    <div className="flex flex-col min-h-screen">
      <Header />

      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger aria-label="Time range" className="w-[120px]" data-onboarding="time-range">
                <SelectValue placeholder="Time Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 min</SelectItem>
                <SelectItem value="2">2 min</SelectItem>
                <SelectItem value="5">5 min</SelectItem>
                <SelectItem value="10">10 min</SelectItem>
                <SelectItem value="15">15 min</SelectItem>
                <SelectItem value="30">30 min</SelectItem>
                <SelectItem value="60">60 min</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={(value) => setSortBy(value as TokenSortBy)}>
              <SelectTrigger aria-label="Sort tokens by" className="w-[150px]" data-onboarding="sort-by">
                <SelectValue placeholder="Sort By" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="marketCap">Market Cap</SelectItem>
                <SelectItem value="totalVolume">Total Volume</SelectItem>
                <SelectItem value="buyVolume">Buy Volume</SelectItem>
                <SelectItem value="sellVolume">Sell Volume</SelectItem>
                <SelectItem value="uniqueTraders">Unique Buyers</SelectItem>
                <SelectItem value="tokenAge">Token Age</SelectItem>
                <SelectItem value="lastTrade">Last Trade</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={settings.graduationFilter}
              onValueChange={(value) => updateSettings("graduationFilter", value as "all" | "bonding" | "graduated")}
            >
              <SelectTrigger aria-label="Lifecycle status" className="w-[140px]" data-onboarding="graduation-filter">
                <SelectValue placeholder="Bonding Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="bonding">Bonding</SelectItem>
                <SelectItem value="graduated">Graduated</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsPaused(!isPaused)}
              className="ml-2"
              data-onboarding="pause-button"
              title={isPaused ? "Resume auto-sorting" : "Pause auto-sorting"}
              aria-label={isPaused ? "Resume automatic token ordering" : "Pause automatic token ordering"}
            >
              {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </Button>
            <div className="relative" data-onboarding="favorites-button">
              <Button
                variant={showFavorites ? "default" : "outline"}
                size="icon"
                onClick={() => setShowFavorites(!showFavorites)}
                className="ml-2"
                title={showFavorites ? "Show all tokens" : "Show favorites only"}
                aria-label={showFavorites ? "Show all tokens" : "Show favorite tokens only"}
              >
                <Star className={`h-4 w-4 ${showFavorites ? "fill-yellow-400" : ""}`} />
              </Button>
              {favorites.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-primary text-primary-foreground text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {favorites.length}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 w-full md:w-auto">
            <DonationButton address="8oRZGW7wDEkmxMWhRo7eaQes4zR1smh9Q1wDwiDaCKnx" />

            <Button
              ref={settingsButtonRef}
              variant="outline"
              size="icon"
              data-onboarding="settings-button"
              aria-label="Open settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="h-4 w-4" />
            </Button>
            {settingsOpen && (
              <Suspense fallback={null}>
                <SettingsSheet
                  open={settingsOpen}
                  settings={settings}
                  updateSettings={updateSettings}
                  updateSettingsBatch={updateSettingsBatch}
                  restartOnboarding={restartOnboarding}
                  onOpenChange={(open) => {
                    setSettingsOpen(open)
                    if (!open) requestAnimationFrame(() => settingsButtonRef.current?.focus())
                  }}
                />
              </Suspense>
            )}
          </div>
        </div>

        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          data-token-card-grid
        >
          {tokenCards}

          {visibleTokens.length === 0 && (
            <div className="col-span-full text-center py-12">
              <h3 className="text-xl font-semibold mb-2">No tokens found</h3>
              {showFavorites && favorites.length === 0 ? (
                <p className="text-muted-foreground">
                  You haven't added any favorites yet. Click the star icon on a token to add it to your favorites.
                </p>
              ) : (
                <p className="text-muted-foreground">Waiting for new trades or adjust your filters...</p>
              )}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <Pagination className="mt-8" data-onboarding="pagination">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                  className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  aria-disabled={currentPage === 1}
                  disabled={currentPage === 1}
                  tabIndex={currentPage === 1 ? -1 : 0}
                />
              </PaginationItem>

              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number

                if (totalPages <= 5) {
                  // Show all pages if 5 or fewer
                  pageNum = i + 1
                } else if (currentPage <= 3) {
                  // Near the start
                  pageNum = i + 1
                  if (i === 4)
                    return (
                      <PaginationItem key="ellipsis-end">
                        <PaginationEllipsis />
                      </PaginationItem>
                    )
                } else if (currentPage >= totalPages - 2) {
                  // Near the end
                  pageNum = totalPages - 4 + i
                  if (i === 0)
                    return (
                      <PaginationItem key="ellipsis-start">
                        <PaginationEllipsis />
                      </PaginationItem>
                    )
                } else {
                  // In the middle
                  if (i === 0)
                    return (
                      <PaginationItem key="ellipsis-start">
                        <PaginationEllipsis />
                      </PaginationItem>
                    )
                  if (i === 4)
                    return (
                      <PaginationItem key="ellipsis-end">
                        <PaginationEllipsis />
                      </PaginationItem>
                    )
                  pageNum = currentPage + i - 2
                }

                return (
                  <PaginationItem key={pageNum}>
                    <PaginationLink
                      isActive={currentPage === pageNum}
                      aria-label={`Go to page ${pageNum}`}
                      onClick={() => setCurrentPage(pageNum)}
                    >
                      {pageNum}
                    </PaginationLink>
                  </PaginationItem>
                )
              })}

              <PaginationItem>
                <PaginationNext
                  onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                  className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  aria-disabled={currentPage === totalPages}
                  disabled={currentPage === totalPages}
                  tabIndex={currentPage === totalPages ? -1 : 0}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </div>

      {/* Onboarding Guide */}
      {isOnboardingActive && (
        <Suspense fallback={null}>
          <OnboardingGuide />
        </Suspense>
      )}

      {/* Add Toaster for notifications */}
      {!chatOpen && (
        <div className="fixed bottom-4 right-4 z-40 md:bottom-6 md:right-6">
          <Button
            className="h-14 w-14 rounded-full shadow-lg p-0 overflow-hidden"
            aria-label="Chat with PI Bot"
            data-onboarding="pi-bot-button"
            onClick={() => setChatOpen(true)}
          >
            <NextImage src="/pi-bot-avatar.png" alt="PI Bot" width={56} height={56} className="rounded-full" />
          </Button>
        </div>
      )}
      {chatOpen && (
        <Suspense fallback={null}>
          <ChatBubble open={chatOpen} onOpenChange={setChatOpen} />
        </Suspense>
      )}

      {/* Add the Alert Settings Modal */}
      {isAlertModalOpen && (
        <Suspense fallback={null}>
          <AlertSettingsModal />
        </Suspense>
      )}
    </div>
  )
}
