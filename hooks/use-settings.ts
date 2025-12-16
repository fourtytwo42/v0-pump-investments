"use client"

import { useCallback } from "react"
import { useLocalStorage } from "@/hooks/use-local-storage"
import { toast } from "@/components/ui/use-toast"
import { db } from "@/lib/db"

export interface DashboardSettings {
  tokensPerPage: number
  hideKOTH: boolean
  hideExternal: boolean
  minMarketCap: number
  maxMarketCap: number
  minTotalVolume: number
  maxTotalVolume: number
  minBuyVolume: number
  maxBuyVolume: number
  minSellVolume: number
  maxSellVolume: number
  minUniqueTraders: number
  maxUniqueTraders: number
  minMarketCapFilter: number
  maxMarketCapFilter: number
  minUniqueTraderCountFilter: number
  maxUniqueTraderCountFilter: number
  minTradeAmountFilter: number
  maxTradeAmountFilter: number
  tradeRetentionMinutes: number // Keeping this in settings but removing UI, fixed at 60 minutes
  showBonkBotLogo: boolean
  graduationFilter: "all" | "bonding" | "graduated"
  minTokenAgeMinutes: number
  maxTokenAgeMinutes: number
}

export function useSettings(setOnboardingActive: (active: boolean) => void) {
  // Settings with localStorage persistence
  const [settings, setSettings] = useLocalStorage<DashboardSettings>("pump-investments-settings", {
    tokensPerPage: 12,
    hideKOTH: false,
    hideExternal: false,
    minMarketCap: 0,
    maxMarketCap: 100000000,
    minTotalVolume: 0,
    maxTotalVolume: 50000000,
    minBuyVolume: 0,
    maxBuyVolume: 50000000,
    minSellVolume: 0,
    maxSellVolume: 50000000,
    minUniqueTraders: 0,
    maxUniqueTraders: 10000,
    minMarketCapFilter: 3000,
    maxMarketCapFilter: 1000000,
    minUniqueTraderCountFilter: 1,
    maxUniqueTraderCountFilter: 500,
    minTradeAmountFilter: 0,
    maxTradeAmountFilter: 5000,
    tradeRetentionMinutes: 60, // Fixed at 1 hour (60 minutes)
    showBonkBotLogo: false,
    graduationFilter: "all",
    minTokenAgeMinutes: 0,
    maxTokenAgeMinutes: 10080, // 7 days in minutes
  })

  // Function to update settings
  const updateSettings = useCallback(
    (key: keyof DashboardSettings, value: any) => {
      setSettings((prev) => ({ ...prev, [key]: value }))
    },
    [setSettings],
  )

  // Function to update multiple settings at once
  const updateSettingsBatch = useCallback(
    (updates: Partial<DashboardSettings>) => {
      setSettings((prev) => ({ ...prev, ...updates }))
    },
    [setSettings],
  )

  // Function to restart the onboarding guide
  const restartOnboarding = useCallback(async () => {
    // Reset the onboarding completed flag in the database
    await db.setPreference("onboardingCompleted", false)

    // Set the onboarding active state to true to show the guide
    setOnboardingActive(true)

    // Show a toast notification
    toast({
      title: "Onboarding Guide Restarted",
      description: "The onboarding guide will now take you through the features of Pump.Investments Lite.",
    })
  }, [setOnboardingActive])

  return {
    settings,
    updateSettings,
    updateSettingsBatch, // Export the batch update function
    restartOnboarding,
  }
}
