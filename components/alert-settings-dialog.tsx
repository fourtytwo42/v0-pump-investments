"use client"

import { useState, useEffect, useRef } from "react"
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
import { db, type AlertHistoryEntry } from "@/lib/db"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatDistanceToNow, format } from "date-fns"
import { ArrowDown, ArrowUp, Volume2, VolumeX } from "lucide-react"
import { soundService } from "@/lib/sound-service"

interface AlertSettings {
  enabled: boolean
  upperThreshold: number | null
  lowerThreshold: number | null
  upperPercentThreshold: number | null
  lowerPercentThreshold: number | null
  thresholdType: "value" | "percent"
}

interface AlertSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  token: {
    mint: string
    name: string
    symbol: string
    usd_market_cap: number
  }
}

export function AlertSettingsDialog({ open, onOpenChange, token }: AlertSettingsDialogProps) {
  // Internal state to track if dialog is actually open
  const [internalOpen, setInternalOpen] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [alertSettings, setAlertSettings] = useState<AlertSettings>({
    enabled: false,
    upperThreshold: null,
    lowerThreshold: null,
    upperPercentThreshold: null,
    lowerPercentThreshold: null,
    thresholdType: "value",
  })
  const [alertHistory, setAlertHistory] = useState<AlertHistoryEntry[]>([])
  const [activeTab, setActiveTab] = useState("settings")
  const [isPlayingTestSound, setIsPlayingTestSound] = useState<"none" | "high" | "low">("none")
  const stopSoundRef = useRef<(() => void) | null>(null)

  // Synchronize external and internal open states
  useEffect(() => {
    if (open && !internalOpen) {
      setInternalOpen(true)
    }
  }, [open, internalOpen])

  // Load settings and history when dialog opens
  useEffect(() => {
    if (internalOpen && !isInitialized) {
      const loadData = async () => {
        try {
          // Load alert settings
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
              upperPercentThreshold: 20,
              lowerPercentThreshold: 20,
              thresholdType: "value",
            })
          }

          // Load alert history
          const history = await db.getAlertHistoryForToken(token.mint)
          setAlertHistory(history)

          setIsInitialized(true)
        } catch (error) {
          console.error("Error loading alert data:", error)
        }
      }

      loadData()
    }
  }, [internalOpen, isInitialized, token.mint, token.usd_market_cap])

  // Reset initialization state when dialog closes
  useEffect(() => {
    if (!internalOpen) {
      setIsInitialized(false)
      setActiveTab("settings")
    }
  }, [internalOpen])

  const handleSave = async () => {
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

      toast({
        title: alertSettings.enabled ? "Alert Enabled" : "Alert Settings Saved",
        description: alertSettings.enabled
          ? `You will be alerted when ${token.name} market cap changes significantly.`
          : `Alert settings saved but not enabled for ${token.name}.`,
      })

      // Close the dialog using internal state first
      setInternalOpen(false)
      // Then notify parent
      onOpenChange(false)
    } catch (error) {
      console.error("Error saving alert settings:", error)
      toast({
        title: "Error",
        description: "Failed to save alert settings.",
        variant: "destructive",
      })
    }
  }

  const handleClose = () => {
    // Close the dialog using internal state first
    setInternalOpen(false)
    // Then notify parent
    onOpenChange(false)
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

  const formatPercent = (value: number | null) => {
    if (value === null) return ""
    return `${value}%`
  }

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

  // Use internal state to control dialog
  return (
    <Dialog
      open={internalOpen}
      onOpenChange={(newOpen) => {
        setInternalOpen(newOpen)
        if (!newOpen) {
          onOpenChange(false)
        }
      }}
    >
      <DialogContent className="sm:max-w-[500px]">
        {token && (
          <>
            <DialogHeader>
              <DialogTitle>Alert Settings for {token.name}</DialogTitle>
              <DialogDescription>
                Set market cap thresholds to receive alerts when this token's value changes significantly.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4">
              <div className="flex space-x-1 border-b">
                <button
                  className={`px-4 py-2 text-sm font-medium ${
                    activeTab === "settings"
                      ? "border-b-2 border-primary text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setActiveTab("settings")}
                >
                  Settings
                </button>
                <button
                  className={`px-4 py-2 text-sm font-medium ${
                    activeTab === "history"
                      ? "border-b-2 border-primary text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setActiveTab("history")}
                >
                  History
                </button>
              </div>
            </div>

            {activeTab === "settings" && (
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
                    <p className="text-xs text-muted-foreground">
                      Current market cap: {formatUSD(token.usd_market_cap)}
                    </p>
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
            )}

            {activeTab === "history" && (
              <div className="py-4">
                <h3 className="text-sm font-medium mb-2">Alert History</h3>
                {alertHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No alerts have been triggered for this token yet.
                  </p>
                ) : (
                  <ScrollArea className="h-[300px] pr-4">
                    <div className="space-y-3">
                      {alertHistory.map((entry, index) => (
                        <div key={index} className="border rounded-md p-3 bg-muted/20">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-1.5">
                              {entry.thresholdDirection === "above" ? (
                                <ArrowUp className="h-4 w-4 text-green-500" />
                              ) : (
                                <ArrowDown className="h-4 w-4 text-red-500" />
                              )}
                              <span className="font-medium">
                                {entry.thresholdDirection === "above" ? "Upper" : "Lower"} threshold{" "}
                                {entry.thresholdDirection}
                              </span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(entry.triggerTime), { addSuffix: true })}
                            </span>
                          </div>

                          <div className="mt-2 text-sm">
                            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                              <div className="text-muted-foreground">Triggered at:</div>
                              <div>{format(new Date(entry.triggerTime), "MMM d, yyyy h:mm a")}</div>

                              <div className="text-muted-foreground">Market Cap:</div>
                              <div>{formatUSD(entry.marketCapAtTrigger)}</div>

                              <div className="text-muted-foreground">Threshold Type:</div>
                              <div className="capitalize">{entry.thresholdType}</div>

                              <div className="text-muted-foreground">Threshold Value:</div>
                              <div>
                                {entry.thresholdType === "value"
                                  ? formatUSD(entry.thresholdValue)
                                  : `${entry.thresholdValue}%`}
                              </div>

                              {entry.thresholdType === "percent" && entry.percentChange !== undefined && (
                                <>
                                  <div className="text-muted-foreground">Percent Change:</div>
                                  <div>{entry.percentChange.toFixed(2)}%</div>

                                  <div className="text-muted-foreground">Reference Value:</div>
                                  <div>{formatUSD(entry.referenceMarketCap)}</div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              {activeTab === "settings" && <Button onClick={handleSave}>Save Settings</Button>}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
