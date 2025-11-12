// A global cache for alert statuses to prevent repeated database queries
class AlertStatusCache {
  private cache: Map<string, boolean> = new Map()

  // Get alert status from cache
  get(mint: string): boolean | undefined {
    return this.cache.get(mint)
  }

  // Set alert status in cache
  set(mint: string, isEnabled: boolean): void {
    this.cache.set(mint, isEnabled)
  }

  // Check if mint exists in cache
  has(mint: string): boolean {
    return this.cache.has(mint)
  }

  // Clear the entire cache
  clear(): void {
    this.cache.clear()
  }

  // Remove a specific mint from cache
  remove(mint: string): void {
    this.cache.delete(mint)
  }
}

// Export a singleton instance
export const alertStatusCache = new AlertStatusCache()
