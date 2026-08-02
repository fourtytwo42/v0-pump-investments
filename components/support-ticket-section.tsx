"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Bug, ChevronDown, ImagePlus, Loader2, MessageSquare, RefreshCw, Send, Trash2, X } from "lucide-react"
import packageInfo from "@/package.json"
import { useTokenContext } from "@/contexts/token-context"
import { getClientDiagnosticEvents, recordClientDiagnostic } from "@/lib/client-diagnostics"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/use-toast"

type TicketStatus = "WAITING_FOR_SUPPORT" | "WAITING_FOR_USER" | "RESOLVED"
type Category = "FEED" | "BONDING_GRADUATION" | "TOKEN_DATA" | "IMAGES" | "SETTINGS_UI" | "PI_BOT" | "OTHER"
interface Attachment { id: string; name: string; url: string; width: number; height: number; byteSize: number }
interface Message { id: string; author: "USER" | "SUPPORT" | "SYSTEM"; body: string; createdAt: string; attachments: Attachment[] }
interface Ticket { ticketNumber: string; category: Category; status: TicketStatus; priority: string; summary: string; revision: number; unread: boolean; createdAt: string; updatedAt: string; resolvedAt: string | null; messages?: Message[] }

const categoryLabels: Record<Category, string> = {
  FEED: "Feed", BONDING_GRADUATION: "Bonding / Graduation", TOKEN_DATA: "Token Data",
  IMAGES: "Images", SETTINGS_UI: "Settings / UI", PI_BOT: "PI Bot", OTHER: "Other",
}
const statusLabels: Record<TicketStatus, string> = { WAITING_FOR_SUPPORT: "Under review", WAITING_FOR_USER: "Waiting for you", RESOLVED: "Resolved" }

function collectDiagnostics(context: ReturnType<typeof useTokenContext>) {
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean } }).connection
  const filters = Object.fromEntries(Object.entries(context.queryOptions.filters).filter(([key]) => !["favoritesOnly"].includes(key)).map(([key, value]) => [key, value ?? null]))
  return {
    appVersion: packageInfo.version,
    capturedAt: new Date().toISOString(),
    route: `${location.origin}${location.pathname}`,
    browser: {
      userAgent: navigator.userAgent,
      platform: navigator.platform || "unknown",
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pixelRatio: window.devicePixelRatio,
      online: navigator.onLine,
      visibility: document.visibilityState,
      ...(connection ? { connection } : {}),
    },
    app: {
      page: context.queryOptions.page,
      pageSize: context.queryOptions.pageSize,
      timeRangeMinutes: context.queryOptions.timeRangeMinutes,
      sortBy: context.queryOptions.sortBy,
      sortOrder: context.queryOptions.sortOrder,
      filters,
      paused: context.isPaused,
      loading: context.isLoading,
      connected: context.isConnected,
      visibleCount: context.visibleTokens.length,
      totalCount: context.totalCount,
      totalPages: context.totalPages,
    },
    errors: getClientDiagnosticEvents(),
  }
}

async function ensureSession(): Promise<void> {
  const response = await fetch("/api/support/session", { method: "POST" })
  if (!response.ok) throw new Error("Could not start support session")
  const payload = await response.json() as { installationId: string }
  localStorage.setItem("pump-investments-support-id", payload.installationId)
}

function imageInput(files: FileList | File[]): File[] {
  return Array.from(files).filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type)).slice(0, 3)
}

function ImagePicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return <div className="space-y-2">
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(event) => onChange(imageInput(event.target.files ?? []))} />
    <button type="button" className="w-full rounded-md border border-dashed p-3 text-xs text-muted-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
      onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onChange(imageInput(event.dataTransfer.files)) }}>
      <ImagePlus className="mx-auto mb-1 h-5 w-5" /> Add screenshots by click, drop, or paste
    </button>
    {files.length > 0 && <div className="flex gap-2 overflow-x-auto">{files.map((file, index) => <div key={`${file.name}-${file.lastModified}`} className="relative shrink-0">
      <img src={URL.createObjectURL(file)} alt={`Selected screenshot ${index + 1}`} className="h-16 w-16 rounded border object-cover" />
      <button type="button" aria-label={`Remove ${file.name}`} className="absolute -right-1 -top-1 rounded-full bg-background p-0.5 shadow" onClick={() => onChange(files.filter((_, item) => item !== index))}><X className="h-3 w-3" /></button>
    </div>)}</div>}
  </div>
}

