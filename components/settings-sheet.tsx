"use client"

import Image from "next/image"
import { HelpCircle } from "lucide-react"

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
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RangeSlider } from "@/components/ui/range-slider"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import type { DashboardSettings } from "@/hooks/use-settings"
import { db } from "@/lib/db"

interface SettingsSheetProps {
  open: boolean
  settings: DashboardSettings
  onOpenChange: (open: boolean) => void
  updateSettings: (key: keyof DashboardSettings, value: unknown) => void
  updateSettingsBatch: (updates: Partial<DashboardSettings>) => void
  restartOnboarding: () => Promise<void>
}

function mapMarketCapSliderToValue(sliderValue: number): number {
  if (sliderValue <= 50) return Math.round(3000 + (sliderValue / 50) * 47000)
  return Math.round(50000 + ((sliderValue - 50) / 50) * 950000)
}

function mapMarketCapValueToSlider(value: number): number {
  if (value <= 50000) return Math.round(((value - 3000) / 47000) * 50)
  return Math.round(50 + ((value - 50000) / 950000) * 50)
}

function mapTradeAmountSliderToValue(sliderValue: number): number {
  if (sliderValue <= 50) return Math.round((sliderValue / 50) * 100)
  return Math.round(100 + ((sliderValue - 50) / 50) * 4900)
}

function mapTradeAmountValueToSlider(value: number): number {
  if (value <= 100) return Math.round((value / 100) * 50)
  return Math.round(50 + ((value - 100) / 4900) * 50)
}

function mapTokenAgeSliderToValue(sliderValue: number): number {
  if (sliderValue <= 33) return Math.round((sliderValue / 33) * 60)
  if (sliderValue <= 66) return Math.round((1 + ((sliderValue - 33) / 33) * 11) * 60)
  return Math.round((0.5 + ((sliderValue - 66) / 34) * 6.5) * 24 * 60)
}

function mapTokenAgeValueToSlider(value: number): number {
  if (value <= 60) return Math.round((value / 60) * 33)
  if (value <= 12 * 60) return Math.round(33 + ((value / 60 - 1) / 11) * 33)
  return Math.round(66 + ((value / (24 * 60) - 0.5) / 6.5) * 34)
}

function formatTokenAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / (24 * 60))}d`
}

export function SettingsSheet({
  open,
  settings,
  onOpenChange,
  updateSettings,
  updateSettingsBatch,
  restartOnboarding,
}: SettingsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
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
              onValueCommit={(value) => updateSettings("tokensPerPage", value[0])}
              thumbLabel="Tokens per page"
            />
          </div>

          <div className="space-y-2">
            <Label>Filters</Label>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Image src="/not-from-pump.png" alt="Not from pump.fun" width={16} height={16} className="object-contain" />
                <Label htmlFor="hide-external">Hide External</Label>
              </div>
              <Switch
                id="hide-external"
                checked={settings.hideExternal}
                onCheckedChange={(checked) => updateSettings("hideExternal", checked)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Integrations</Label>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Image src="/bonkbot.png" alt="BonkBot" width={24} height={24} className="object-contain" />
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
            onValueCommit={(values) =>
              updateSettingsBatch({
                minMarketCapFilter: mapMarketCapSliderToValue(values[0]),
                maxMarketCapFilter: mapMarketCapSliderToValue(values[1]),
              })
            }
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
          <Label className="text-base font-semibold">Unique Buyers Range</Label>
          <RangeSlider
            min={1}
            max={500}
            value={[settings.minUniqueTraderCountFilter, settings.maxUniqueTraderCountFilter]}
            onValueCommit={(value) =>
              updateSettingsBatch({
                minUniqueTraderCountFilter: value[0],
                maxUniqueTraderCountFilter: value[1],
              })
            }
            formatValue={(value) => (value === 500 ? "500+" : value.toString())}
            className="my-4"
          />
          <p className="text-xs text-muted-foreground pt-2 border-t">
            {settings.maxUniqueTraderCountFilter === 500
              ? `Showing tokens with ${settings.minUniqueTraderCountFilter}+ unique buyers`
              : `Showing tokens with ${settings.minUniqueTraderCountFilter}–${settings.maxUniqueTraderCountFilter} unique buyers`}
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
            onValueCommit={(values) =>
              updateSettingsBatch({
                minTradeAmountFilter: mapTradeAmountSliderToValue(values[0]),
                maxTradeAmountFilter: mapTradeAmountSliderToValue(values[1]),
              })
            }
            formatValue={(sliderValue) => {
              const value = mapTradeAmountSliderToValue(sliderValue)
              return value >= 5000 ? "$5000+" : `$${value}`
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
            onValueCommit={(values) =>
              updateSettingsBatch({
                minTokenAgeMinutes: mapTokenAgeSliderToValue(values[0]),
                maxTokenAgeMinutes: mapTokenAgeSliderToValue(values[1]),
              })
            }
            formatValue={(value) => formatTokenAge(mapTokenAgeSliderToValue(value))}
            className="my-4"
          />
          <p className="text-xs text-muted-foreground pt-2 border-t">
            {settings.maxTokenAgeMinutes >= 10080
              ? `Showing tokens with age ${formatTokenAge(settings.minTokenAgeMinutes)}+`
              : `Showing tokens with age between ${formatTokenAge(settings.minTokenAgeMinutes)}–${formatTokenAge(settings.maxTokenAgeMinutes)}`}
          </p>
        </div>

        <div className="mt-8 border-t pt-4">
          <h3 className="text-sm font-medium mb-4">Alert Management</h3>
        </div>

        <div className="mt-8 border-t pt-4">
          <h3 className="text-sm font-medium mb-2">Help & Guidance</h3>
          <Button
            onClick={() => void restartOnboarding()}
            variant="outline"
            className="w-full flex items-center justify-center gap-2 bg-transparent"
          >
            <HelpCircle className="h-4 w-4" />
            Restart Onboarding Guide
          </Button>
          <p className="text-xs text-muted-foreground mt-2">Take the tour again to learn about all features</p>
        </div>

        <div className="mt-8 border-t pt-4">
          <h3 className="text-sm font-medium mb-2">Reset Settings</h3>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="w-full">Reset All Settings</Button>
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
                    localStorage.removeItem("pump-investments-settings")
                    localStorage.removeItem("pump-investments-time-range")
                    localStorage.removeItem("pump-investments-sort-by")
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
            This will reset all settings, delete all alerts, and remove all favorites. Alert history will be preserved.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
