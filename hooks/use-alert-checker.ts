"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { db, type TokenAlert } from "@/lib/db"
import { soundService } from "@/lib/sound-service"

export function useAlertChecker(tokens: Map<string, any>) {
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const [lastCheckTime, setLastCheckTime] = useState<number>(0)
  const activeAlertSoundsRef = useRef<Map<string, () => void>>(new Map())
  const activeToastsRef = useRef<Map<string, { id: string; timeoutId: NodeJS.Timeout }>>(new Map())

  // Use a ref to store tokens to avoid unnecessary effect triggers
  const tokensRef = useRef(tokens)

  // Update the ref when tokens change
  useEffect(() => {
    tokensRef.current = tokens
  }, [tokens])

  // Define the check alerts function as a callback so it can be used in multiple places
  const checkAlerts = useCallback(async () => {
    try {
      // Get all enabled alerts
      const allAlerts = await db.alerts.toArray()
      const enabledAlerts = allAlerts.filter((alert) => alert.enabled === true)

      if (enabledAlerts.length === 0) return

      // Check each alert against current token data
      for (const alert of enabledAlerts) {
        const token = tokensRef.current.get(alert.mint)
        if (!token) continue // Skip if token not in current view

        const currentMarketCap = token.usd_market_cap

        // Store the reference market cap when the alert was created
        // If we don't have a reference value stored, use the current value
        if (!alert.referenceMarketCap) {
          // Update the alert with the current market cap as reference
          await db.alerts.update(alert.mint, { referenceMarketCap: currentMarketCap })
          alert.referenceMarketCap = currentMarketCap
        }

        // Check based on threshold type
        if (alert.thresholdType === "value") {
          // Check upper threshold (absolute value)
          if (alert.upperThreshold !== null && currentMarketCap > alert.upperThreshold) {
            // Only trigger if this is the first time or if it's been at least 1 hour since last trigger
            const shouldTrigger = !alert.lastTriggered || Date.now() - alert.lastTriggered > 60 * 60 * 1000

            if (shouldTrigger) {
              triggerAlert(token, alert, "above", currentMarketCap, alert.upperThreshold, "value")
              await db.updateAlertLastTriggered(alert.mint)

              // Add to alert history
              await db.addAlertHistoryEntry({
                mint: token.mint,
                tokenName: token.name,
                tokenSymbol: token.symbol,
                triggerTime: Date.now(),
                marketCapAtTrigger: currentMarketCap,
                thresholdType: "value",
                thresholdValue: alert.upperThreshold,
                thresholdDirection: "above",
              })
            }
          }

          // Check lower threshold (absolute value)
          if (alert.lowerThreshold !== null && currentMarketCap < alert.lowerThreshold) {
            // Only trigger if this is the first time or if it's been at least 1 hour since last trigger
            const shouldTrigger = !alert.lastTriggered || Date.now() - alert.lastTriggered > 60 * 60 * 1000

            if (shouldTrigger) {
              triggerAlert(token, alert, "below", currentMarketCap, alert.lowerThreshold, "value")
              await db.updateAlertLastTriggered(alert.mint)

              // Add to alert history
              await db.addAlertHistoryEntry({
                mint: token.mint,
                tokenName: token.name,
                tokenSymbol: token.symbol,
                triggerTime: Date.now(),
                marketCapAtTrigger: currentMarketCap,
                thresholdType: "value",
                thresholdValue: alert.lowerThreshold,
                thresholdDirection: "below",
              })
            }
          }
        } else {
          // Percentage-based thresholds
          const referenceValue = alert.referenceMarketCap || currentMarketCap

          // Calculate percentage change
          const percentChange = ((currentMarketCap - referenceValue) / referenceValue) * 100

          // Check upper percentage threshold
          if (alert.upperPercentThreshold !== null && percentChange >= alert.upperPercentThreshold) {
            // Only trigger if this is the first time or if it's been at least 1 hour since last trigger
            const shouldTrigger = !alert.lastTriggered || Date.now() - alert.lastTriggered > 60 * 60 * 1000

            if (shouldTrigger) {
              const thresholdValue = referenceValue * (1 + alert.upperPercentThreshold / 100)
              triggerAlert(token, alert, "above", currentMarketCap, thresholdValue, "percent", percentChange)
              await db.updateAlertLastTriggered(alert.mint)

              // Add to alert history
              await db.addAlertHistoryEntry({
                mint: token.mint,
                tokenName: token.name,
                tokenSymbol: token.symbol,
                triggerTime: Date.now(),
                marketCapAtTrigger: currentMarketCap,
                thresholdType: "percent",
                thresholdValue: alert.upperPercentThreshold,
                thresholdDirection: "above",
                percentChange: percentChange,
                referenceMarketCap: referenceValue,
              })

              // Update reference value after triggering
              await db.alerts.update(alert.mint, { referenceMarketCap: currentMarketCap })
            }
          }

          // Check lower percentage threshold
          if (alert.lowerPercentThreshold !== null && percentChange <= -alert.lowerPercentThreshold) {
            // Only trigger if this is the first time or if it's been at least 1 hour since last trigger
            const shouldTrigger = !alert.lastTriggered || Date.now() - alert.lastTriggered > 60 * 60 * 1000

            if (shouldTrigger) {
              const thresholdValue = referenceValue * (1 - alert.lowerPercentThreshold / 100)
              triggerAlert(token, alert, "below", currentMarketCap, thresholdValue, "percent", percentChange)
              await db.updateAlertLastTriggered(alert.mint)

              // Add to alert history
              await db.addAlertHistoryEntry({
                mint: token.mint,
                tokenName: token.name,
                tokenSymbol: token.symbol,
                triggerTime: Date.now(),
                marketCapAtTrigger: currentMarketCap,
                thresholdType: "percent",
                thresholdValue: alert.lowerPercentThreshold,
                thresholdDirection: "below",
                percentChange: percentChange,
                referenceMarketCap: referenceValue,
              })

              // Update reference value after triggering
              await db.alerts.update(alert.mint, { referenceMarketCap: currentMarketCap })
            }
          }
        }

        // Update last checked timestamp
        await db.updateAlertLastChecked(alert.mint)
      }

      // Update last check time
      setLastCheckTime(Date.now())
    } catch (error) {
      console.error("Error checking alerts:", error)
    }
  }, [])

  // Check alerts when tokens change
  useEffect(() => {
    // Run the check immediately when tokens change
    checkAlerts()
  }, [tokens, checkAlerts])

  // Set up the interval for regular checks
  useEffect(() => {
    // Run immediately and then set interval - check every 5 seconds
    checkAlerts()
    checkIntervalRef.current = setInterval(() => {
      checkAlerts()
    }, 5000)

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current)
      }

      // Stop any playing alert sounds when unmounting
      activeAlertSoundsRef.current.forEach((stopSound) => stopSound())
      activeAlertSoundsRef.current.clear()

      // Clear any active toast timeouts
      activeToastsRef.current.forEach(({ timeoutId }) => {
        clearTimeout(timeoutId)
      })
      activeToastsRef.current.clear()
    }
  }, [checkAlerts])

  // Function to trigger an alert
  const triggerAlert = (
    token: any,
    alert: TokenAlert,
    direction: "above" | "below",
    currentValue: number,
    threshold: number,
    thresholdType: "value" | "percent",
    percentChange?: number,
  ) => {
    const pumpFunUrl = `https://pump.fun/coin/${token.mint}?include-nsfw=true`
    const alertId = `alert-${token.mint}-${direction}`

    // If we already have an active alert for this token and direction, don't create another one
    if (activeToastsRef.current.has(alertId)) {
      return
    }

    // Play the appropriate sound based on the direction
    // Play once every 3 seconds, auto-stop after 30 seconds if not acknowledged
    const soundType = direction === "above" ? "high" : "low"

    try {
      // Play sound indefinitely until user responds (we'll handle cleanup manually)
      const stopSound = soundService.playPeriodicSound(soundType, 3000, 0)
      activeAlertSoundsRef.current.set(alertId, stopSound)
    } catch (error) {
      console.error(`Error playing ${soundType} sound:`, error)
    }

    // Function to clean up the alert
    const cleanupAlert = () => {
      // Stop sound
      if (activeAlertSoundsRef.current.has(alertId)) {
        const stopSound = activeAlertSoundsRef.current.get(alertId)
        if (stopSound) stopSound()
        activeAlertSoundsRef.current.delete(alertId)
      }

      // Clear any timeouts
      if (activeToastsRef.current.has(alertId)) {
        const { timeoutId } = activeToastsRef.current.get(alertId)!
        clearTimeout(timeoutId)
        activeToastsRef.current.delete(alertId)
      }
    }

    // Create a timeout to ensure we don't block the UI thread
    setTimeout(() => {
      // Prepare the message based on threshold type
      let message = `${token.name} (${token.symbol}) Market Cap Alert:\n`

      if (thresholdType === "value") {
        message += `Market cap is now ${direction} your ${direction === "above" ? "upper" : "lower"} threshold of $${threshold.toLocaleString()}.\n`
        message += `Current value: $${currentValue.toLocaleString()}.`
      } else {
        // For percentage-based alerts
        const changeDirection = direction === "above" ? "increased" : "decreased"
        const percentValue = Math.abs(percentChange || 0).toFixed(2)
        message += `Market cap has ${changeDirection} by ${percentValue}%.\n`
        message += `Current value: $${currentValue.toLocaleString()}.`
      }

      message += `\n\nClick OK to view this token on pump.fun.\nClick Cancel to dismiss this alert.`

      // Show browser confirm dialog
      const userConfirmed = window.confirm(message)

      // Stop the sound regardless of user choice
      cleanupAlert()

      // If user clicked OK, navigate to the token page
      if (userConfirmed) {
        window.open(pumpFunUrl, "_blank", "noopener,noreferrer")
      }
    }, 100)

    // Store a dummy timeout ID for tracking active alerts
    const timeoutId = setTimeout(() => {}, 100000)
    activeToastsRef.current.set(alertId, { id: "browser-alert", timeoutId })
  }

  // Return nothing as this hook only has side effects
  return null
}
