"use client"

import type React from "react"

import { useEffect, useState, useRef } from "react"
import { motion } from "framer-motion"

interface OnboardingStepProps {
  step: {
    title: string
    description: string
    target: string | null
    placement: "top" | "right" | "bottom" | "left" | "middle" | "center"
  }
  currentStep: number
  totalSteps: number
  children: React.ReactNode
}

export function OnboardingStep({ step, currentStep, totalSteps, children }: OnboardingStepProps) {
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, height: 0 })
  const [contentPosition, setContentPosition] = useState({ top: 0, left: 0 })
  const contentRef = useRef<HTMLDivElement>(null)
  const hasScrolled = useRef(false)

  // Calculate positions based on target element
  useEffect(() => {
    if (!step.target) {
      // Center in the viewport for steps without a target
      setPosition({
        top: window.innerHeight / 2,
        left: window.innerWidth / 2,
        width: 0,
        height: 0,
      })
      setContentPosition({
        top: window.innerHeight / 2,
        left: window.innerWidth / 2,
      })
      // Reset scroll flag for next step
      hasScrolled.current = false
      return
    }

    const targetElement = document.querySelector(step.target)
    if (!targetElement) {
      console.warn(`Target element not found: ${step.target}`)
      // Reset scroll flag for next step
      hasScrolled.current = false
      return
    }

    const rect = targetElement.getBoundingClientRect()
    setPosition({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    })

    // Calculate content position based on placement
    if (contentRef.current) {
      const contentRect = contentRef.current.getBoundingClientRect()
      let top = 0
      let left = 0

      switch (step.placement) {
        case "top":
          if (step.target === "[data-onboarding='token-card']") {
            top = rect.top - contentRect.height - 24 // Extra space above token card
          } else {
            top = rect.top - contentRect.height - 16
          }
          left = rect.left + rect.width / 2 - contentRect.width / 2
          break
        case "right":
          top = rect.top + rect.height / 2 - contentRect.height / 2
          left = rect.right + 16

          // Special handling for sheet content
          if (
            step.target === "[data-onboarding='changelog-content']" ||
            step.target === "[data-onboarding='roadmap-content']"
          ) {
            // Position to the right of the sheet content, but not too far
            left = rect.right - rect.width / 4
          }
          break
        case "bottom":
          top = rect.bottom + 16
          left = rect.left + rect.width / 2 - contentRect.width / 2
          break
        case "left":
          top = rect.top + rect.height / 2 - contentRect.height / 2
          left = rect.left - contentRect.width - 16
          break
        case "middle":
        case "center":
          top = window.innerHeight / 2 - contentRect.height / 2
          left = window.innerWidth / 2 - contentRect.width / 2
          break
      }

      // Ensure content stays within viewport
      if (left < 16) left = 16
      if (left + contentRect.width > window.innerWidth - 16) {
        left = window.innerWidth - contentRect.width - 16
      }
      if (top < 16) top = 16
      if (top + contentRect.height > window.innerHeight - 16) {
        top = window.innerHeight - contentRect.height - 16
      }

      setContentPosition({ top, left })
    }
  }, [step, currentStep])

  // Handle scrolling separately after positions are calculated
  useEffect(() => {
    // Skip if we've already scrolled for this step or if there's no target
    if (hasScrolled.current || !step.target) return

    const targetElement = document.querySelector(step.target)
    if (!targetElement) return

    // Delay the scroll slightly to ensure positions are calculated
    const scrollTimeout = setTimeout(() => {
      if (step.target === "[data-onboarding='token-card']") {
        // For token card, get the featured card if available
        const featuredCard = document.getElementById("featured-token-card")
        const elementToScroll = featuredCard || targetElement

        // Calculate the ideal position - we want both the guide and the card visible
        const rect = elementToScroll.getBoundingClientRect()
        const guideHeight = contentRef.current?.getBoundingClientRect().height || 0

        // Calculate scroll position to center the card with space for the guide above
        const scrollPosition = window.scrollY + rect.top - window.innerHeight / 2 - guideHeight / 2

        // Smooth scroll to position
        window.scrollTo({
          top: Math.max(0, scrollPosition),
          behavior: "smooth",
        })
      } else if (step.target === "[data-onboarding='pagination']") {
        // Special handling for pagination
        const rect = targetElement.getBoundingClientRect()
        const guideHeight = contentRef.current?.getBoundingClientRect().height || 0

        // Position the pagination at the bottom of the viewport
        // with enough space for both the guide and the pagination controls
        const scrollPosition = window.scrollY + rect.top - window.innerHeight + rect.height + 150

        // Smooth scroll to position
        window.scrollTo({
          top: Math.max(0, scrollPosition),
          behavior: "smooth",
        })
      } else {
        // For other elements, just scroll them into view
        targetElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        })
      }

      hasScrolled.current = true
    }, 100)

    return () => clearTimeout(scrollTimeout)
  }, [step, contentPosition])

  // Reset scroll flag when step changes
  useEffect(() => {
    hasScrolled.current = false
  }, [currentStep])

  // For steps with a target, create spotlight effect
  if (step.target) {
    return (
      <>
        {/* Semi-transparent overlay with cutout for the target element */}
        <svg className="fixed inset-0 z-40 pointer-events-none" width="100%" height="100%">
          <defs>
            <mask id="spotlight">
              <rect width="100%" height="100%" fill="white" />
              <rect
                x={position.left - 8}
                y={position.top - 8}
                width={position.width + 16}
                height={position.height + 16}
                fill="black"
                rx="4"
              />
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(0, 0, 0, 0.75)" mask="url(#spotlight)" />
        </svg>

        {/* Highlight border around target */}
        <div
          className="fixed z-40 border-2 border-primary rounded-md pointer-events-none animate-pulse"
          style={{
            top: position.top - 8,
            left: position.left - 8,
            width: position.width + 16,
            height: position.height + 16,
            boxShadow: "0 0 0 4px rgba(59, 130, 246, 0.3)",
          }}
        />

        {/* Content positioned relative to target */}
        <motion.div
          ref={contentRef}
          className="fixed z-50"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
          style={{
            top: contentPosition.top,
            left: contentPosition.left,
          }}
        >
          {children}
        </motion.div>
      </>
    )
  }

  // For center steps (welcome and completion)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div
        ref={contentRef}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.3 }}
      >
        {children}
      </motion.div>
    </div>
  )
}
