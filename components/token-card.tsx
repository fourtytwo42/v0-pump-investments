"use client"

import React, { useEffect, useState, useRef, useCallback, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import NextImage from "next/image"
import { formatDistanceToNow } from "date-fns"
import { Globe, Twitter, MessageCircle, Star, Bell, ChevronDown, ChevronUp } from "lucide-react"
import Link from "next/link"
import { useAlertModalStore } from "@/stores/alert-modal-store"
import { db } from "@/lib/db"
import { alertStatusCache } from "@/lib/alert-status-cache"
import type { TokenData } from "@/types/token-data"
import { tokenImagePath } from "@/lib/token-image"
import { useTokenStore } from "@/stores/token-store"
import { formatCompactTimeAgo } from "@/lib/format-relative-time"
import { deriveVerifiedBondingProgress } from "@/lib/bonding-display-progress"

// Update the TokenCardProps interface to include the description field and BonkBot setting
interface TokenCardProps {
  mint: string
  size?: string
  showAlertSettings?: boolean
  showBonkBotLogo?: boolean // New prop for BonkBot logo
}

const FALLBACK_IMAGE = "/digital-token.png"

// Create a separate component for the bell icon to isolate its rendering
const AlertBellIcon = React.memo(
  ({ mint, isEnabled }: { mint: string; isEnabled: boolean }) => {
    return isEnabled ? <Bell className="h-5 w-5 fill-yellow-400 text-yellow-400" /> : <Bell className="h-5 w-5" />
  },
  (prevProps, nextProps) => {
    // Only re-render if the enabled status changes
    return prevProps.isEnabled === nextProps.isEnabled
  },
)

AlertBellIcon.displayName = "AlertBellIcon"

// Create a separate component for the star icon to isolate its rendering
const FavoriteStarIcon = React.memo(
  ({ isFavorite }: { isFavorite: boolean }) => {
    return isFavorite ? <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" /> : <Star className="h-5 w-5" />
  },
  (prevProps, nextProps) => {
    // Only re-render if the favorite status changes
    return prevProps.isFavorite === nextProps.isFavorite
  },
)

FavoriteStarIcon.displayName = "FavoriteStarIcon"

function TokenCard({ mint, size = "medium", showAlertSettings = false, showBonkBotLogo = false }: TokenCardProps) {
  const token = useTokenStore((state) => state.tokensByMint.get(mint)) as TokenData
  const isFavorite = useTokenStore((state) => state.favoriteMints.has(mint))
  const toggleFavorite = useTokenStore((state) => state.toggleFavorite)
  const solPrice = useTokenStore((state) => state.solPrice)
  const lifecycleStatus = token.lifecycle_status ?? "unknown"
  const progressPercent = deriveVerifiedBondingProgress(token.bonding_progress)
  const showBondingProgress =
    lifecycleStatus === "bonding" &&
    Number.isFinite(progressPercent) &&
    progressPercent >= 0 &&
    token.is_bonding_curve === true

  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  // Use state for alert status, but initialize it from cache if available
  const [hasActiveAlert, setHasActiveAlert] = useState(() => {
    return alertStatusCache.has(token.mint) ? (alertStatusCache.get(token.mint) ?? false) : false
  })

  const alertStatusCheckedRef = useRef(false)

  // Check alert status once on mount or when dependencies change
  useEffect(() => {
    if (!isFavorite || !showAlertSettings) {
      setHasActiveAlert(false)
      alertStatusCheckedRef.current = false
      return
    }

    if (!alertStatusCheckedRef.current) {
      const checkAlertStatus = async () => {
        try {
          const isEnabled = await db.isAlertEnabled(token.mint)
          setHasActiveAlert(isEnabled)
          alertStatusCheckedRef.current = true
        } catch (error) {
          console.error("Error checking alert status:", error)
        }
      }

      checkAlertStatus()
    }
  }, [token.mint, isFavorite, showAlertSettings])

  // Format USD values - memoize this function
  const formatUSD = useMemo(() => {
    return (num: number) => {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(num)
    }
  }, [])

  // Fixed card height
  const cardHeight = "h-[342px]"

  // Fixed image size
  const imageSize = 80

  // Calculate color based on buy/sell ratio - memoize this calculation
  const borderColor = useMemo(() => {
    const ratio = token.buy_sell_ratio
    if (ratio > 0.7) return "border-green-500" // High buy volume
    if (ratio > 0.55) return "border-green-300" // Moderate buy volume
    if (ratio < 0.3) return "border-red-500" // High sell volume
    if (ratio < 0.45) return "border-red-300" // Moderate sell volume
    return "border-gray-200 dark:border-gray-800" // Balanced
  }, [token.buy_sell_ratio])

  const backgroundColor = useMemo(() => {
    const ratio = token.buy_sell_ratio
    if (ratio > 0.7) return "bg-green-50 dark:bg-green-950/20" // High buy volume
    if (ratio > 0.55) return "bg-green-50/50 dark:bg-green-950/10" // Moderate buy volume
    if (ratio < 0.3) return "bg-red-50 dark:bg-red-950/20" // High sell volume
    if (ratio < 0.45) return "bg-red-50/50 dark:bg-red-950/10" // Moderate sell volume
    return "" // Balanced - use default background
  }, [token.buy_sell_ratio])

  // Memoize time calculations
  const timeInfo = useMemo(() => {
    const timeAgo = formatCompactTimeAgo(token.last_trade_time)

    // Calculate token age if created_timestamp is available
    const tokenAge = token.created_timestamp
      ? formatDistanceToNow(new Date(token.created_timestamp), { addSuffix: false })
      : "Unknown"

    return { timeAgo, tokenAge }
  }, [token.last_trade_time, token.created_timestamp])

  // Memoize USD volume calculations
  const volumeInfo = useMemo(() => {
    const totalVolumeUSD = token.total_volume * solPrice
    const buyVolumeUSD = token.buy_volume * solPrice
    const sellVolumeUSD = token.sell_volume * solPrice
    return { totalVolumeUSD, buyVolumeUSD, sellVolumeUSD }
  }, [token.total_volume, token.buy_volume, token.sell_volume, solPrice])

  // Generate pump.fun URL - memoize
  const pumpFunUrl = useMemo(() => {
    return `https://pump.fun/coin/${token.mint}?include-nsfw=true`
  }, [token.mint])

  // Generate BonkBot URL - memoize
  const bonkBotUrl = useMemo(() => {
    return `https://app.bonkbot.io/trading/${token.mint}`
  }, [token.mint])

  // Check if token is from pump.fun - memoize
  const isFromPumpFun = useMemo(() => {
    return token.launch_source !== "external" && lifecycleStatus !== "non_launchpad"
  }, [token.launch_source, lifecycleStatus])

  // Handle click on the card
  const handleCardClick = useCallback(() => {
    // Open pump.fun URL in a new tab
    window.open(pumpFunUrl, "_blank", "noopener,noreferrer")
  }, [pumpFunUrl])

  // Handle click on social links to prevent propagation to the card
  const handleSocialLinkClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  // Handle click on the favorite star
  const handleFavoriteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation() // Prevent card click
      e.preventDefault() // Prevent any default behavior
      toggleFavorite(token.mint)
    },
    [toggleFavorite, token.mint],
  )

  // Handle click on the alert settings bell
  const handleAlertSettingsClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation() // Prevent card click
      e.preventDefault() // Prevent any default behavior

      useAlertModalStore.getState().open({
        mint: token.mint,
        name: token.name,
        symbol: token.symbol,
        usd_market_cap: token.usd_market_cap,
      })
    },
    [token.mint, token.name, token.symbol, token.usd_market_cap],
  )

  // Handle click on the BonkBot logo
  const handleBonkBotClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation() // Prevent card click
      e.preventDefault() // Prevent any default behavior
      window.open(bonkBotUrl, "_blank", "noopener,noreferrer")
    },
    [bonkBotUrl],
  )

  // Handle click on the drawer handle
  const handleDrawerToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation() // Prevent card click
    e.preventDefault() // Prevent any default behavior
    setIsDrawerOpen((prev) => !prev)
  }, [])

  // Memoize the star button to prevent re-renders
  const starButton = useMemo(() => {
    return (
      <button
        className="absolute top-1 right-1 z-20 cursor-pointer hover:scale-110 transition-transform"
        onClick={handleFavoriteClick}
        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      >
        <FavoriteStarIcon isFavorite={isFavorite} />
      </button>
    )
  }, [isFavorite, handleFavoriteClick])

  // Memoize the bell icon to prevent re-renders
  const bellIcon = useMemo(() => {
    if (!isFavorite || !showAlertSettings) return null

    return (
      <button
        className="absolute top-11 right-2 p-2.5 bg-background/80 rounded-full hover:bg-background z-20 shadow-sm transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer"
        onClick={handleAlertSettingsClick}
        aria-label="Alert settings"
        style={{ minWidth: "40px", minHeight: "40px" }} // Ensure minimum clickable area
      >
        <AlertBellIcon mint={token.mint} isEnabled={hasActiveAlert} />
      </button>
    )
  }, [isFavorite, showAlertSettings, handleAlertSettingsClick, token.mint, hasActiveAlert])

  // Memoize the BonkBot logo to prevent re-renders
  const bonkBotLogo = useMemo(() => {
    if (!showBonkBotLogo) return null

    return (
      <button
        className="absolute top-1 left-1 z-20 cursor-pointer hover:scale-110 transition-transform"
        onClick={handleBonkBotClick}
        aria-label="Trade on BonkBot"
        title="Trade on BonkBot"
      >
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
      </button>
    )
  }, [showBonkBotLogo, handleBonkBotClick])

  // Memoize social links to prevent re-renders
  const socialLinks = useMemo(() => {
    return (
      <div className="mt-1 flex gap-0.5" data-token-social-links>
        {token.website && (
          <Link
            href={token.website.startsWith("http") ? token.website : `https://${token.website}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleSocialLinkClick}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-muted hover:text-primary"
            aria-label="Open token website"
            title="Website"
          >
            <Globe className="h-3.5 w-3.5" />
          </Link>
        )}
        {token.twitter && (
          <Link
            href={token.twitter.startsWith("http") ? token.twitter : `https://twitter.com/${token.twitter}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleSocialLinkClick}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-muted hover:text-primary"
            aria-label="Open token profile on X"
            title="X"
          >
            <Twitter className="h-3.5 w-3.5" />
          </Link>
        )}
        {token.telegram && (
          <Link
            href={token.telegram.startsWith("http") ? token.telegram : `https://t.me/${token.telegram}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleSocialLinkClick}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-foreground/70 transition-colors hover:bg-muted hover:text-primary"
            aria-label="Open token Telegram"
            title="Telegram"
          >
            <MessageCircle className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    )
  }, [token.website, token.twitter, token.telegram, handleSocialLinkClick])

  // Memoize status icons to prevent re-renders
  const statusIcons = useMemo(() => {
    return (
      <div className="flex items-center gap-2 h-10">
        {!isFromPumpFun && (
          <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
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
          </div>
        )}
      </div>
    )
  }, [isFromPumpFun])

  // Check if token has a description
  const hasDescription = token.description && token.description.trim() !== ""

  const proxiedImageSrc = useMemo(
    () => tokenImagePath(token.mint),
    [token.mint],
  )
  const hasImageSource = Boolean(token.image_uri || token.metadata_uri)
  const [imageSrc, setImageSrc] = useState(() => (hasImageSource ? proxiedImageSrc : FALLBACK_IMAGE))

  useEffect(() => {
    setImageSrc(hasImageSource ? proxiedImageSrc : FALLBACK_IMAGE)
  }, [hasImageSource, proxiedImageSrc, token.image_uri, token.metadata_uri])

  const handleImageError = useCallback(() => {
    setImageSrc(FALLBACK_IMAGE)
  }, [])

  return (
    <div className="relative">
      <Card
        className={`${cardHeight} relative cursor-pointer overflow-hidden border-2 transition-[transform,box-shadow] duration-150 ease-out motion-safe:hover:-translate-y-0.5 hover:shadow-lg ${borderColor} ${backgroundColor}`}
        onClick={handleCardClick}
        data-token-card
        data-token-mint={token.mint}
        data-token-market-cap={token.usd_market_cap}
      >
        <CardContent className="absolute inset-x-0 bottom-px top-0 flex flex-col p-0">
          {/* BonkBot logo in top-left corner */}
          {bonkBotLogo}

          {/* Favorite star button in top-right corner */}
          {starButton}

          {/* Alert settings bell icon - only show for favorited tokens when in favorites view */}
          {bellIcon}

          {/* Top section with image and basic info - fixed height */}
          <div className="p-3 pb-2 flex items-center gap-3 h-[100px]">
            <div
              className="relative flex h-[80px] w-[80px] flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40 ring-1 ring-inset ring-border/50"
              data-token-image-surface
            >
              <NextImage
                src={imageSrc}
                alt={token.name}
                width={imageSize}
                height={imageSize}
                className="rounded-md object-contain max-h-full max-w-full"
                onError={handleImageError}
              />
            </div>
            <div className="flex-1 min-w-0 overflow-hidden">
              <div className="flex items-center mb-0.5">
                <h3 className="font-bold truncate">{token.name}</h3>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <p className="min-w-0 truncate text-xs text-foreground/70">
                  by {token.creator_username || token.creator.slice(0, 6)}
                </p>
                <Badge variant="outline" className="max-w-[88px] shrink-0 truncate px-2 py-0 text-xs">
                  {token.symbol}
                </Badge>
              </div>

              {/* Social links */}
              {socialLinks}
            </div>
          </div>

          {/* Thin divider with drawer handle - only show if token has a description */}
          {hasDescription && (
            <div className="relative">
              <div className="border-t border-gray-200 dark:border-gray-700"></div>
              <button
                onClick={handleDrawerToggle}
                className="absolute left-1/2 top-0 transform -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-full p-1 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors z-20"
                aria-label={isDrawerOpen ? "Close description" : "Open description"}
              >
                {isDrawerOpen ? (
                  <ChevronUp className="h-3 w-3 text-gray-500" />
                ) : (
                  <ChevronDown className="h-3 w-3 text-gray-500" />
                )}
              </button>
            </div>
          )}

          {/* Middle section - financial data */}
          <div className="p-3 flex-1 overflow-visible relative">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div>
                <p className="text-xs text-foreground/70">Market Cap</p>
                <p className="font-medium tabular-nums">{formatUSD(token.usd_market_cap)}</p>
              </div>
              <div>
                <p className="text-xs text-foreground/70">Volume (USD)</p>
                <p className="font-medium tabular-nums">{formatUSD(volumeInfo.totalVolumeUSD)}</p>
              </div>
              <div>
                <p className="text-xs text-foreground/70">Buy Vol</p>
                <p className="font-medium tabular-nums text-green-500">{formatUSD(volumeInfo.buyVolumeUSD)}</p>
              </div>
              <div>
                <p className="text-xs text-foreground/70">Sell Vol</p>
                <p className="font-medium tabular-nums text-red-500">{formatUSD(volumeInfo.sellVolumeUSD)}</p>
              </div>
              <div>
                <p className="text-xs text-foreground/70">Unique Buyers</p>
                <p className="font-medium tabular-nums">{token.unique_trader_count}</p>
              </div>
              <div>
                <p className="text-xs text-foreground/70">Last Trade</p>
                <p className="whitespace-nowrap text-xs font-medium tabular-nums" data-token-last-trade>
                  {timeInfo.timeAgo}
                </p>
              </div>
            </div>

            {/* Description drawer overlay - positioned absolutely over the financial data */}
            {hasDescription && isDrawerOpen && (
              <div className="absolute inset-0 bg-white dark:bg-gray-900 p-3 overflow-y-auto scrollbar-hidden z-10 border border-gray-200 dark:border-gray-700 rounded-md shadow-sm">
                <div className="flex justify-between items-center mb-2">
                  <h4 className="font-medium text-sm text-primary">Description</h4>
                  <button
                    onClick={handleDrawerToggle}
                    className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
                    aria-label="Close description"
                  >
                    <ChevronUp className="h-4 w-4 text-gray-500" />
                  </button>
                </div>
                <p className="text-sm">{token.description}</p>
              </div>
            )}
          </div>

          {/* Bottom section with age info - now with fixed height */}
          <div
            className="mt-auto space-y-2 border-t border-gray-100 bg-gray-50 p-3 pb-[15px] pt-2 dark:border-gray-800 dark:bg-gray-900/30"
            data-token-footer
          >
            {showBondingProgress && (
              <div
                className="relative h-4 w-full overflow-hidden rounded-full bg-muted"
                data-token-bonding-progress
                data-token-progress={progressPercent}
              >
                <div
                  className="h-full bg-sky-500"
                  style={{ width: `${progressPercent}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="rounded bg-gray-950/75 px-1.5 py-0.5 text-[11px] font-bold leading-none tabular-nums text-white shadow-sm">
                    {Math.round(progressPercent)}%
                  </span>
                </span>
              </div>
            )}

            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs text-foreground/70">Token Age</p>
                <p className="font-medium tabular-nums">{timeInfo.tokenAge}</p>
              </div>
              {statusIcons}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Use a more aggressive memoization strategy
export default React.memo(TokenCard, (prevProps, nextProps) => {
  return (
    prevProps.mint === nextProps.mint &&
    prevProps.size === nextProps.size &&
    prevProps.showAlertSettings === nextProps.showAlertSettings &&
    prevProps.showBonkBotLogo === nextProps.showBonkBotLogo
  )
})
