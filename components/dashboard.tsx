"use client"

import { useEffect, useMemo, useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { RangeSlider } from "@/components/ui/range-slider"
import { HelpCircle, Pause, Play, Settings, Star } from "lucide-react"
import TokenCard from "./token-card"
import Header from "./header"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { useLocalStorage } from "@/hooks/use-local-storage"
import { useTheme } from "next-themes"
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
import { Toaster } from "@/components/ui/toaster"
import { db } from "@/lib/db"
import { OnboardingGuide } from "./onboarding/onboarding-guide"
import { useOnboardingStore } from "./onboarding/onboarding-store"
import { ChatBubble } from "./pi-bot/chat-bubble"
import { useTokenContext } from "@/contexts/token-context"
import { AlertSettingsModal } from "./alert-settings-modal"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

// Import custom hooks
// import { useWebSocketTrades } from "@/hooks/use-websocket-trades"; // Removed as it's in TokenProvider
import { useSettings } from "@/hooks/use-settings"
import { usePiBotData } from "@/hooks/use-pi-bot-data"
import { useAlertChecker } from "@/hooks/use-alert-checker"

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
  const [sortBy, setSortBy] = useLocalStorage<string>("pump-investments-sort-by", "marketCap")
  const [currentPage, setCurrentPage] = useState<number>(queryOptions.page ?? 1)

  // Onboarding state
  const { isOnboardingActive, setOnboardingActive } = useOnboardingStore()

  // Get theme from next-themes
  const { theme } = useTheme()

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
    settings.hideKOTH,
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
        hideKOTH: settings.hideKOTH,
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
    settings.hideKOTH,
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
        key={`${token.mint}-${index}`}
        data-onboarding={index === 4 ? "token-card" : undefined}
        id={index === 4 ? "featured-token-card" : undefined}
      >
        <TokenCard
          token={token}
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

  // Maps slider position (0-100) to actual values with more precision at lower values
  const mapSliderToValue = (sliderValue: number): number => {
    if (sliderValue <= 50) {
      // First half: 0-50 slider = 1-50 value (1:1 mapping)
      return Math.round(sliderValue)
    } else {
      // Second half: 50-100 slider = 50-500 value (exponential growth)
      const normalized = (sliderValue - 50) / 50 // 0 to 1
      return Math.round(50 + normalized * 450) // 50 to 500
    }
  }

  const mapValueToSlider = (value: number): number => {
    if (value <= 50) {
      // First half: 1-50 value = 0-50 slider
      return value
    } else {
      // Second half: 50-500 value = 50-100 slider
      const normalized = (value - 50) / 450 // 0 to 1
      return Math.round(50 + normalized * 50) // 50 to 100
    }
  }

  // Maps slider position (0-100) to market cap values (3000 to 1,000,000)
  const mapMarketCapSliderToValue = (sliderValue: number): number => {
    if (sliderValue <= 50) {
      // First half: 0-50 slider = 3k-50k (more granular at lower values)
      const normalized = sliderValue / 50 // 0 to 1
      return Math.round(3000 + normalized * 47000) // 3k to 50k
    } else {
      // Second half: 50-100 slider = 50k-1M (larger jumps)
      const normalized = (sliderValue - 50) / 50 // 0 to 1
      return Math.round(50000 + normalized * 950000) // 50k to 1M
    }
  }

  const mapMarketCapValueToSlider = (value: number): number => {
    if (value <= 50000) {
      // First half: 3k-50k value = 0-50 slider
      const normalized = (value - 3000) / 47000 // 0 to 1
      return Math.round(normalized * 50) // 0 to 50
    } else {
      // Second half: 50k-1M value = 50-100 slider
      const normalized = (value - 50000) / 950000 // 0 to 1
      return Math.round(50 + normalized * 50) // 50 to 100
    }
  }

  const mapTradeAmountSliderToValue = (sliderValue: number): number => {
    if (sliderValue <= 50) {
      // First half: 0-50 slider = 0-100 (more granular at lower values)
      const normalized = sliderValue / 50 // 0 to 1
      return Math.round(normalized * 100) // 0 to 100
    } else {
      // Second half: 50-100 slider = 100-5000 (larger jumps)
      const normalized = (sliderValue - 50) / 50 // 0 to 1
      return Math.round(100 + normalized * 4900) // 100 to 5000
    }
  }

  const mapTradeAmountValueToSlider = (value: number): number => {
    if (value <= 100) {
      // First half: 0-100 value = 0-50 slider
      const normalized = value / 100 // 0 to 1
      return Math.round(normalized * 50) // 0 to 50
    } else {
      // Second half: 100-5000 value = 50-100 slider
      const normalized = (value - 100) / 4900 // 0 to 1
      return Math.round(50 + normalized * 50) // 50 to 100
    }
  }

  // Maps slider position (0-100) to token age in minutes (0 to 10080 = 7 days)
  // Non-linear scale: more granular for minutes/hours, less granular for days
  const mapTokenAgeSliderToValue = (sliderValue: number): number => {
    if (sliderValue <= 33) {
      // First third: 0-33 slider = 0-60 minutes (about 1.8 minutes per unit)
      const normalized = sliderValue / 33 // 0 to 1
      return Math.round(normalized * 60) // 0 to 60 minutes
    } else if (sliderValue <= 66) {
      // Second third: 33-66 slider = 1-12 hours (non-linear, more granular at lower hours)
      const normalized = (sliderValue - 33) / 33 // 0 to 1
      // Use exponential curve for better granularity at lower hours
      const hours = 1 + normalized * 11 // 1 to 12 hours
      return Math.round(hours * 60) // Convert to minutes
    } else {
      // Final third: 66-100 slider = 12 hours - 7 days (non-linear, more granular at lower days)
      const normalized = (sliderValue - 66) / 34 // 0 to 1
      // Use exponential curve for better granularity at lower days
      const days = 0.5 + normalized * 6.5 // 0.5 to 7 days (12 hours to 7 days)
      return Math.round(days * 24 * 60) // Convert to minutes
    }
  }

  const mapTokenAgeValueToSlider = (value: number): number => {
    if (value <= 60) {
      // First third: 0-60 minutes = 0-33 slider
      const normalized = value / 60 // 0 to 1
      return Math.round(normalized * 33) // 0 to 33
    } else if (value <= 12 * 60) {
      // Second third: 1-12 hours = 33-66 slider
      const hours = value / 60 // Convert to hours
      const normalized = (hours - 1) / 11 // 0 to 1
      return Math.round(33 + normalized * 33) // 33 to 66
    } else {
      // Final third: 12 hours - 7 days = 66-100 slider
      const days = value / (24 * 60) // Convert to days
      const normalized = (days - 0.5) / 6.5 // 0 to 1
      return Math.round(66 + normalized * 34) // 66 to 100
    }
  }

  // Format token age for display
  const formatTokenAge = (minutes: number): string => {
    if (minutes < 60) {
      return `${minutes}m`
    } else if (minutes < 24 * 60) {
      const hours = Math.round(minutes / 60)
      return `${hours}h`
    } else {
      const days = Math.round(minutes / (24 * 60))
      return `${days}d`
    }
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Header />

      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-[120px]" data-onboarding="time-range">
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

            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-[150px]" data-onboarding="sort-by">
                <SelectValue placeholder="Sort By" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="marketCap">Market Cap</SelectItem>
                <SelectItem value="totalVolume">Total Volume</SelectItem>
                <SelectItem value="buyVolume">Buy Volume</SelectItem>
                <SelectItem value="sellVolume">Sell Volume</SelectItem>
                <SelectItem value="uniqueTraders">Unique Traders</SelectItem>
                <SelectItem value="tokenAge">Token Age</SelectItem>
                <SelectItem value="lastTrade">Last Trade</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={settings.graduationFilter}
              onValueChange={(value) => updateSettings("graduationFilter", value as "all" | "bonding" | "graduated")}
            >
              <SelectTrigger className="w-[140px]" data-onboarding="graduation-filter">
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

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" data-onboarding="settings-button">
                  <Settings className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent className="overflow-y-auto max-h-screen pb-20">
                <SheetHeader>
                  <SheetTitle>Settings</SheetTitle>
                  <SheetDescription>Customize your Pump.Investments experience</SheetDescription>
                  <p className="text-xs text-muted-foreground mt-1 mb-4">
                    Scroll down to see all settings including alert management
                  </p>
                </SheetHeader>

                <div className="py-4 space-y-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Tokens Per Page: {settings.tokensPerPage}</Label>
                    </div>
                    <Slider
                      value={[settings.tokensPerPage]}
                      min={4}
                      max={48}
                      step={4}
                      onValueChange={(value) => updateSettings("tokensPerPage", value[0])}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Filters</Label>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <NextImage
                            src="/koth.png"
                            alt="King of the Hill"
                            width={40}
                            height={40}
                            className="object-contain"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement
                              target.style.display = "none"
                            }}
                          />
                          <Label htmlFor="hide-koth">Hide KOTH</Label>
                        </div>
                        <Switch
                          id="hide-koth"
                          checked={settings.hideKOTH}
                          onCheckedChange={(checked) => updateSettings("hideKOTH", checked)}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <NextImage
                            src="/not-from-pump.png"
                            alt="Not from pump.fun"
                            width={16}
                            height={16}
                            className="object-contain"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement
                              target.style.display = "none"
                            }}
                          />
                          <Label htmlFor="hide-external">Hide External</Label>
                        </div>
                        <Switch
                          id="hide-external"
                          checked={settings.hideExternal}
                          onCheckedChange={(checked) => updateSettings("hideExternal", checked)}
                        />
                      </div>
                    </div>
                  </div>

                  {/* BonkBot Logo Setting */}
                  <div className="space-y-2">
                    <Label>Integrations</Label>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <NextImage
                            src="/bonkbot.png"
                            alt="BonkBot"
                            width={24}
                            height={24}
                            className="object-contain"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement
                              target.style.display = "none"
                            }}
                          />
                          <Label htmlFor="show-bonkbot-logo">Show BonkBot Logo</Label>
                        </div>
                        <Switch
                          id="show-bonkbot-logo"
                          checked={settings.showBonkBotLogo}
                          onCheckedChange={(checked) => updateSettings("showBonkBotLogo", checked)}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Display BonkBot logo on token cards for quick trading access
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 mt-6 border-t pt-4">
                  <Label className="text-base font-semibold">Market Cap Range</Label>

                  <RangeSlider
                    min={0}
                    max={100}
                    step={1}
                    value={[
                      mapMarketCapValueToSlider(settings.minMarketCapFilter),
                      mapMarketCapValueToSlider(settings.maxMarketCapFilter),
                    ]}
                    onValueChange={(sliderValues) => {
                      const minValue = mapMarketCapSliderToValue(sliderValues[0])
                      const maxValue = mapMarketCapSliderToValue(sliderValues[1])
                      updateSettingsBatch({
                        minMarketCapFilter: minValue,
                        maxMarketCapFilter: maxValue,
                      })
                    }}
                    formatValue={(sliderValue) => {
                      const value = mapMarketCapSliderToValue(sliderValue)
                      if (value >= 1000000) return "$1M+"
                      if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
                      return `$${value}`
                    }}
                    className="my-4"
                  />

                  <p className="text-xs text-muted-foreground pt-2 border-t">
                    {settings.maxMarketCapFilter >= 1000000
                      ? `Showing tokens with $${(settings.minMarketCapFilter / 1000).toFixed(0)}K+ market cap`
                      : `Showing tokens with $${(settings.minMarketCapFilter / 1000).toFixed(0)}K–$${(settings.maxMarketCapFilter / 1000).toFixed(0)}K market cap`}
                  </p>
                </div>

                <div className="space-y-4 mt-6 border-t pt-4">
                  <Label className="text-base font-semibold">Unique Traders Range</Label>

                  <RangeSlider
                    min={1}
                    max={500}
                    value={[settings.minUniqueTraderCountFilter, settings.maxUniqueTraderCountFilter]}
                    onValueChange={(value) => {
                      updateSettingsBatch({
                        minUniqueTraderCountFilter: value[0],
                        maxUniqueTraderCountFilter: value[1],
                      })
                    }}
                    formatValue={(value) => (value === 500 ? "500+" : value.toString())}
                    className="my-4"
                  />

                  <p className="text-xs text-muted-foreground pt-2 border-t">
                    {settings.maxUniqueTraderCountFilter === 500
                      ? `Showing tokens with ${settings.minUniqueTraderCountFilter}+ unique traders`
                      : `Showing tokens with ${settings.minUniqueTraderCountFilter}–${settings.maxUniqueTraderCountFilter} unique traders`}
                  </p>
                </div>

                <div className="space-y-4 mt-6 border-t pt-4">
                  <Label className="text-base font-semibold">Trade Amount Range</Label>

                  <RangeSlider
                    min={0}
                    max={100}
                    step={1}
                    value={[
                      mapTradeAmountValueToSlider(settings.minTradeAmountFilter),
                      mapTradeAmountValueToSlider(settings.maxTradeAmountFilter),
                    ]}
                    onValueChange={(sliderValues) => {
                      const minValue = mapTradeAmountSliderToValue(sliderValues[0])
                      const maxValue = mapTradeAmountSliderToValue(sliderValues[1])
                      updateSettingsBatch({
                        minTradeAmountFilter: minValue,
                        maxTradeAmountFilter: maxValue,
                      })
                    }}
                    formatValue={(sliderValue) => {
                      const value = mapTradeAmountSliderToValue(sliderValue)
                      if (value >= 5000) return "$5000+"
                      return `$${value}`
                    }}
                    className="my-4"
                  />

                  <p className="text-xs text-muted-foreground pt-2 border-t">
                    {settings.maxTradeAmountFilter >= 5000
                      ? `Only counting traders with individual trades above $${settings.minTradeAmountFilter}`
                      : `Only counting traders with individual trades between $${settings.minTradeAmountFilter}–$${settings.maxTradeAmountFilter}`}
                  </p>
                </div>

                <div className="space-y-4 mt-6 border-t pt-4">
                  <Label className="text-base font-semibold">Token Age Range</Label>

                  <RangeSlider
                    min={0}
                    max={100}
                    step={1}
                    value={[
                      mapTokenAgeValueToSlider(settings.minTokenAgeMinutes),
                      mapTokenAgeValueToSlider(settings.maxTokenAgeMinutes),
                    ]}
                    onValueChange={(sliderValues) => {
                      const minValue = mapTokenAgeSliderToValue(sliderValues[0])
                      const maxValue = mapTokenAgeSliderToValue(sliderValues[1])
                      updateSettingsBatch({
                        minTokenAgeMinutes: minValue,
                        maxTokenAgeMinutes: maxValue,
                      })
                    }}
                    formatValue={(sliderValue) => {
                      const value = mapTokenAgeSliderToValue(sliderValue)
                      return formatTokenAge(value)
                    }}
                    className="my-4"
                  />

                  <p className="text-xs text-muted-foreground pt-2 border-t">
                    {settings.maxTokenAgeMinutes >= 10080
                      ? `Showing tokens with age ${formatTokenAge(settings.minTokenAgeMinutes)}+`
                      : `Showing tokens with age between ${formatTokenAge(settings.minTokenAgeMinutes)}–${formatTokenAge(settings.maxTokenAgeMinutes)}`}
                  </p>
                </div>

                {/* Alert Management */}
                <div className="mt-8 border-t pt-4">
                  <h3 className="text-sm font-medium mb-4">Alert Management</h3>
                  {/* Placeholder for AlertManagement component */}
                </div>

                {/* Onboarding Guide Restart Button - MOVED HERE */}
                <div className="mt-8 border-t pt-4">
                  <h3 className="text-sm font-medium mb-2">Help & Guidance</h3>
                  <Button
                    onClick={restartOnboarding}
                    variant="outline"
                    className="w-full flex items-center justify-center gap-2 bg-transparent"
                  >
                    <HelpCircle className="h-4 w-4" />
                    Restart Onboarding Guide
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2">Take the tour again to learn about all features</p>
                </div>

                {/* Reset All Settings */}
                <div className="mt-8 border-t pt-4">
                  <h3 className="text-sm font-medium mb-2">Reset Settings</h3>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" className="w-full">
                        Reset All Settings
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This action cannot be undone. This will permanently delete:
                          <ul className="list-disc list-inside mt-2 space-y-1">
                            <li>All favorites</li>
                            <li>All alerts</li>
                            <li>All filter settings</li>
                          </ul>
                          <p className="mt-2 font-semibold">Alert history will be preserved.</p>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={async () => {
                            await db.resetAllSettings()
                            // Clear local storage settings
                            localStorage.removeItem("pump-investments-settings")
                            localStorage.removeItem("pump-investments-time-range")
                            localStorage.removeItem("pump-investments-sort-by")
                            // Reload the page to apply defaults
                            window.location.reload()
                          }}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Reset Everything
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <p className="text-xs text-muted-foreground mt-2">
                    This will reset all settings, delete all alerts, and remove all favorites. Alert history will be
                    preserved.
                  </p>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
                    <PaginationLink isActive={currentPage === pageNum} onClick={() => setCurrentPage(pageNum)}>
                      {pageNum}
                    </PaginationLink>
                  </PaginationItem>
                )
              })}

              <PaginationItem>
                <PaginationNext
                  onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                  className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </div>

      {/* Onboarding Guide */}
      {isOnboardingActive && <OnboardingGuide />}

      {/* Add Toaster for notifications */}
      <Toaster />
      {/* PI Bot Chat Bubble */}
      <ChatBubble />

      {/* Add the Alert Settings Modal */}
      <AlertSettingsModal />
    </div>
  )
}
