"use client"

import Markdown from "markdown-to-jsx"
import { cn } from "@/lib/utils"

interface MarkdownRendererProps {
  content: string
  className?: string
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn("markdown-content text-sm", className)}>
      <Markdown
        options={{
          overrides: {
            h1: {
              component: ({ children, ...props }) => (
                <h1 className="text-xl font-bold mt-4 mb-2 break-words" {...props}>
                  {children}
                </h1>
              ),
            },
            h2: {
              component: ({ children, ...props }) => (
                <h2 className="text-lg font-bold mt-3 mb-2 break-words" {...props}>
                  {children}
                </h2>
              ),
            },
            h3: {
              component: ({ children, ...props }) => (
                <h3 className="text-base font-bold mt-2 mb-1 break-words" {...props}>
                  {children}
                </h3>
              ),
            },
            p: {
              component: ({ children, ...props }) => (
                <p className="mb-2 break-words" {...props}>
                  {children}
                </p>
              ),
            },
            a: {
              component: ({ children, ...props }) => (
                <a
                  className="text-primary hover:underline break-words overflow-hidden text-ellipsis"
                  target="_blank"
                  rel="noopener noreferrer"
                  {...props}
                >
                  {children}
                </a>
              ),
            },
            ul: {
              component: ({ children, ...props }) => (
                <ul className="list-disc pl-5 mb-2" {...props}>
                  {children}
                </ul>
              ),
            },
            ol: {
              component: ({ children, ...props }) => (
                <ol className="list-decimal pl-5 mb-2" {...props}>
                  {children}
                </ol>
              ),
            },
            li: {
              component: ({ children, ...props }) => (
                <li className="mb-1 break-words" {...props}>
                  {children}
                </li>
              ),
            },
            table: {
              component: ({ children, ...props }) => (
                <div className="overflow-x-auto mb-2 max-w-full">
                  <table className="w-full border-collapse text-sm" {...props}>
                    {children}
                  </table>
                </div>
              ),
            },
            thead: {
              component: ({ children, ...props }) => (
                <thead className="bg-muted/50" {...props}>
                  {children}
                </thead>
              ),
            },
            tbody: {
              component: ({ children, ...props }) => <tbody {...props}>{children}</tbody>,
            },
            tr: {
              component: ({ children, ...props }) => (
                <tr className="border-b border-border" {...props}>
                  {children}
                </tr>
              ),
            },
            th: {
              component: ({ children, ...props }) => (
                <th className="px-2 py-1 text-left font-medium break-words" {...props}>
                  {children}
                </th>
              ),
            },
            td: {
              component: ({ children, ...props }) => (
                <td className="px-2 py-1 break-words" {...props}>
                  {children}
                </td>
              ),
            },
            code: {
              component: ({ children, className, ...props }) => {
                // Check if this is a code block or inline code
                const match = /language-(\w+)/.exec(className || "")
                return match ? (
                  <div className="rounded bg-muted p-2 my-2 overflow-x-auto max-w-full">
                    <pre className="text-xs overflow-x-auto">
                      <code className={className} {...props}>
                        {children}
                      </code>
                    </pre>
                  </div>
                ) : (
                  <code className="bg-muted px-1 py-0.5 rounded text-xs break-words" {...props}>
                    {children}
                  </code>
                )
              },
            },
            blockquote: {
              component: ({ children, ...props }) => (
                <blockquote
                  className="border-l-4 border-primary/30 pl-4 italic text-muted-foreground my-2 break-words"
                  {...props}
                >
                  {children}
                </blockquote>
              ),
            },
            hr: {
              component: ({ ...props }) => <hr className="my-4 border-border" {...props} />,
            },
            img: {
              component: ({ alt, ...props }) => (
                <img alt={alt || "Image"} className="max-w-full h-auto rounded my-2" {...props} />
              ),
            },
          },
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}
