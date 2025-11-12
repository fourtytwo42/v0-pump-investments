"use client"

import { useState } from "react"
import { Coffee, Copy, Check } from "lucide-react"
import { toast } from "@/components/ui/use-toast"
import { ToastAction } from "@/components/ui/toast"

// Developer Solana Address
const DEVELOPER_SOL_ADDRESS = "8oRZGW7wDEkmxMWhRo7eaQes4zR1smh9Q1wDwiDaCKnx"

interface DonationButtonProps {
  address?: string
}

// Make the donation button more subtle and compact
export default function DonationButton({ address = DEVELOPER_SOL_ADDRESS }: DonationButtonProps) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)

      toast({
        title: "Address copied!",
        description: "The donation address has been copied to your clipboard.",
        action: <ToastAction altText="Dismiss">Dismiss</ToastAction>,
      })

      // Reset copied state after 2 seconds
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy: ", err)
      toast({
        title: "Copy failed",
        description: "Please try copying the address manually.",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="text-xs text-muted-foreground flex items-center gap-1">
        <Coffee className="h-3 w-3" />
        <span>Buy me a coffee:</span>
      </div>
      <div className="flex items-center">
        <button
          onClick={copyToClipboard}
          className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
          title="Click to copy"
        >
          {address.slice(0, 5)}...{address.slice(-5)}
        </button>
        <button
          onClick={copyToClipboard}
          className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
          title="Copy address"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  )
}
