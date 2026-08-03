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
    version: "4.0.12",
    date: "August 3, 2026",
    changes: [
      {
        type: "new",
        description: "Added a live header count showing how many distinct browsers are actively using Pump.Investments.",
      },
      {
        type: "improved",
        description: "Active browser counting is privacy-preserving, ignores duplicate tabs, and stops counting hidden or inactive sessions automatically.",
      },
    ],
  },
  {
    version: "4.0.11",
    date: "August 1, 2026",
    changes: [
      {
        type: "new",
        description: "Added compact problem reporting in Settings with ticket conversations, safe diagnostics, and screenshot uploads.",
      },
      {
        type: "new",
        description: "Problem reports can now receive support replies, request more information, reopen after resolution, and be permanently deleted by the user.",
      },
      {
        type: "improved",
        description: "Added protected VM-local ticket management and backend health snapshots to make feed and lifecycle problems easier to diagnose.",
      },
    ],
  },
  {
    version: "4.0.10",
    date: "August 1, 2026",
    changes: [
      {
        type: "fixed",
        description: "Stopped treating Pump's bonding pool address as graduation evidence, restoring actively bonding tokens to the Bonding feed.",
      },
      {
        type: "fixed",
        description: "Added a verified repair pass for tokens previously misclassified as graduated while still trading on Pump's bonding curve.",
      },
    ],
  },
  {
    version: "4.0.9",
    date: "August 1, 2026",
    changes: [
      {
        type: "improved",
        description: "Made token snapshots, realtime updates, buyer counts, and alert streams faster while reducing repeated database work.",
      },
      {
        type: "improved",
        description: "Added deeper feed, lifecycle, database, disk, query, stream, and image-cache health reporting for faster recovery.",
      },
      {
        type: "fixed",
        description: "Bound image-cache cleanup and improved keyboard and screen-reader behavior without changing the card design.",
      },
      {
        type: "improved",
        description: "Hardened public proxy security and added a validated, rollback-safe VM release process.",
      },
    ],
  },
  {
    version: "4.0.8",
    date: "August 1, 2026",
    changes: [
      {
        type: "fixed",
        description: "Bonding bars now use Pump's verified curve reserves, fixing unrelated market caps that were incorrectly displayed at 99%.",
      },
      {
        type: "fixed",
        description: "Recognize Pump's confirmed legacy Raydium pool migrations as graduated even when its old complete flag remains stale.",
      },
      {
        type: "improved",
        description: "Bound trade, aggregate, realtime, and lifecycle queue retention to the one-hour token tracking window with a safe recovery margin.",
      },
      {
        type: "fixed",
        description: "Restored reliable public realtime streams by applying Cloudflare connection limits per actual visitor instead of per tunnel.",
      },
    ],
  },
  {
    version: "4.0.7",
    date: "August 1, 2026",
    changes: [
      {
        type: "fixed",
        description: "Made the live token feed automatically reconnect when trade events stop even if the upstream connection still answers heartbeats.",
      },
      {
        type: "improved",
        description: "Added a second process-level recovery guard and live trade freshness reporting to prevent silent feed outages.",
      },
    ],
  },
  {
    version: "4.0.6",
    date: "July 31, 2026",
    changes: [
      {
        type: "fixed",
        description: "Aligned the visible bonding percentage with market cap and the live SOL price so higher-cap bonding tokens consistently show greater progress.",
      },
      {
        type: "improved",
        description: "Kept market-cap progress visual-only while Pump and confirmed PumpSwap evidence remain authoritative for graduation.",
      },
    ],
  },
  {
    version: "4.0.5",
    date: "July 31, 2026",
    changes: [
      {
        type: "improved",
        description: "Refined token cards with compact trade times, clearer secondary text, aligned numbers, consistent artwork and social controls, and more comfortable footer spacing.",
      },
      {
        type: "improved",
        description: "Added a subtle card lift and stronger hover shadow while preserving the bright green and red buy/sell borders.",
      },
      {
        type: "fixed",
        description: "Kept the header version badge synchronized with the latest in-app changelog release.",
      },
    ],
  },
  {
    version: "4.0.4",
    date: "July 31, 2026",
    changes: [
      {
        type: "fixed",
        description: "Tokens now graduate immediately when the live feed confirms trading through a concrete PumpSwap pool, even if Pump's token metadata is delayed.",
      },
      {
        type: "fixed",
        description: "Bonding progress now follows Pump's remaining curve reserves instead of estimating graduation from market cap.",
      },
      {
        type: "improved",
        description: "Made the bonding percentage larger and easier to read in light and dark themes.",
      },
    ],
  },
  {
    version: "4.0.3",
    date: "July 31, 2026",
    changes: [
      {
        type: "fixed",
        description: "Switched the live ingester from Pump's sampled market ticker to the complete per-token trade stream, restoring accurate token discovery, unique-buyer counts, and buy/sell volume.",
      },
    ],
  },
  {
    version: "4.0.2",
    date: "July 30, 2026",
    changes: [
      {
        type: "new",
        description: "Connected PI Bot to the private GPU45 appliance and its Ornith 1.0 35B model.",
      },
      {
        type: "improved",
        description: "Added a 100,000-token PI Bot context ceiling, private server-side routing, and clearer appliance timeout and availability handling.",
      },
      {
        type: "improved",
        description: "Removed the unused hosted Groq integration so PI Bot analysis stays on the local network appliance.",
      },
    ],
  },
  {
    version: "4.0.1",
    date: "July 30, 2026",
    changes: [
      {
        type: "new",
        description: "Published Pump.Investments at https://pump.investments through a secure Cloudflare Tunnel while preserving the existing LAN address.",
      },
      {
        type: "improved",
        description: "Added an auto-starting Ubuntu tunnel connector and routed the app, APIs, token images, health checks, and realtime token and alert streams through one HTTPS hostname.",
      },
    ],
  },
  {
    version: "4.0.0",
    date: "July 29, 2026",
    changes: [
      {
        type: "new",
        description: "Added durable trade spooling, atomic database writes, rolling activity aggregates, independent alert streaming, and public service health checks.",
      },
      {
        type: "improved",
        description: "Upgraded the application to Next.js 16, React 19, Prisma 7, and pinned production dependencies with explicit PostgreSQL connection pools.",
      },
      {
        type: "improved",
        description: "Centralized SOL pricing, hardened and cached token images, reduced initial loading, and made Pause preserve card order while values keep updating.",
      },
      {
        type: "fixed",
        description: "Made lifecycle updates no-op when Pump reports no change, corrected individual Trade Amount filtering, and preserved exact requested time ranges.",
      },
      {
        type: "improved",
        description: "Removed obsolete King of the Hill controls and artwork while preserving the existing card design and external-token provenance icon.",
      },
      {
        type: "improved",
        description: "Improved request validation, accessibility, reverse-proxy readiness, alert sounds, observability, and failure recovery without adding new card chips.",
      },
    ],
  },
  {
    version: "3.1.3",
    date: "July 29, 2026",
    changes: [
      {
        type: "improved",
        description: "Removed redundant Bonding, Graduated, and Verifying chips from token cards. Bonding status is now communicated by the existing progress bar.",
      },
      {
        type: "improved",
        description: "Kept graduated cards visually clean without a replacement status label, while retaining the existing external-token provenance icon.",
      },
    ],
  },
  {
    version: "3.1.2",
    date: "July 29, 2026",
    changes: [
      {
        type: "fixed",
        description: "Made token images load through Pump.Investments with automatic IPFS gateway fallback instead of relying on one third-party image host in each browser.",
      },
      {
        type: "fixed",
        description: "Stopped failed image URLs from being saved as successful images and refreshed cards when newly resolved image metadata arrives.",
      },
      {
        type: "improved",
        description: "Accelerated missing-image recovery by resolving metadata URIs already captured from live trades before making additional Pump API requests.",
      },
      {
        type: "fixed",
        description: "Restored automatic image recovery for valid pump.fun mint addresses ending in “pump” and included active tokens that existed before a service restart.",
      },
      {
        type: "improved",
        description: "Backfilled image metadata for the active token set so currently traded tokens no longer depend on the default artwork while metadata catches up.",
      },
    ],
  },
  {
    version: "3.1.1",
    date: "July 29, 2026",
    changes: [
      {
        type: "fixed",
        description: "Hardened every Settings slider for consistent mouse, touch, pen, and keyboard control across browsers.",
      },
      {
        type: "fixed",
        description: "Stopped range sliders from restarting token queries while they are still being dragged, preventing lag and values snapping back mid-adjustment.",
      },
      {
        type: "improved",
        description: "Added larger slider controls and touch targets, stable value clamping, and explicit screen-reader labels for every slider thumb.",
      },
    ],
  },
  {
    version: "3.1.0",
    date: "July 29, 2026",
    changes: [
      {
        type: "fixed",
        description: "Replaced market-cap graduation guesses with lifecycle data verified directly from pump.fun, so high-market-cap tokens can remain Bonding and low-market-cap tokens can remain Graduated when that is their real state.",
      },
      {
        type: "fixed",
        description: "Corrected Bonding and Graduated filters to use verified lifecycle state instead of market cap or unreliable websocket flags.",
      },
      {
        type: "improved",
        description: "Simplified token status labels to Bonding or Graduated. External tokens retain the existing provenance icon, while unresolved tokens display Verifying.",
      },
      {
        type: "improved",
        description: "Moved token aggregation, filtering, sorting, and pagination into PostgreSQL for substantially faster token-list responses.",
      },
      {
        type: "new",
        description: "Added realtime token updates over a shared server-sent event stream with automatic reconnect and snapshot recovery, replacing 500 ms full-page polling.",
      },
      {
        type: "improved",
        description: "Moved metadata enrichment out of the token-list request path and added bounded caches to prevent long-running memory growth.",
      },
      {
        type: "fixed",
        description: "Prevented delayed trade batches from overwriting newer prices and added continuous lifecycle reconciliation for newly created and actively traded tokens.",
      },
    ],
  },
  {
    version: "3.0.34",
    date: "April 01, 2026",
    changes: [
      {
        type: "fixed",
        description: "Reworked metadata retries so temporary pump.fun failures and stale inflight requests no longer freeze token enrichment indefinitely.",
      },
      {
        type: "improved",
        description: "Prioritized active tokens in the ingester metadata queue and added backlog health logging so fresh trading activity stays ahead of older missing metadata work.",
      },
      {
        type: "improved",
        description: "Reduced /api/tokens metadata hydration pressure by limiting fallback enrichment to returned page items instead of every aggregated token.",
      },
    ],
  },
  {
    version: "3.0.33",
    date: "March 30, 2025",
    changes: [
      {
        type: "improved",
        description: "Hardened the trade ingester with reconnect backoff, connect timeouts, and heartbeat-based stale socket detection.",
      },
      {
        type: "fixed",
        description: "The ingestion service now tears down and rebuilds dead upstream WebSocket connections automatically after internet or DNS interruptions.",
      },
    ],
  },
  {
    version: "3.0.32",
    date: "January 15, 2025",
    changes: [
      {
        type: "improved",
        description: "Changed 'Unique Traders' to 'Unique Buyers' throughout the application to accurately reflect that only buyers are counted, not all traders.",
      },
      {
        type: "improved",
        description: "Updated filter logic to count only unique buyers when filtering and displaying token statistics.",
      },
    ],
  },
  {
    version: "3.0.31",
    date: "December 20, 2024",
    changes: [
      {
        type: "new",
        description: "Added Token Age Range filter slider in settings to filter tokens by their creation age (0 minutes to 7 days) with granular control for minutes, hours, and days.",
      },
      {
        type: "improved",
        description: "Token age filter uses non-linear scaling for precise selection of common values like 5 minutes, 25 minutes, 5 hours, or 3 days.",
      },
    ],
  },
  {
    version: "3.0.30",
    date: "November 13, 2025",
    changes: [
      {
        type: "improved",
        description: "Replaced bespoke metadata fetch stack with the AutoTrader-style pump API client and server metadata route for consistent data.",
      },
      {
        type: "fixed",
        description: "Front-end now hydrates missing token info through the new /api/tokens/[mint]/metadata endpoint instead of fallback coin proxy.",
      }
    ],
  },
  {
    version: "3.0.29",
    date: "November 12, 2025",
    changes: [
      {
        type: "improved",
        description:
          "Moved Pump.fun coin metadata fetching into the proxy service with caching so clients avoid Cloudflare 530 errors.",
      },
      {
        type: "improved",
        description:
          "Proxy now enriches every trade broadcast with the latest metadata payloads and shares cached entries when clients connect.",
      },
      {
        type: "fixed",
        description:
          "Client WebSocket handler waits for proxy metadata before falling back to IPFS, keeping trade cards accurate without redundant requests.",
      },
    ],
  },
  {
    version: "3.0.28",
    date: "June 3, 2025",
    changes: [
      {
        type: "fixed",
        description:
          "Regrouped incoming WebSocket trades by mint with an in-memory index so per-token statistics stay accurate across updates.",
      },
      {
        type: "fixed",
        description:
          "Skipped duplicate trade signatures entirely to keep historical records and on-screen data free of redundant entries.",
      },
      {
        type: "improved",
        description:
          "Tightened visible-token metadata caching to reuse fetched details and avoid repeat requests while browsing between pages.",
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
