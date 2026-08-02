"use client"

import { useEffect } from "react"
import { recordClientDiagnostic } from "@/lib/client-diagnostics"

export function ClientDiagnosticRecorder() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => recordClientDiagnostic({ kind: "window-error", message: event.message || "Unknown browser error", url: event.filename })
    const onRejection = (event: PromiseRejectionEvent) => recordClientDiagnostic({ kind: "unhandled-rejection", message: event.reason instanceof Error ? event.reason.message : String(event.reason ?? "Unknown rejection") })
    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onRejection)
    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onRejection)
    }
  }, [])
  return null
}
