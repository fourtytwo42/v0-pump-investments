import Dexie, { type Table } from "dexie"
import { alertStatusCache } from "./alert-status-cache"

// Define interfaces for our database tables
export interface FavoriteToken {
  mint: string
  dateAdded: Date
}

export interface StoredTrade {
  id: string // Combination of mint + timestamp + signature for uniqueness
  mint: string
  name: string
  symbol: string
  image_uri: string
  usd_market_cap: number
  market_cap: number
  sol_amount: number
  usd_amount: number
  is_buy: boolean
  user: string
  creator: string
  creator_username: string
  token_amount: number
  total_supply: number
  timestamp: number
  received_time: number
  virtual_sol_reserves: number
  virtual_token_reserves: number
  signature: string
  created_timestamp?: number
  metadata_uri?: string | null
  website?: string | null
  twitter?: string | null
  telegram?: string | null
  description?: string | null
  king_of_the_hill_timestamp?: number | null
  description?: string | null
}

// New interface for token alerts
export interface TokenAlert {
  mint: string
  enabled: boolean
  upperThreshold: number | null
  lowerThreshold: number | null
  upperPercentThreshold: number | null
  lowerPercentThreshold: number | null
  thresholdType: "value" | "percent"
  referenceMarketCap?: number
  lastChecked?: number
  lastTriggered?: number
}

// New interface for alert history
export interface AlertHistoryEntry {
  id?: number // Auto-incremented primary key
  mint: string
  tokenName: string
  tokenSymbol: string
  triggerTime: number
  marketCapAtTrigger: number
  thresholdType: "value" | "percent"
  thresholdValue: number
  thresholdDirection: "above" | "below"
  percentChange?: number // Only for percentage-based alerts
  referenceMarketCap?: number // Only for percentage-based alerts
}

// Interface for user preferences
export interface UserPreference {
  id: string
  value: any
}

// Define the database
class PumpInvestmentsDB extends Dexie {
  favorites!: Table<FavoriteToken, string> // string = type of the primary key
  trades!: Table<StoredTrade, string> // string = type of the primary key
  preferences!: Table<UserPreference, string> // For user preferences like onboarding completion
  alerts!: Table<TokenAlert, string> // For token alerts
  alertHistory!: Table<AlertHistoryEntry, number> // For alert history

  constructor() {
    super("PumpInvestmentsDB")

    // Define tables and indexes
    this.version(5).stores({
      favorites: "mint, dateAdded",
      trades: "id, mint, timestamp, received_time",
      preferences: "id",
      alerts: "mint", // Removed 'enabled' index to avoid IDBKeyRange issues
      alertHistory: "++id, mint, triggerTime", // Auto-incrementing id, with indexes on mint and triggerTime
    })
  }

  // Helper methods for favorites
  async getFavorites(): Promise<string[]> {
    const favorites = await this.favorites.toArray()
    return favorites.map((fav) => fav.mint)
  }

  async addFavorite(mint: string): Promise<void> {
    await this.favorites.put({
      mint,
      dateAdded: new Date(),
    })
  }

  async removeFavorite(mint: string): Promise<void> {
    // Remove the favorite
    await this.favorites.where("mint").equals(mint).delete()

    // Also remove all trades for this token
    await this.trades.where("mint").equals(mint).delete()

    // Remove any alerts for this token
    await this.alerts.where("mint").equals(mint).delete()

    // Remove from alert status cache
    alertStatusCache.remove(mint)
  }

  async isFavorite(mint: string): Promise<boolean> {
    const count = await this.favorites.where("mint").equals(mint).count()
    return count > 0
  }

  // Helper methods for trades
  async addTrade(trade: StoredTrade): Promise<void> {
    await this.trades.put(trade)
  }

  async getTradesForToken(mint: string): Promise<StoredTrade[]> {
    return this.trades.where("mint").equals(mint).toArray()
  }

  async getRecentTrades(minutes = 60): Promise<StoredTrade[]> {
    const cutoff = Date.now() - minutes * 60 * 1000
    return this.trades.where("received_time").above(cutoff).toArray()
  }

  async getTradesForFavorites(): Promise<StoredTrade[]> {
    const favorites = await this.getFavorites()
    if (favorites.length === 0) return []

    return this.trades.where("mint").anyOf(favorites).toArray()
  }

  async cleanupOldTrades(minutes = 60): Promise<number> {
    const cutoff = Date.now() - minutes * 60 * 1000
    const favorites = await this.getFavorites()

    // Keep all trades for favorites, delete old trades for non-favorites
    if (favorites.length === 0) {
      // No favorites, just delete old trades
      return await this.trades.where("received_time").below(cutoff).delete()
    } else {
      // Keep favorite trades, delete old non-favorite trades
      return await this.trades
        .where("received_time")
        .below(cutoff)
        .and((item) => !favorites.includes(item.mint))
        .delete()
    }
  }

  // Helper methods for user preferences
  async getPreference(id: string, defaultValue: any = null): Promise<any> {
    const pref = await this.preferences.get(id)
    return pref ? pref.value : defaultValue
  }

