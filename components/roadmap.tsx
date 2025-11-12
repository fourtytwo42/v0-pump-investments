"use client"

import { Badge } from "@/components/ui/badge"

/**
 * ROADMAP GUIDELINES
 * =================
 *
 * The roadmap shows users what features are planned for future releases.
 * When updating the roadmap:
 *
 * 1. Keep items organized by status (planned, in-progress, considering)
 * 2. Add estimated version numbers for planned features
 * 3. When a feature is implemented, remove it from the roadmap and add it to the changelog
 * 4. Update the roadmap whenever the product strategy changes
 *
 * Remember: The roadmap is a communication tool that sets user expectations.
 * Be realistic about timelines and priorities.
 */

// Define the roadmap item type
interface RoadmapItem {
  title: string
  description: string
  targetVersion?: string
  status: "planned" | "in-progress" | "considering"
  category: "feature" | "improvement" | "infrastructure"
}

// Update the roadmap data to reflect current version (3.0.24) and adjust planned features
const roadmapData: RoadmapItem[] = [
  // In Progress - Features actively being worked on
  {
    title: "Advanced Token Analytics",
    description: "Detailed price charts and trading pattern analysis for each token",
    targetVersion: "3.0.25",
    status: "in-progress",
    category: "feature",
  },
  {
    title: "Enhanced Filtering Options",
    description: "More granular filters for finding tokens based on specific criteria",
    targetVersion: "3.0.26",
    status: "in-progress",
    category: "improvement",
  },

  // Planned - Features that are definitely coming in specific versions
  {
    title: "Trade History Timeline",
    description: "View detailed trade history for tokens with timeline visualization",
    targetVersion: "3.0.27",
    status: "planned",
    category: "feature",
  },
  {
    title: "Customizable Dashboard Layout",
    description: "Arrange and resize token cards and widgets to your preference",
    targetVersion: "3.0.28",
    status: "planned",
    category: "feature",
  },
  {
    title: "Desktop Notifications",
    description: "Use the browser Notification API for better alert experience",
    targetVersion: "3.0.29",
    status: "planned",
    category: "improvement",
  },

  // Considering - Features that might be added in the future
  {
    title: "Social Integration",
    description: "Share tokens and insights directly to social platforms",
    status: "considering",
    category: "feature",
  },
  {
    title: "Wallet Connection",
    description: "Connect your wallet to track your own token holdings",
    status: "considering",
    category: "feature",
  },
  {
    title: "Token Comparison Tool",
    description: "Side-by-side comparison of multiple tokens",
    status: "considering",
    category: "feature",
  },
  {
    title: "Market Sentiment Analysis",
    description: "AI-powered analysis of market sentiment for tokens",
    status: "considering",
    category: "feature",
  },
  {
    title: "Mobile App",
    description: "Native mobile applications for iOS and Android",
    status: "considering",
    category: "infrastructure",
  },
  {
    title: "Theme Customization",
    description: "Create and save custom color themes",
    status: "considering",
    category: "improvement",
  },
]

export function Roadmap() {
  // Function to get the badge color based on status
  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "planned":
        return "default"
      case "in-progress":
        return "secondary"
      case "considering":
        return "outline"
      default:
        return "default"
    }
  }

  // Function to get the badge color based on category
  const getCategoryBadgeVariant = (category: string) => {
    switch (category) {
      case "feature":
        return "default"
      case "improvement":
        return "secondary"
      case "infrastructure":
        return "outline"
      default:
        return "default"
    }
  }

  // Group roadmap items by status
  const planned = roadmapData.filter((item) => item.status === "planned")
  const inProgress = roadmapData.filter((item) => item.status === "in-progress")
  const considering = roadmapData.filter((item) => item.status === "considering")

  return (
    <div className="space-y-8 pb-6">
      {/* In Progress Section */}
      <div className="space-y-2">
        <h3 className="text-lg font-bold flex items-center">
          <span className="inline-block w-3 h-3 bg-yellow-400 rounded-full mr-2"></span>
          In Progress
        </h3>
        <p className="text-sm text-muted-foreground mb-4">Features we're actively working on right now.</p>
        <ul className="space-y-4">
          {inProgress.map((item, index) => (
            <li key={index} className="border rounded-md p-3 bg-background/50">
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-medium">{item.title}</h4>
                {item.targetVersion && <Badge variant="outline">v{item.targetVersion}</Badge>}
              </div>
              <p className="text-sm text-muted-foreground mb-2">{item.description}</p>
              <div className="flex gap-2">
                <Badge variant={getStatusBadgeVariant(item.status)}>In Progress</Badge>
                <Badge variant={getCategoryBadgeVariant(item.category)}>
                  {item.category.charAt(0).toUpperCase() + item.category.slice(1)}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Planned Section */}
      <div className="space-y-2">
        <h3 className="text-lg font-bold flex items-center">
          <span className="inline-block w-3 h-3 bg-green-500 rounded-full mr-2"></span>
          Planned
        </h3>
        <p className="text-sm text-muted-foreground mb-4">Features scheduled for upcoming releases.</p>
        <ul className="space-y-4">
          {planned.map((item, index) => (
            <li key={index} className="border rounded-md p-3 bg-background/50">
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-medium">{item.title}</h4>
                {item.targetVersion && <Badge variant="outline">v{item.targetVersion}</Badge>}
              </div>
              <p className="text-sm text-muted-foreground mb-2">{item.description}</p>
              <div className="flex gap-2">
                <Badge variant={getStatusBadgeVariant(item.status)}>Planned</Badge>
                <Badge variant={getCategoryBadgeVariant(item.category)}>
                  {item.category.charAt(0).toUpperCase() + item.category.slice(1)}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Considering Section */}
      <div className="space-y-2">
        <h3 className="text-lg font-bold flex items-center">
          <span className="inline-block w-3 h-3 bg-blue-400 rounded-full mr-2"></span>
          Considering
        </h3>
        <p className="text-sm text-muted-foreground mb-4">Features we're exploring for future releases.</p>
        <ul className="space-y-4">
          {considering.map((item, index) => (
            <li key={index} className="border rounded-md p-3 bg-background/50">
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-medium">{item.title}</h4>
                {item.targetVersion && <Badge variant="outline">v{item.targetVersion}</Badge>}
              </div>
              <p className="text-sm text-muted-foreground mb-2">{item.description}</p>
              <div className="flex gap-2">
                <Badge variant={getStatusBadgeVariant(item.status)}>Considering</Badge>
                <Badge variant={getCategoryBadgeVariant(item.category)}>
                  {item.category.charAt(0).toUpperCase() + item.category.slice(1)}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
