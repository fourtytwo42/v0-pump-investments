"use client"

import { Button } from "@/components/ui/button"

interface SuggestedPromptsProps {
  onSelectPrompt: (prompt: string) => void
}

export function SuggestedPrompts({ onSelectPrompt }: SuggestedPromptsProps) {
  const prompts = [
    "What tokens are trending today?",
    "Explain the buy/sell ratio",
    "How do I set up price alerts?",
    "What is KOTH?",
    "Analyze the top token by volume",
  ]

  return (
    <div className="p-4 border-t bg-muted/30">
      <p className="text-xs text-muted-foreground mb-2">Suggested questions:</p>
      <div className="flex flex-wrap gap-2">
        {prompts.map((prompt, index) => (
          <Button
            key={index}
            variant="outline"
            size="sm"
            className="text-xs py-1 h-auto"
            onClick={() => onSelectPrompt(prompt)}
          >
            {prompt}
          </Button>
        ))}
      </div>
    </div>
  )
}
