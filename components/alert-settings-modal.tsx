"use client"

import { useState, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/use-toast"
import { db } from "@/lib/db"
import { Volume2, VolumeX, ArrowUp, ArrowDown } from "lucide-react"
import { soundService } from "@/lib/sound-service"
import { alertStatusCache } from "@/lib/alert-status-cache"

// Global state for the alert modal
type ModalState = {
  isOpen: boolean
  token: {
    mint: string
    name: string
    symbol: string
    usd_market_cap: number
  } | null
}

// Global variable to store modal state
let modalState: ModalState = {
  isOpen: false,
  token: null,
}

// Global callbacks
let openCallback: ((state: ModalState) => void) | null = null
let closeCallback: (() => void) | null = null

// Function to open the modal from anywhere
export function openAlertSettingsModal(token: {
  mint: string
  name: string
  symbol: string
  usd_market_cap: number
}) {
  console.log("Opening alert settings modal for token:", token.name)

  modalState = {
    isOpen: true,
    token,
  }

  if (openCallback) {
    openCallback(modalState)
  } else {
    console.warn("Alert settings modal callback not registered yet")
  }
}

// Function to close the modal from anywhere
export function closeAlertSettingsModal() {
  modalState = {
    isOpen: false,
    token: null,
  }

  if (closeCallback) {
    closeCallback()
  }
}

// The actual modal component
export function AlertSettingsModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [token, setToken] = useState<ModalState["token"]>(null)
  // Update the state to include percentage thresholds and threshold type
  const [alertSettings, setAlertSettings] = useState({
    enabled: false,
    upperThreshold: null as number | null,
    lowerThreshold: null as number | null,
    upperPercentThreshold: null as number | null,
    lowerPercentThreshold: null as number | null,
    thresholdType: "value" as "value" | "percent",
  })
  const [isClient, setIsClient] = useState(false)
  const [isPlayingTestSound, setIsPlayingTestSound] = useState<"none" | "high" | "low">("none")
  const initialized = useRef(false)
  const stopSoundRef = useRef<(() => void) | null>(null)

  // Register callbacks when component mounts
  useEffect(() => {
    setIsClient(true)

    openCallback = (state: ModalState) => {
      setIsOpen(state.isOpen)
      setToken(state.token)
    }

    closeCallback = () => {
      setIsOpen(false)
    }

    // Initialize from current state
    if (modalState.isOpen) {
      setIsOpen(true)
      setToken(modalState.token)
    }

    return () => {
      openCallback = null
      closeCallback = null

      // Clean up any playing test sounds
      if (stopSoundRef.current) {
        stopSoundRef.current()
        stopSoundRef.current = null
      }
    }
  }, [])

  // Load alert settings when token changes
  useEffect(() => {
    if (!token || initialized.current) return

    // Update the loadAlertSettings function to handle the new fields
    const loadAlertSettings = async () => {
      try {
        const settings = await db.getTokenAlertSettings(token.mint)
        if (settings) {
          setAlertSettings(settings)
        } else {
          // Default settings - upper threshold 20% higher, lower threshold 20% lower
          const currentMarketCap = token.usd_market_cap
          setAlertSettings({
            enabled: false,
            upperThreshold: Math.round(currentMarketCap * 1.2),
            lowerThreshold: Math.round(currentMarketCap * 0.8),
            upperPercentThreshold: 20, // Default 20% increase
            lowerPercentThreshold: 20, // Default 20% decrease
            thresholdType: "value",
          })
        }
        initialized.current = true
      } catch (error) {
        console.error("Error loading alert settings:", error)
      }
    }

    loadAlertSettings()
  }, [token])

  // Reset initialization when dialog closes
  useEffect(() => {
    if (!isOpen) {
      initialized.current = false

      // Stop any playing test sounds when dialog closes
      if (stopSoundRef.current) {
        stopSoundRef.current()
        stopSoundRef.current = null
        setIsPlayingTestSound("none")
      }
    }
  }, [isOpen])

  const handleSave = async () => {
    if (!token) return

    try {
      // Validate thresholds
      if (alertSettings.enabled) {
        if (
          !alertSettings.upperThreshold &&
          !alertSettings.lowerThreshold &&
          !alertSettings.upperPercentThreshold &&
          !alertSettings.lowerPercentThreshold
        ) {
          toast({
            title: "Invalid Settings",
            description: "Please set at least one threshold for the alert.",
            variant: "destructive",
          })
          return
        }
      }

      // Save alert settings
      await db.saveTokenAlertSettings(token.mint, alertSettings)

      // Update cache directly
      alertStatusCache.set(token.mint, alertSettings.enabled)

      toast({
        title: alertSettings.enabled ? "Alert Enabled" : "Alert Settings Saved",
        description: alertSettings.enabled
          ? `You will be alerted when ${token.name} market cap changes significantly.`
          : `Alert settings saved but not enabled for ${token.name}.`,
      })

      // Close the dialog
      closeAlertSettingsModal()
    } catch (error) {
      console.error("Error saving alert settings:", error)
      toast({
        title: "Error",
        description: "Failed to save alert settings.",
        variant: "destructive",
      })
    }
  }

  const formatUSD = (value: number | null) => {
    if (value === null) return ""
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value)
  }

  const parseUSD = (value: string): number | null => {
    if (!value) return null
    // Remove currency symbols, commas, etc.
    const numericValue = value.replace(/[^0-9.]/g, "")
    const parsed = Number.parseFloat(numericValue)
    return isNaN(parsed) ? null : parsed
  }

  // Add formatPercent function
  const formatPercent = (value: number | null) => {
    if (value === null) return ""
    return `${value}%`
  }

  // Add parsePercent function
  const parsePercent = (value: string): number | null => {
    if (!value) return null
    // Remove percentage symbol and other non-numeric characters
    const numericValue = value.replace(/[^0-9.]/g, "")
    const parsed = Number.parseFloat(numericValue)
    return isNaN(parsed) ? null : parsed
  }

  // Function to play/stop test sound
  const toggleTestSound = (soundType: "high" | "low") => {
    // If already playing this sound, stop it
    if (isPlayingTestSound === soundType) {
      if (stopSoundRef.current) {
        stopSoundRef.current()
        stopSoundRef.current = null
      }
      setIsPlayingTestSound("none")
      return
    }

    // If playing a different sound, stop it first
    if (isPlayingTestSound !== "none" && stopSoundRef.current) {
      stopSoundRef.current()
      stopSoundRef.current = null
    }

    // Play the new sound
    console.log(`Testing ${soundType} sound...`)

    try {
      stopSoundRef.current = soundService.playPeriodicSound(soundType, 3000, 10000) // Play for 10 seconds in test mode
      setIsPlayingTestSound(soundType)

      // Auto-stop after 10 seconds
      setTimeout(() => {
        if (isPlayingTestSound === soundType) {
          if (stopSoundRef.current) {
            stopSoundRef.current()
            stopSoundRef.current = null
          }
          setIsPlayingTestSound("none")
        }
      }, 10000)
    } catch (error) {
      console.error(`Error playing ${soundType} sound:`, error)
      toast({
        title: "Sound Error",
        description: `Could not play the ${soundType} alert sound. Check console for details.`,
        variant: "destructive",
      })
      setIsPlayingTestSound("none")
    }
  }

  // Only render on client side
  if (!isClient) return null

  return createPortal(
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) closeAlertSettingsModal()
      }}
    >
      <DialogContent className="sm:max-w-[425px]">
        {token && (
          <>
            <DialogHeader>
              <DialogTitle>Alert Settings for {token.name}</DialogTitle>
              <DialogDescription>
                Set market cap thresholds to receive alerts when this token's value changes significantly.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="alert-enabled" className="flex items-center gap-2">
                  Enable Alerts
                </Label>
                <Switch
                  id="alert-enabled"
                  checked={alertSettings.enabled}
                  onCheckedChange={(checked) => setAlertSettings({ ...alertSettings, enabled: checked })}
                />
              </div>

              <div className="space-y-2 mt-4">
                <Label>Threshold Type</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={alertSettings.thresholdType === "value" ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => setAlertSettings({ ...alertSettings, thresholdType: "value" })}
                    disabled={!alertSettings.enabled}
                  >
                    Dollar Value
                  </Button>
                  <Button
                    type="button"
                    variant={alertSettings.thresholdType === "percent" ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => setAlertSettings({ ...alertSettings, thresholdType: "percent" })}
                    disabled={!alertSettings.enabled}
                  >
                    Percentage
                  </Button>
                </div>
              </div>

              {alertSettings.thresholdType === "value" ? (
                <div className="space-y-2">
                  <Label htmlFor="upper-threshold">Alert when market cap rises above</Label>
                  <Input
                    id="upper-threshold"
                    value={formatUSD(alertSettings.upperThreshold)}
                    onChange={(e) =>
                      setAlertSettings({
                        ...alertSettings,
                        upperThreshold: parseUSD(e.target.value),
                      })
                    }
                    placeholder="e.g. $100,000"
                    disabled={!alertSettings.enabled}
                  />
                  <p className="text-xs text-muted-foreground">Current market cap: {formatUSD(token.usd_market_cap)}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="upper-percent-threshold">Alert when market cap increases by</Label>
                  <Input
                    id="upper-percent-threshold"
                    value={formatPercent(alertSettings.upperPercentThreshold)}
                    onChange={(e) =>
                      setAlertSettings({
                        ...alertSettings,
                        upperPercentThreshold: parsePercent(e.target.value),
                      })
                    }
                    placeholder="e.g. 20%"
                    disabled={!alertSettings.enabled}
                  />
                  <p className="text-xs text-muted-foreground">
                    Equivalent to{" "}
                    {formatUSD(token.usd_market_cap * (1 + (alertSettings.upperPercentThreshold || 0) / 100))}
                  </p>
                </div>
              )}

              {alertSettings.thresholdType === "value" ? (
                <div className="space-y-2">
                  <Label htmlFor="lower-threshold">Alert when market cap falls below</Label>
                  <Input
                    id="lower-threshold"
                    value={formatUSD(alertSettings.lowerThreshold)}
                    onChange={(e) =>
                      setAlertSettings({
                        ...alertSettings,
                        lowerThreshold: parseUSD(e.target.value),
                      })
                    }
                    placeholder="e.g. $50,000"
                    disabled={!alertSettings.enabled}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="lower-percent-threshold">Alert when market cap decreases by</Label>
                  <Input
                    id="lower-percent-threshold"
                    value={formatPercent(alertSettings.lowerPercentThreshold)}
                    onChange={(e) =>
                      setAlertSettings({
                        ...alertSettings,
                        lowerPercentThreshold: parsePercent(e.target.value),
                      })
                    }
                    placeholder="e.g. 20%"
                    disabled={!alertSettings.enabled}
                  />
                  <p className="text-xs text-muted-foreground">
                    Equivalent to{" "}
                    {formatUSD(token.usd_market_cap * (1 - (alertSettings.lowerPercentThreshold || 0) / 100))}
                  </p>
                </div>
              )}

              {/* Sound test buttons */}
              <div className="mt-2 space-y-2">
                <Label>Test Alert Sounds</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={isPlayingTestSound === "high" ? "default" : "outline"}
                    size="sm"
                    className="flex items-center gap-2 flex-1"
                    onClick={() => toggleTestSound("high")}
                    disabled={!alertSettings.enabled}
                  >
                    {isPlayingTestSound === "high" ? (
                      <>
                        <VolumeX className="h-4 w-4" />
                        Stop High Sound
                      </>
                    ) : (
                      <>
                        <Volume2 className="h-4 w-4" />
                        <ArrowUp className="h-3 w-3" />
                        Test High Alert
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant={isPlayingTestSound === "low" ? "default" : "outline"}
                    size="sm"
                    className="flex items-center gap-2 flex-1"
                    onClick={() => toggleTestSound("low")}
                    disabled={!alertSettings.enabled}
                  >
                    {isPlayingTestSound === "low" ? (
                      <>
                        <VolumeX className="h-4 w-4" />
                        Stop Low Sound
                      </>
                    ) : (
                      <>
                        <Volume2 className="h-4 w-4" />
                        <ArrowDown className="h-3 w-3" />
                        Test Low Alert
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Different sounds will play for high and low threshold alerts.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => closeAlertSettingsModal()}>
                Cancel
              </Button>
              <Button onClick={handleSave}>Save Settings</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>,
    document.body,
  )
}
