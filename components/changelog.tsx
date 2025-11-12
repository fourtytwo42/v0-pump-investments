"use client"

/**
 * VERSIONING GUIDELINES
 * =====================
 *
 * Version Format: MAJOR.MINOR.PATCH
 *
 * MAJOR version: Significant redesigns or feature overhauls that change how users interact with the app
 * MINOR version: New features or significant enhancements to existing features
 * PATCH version: Bug fixes, minor UI adjustments, and small improvements
 *
 * When adding a new entry:
 * 1. Add it at the TOP of the changelogData array
 * 2. Increment the appropriate version number
 * 3. Use the current date in the format "MMMM DD, YYYY"
 * 4. Categorize changes as "New", "Improved", or "Fixed"
 * 5. Provide clear, concise descriptions
 */

type ChangeType = "new" | "improved" | "fixed"

interface ChangelogEntry {
  version: string
  date: string
  changes: {
    type: ChangeType
    description: string
  }[]
}

export const changelogData: ChangelogEntry[] = [
  {
    version: "3.0.27",
    date: "June 2, 2025",
    changes: [
      {
        type: "fixed",
        description:
          "Prevented duplicate WebSocket trades from being stored so tokens remain correctly grouped by mint.",
      },
      {
        type: "improved",
        description:
          "Added on-demand token metadata loading that triggers only for tokens visible on the dashboard and caches responses.",
      },
      {
        type: "improved",
        description:
          "Persisted fetched metadata locally to reuse cached details across re-renders and reduce repeated metadata requests.",
      },
    ],
  },
  {
    version: "3.0.26",
    date: "June 1, 2025",
    changes: [
      {
        type: "improved",
        description:
          "Combined Unique Traders filters into a single dual-handle range slider with non-linear scale for precise control at lower values.",
      },
      {
        type: "improved",
        description:
          "Converted Market Cap filter to dual-handle range slider with non-linear scale ($3k-$1M+), providing fine-grained control for common market cap ranges.",
      },
      {
        type: "improved",
        description:
          "Converted Trade Amount filter to dual-handle range slider with non-linear scale ($0-$5000+), optimized for lower value precision.",
      },
      {
        type: "improved",
        description:
          "Set default filter values to show all tokens for new users, ensuring a better first-time experience.",
      },
      {
        type: "improved",
        description: "Removed Trade Retention Period slider and fixed retention at 1 hour for all users.",
      },
      {
        type: "new",
        description:
          "Added Reset Settings button with confirmation dialog to clear all settings, favorites, and alerts (alert history preserved).",
      },
    ],
  },
  {
    version: "3.0.25",
    date: "June 1, 2025",
    changes: [
      {
        type: "new",
        description:
          "Added 'Maximum Unique Traders' filter slider to settings with non-linear scale for easier selection of lower values (1-50 with fine precision, 50-500+ with larger increments).",
      },
      {
        type: "improved",
        description:
          "Enhanced filter controls to display '500+' when maxed, effectively disabling the filter to show tokens with any number of unique traders.",
      },
      {
        type: "improved",
        description: "Improved slider usability with better scaling for commonly used values like 10 or 20.",
      },
    ],
  },
  {
    version: "3.0.24",
    date: "May 31, 2025",
    changes: [
      {
        type: "new",
        description:
          "Added BonkBot integration with clickable logo overlay on token cards that links to BonkBot trading page.",
      },
      {
        type: "new",
        description:
          "Added 'Integrations' section to settings with toggle to enable/disable BonkBot logo display (disabled by default).",
      },
      {
        type: "improved",
        description: "Updated versioning across the application to 3.0.24.",
      },
    ],
  },
  {
    version: "3.0.23",
    date: "May 31, 2025",
    changes: [
      {
        type: "new",
        description: "Added 'Last Trade' sorting option to display tokens with the oldest trades first.",
      },
      {
        type: "improved",
        description: "Updated versioning across the application to 3.0.23.",
      },
    ],
  },
  {
    version: "3.0.22",
    date: "May 31, 2025",
    changes: [
      {
        type: "new",
        description: "Added 'Token Age' sorting option to display newest tokens first.",
      },
      {
        type: "improved",
        description:
          "WebSocket connection indicator text changed to 'Connected' (from 'Live') and pulsing animation removed for a steady light.",
      },
      {
        type: "improved",
        description:
          "WebSocket connection indicator tooltip now provides more specific information about the connection status to pump.fun.",
      },
      {
        type: "fixed",
        description:
          "'What's New' indicator (red dot) on Changelog button now correctly displays for unread updates, especially for new users or after clearing local storage.",
      },
      {
        type: "improved",
        description: "Updated versioning across the application to 3.0.22.",
      },
    ],
  },
  {
    version: "3.0.21",
    date: "May 31, 2025",
    changes: [
      {
        type: "new",
        description: "Added WebSocket connection status indicator in the header (Live/Offline dot with tooltip).",
      },
      {
        type: "new",
        description:
          "Implemented a 'What's New' indicator (red dot) on the Changelog button to notify users of unread updates.",
      },
      {
        type: "improved",
        description: "Updated versioning across the application.",
      },
    ],
  },
  {
    version: "3.0.20",
    date: "May 28, 2025",
    changes: [
      {
        type: "improved",
        description: "Redesigned favorite star icon to be more minimal and positioned in the top-right corner",
      },
      {
        type: "improved",
        description: "Enhanced token card visual hierarchy with cleaner design elements",
      },
    ],
  },
  {
    version: "3.0.19",
    date: "May 28, 2025",
    changes: [
      {
        type: "improved",
        description: "Repositioned token symbol badge to appear next to creator's address for better readability",
      },
      {
        type: "improved",
        description: "Enhanced token card layout with better spacing and alignment of information",
      },
    ],
  },
  {
    version: "3.0.18",
    date: "May 22, 2025",
    changes: [
      {
        type: "new",
        description: "Added clickable description drawers to token cards for tokens with descriptions",
      },
      {
        type: "improved",
        description: "Replaced hover-based tooltips with stable drawer interface to prevent flashing issues",
      },
      {
        type: "improved",
        description: "Enhanced token card design with thin divider and overlay drawer system",
      },
      {
        type: "fixed",
        description: "Fixed description display issues caused by frequent DOM updates",
      },
    ],
  },
  {
    version: "3.0.17",
    date: "May 21, 2025",
    changes: [
      {
        type: "new",
        description: "Added Vercel Web Analytics for visitor tracking and insights",
      },
      {
        type: "improved",
        description: "Enhanced performance monitoring capabilities",
      },
    ],
  },
  {
    version: "3.0.16",
    date: "May 11, 2025",
    changes: [
      {
        type: "improved",
        description: "Enhanced SEO metadata for better search engine visibility",
      },
      {
        type: "new",
        description: "Added social media optimization with Open Graph and Twitter Card metadata",
      },
      {
        type: "new",
        description: "Created custom OG image for rich social media sharing",
      },
      {
        type: "new",
        description: "Implemented structured data (JSON-LD) for rich search results",
      },
      {
        type: "improved",
        description: "Optimized mobile experience with proper viewport settings",
      },
      {
        type: "improved",
        description: "Converted PI Bot chat to a drawer interface for better mobile experience",
      },
      {
        type: "fixed",
        description: "Fixed image loading issues with KOTH and external token icons",
      },
      {
        type: "fixed",
        description: "Resolved layout shift issues in token cards",
      },
    ],
  },
  {
    version: "3.0.15",
    date: "May 8, 2025",
    changes: [
      {
        type: "new",
        description: "Added alert history to track past triggered alerts",
      },
      {
        type: "new",
        description: "Created alert management section to view and manage all alerts",
      },
      {
        type: "improved",
        description: "Enhanced alert notification system with sound options",
      },
      {
        type: "improved",
        description: "Optimized token data processing for better performance",
      },
      {
        type: "fixed",
        description: "Fixed issue with alert settings not saving properly",
      },
    ],
  },
  {
    version: "3.0.14",
    date: "May 5, 2025",
    changes: [
      {
        type: "new",
        description: "Introduced PI Bot, an AI assistant for token analysis",
      },
      {
        type: "improved",
        description: "Enhanced token filtering with additional options",
      },
      {
        type: "improved",
        description: "Updated UI for better readability and contrast",
      },
      {
        type: "fixed",
        description: "Resolved WebSocket connection stability issues",
      },
    ],
  },
  {
    version: "3.0.13",
    date: "May 1, 2025",
    changes: [
      {
        type: "new",
        description: "Added market cap alerts feature",
      },
      {
        type: "new",
        description: "Implemented sound notifications for alerts",
      },
      {
        type: "improved",
        description: "Enhanced token card design with more information",
      },
      {
        type: "fixed",
        description: "Fixed pagination issues when filtering tokens",
      },
    ],
  },
  {
    version: "3.0.12",
    date: "April 28, 2025",
    changes: [
      {
        type: "new",
        description: "Added favorites feature to bookmark tokens",
      },
      {
        type: "improved",
        description: "Enhanced data refresh mechanism for more timely updates",
      },
      {
        type: "improved",
        description: "Updated token age calculation for better accuracy",
      },
      {
        type: "fixed",
        description: "Resolved issue with token sorting not working correctly",
      },
    ],
  },
  {
    version: "3.0.11",
    date: "April 25, 2025",
    changes: [
      {
        type: "new",
        description: "Added dark mode support",
      },
      {
        type: "new",
        description: "Implemented settings panel for customization",
      },
      {
        type: "improved",
        description: "Enhanced mobile responsiveness",
      },
      {
        type: "fixed",
        description: "Fixed data loading issues on slow connections",
      },
    ],
  },
  {
    version: "3.0.10",
    date: "April 22, 2025",
    changes: [
      {
        type: "new",
        description: "Initial release of Pump.Investments Lite",
      },
      {
        type: "new",
        description: "Real-time token data display",
      },
      {
        type: "new",
        description: "Basic filtering and sorting options",
      },
      {
        type: "new",
        description: "Token age tracking",
      },
    ],
  },
]

export function Changelog() {
  return (
    <div className="space-y-8 pb-6">
      {changelogData.map((entry, index) => (
        <div key={index} className="pb-6 last:pb-0">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-lg font-semibold">Version {entry.version}</h3>
            <span className="text-sm text-muted-foreground">{entry.date}</span>
          </div>
          <ul className="space-y-2">
            {entry.changes.map((change, changeIndex) => (
              <li key={changeIndex} className="flex items-start gap-2">
                <span
                  className={`px-2 py-0.5 text-xs rounded-full mt-0.5 ${
                    change.type === "new"
                      ? "bg-green-500/10 text-green-600 dark:text-green-400"
                      : change.type === "improved"
                        ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                        : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {change.type === "new" ? "New" : change.type === "improved" ? "Improved" : "Fixed"}
                </span>
                <span>{change.description}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
