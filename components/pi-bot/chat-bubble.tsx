"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Send, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { useChat } from "./use-chat"
import { Spinner } from "@/components/ui/spinner"
import { MarkdownRenderer } from "./markdown-renderer"
import { SuggestedPrompts } from "./suggested-prompts"
import Image from "next/image"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet"

interface Message {
  role: "user" | "assistant"
  content: string
}

export function ChatBubble() {
  const [input, setInput] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const { messages, sendMessage, isLoading, clearChatHistory } = useChat()
  const [hasError, setHasError] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector("[data-radix-scroll-area-viewport]")
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    }
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (input.trim() && !isLoading) {
      setHasError(false) // Reset error state
      sendMessage(input).catch((err) => {
        console.error("Error in chat submission:", err)
        setHasError(true)
      })
      setInput("")
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleSelectPrompt = (prompt: string) => {
    if (!isLoading) {
      sendMessage(prompt)
    }
  }

  // Show suggested prompts only when there are no messages or when explicitly requested
  const showSuggestedPrompts =
    messages.length === 0 || messages[messages.length - 1]?.content?.includes("Here are some questions you can ask")

  return (
    <>
      {/* Fixed chat button */}
      <div className="fixed bottom-4 right-4 z-40 md:bottom-6 md:right-6">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <Button
              className="h-14 w-14 rounded-full shadow-lg p-0 overflow-hidden"
              aria-label="Chat with PI Bot"
              data-onboarding="pi-bot-button"
            >
              <Image src="/pi-bot-avatar.png" alt="PI Bot" width={56} height={56} className="rounded-full" />
            </Button>
          </SheetTrigger>
          <SheetContent className="flex flex-col p-0 w-full sm:max-w-md overflow-hidden">
            <SheetHeader className="p-4 border-b bg-primary/5 shrink-0">
              <div className="flex items-center">
                <div className="flex items-center gap-2">
                  <Image src="/pi-bot-avatar.png" alt="PI Bot" width={28} height={28} className="rounded-full" />
                  <SheetTitle>PI Bot</SheetTitle>
                </div>
              </div>
              <div className="flex items-center justify-between mt-2">
                <SheetDescription>Your personal token analysis assistant</SheetDescription>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearChatHistory}
                  className="h-8 gap-1 text-xs"
                  title="Clear chat history"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  Clear History
                </Button>
              </div>
            </SheetHeader>

            {/* Chat messages */}
            <ScrollArea className="flex-1 p-4 overflow-y-auto" ref={scrollAreaRef}>
              <div className="space-y-4 w-full">
                {messages.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    <Image
                      src="/pi-bot-avatar.png"
                      alt="PI Bot"
                      width={64}
                      height={64}
                      className="mx-auto mb-2 rounded-full"
                    />
                    <p className="text-sm">Hi! I'm PI Bot, your token analysis assistant.</p>
                    <p className="text-sm mt-1">Ask me about tokens, market trends, or trading strategies!</p>
                  </div>
                ) : (
                  messages.map((message, index) => (
                    <div
                      key={index}
                      className={cn("flex gap-2", message.role === "user" ? "justify-end" : "justify-start")}
                    >
                      {message.role === "assistant" && (
                        <Image
                          src="/pi-bot-avatar.png"
                          alt="PI Bot"
                          width={32}
                          height={32}
                          className="rounded-full self-start mt-1 flex-shrink-0"
                        />
                      )}
                      <div
                        className={cn(
                          "flex flex-col max-w-[75%] rounded-lg p-3 break-words overflow-hidden",
                          message.role === "user"
                            ? "bg-primary text-primary-foreground rounded-tr-none"
                            : "bg-muted text-foreground rounded-tl-none",
                        )}
                      >
                        <span className="text-xs opacity-70 mb-1">{message.role === "user" ? "You" : "PI Bot"}</span>
                        {message.role === "user" ? (
                          <div className="whitespace-pre-wrap text-sm overflow-hidden text-break">
                            {message.content}
                          </div>
                        ) : (
                          <div className="overflow-hidden">
                            <MarkdownRenderer content={message.content} className="max-w-full overflow-x-auto" />
                          </div>
                        )}
                      </div>
                      {message.role === "user" && (
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center self-start mt-1 flex-shrink-0">
                          <span className="text-xs font-medium text-primary">You</span>
                        </div>
                      )}
                    </div>
                  ))
                )}
                {isLoading && (
                  <div className="flex gap-2">
                    <Image
                      src="/pi-bot-avatar.png"
                      alt="PI Bot"
                      width={32}
                      height={32}
                      className="rounded-full self-start mt-1 flex-shrink-0"
                    />
                    <div className="flex flex-col max-w-[75%] rounded-lg p-3 bg-muted text-foreground rounded-tl-none">
                      <span className="text-xs opacity-70 mb-1">PI Bot</span>
                      <div className="flex items-center gap-2">
                        <Spinner size="sm" />
                        <span className="text-sm">Thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
                {hasError && (
                  <div className="text-center text-destructive py-4 px-3 bg-destructive/10 rounded-md mx-auto my-2 max-w-[90%]">
                    <p className="text-sm font-medium">Connection error</p>
                    <p className="text-xs mt-1">
                      Unable to connect to AI services. Please check your internet connection or try again later.
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Suggested Prompts */}
            {showSuggestedPrompts && (
              <div className="border-t shrink-0">
                <SuggestedPrompts onSelectPrompt={handleSelectPrompt} />
              </div>
            )}

            {/* Input area */}
            <form onSubmit={handleSubmit} className="p-4 border-t mt-auto shrink-0">
              <div className="flex gap-2">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about tokens..."
                  className="min-h-[40px] max-h-[120px] resize-none"
                  disabled={isLoading}
                />
                <Button type="submit" size="icon" disabled={!input.trim() || isLoading}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </form>
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
