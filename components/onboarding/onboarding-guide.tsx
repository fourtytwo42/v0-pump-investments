"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { db } from "@/lib/db"
import { X } from "lucide-react"
import { OnboardingStep } from "./onboarding-step"
import { useOnboardingStore } from "./onboarding-store"

// Updated steps with combined token status icons step
const steps = [
  {
    title: "Welcome to Pump.Investments Lite!",
    description:
      "Let's take a quick tour to help you get the most out of this dashboard. You can skip this guide anytime.",
    target: null, // No specific target for the welcome step
    placement: "center",
  },
  {
    title: "Time Range",
    description: "Select a time range to filter token data. This determines how far back in time we look for trades.",
    target: "[data-onboarding='time-range']",
    placement: "bottom",
  },
  {
    title: "Sort Options",
    description: "Sort tokens by different metrics like Market Cap, Volume, or Unique Buyers.",
    target: "[data-onboarding='sort-by']",
    placement: "bottom",
  },
  {
    title: "Pause/Resume",
    description: "Pause or resume real-time data updates when you want to analyze the current state.",
    target: "[data-onboarding='pause-button']",
    placement: "bottom",
  },
  {
    title: "Settings",
    description:
      "Access important settings like tokens per page, filters for KOTH tokens, minimum market cap, and more.",
    target: "[data-onboarding='settings-button']",
    placement: "bottom",
  },
  {
    title: "Changelog",
    description:
      "Click this button to view the history of updates and new features. The changelog shows version history with new features, improvements, and bug fixes organized by release date.",
    target: "[data-onboarding='changelog-button']",
    placement: "left",
  },
  {
    title: "Roadmap",
    description:
      "Click this button to see what features are planned for future releases. The roadmap shows upcoming features organized by status: in-progress, planned, and under consideration.",
    target: "[data-onboarding='roadmap-button']",
    placement: "left",
  },
  {
    title: "Telegram Community",
    description:
      "Join our Telegram group to connect with other users, get support, and stay updated on the latest news and announcements.",
    target: "a[href*='t.me']",
    placement: "left",
  },
  {
    title: "Token Cards",
    description:
      "Each card shows key metrics for a token. The border color indicates the buy/sell ratio: green for high buy volume, red for high sell volume, and neutral for balanced trading.",
    target: "[data-onboarding='token-card']",
    placement: "top",
  },
  {
    title: "Token Status Icons",
    description:
      "These icons show token status: the crown indicates a 'King of the Hill' token with the highest market cap on pump.fun, while the small icon indicates tokens imported from elsewhere rather than created on pump.fun.",
    target:
      ".grid.grid-cols-1.sm\\:grid-cols-2.lg\\:grid-cols-3.xl\\:grid-cols-4 > div:nth-child(2) .p-3.pt-2.border-t .flex.items-center.gap-2",
    placement: "left",
  },
  {
    title: "Favoriting Tokens",
    description:
      "Click the star icon on a token card to add it to your favorites. Favorited tokens will be saved even when you close your browser.",
    target:
      ".grid.grid-cols-1.sm\\:grid-cols-2.lg\\:grid-cols-3.xl\\:grid-cols-4 > div:nth-child(2) .absolute.top-2.right-2", // Target the star button on the second card
    placement: "left", // Position to the left of the star to avoid covering it
  },
  {
    title: "Favorites Filter",
    description:
      "Click this button to show only your favorited tokens. The number indicates how many tokens you've added to favorites.",
    target: "[data-onboarding='favorites-button']",
    placement: "bottom",
  },
  {
    title: "You're all set!",
    description: "You now know the basics of Pump.Investments Lite. Enjoy exploring tokens on pump.fun!",
    target: null, // No specific target for the completion step
    placement: "center",
  },
]

// Add this function to handle special actions for certain steps
const executeStepAction = (action: string | undefined) => {
  // Function intentionally left empty to prevent automatic opening of panels
  // We'll just highlight the buttons without opening them
}

export function OnboardingGuide() {
  const [currentStep, setCurrentStep] = useState(0)
  const [isVisible, setIsVisible] = useState(true)
  const { setOnboardingActive } = useOnboardingStore()

  // Ensure the page is scrolled to the appropriate position when the step changes
  useEffect(() => {
    const currentStepData = steps[currentStep]

    // Execute the step action when the step changes
    executeStepAction(currentStepData.action)

    // Special handling for pagination step removed
  }, [currentStep])

  // Update the handleNext function to execute step actions
  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      // Execute any actions for the current step before moving to the next
      executeStepAction(steps[currentStep].action)
      setCurrentStep(currentStep + 1)
    } else {
      handleComplete()
    }
  }

  // Update the handlePrevious function to handle closing sheets when going back
  const handlePrevious = () => {
    if (currentStep > 0) {
      // If we're going back from a sheet view step, close the sheet
      const currentAction = steps[currentStep].action
      const prevAction = steps[currentStep - 1].action

      // If we're moving from a view step to an open step, or from an open step to a non-sheet step
      if (
        (currentAction === "view-changelog" && prevAction !== "open-changelog") ||
        (currentAction === "view-roadmap" && prevAction !== "open-roadmap") ||
        currentAction === "open-changelog" ||
        currentAction === "open-roadmap"
      ) {
        // Find and click the close button of the sheet
        const closeButton = document.querySelector("[data-onboarding-close]")
        if (closeButton instanceof HTMLElement) {
          closeButton.click()
        }
      }

      setCurrentStep(currentStep - 1)
    }
  }

  // Handle skip/complete
  const handleComplete = async () => {
    setIsVisible(false)
    // Mark onboarding as completed in the database
    await db.markOnboardingCompleted()
    // Update global state
    setOnboardingActive(false)
  }

  // Calculate progress percentage
  const progress = ((currentStep + 1) / steps.length) * 100

  // Get current step data
  const currentStepData = steps[currentStep]
  const isFirstStep = currentStep === 0
  const isLastStep = currentStep === steps.length - 1

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Render the step with its target highlight */}
          <OnboardingStep step={currentStepData} currentStep={currentStep} totalSteps={steps.length}>
            <div className="p-6 bg-background rounded-lg shadow-lg max-w-md w-full">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">{currentStepData.title}</h3>
                <Button variant="ghost" size="icon" onClick={handleComplete} className="h-8 w-8">
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close</span>
                </Button>
              </div>

              <p className="text-muted-foreground mb-6">{currentStepData.description}</p>

              <Progress value={progress} className="mb-6" />

              <div className="flex justify-between">
                <div>
                  {!isFirstStep && (
                    <Button variant="outline" onClick={handlePrevious}>
                      Previous
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  {!isLastStep && (
                    <Button variant="outline" onClick={handleComplete}>
                      Skip
                    </Button>
                  )}
                  <Button onClick={handleNext}>{isLastStep ? "Finish" : "Next"}</Button>
                </div>
              </div>
            </div>
          </OnboardingStep>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
