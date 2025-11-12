"use client"

import Dashboard from "@/components/dashboard"
import { Toaster } from "@/components/ui/toaster"
import { TokenProvider } from "@/contexts/token-context"

export default function ClientWrapper() {
  return (
    <TokenProvider>
      <Dashboard />
      <Toaster />
    </TokenProvider>
  )
}
