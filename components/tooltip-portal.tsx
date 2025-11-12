"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { createPortal } from "react-dom"

interface TooltipPortalProps {
  isOpen: boolean
  content: React.ReactNode
  targetRect: DOMRect | null
}

export function TooltipPortal({ isOpen, content, targetRect }: TooltipPortalProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  if (!mounted || !isOpen || !targetRect) return null

  // Calculate position to center over the target element
  const tooltipStyle: React.CSSProperties = {
    position: "fixed",
    zIndex: 9999,
    maxWidth: "300px",
    width: Math.min(targetRect.width * 0.9, 300),
    left: targetRect.left + targetRect.width / 2,
    top: targetRect.top + targetRect.height / 2,
    transform: "translate(-50%, -50%)",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    borderRadius: "0.375rem",
    padding: "0.75rem",
    boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
    border: "1px solid var(--border)",
  }

  return createPortal(<div style={tooltipStyle}>{content}</div>, document.body)
}
