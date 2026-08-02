"use client"

export interface ClientDiagnosticEvent {
  at: string
  kind: string
  message: string
  url?: string
  status?: number
  durationMs?: number
}

const events: ClientDiagnosticEvent[] = []

function cleanUrl(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value, window.location.origin)
    return `${url.origin}${url.pathname}`.slice(0, 500)
  } catch { return undefined }
}

export function recordClientDiagnostic(event: Omit<ClientDiagnosticEvent, "at">): void {
  events.push({ ...event, message: event.message.slice(0, 500), url: cleanUrl(event.url), at: new Date().toISOString() })
  if (events.length > 20) events.splice(0, events.length - 20)
}

export function getClientDiagnosticEvents(): ClientDiagnosticEvent[] {
  return events.slice()
}
