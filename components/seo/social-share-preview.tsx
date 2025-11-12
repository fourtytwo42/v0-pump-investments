"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Copy, Check, Twitter, Facebook, Linkedin } from "lucide-react"
import { toast } from "@/components/ui/use-toast"
import NextImage from "next/image"

export default function SocialSharePreview() {
  const [copied, setCopied] = useState(false)
  const [url, setUrl] = useState("")

  useEffect(() => {
    setUrl(window.location.href)
  }, [])

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast({
        title: "URL copied!",
        description: "The URL has been copied to your clipboard.",
      })
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy: ", err)
      toast({
        title: "Copy failed",
        description: "Please try copying the URL manually.",
        variant: "destructive",
      })
    }
  }

  const shareOnTwitter = () => {
    const text = "Check out Pump.Investments Lite - a real-time token tracker for pump.fun!"
    window.open(
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
      "_blank",
    )
  }

  const shareOnFacebook = () => {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, "_blank")
  }

  const shareOnLinkedIn = () => {
    const title = "Pump.Investments Lite"
    const summary = "Track, analyze, and monitor tokens on pump.fun in real-time"
    window.open(
      `https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(url)}&title=${encodeURIComponent(
        title,
      )}&summary=${encodeURIComponent(summary)}`,
      "_blank",
    )
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardContent className="p-6">
        <h3 className="text-lg font-semibold mb-4">Share Pump.Investments</h3>

        <div className="mb-6 rounded-lg overflow-hidden border">
          <NextImage
            src="/og-image.png"
            alt="Pump.Investments Lite Preview"
            width={600}
            height={315}
            className="w-full h-auto"
          />
        </div>

        <div className="flex items-center mb-4">
          <input type="text" value={url} readOnly className="flex-1 p-2 text-sm border rounded-l-md bg-background" />
          <Button variant="default" size="sm" className="rounded-l-none" onClick={copyToClipboard}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>

        <div className="flex justify-between gap-2">
          <Button variant="outline" size="sm" className="flex-1 flex items-center gap-2" onClick={shareOnTwitter}>
            <Twitter className="h-4 w-4" />
            Twitter
          </Button>
          <Button variant="outline" size="sm" className="flex-1 flex items-center gap-2" onClick={shareOnFacebook}>
            <Facebook className="h-4 w-4" />
            Facebook
          </Button>
          <Button variant="outline" size="sm" className="flex-1 flex items-center gap-2" onClick={shareOnLinkedIn}>
            <Linkedin className="h-4 w-4" />
            LinkedIn
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