  async setPreference(id: string, value: any): Promise<void> {
    await this.preferences.put({ id, value })
  }

  // Specific method for onboarding
  async hasCompletedOnboarding(): Promise<boolean> {
    return await this.getPreference("onboardingCompleted", false)
  }

  async markOnboardingCompleted(): Promise<void> {
    await this.setPreference("onboardingCompleted", true)
  }

  // Methods for token alerts
  async getTokenAlertSettings(mint: string): Promise<TokenAlert | undefined> {
    // Check cache first
    if (alertStatusCache.has(mint)) {
      const isEnabled = alertStatusCache.get(mint)
      const settings = await this.alerts.get(mint)

      // If we have settings, return them with the cached enabled status
      if (settings) {
        return {
          ...settings,
          enabled: isEnabled ?? settings.enabled,
        }
      }
    }

    // If not in cache, get from database
    const settings = await this.alerts.get(mint)

    // Update cache if settings exist
    if (settings) {
      alertStatusCache.set(mint, settings.enabled)
    }

    return settings
  }

  async isAlertEnabled(mint: string): Promise<boolean> {
    // Check cache first
    if (alertStatusCache.has(mint)) {
      return alertStatusCache.get(mint) ?? false
    }

    // If not in cache, get from database
    const settings = await this.alerts.get(mint)
    const isEnabled = settings?.enabled ?? false

    // Update cache
    alertStatusCache.set(mint, isEnabled)

    return isEnabled
  }

  async saveTokenAlertSettings(mint: string, settings: Omit<TokenAlert, "mint">): Promise<void> {
    // Update database
    await this.alerts.put({
      mint,
      ...settings,
      lastChecked: Date.now(),
    })

    // Update cache
    alertStatusCache.set(mint, settings.enabled)
  }

  async getAllEnabledAlerts(): Promise<TokenAlert[]> {
    // Get all alerts and filter for enabled ones in JavaScript
    // This avoids using the 'enabled' index which was causing IDBKeyRange errors
    const allAlerts = await this.alerts.toArray()
    return allAlerts.filter((alert) => alert.enabled === true)
  }

  async getAllAlerts(): Promise<TokenAlert[]> {
    return await this.alerts.toArray()
  }

  async updateAlertLastChecked(mint: string): Promise<void> {
    const alert = await this.alerts.get(mint)
    if (alert) {
      alert.lastChecked = Date.now()
      await this.alerts.put(alert)
    }
  }

  async updateAlertLastTriggered(mint: string): Promise<void> {
    const alert = await this.alerts.get(mint)
    if (alert) {
      alert.lastTriggered = Date.now()
      await this.alerts.put(alert)
    }
  }

  async removeAllAlertsForNonFavorites(): Promise<number> {
    const favorites = await this.getFavorites()
    if (favorites.length === 0) {
      // Clear cache
      alertStatusCache.clear()
      return await this.alerts.clear()
    } else {
      // Get all alerts
      const allAlerts = await this.alerts.toArray()

      // Filter for non-favorites
      const nonFavoriteAlerts = allAlerts.filter((alert) => !favorites.includes(alert.mint))

      // Delete each non-favorite alert
      let deleteCount = 0
      for (const alert of nonFavoriteAlerts) {
        await this.alerts.delete(alert.mint)
        alertStatusCache.remove(alert.mint)
        deleteCount++
      }

      return deleteCount
    }
  }

  async deleteAlert(mint: string): Promise<void> {
    await this.alerts.delete(mint)
    alertStatusCache.remove(mint)
  }

  async deleteAllAlerts(): Promise<void> {
    await this.alerts.clear()
    alertStatusCache.clear()
  }

  // Methods for alert history
  async addAlertHistoryEntry(entry: Omit<AlertHistoryEntry, "id">): Promise<number> {
    return await this.alertHistory.add(entry)
  }

  async getAlertHistoryForToken(mint: string): Promise<AlertHistoryEntry[]> {
    return await this.alertHistory.where("mint").equals(mint).reverse().sortBy("triggerTime")
  }

  async getAllAlertHistory(): Promise<AlertHistoryEntry[]> {
    return await this.alertHistory.reverse().sortBy("triggerTime")
  }

  async clearAllAlertHistory(): Promise<void> {
    await this.alertHistory.clear()
  }

  // Reset all settings to default
  async resetAllSettings(): Promise<void> {
    // Delete all favorites
    await this.favorites.clear()

    // Delete all alerts
    await this.alerts.clear()
    alertStatusCache.clear()

    // Reset preferences to defaults
    // We'll keep onboarding completed to avoid showing the guide again
    const onboardingCompleted = await this.getPreference("onboardingCompleted", false)
    await this.preferences.clear()

    // Restore onboarding preference
    if (onboardingCompleted) {
      await this.setPreference("onboardingCompleted", true)
    }

    // Note: We're keeping alert history as requested
  }
}

// Create and export a singleton instance
export const db = new PumpInvestmentsDB()
