"use client"

import { useState, useEffect } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/use-toast"
import { db, type TokenAlert, type AlertHistoryEntry } from "@/lib/db"
import { formatDistanceToNow, format } from "date-fns"
import { ArrowDown, ArrowUp, Bell, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function AlertManagement() {
  const [activeAlerts, setActiveAlerts] = useState<(TokenAlert & { tokenName?: string; tokenSymbol?: string })[]>([])
  const [alertHistory, setAlertHistory] = useState<AlertHistoryEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("active")

  // Load alerts and history
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true)

        // Load active alerts
        const alerts = await db.getAllAlerts()
        const enabledAlerts = alerts.filter((alert) => alert.enabled)

        // Enrich alerts with token names
        const enrichedAlerts = await Promise.all(
          enabledAlerts.map(async (alert) => {
            // Try to find a history entry for this token to get the name
            const history = await db.getAlertHistoryForToken(alert.mint)
            if (history.length > 0) {
              return {
                ...alert,
                tokenName: history[0].tokenName,
                tokenSymbol: history[0].tokenSymbol,
              }
            }
            return alert
          }),
        )

        setActiveAlerts(enrichedAlerts)

        // Load alert history
        const history = await db.getAllAlertHistory()
        setAlertHistory(history)
      } catch (error) {
        console.error("Error loading alert data:", error)
        toast({
          title: "Error",
          description: "Failed to load alert data",
          variant: "destructive",
        })
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [])

  // Delete a single alert
  const handleDeleteAlert = async (mint: string) => {
    try {
      await db.deleteAlert(mint)

      // Update the UI
      setActiveAlerts((prev) => prev.filter((alert) => alert.mint !== mint))

      toast({
        title: "Alert Deleted",
        description: "The alert has been removed successfully",
      })
    } catch (error) {
      console.error("Error deleting alert:", error)
      toast({
        title: "Error",
        description: "Failed to delete the alert",
        variant: "destructive",
      })
    }
  }

  // Delete all alerts
  const handleDeleteAllAlerts = async () => {
    try {
      await db.deleteAllAlerts()

      // Update the UI
      setActiveAlerts([])

      toast({
        title: "All Alerts Deleted",
        description: "All alerts have been removed successfully",
      })
    } catch (error) {
      console.error("Error deleting all alerts:", error)
      toast({
        title: "Error",
        description: "Failed to delete all alerts",
        variant: "destructive",
      })
    }
  }

  // Clear alert history
  const handleClearHistory = async () => {
    try {
      await db.clearAllAlertHistory()

      // Update the UI
      setAlertHistory([])

      toast({
        title: "History Cleared",
        description: "Alert history has been cleared successfully",
      })
    } catch (error) {
      console.error("Error clearing alert history:", error)
      toast({
        title: "Error",
        description: "Failed to clear alert history",
        variant: "destructive",
      })
    }
  }

  // Format currency values
  const formatUSD = (value: number | null) => {
    if (value === null) return "N/A"
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value)
  }

  return (
    <div className="space-y-4">
      <Tabs defaultValue="active" onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="active">Active Alerts</TabsTrigger>
          <TabsTrigger value="history">Alert History</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-medium">Active Alerts ({activeAlerts.length})</h3>
            {activeAlerts.length > 0 && (
              <Button variant="destructive" size="sm" onClick={handleDeleteAllAlerts}>
                Delete All
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : activeAlerts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No active alerts. Set up alerts for your favorite tokens to get notified of price changes.
            </p>
          ) : (
            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-3">
                {activeAlerts.map((alert) => (
                  <div key={alert.mint} className="border rounded-md p-3 bg-muted/20 relative">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-6 w-6"
                      onClick={() => handleDeleteAlert(alert.mint)}
                    >
                      <X className="h-4 w-4" />
                    </Button>

                    <div className="flex items-center gap-2 mb-2">
                      <Bell className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                      <span className="font-medium">
                        {alert.tokenName || alert.mint.substring(0, 8)}
                        {alert.tokenSymbol && ` (${alert.tokenSymbol})`}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-sm mt-3">
                      <div className="text-muted-foreground">Alert Type:</div>
                      <div className="capitalize">{alert.thresholdType}</div>

                      {alert.thresholdType === "value" ? (
                        <>
                          {alert.upperThreshold && (
                            <>
                              <div className="text-muted-foreground">Upper Threshold:</div>
                              <div className="flex items-center gap-1">
                                <ArrowUp className="h-3 w-3 text-green-500" />
                                {formatUSD(alert.upperThreshold)}
                              </div>
                            </>
                          )}

                          {alert.lowerThreshold && (
                            <>
                              <div className="text-muted-foreground">Lower Threshold:</div>
                              <div className="flex items-center gap-1">
                                <ArrowDown className="h-3 w-3 text-red-500" />
                                {formatUSD(alert.lowerThreshold)}
                              </div>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          {alert.upperPercentThreshold && (
                            <>
                              <div className="text-muted-foreground">Upper Threshold:</div>
                              <div className="flex items-center gap-1">
                                <ArrowUp className="h-3 w-3 text-green-500" />
                                {alert.upperPercentThreshold}%
                              </div>
                            </>
                          )}

                          {alert.lowerPercentThreshold && (
                            <>
                              <div className="text-muted-foreground">Lower Threshold:</div>
                              <div className="flex items-center gap-1">
                                <ArrowDown className="h-3 w-3 text-red-500" />
                                {alert.lowerPercentThreshold}%
                              </div>
                            </>
                          )}

                          {alert.referenceMarketCap && (
                            <>
                              <div className="text-muted-foreground">Reference Value:</div>
                              <div>{formatUSD(alert.referenceMarketCap)}</div>
                            </>
                          )}
                        </>
                      )}

                      {alert.lastTriggered && (
                        <>
                          <div className="text-muted-foreground">Last Triggered:</div>
                          <div>{formatDistanceToNow(new Date(alert.lastTriggered), { addSuffix: true })}</div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-medium">Alert History ({alertHistory.length})</h3>
            {alertHistory.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleClearHistory}>
                Clear History
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : alertHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No alert history available. Triggered alerts will appear here.
            </p>
          ) : (
            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-3">
                {alertHistory.map((entry, index) => (
                  <div key={index} className="border rounded-md p-3 bg-muted/20">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">
                          {entry.tokenName} ({entry.tokenSymbol})
                        </span>
                      </div>
                      <Badge
                        variant={entry.thresholdDirection === "above" ? "default" : "destructive"}
                        className="ml-2"
                      >
                        {entry.thresholdDirection === "above" ? "Upper" : "Lower"}
                      </Badge>
                    </div>

                    <div className="mt-2 text-sm">
                      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                        <div className="text-muted-foreground">Triggered:</div>
                        <div>{formatDistanceToNow(new Date(entry.triggerTime), { addSuffix: true })}</div>

                        <div className="text-muted-foreground">Date:</div>
                        <div>{format(new Date(entry.triggerTime), "MMM d, yyyy h:mm a")}</div>

                        <div className="text-muted-foreground">Market Cap:</div>
                        <div>{formatUSD(entry.marketCapAtTrigger)}</div>

                        <div className="text-muted-foreground">Type:</div>
                        <div className="capitalize">{entry.thresholdType}</div>

                        <div className="text-muted-foreground">Threshold:</div>
                        <div>
                          {entry.thresholdType === "value"
                            ? formatUSD(entry.thresholdValue)
                            : `${entry.thresholdValue}%`}
                        </div>

                        {entry.thresholdType === "percent" && entry.percentChange !== undefined && (
                          <>
                            <div className="text-muted-foreground">Change:</div>
                            <div>{entry.percentChange.toFixed(2)}%</div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