export function SupportTicketSection() {
  const tokenContext = useTokenContext()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [expanded, setExpanded] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [active, setActive] = useState<Ticket | null>(null)
  const [category, setCategory] = useState<Category>("FEED")
  const [body, setBody] = useState("")
  const [reply, setReply] = useState("")
  const [images, setImages] = useState<File[]>([])
  const [replyImages, setReplyImages] = useState<File[]>([])
  const [attachDiagnostics, setAttachDiagnostics] = useState(false)
  const [busy, setBusy] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState("")
  const turnstileHost = useRef<HTMLDivElement>(null)
  const turnstileWidget = useRef<string | null>(null)

  useEffect(() => {
    const siteKey = process.env.NEXT_PUBLIC_SUPPORT_TURNSTILE_SITE_KEY
    if (!createOpen || !siteKey || !turnstileHost.current) return
    let cancelled = false
    const render = () => {
      const api = (window as Window & { turnstile?: { render: (element: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void } }).turnstile
      if (!api || !turnstileHost.current || cancelled || turnstileWidget.current) return
      turnstileWidget.current = api.render(turnstileHost.current, { sitekey: siteKey, size: "flexible", callback: (token: string) => setTurnstileToken(token), "expired-callback": () => setTurnstileToken("") })
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-pump-turnstile]')
    if (existing) render()
    else {
      const script = document.createElement("script")
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
      script.async = true
      script.defer = true
      script.dataset.pumpTurnstile = "true"
      script.addEventListener("load", render, { once: true })
      document.head.appendChild(script)
    }
    return () => {
      cancelled = true
      const api = (window as Window & { turnstile?: { remove: (id: string) => void } }).turnstile
      if (api && turnstileWidget.current) api.remove(turnstileWidget.current)
      turnstileWidget.current = null
      setTurnstileToken("")
    }
  }, [createOpen])

  const refresh = useCallback(async () => {
    try {
      await ensureSession()
      const response = await fetch("/api/support/tickets", { cache: "no-store" })
      if (!response.ok) throw new Error("Could not load tickets")
      setTickets(((await response.json()) as { tickets: Ticket[] }).tickets)
    } catch (error) { recordClientDiagnostic({ kind: "support", message: error instanceof Error ? error.message : "Support refresh failed", url: "/api/support/tickets" }) }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh() }, 30_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    if (!active) return
    const ticketNumber = active.ticketNumber
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return
      const response = await fetch(`/api/support/tickets/${ticketNumber}`, { cache: "no-store" }).catch(() => null)
      if (response?.ok) setActive(((await response.json()) as { ticket: Ticket }).ticket)
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [active?.ticketNumber])

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const pasted = imageInput(Array.from(event.clipboardData?.files ?? []))
      if (pasted.length) {
        if (createOpen) setImages(pasted)
        else if (active) setReplyImages(pasted)
      }
    }
    window.addEventListener("paste", paste)
    return () => window.removeEventListener("paste", paste)
  }, [active, createOpen])

  const openTicket = async (ticket: Ticket) => {
    const response = await fetch(`/api/support/tickets/${ticket.ticketNumber}`, { cache: "no-store" })
    if (!response.ok) return toast({ title: "Could not open ticket", variant: "destructive" })
    const detail = ((await response.json()) as { ticket: Ticket }).ticket
    setActive(detail)
    await fetch(`/api/support/tickets/${ticket.ticketNumber}/read`, { method: "POST" })
    void refresh()
  }

  const submit = async () => {
    setBusy(true)
    try {
      const form = new FormData()
      form.set("payload", JSON.stringify({ category, body, frontend: collectDiagnostics(tokenContext), ...(turnstileToken ? { turnstileToken } : {}) }))
      images.forEach((image) => form.append("images", image))
      const response = await fetch("/api/support/tickets", { method: "POST", body: form })
      const payload = await response.json().catch(() => ({})) as { error?: string; ticket?: Ticket }
      if (!response.ok || !payload.ticket) throw new Error(payload.error ?? "Could not submit report")
      setBody(""); setImages([]); setCreateOpen(false); setActive(payload.ticket); await refresh()
      toast({ title: `${payload.ticket.ticketNumber} submitted`, description: "Your diagnostic snapshot was attached." })
    } catch (error) { toast({ title: "Report not submitted", description: error instanceof Error ? error.message : "Try again", variant: "destructive" }) }
    finally { setBusy(false) }
  }

  const submitReply = async () => {
    if (!active) return
    setBusy(true)
    try {
      const form = new FormData()
      form.set("payload", JSON.stringify({ body: reply, ...(attachDiagnostics ? { frontend: collectDiagnostics(tokenContext) } : {}) }))
      replyImages.forEach((image) => form.append("images", image))
      const response = await fetch(`/api/support/tickets/${active.ticketNumber}/messages`, { method: "POST", body: form })
      const payload = await response.json().catch(() => ({})) as { error?: string; ticket?: Ticket }
      if (!response.ok || !payload.ticket) throw new Error(payload.error ?? "Could not add reply")
      setActive(payload.ticket); setReply(""); setReplyImages([]); setAttachDiagnostics(false); await refresh()
    } catch (error) { toast({ title: "Reply not sent", description: error instanceof Error ? error.message : "Try again", variant: "destructive" }) }
    finally { setBusy(false) }
  }

  const removeTicket = async (ticket: Ticket) => {
    if (!window.confirm(`Permanently delete ${ticket.ticketNumber} and all screenshots?`)) return
    const response = await fetch(`/api/support/tickets/${ticket.ticketNumber}`, { method: "DELETE" })
    if (!response.ok) return toast({ title: "Ticket was not deleted", variant: "destructive" })
    if (active?.ticketNumber === ticket.ticketNumber) setActive(null)
    await refresh()
  }

  const shown = expanded ? tickets : tickets.slice(0, 3)
  return <section className="space-y-3 rounded-lg border p-3" aria-labelledby="problem-reporting-title">
    <div className="flex items-center justify-between gap-2">
      <div><h3 id="problem-reporting-title" className="text-sm font-semibold">Report a Problem</h3><p className="text-xs text-muted-foreground">Send a report with safe diagnostics and screenshots.</p></div>
      <Button size="sm" onClick={() => setCreateOpen(true)}><Bug className="mr-1 h-4 w-4" /> Report</Button>
    </div>
    {shown.map((ticket) => <div key={ticket.ticketNumber} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
      <button className="min-w-0 flex-1 text-left" onClick={() => void openTicket(ticket)}>
        <span className="flex items-center gap-1 font-medium">{ticket.unread && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread support reply" />}{ticket.ticketNumber} · {statusLabels[ticket.status]}</span>
        <span className="block truncate text-muted-foreground">{ticket.summary} · {new Date(ticket.updatedAt).toLocaleDateString()}</span>
      </button>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={`Delete ${ticket.ticketNumber}`} onClick={() => void removeTicket(ticket)}><Trash2 className="h-3.5 w-3.5" /></Button>
    </div>)}
    {tickets.length > 3 && <Button variant="ghost" size="sm" className="w-full" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show recent" : `View all (${tickets.length})`}<ChevronDown className={`ml-1 h-3 w-3 ${expanded ? "rotate-180" : ""}`} /></Button>}

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Report a Problem</DialogTitle><DialogDescription>Describe what happened. Current app and service health information will be attached automatically.</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1"><Label>Area</Label><Select value={category} onValueChange={(value) => setCategory(value as Category)}><SelectTrigger aria-label="Problem area"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(categoryLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label htmlFor="problem-description">What happened?</Label><Textarea id="problem-description" rows={6} maxLength={5000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Tell us what you expected and what actually happened..." /></div>
        <ImagePicker files={images} onChange={setImages} />
        {process.env.NEXT_PUBLIC_SUPPORT_TURNSTILE_SITE_KEY && <div ref={turnstileHost} aria-label="Human verification" />}
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">Diagnostics included</summary><p className="mt-1">App version, current filters, feed connection, browser/device class, service health, and recent sanitized errors. Never includes favorites, token lists, chat, wallet data, cookies, storage contents, or your full IP address.</p></details>
      </div>
      <DialogFooter><Button disabled={busy || body.trim().length < 10 || (Boolean(process.env.NEXT_PUBLIC_SUPPORT_TURNSTILE_SITE_KEY) && !turnstileToken)} onClick={() => void submit()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Submit report</Button></DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={Boolean(active)} onOpenChange={(open) => !open && setActive(null)}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
      {active && <><DialogHeader><DialogTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5" />{active.ticketNumber}</DialogTitle><DialogDescription>{categoryLabels[active.category]} · {statusLabels[active.status]} · Updated {new Date(active.updatedAt).toLocaleString()}</DialogDescription></DialogHeader>
      <div className="space-y-3">{active.messages?.map((message) => <article key={message.id} className={`rounded-lg border p-3 text-sm ${message.author === "SUPPORT" ? "bg-primary/5" : "bg-muted/30"}`}><div className="mb-1 text-xs font-semibold">{message.author === "SUPPORT" ? "Pump.Investments Support" : "You"} · {new Date(message.createdAt).toLocaleString()}</div><p className="whitespace-pre-wrap break-words">{message.body}</p>{message.attachments.length > 0 && <div className="mt-2 flex gap-2 overflow-x-auto">{message.attachments.map((attachment) => <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer"><img src={attachment.url} alt={attachment.name} className="h-24 w-24 rounded border object-cover" /></a>)}</div>}</article>)}</div>
      <div className="space-y-3 border-t pt-3"><Textarea rows={4} maxLength={5000} value={reply} onChange={(event) => setReply(event.target.value)} placeholder={active.status === "RESOLVED" ? "Reply to reopen this ticket..." : "Add more information..."} /><ImagePicker files={replyImages} onChange={setReplyImages} /><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={attachDiagnostics} onChange={(event) => setAttachDiagnostics(event.target.checked)} />Attach current diagnostics</label><div className="flex justify-between"><Button variant="outline" size="sm" onClick={() => void openTicket(active)}><RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh</Button><Button size="sm" disabled={busy || !reply.trim()} onClick={() => void submitReply()}><Send className="mr-1 h-3.5 w-3.5" />Send</Button></div></div></>}
    </DialogContent></Dialog>
  </section>
}
