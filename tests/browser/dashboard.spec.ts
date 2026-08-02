import { expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"

const expectedVersion = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string }

async function dismissOnboarding(page: import("@playwright/test").Page) {
  const welcome = page.getByRole("heading", { name: "Welcome to Pump.Investments Lite!" })
  if (await welcome.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false)) {
    await page.getByRole("button", { name: "Close" }).click()
    await expect(welcome).toBeHidden()
  }
}

test("dashboard preserves controls and removes obsolete KOTH surfaces", async ({ page }) => {
  await page.goto("/")
  await dismissOnboarding(page)
  await expect(page.getByText(`v${expectedVersion.version}`)).toBeVisible()
  await expect(page.getByRole("button", { name: "Pause automatic token ordering" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Open settings" })).toBeVisible()
  await expect(page.locator("[data-notification-region]")).toHaveCount(1)

  await page.getByRole("button", { name: "Open settings" }).click()
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible()
  await expect(page.getByText("KOTH", { exact: false })).toHaveCount(0)
  const firstSlider = page.getByRole("slider").first()
  await firstSlider.focus()
  const before = await firstSlider.getAttribute("aria-valuenow")
  await firstSlider.press("ArrowRight")
  await expect(firstSlider).not.toHaveAttribute("aria-valuenow", before ?? "")
})

test("pause defers ordering and query changes automatically resume", async ({ page }) => {
  await page.goto("/")
  await dismissOnboarding(page)
  const pause = page.getByRole("button", { name: "Pause automatic token ordering" })
  await pause.click()
  await expect(page.getByRole("button", { name: "Resume automatic token ordering" })).toBeVisible()
  await page.locator('[data-onboarding="time-range"]').click()
  await page.getByRole("option", { name: "15 min" }).click()
  await expect(page.getByRole("button", { name: "Pause automatic token ordering" })).toBeVisible()
})

test("browser uses same-origin pricing, images, and generated alert audio", async ({ page }) => {
  const forbidden: string[] = []
  page.on("request", (request) => {
    const url = request.url()
    if (url.includes("api.coingecko.com") || /\.(mp3|wav|ogg)(\?|$)/i.test(url)) forbidden.push(url)
  })
  await page.goto("/")
  await dismissOnboarding(page)
  await page.waitForTimeout(2_000)
  expect(forbidden).toEqual([])
  const images = page.locator('img[src*="/api/token-image/"]')
  if (await images.count()) {
    await expect(images.first()).toBeVisible()
  }
})

test("problem reports persist a conversation and can be permanently deleted", async ({ page }) => {
  await page.goto("/")
  await dismissOnboarding(page)
  await page.getByRole("button", { name: "Open settings" }).click()
  await expect(page.getByRole("heading", { name: "Report a Problem" })).toBeVisible()
  await page.getByRole("button", { name: "Report", exact: true }).click()
  await page.getByLabel("What happened?").fill("Browser test support report\nThis ticket verifies the conversation flow.")
  await page.getByRole("button", { name: "Submit report" }).click()
  const ticketHeading = page.getByRole("heading", { name: /^PI-\d+$/ })
  await expect(ticketHeading).toBeVisible()
  const ticketNumber = await ticketHeading.textContent()
  expect(ticketNumber).toBeTruthy()
  await page.getByPlaceholder("Add more information...").fill("A follow-up from the browser test.")
  await page.getByRole("button", { name: "Send", exact: true }).click()
  await expect(page.getByText("A follow-up from the browser test.")).toBeVisible()
  await page.getByRole("button", { name: "Close" }).last().click()
  page.once("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: `Delete ${ticketNumber}` }).click()
  await expect(page.getByText(ticketNumber!, { exact: false })).toHaveCount(0)
})

test("token cards preserve bright borders and refined content fit", async ({ page }, testInfo) => {
  await page.goto("/")
  await dismissOnboarding(page)
  const graduationFilter = page.locator('[data-onboarding="graduation-filter"]')
  await graduationFilter.click()
  await page.getByRole("option", { name: "Bonding" }).click()

  const grid = page.locator("[data-token-card-grid]")
  const cards = page.locator("[data-token-card]")
  await expect(cards.first()).toBeVisible()
  expect(await cards.count()).toBeGreaterThan(0)
  const bondingCards = page.locator("[data-token-card]:has([data-token-bonding-progress])")
  await expect(bondingCards.first()).toBeVisible()
  const apiResponse = await page.request.post("/api/tokens", {
    data: {
      page: 1,
      pageSize: 100,
      timeRangeMinutes: 10,
      filters: { graduationFilter: "bonding" },
    },
  })
  expect(apiResponse.ok()).toBe(true)
  const apiSnapshot = await apiResponse.json() as {
    tokens: Array<{ mint: string; bonding_progress: number; lifecycle_status: string }>
  }
  const apiByMint = new Map(apiSnapshot.tokens.map((token) => [token.mint, token]))
  const displayedProgress = await bondingCards.evaluateAll((visibleCards) =>
    visibleCards.map((card) => ({
      mint: card.getAttribute("data-token-mint") ?? "",
      progress: Number(card.querySelector("[data-token-bonding-progress]")?.getAttribute("data-token-progress")),
    })),
  )
  for (const displayed of displayedProgress) {
    const apiToken = apiByMint.get(displayed.mint)
    expect(apiToken?.lifecycle_status).toBe("bonding")
    expect(displayed.progress).toBeGreaterThanOrEqual(0)
    expect(displayed.progress).toBeLessThanOrEqual(99)
    expect(displayed.progress).toBeCloseTo(Math.min(99, Math.max(0, apiToken?.bonding_progress ?? 0)), 5)
  }

  const cardChecks = await bondingCards.first().evaluate((card) => {
    const imageSurface = card.querySelector<HTMLElement>("[data-token-image-surface]")
    const lastTrade = card.querySelector<HTMLElement>("[data-token-last-trade]")
    const footer = card.querySelector<HTMLElement>("[data-token-footer]")
    const cardRect = card.getBoundingClientRect()
    const imageRect = imageSurface?.getBoundingClientRect()
    const footerRect = footer?.getBoundingClientRect()
    const style = getComputedStyle(card)
    return {
      cardHeight: cardRect.height,
      borderWidth: style.borderTopWidth,
      borderClass: Array.from(card.classList).find((name) => name.startsWith("border-") && name !== "border-2"),
      imageWidth: imageRect?.width,
      imageHeight: imageRect?.height,
      imageBackground: imageSurface ? getComputedStyle(imageSurface).backgroundColor : "",
      lastTradeText: lastTrade?.textContent?.trim(),
      lastTradeWhiteSpace: lastTrade ? getComputedStyle(lastTrade).whiteSpace : "",
      footerInside: Boolean(footerRect && footerRect.bottom <= cardRect.bottom),
      horizontalOverflow: card.scrollWidth > card.clientWidth,
    }
  })

  expect(cardChecks).toMatchObject({
    cardHeight: 342,
    borderWidth: "2px",
    imageWidth: 80,
    imageHeight: 80,
    lastTradeWhiteSpace: "nowrap",
    footerInside: true,
    horizontalOverflow: false,
  })
  expect(cardChecks.borderClass).toMatch(/^border-(green|red|gray)-/)
  expect(cardChecks.imageBackground).not.toBe("rgba(0, 0, 0, 0)")
  expect(cardChecks.lastTradeText).toMatch(/^(<1m|\d+[mhd]) ago$|^Unknown$/)

  const overflowingMints = await bondingCards.evaluateAll((cards) => cards.flatMap((card) => {
    const footer = card.querySelector<HTMLElement>("[data-token-footer]")
    const footerRect = footer?.getBoundingClientRect()
    return footerRect && footerRect.bottom > card.getBoundingClientRect().bottom
      ? [card.getAttribute("data-token-mint")]
      : []
  }))
  expect(overflowingMints).toEqual([])

  const socialLinks = page.locator("[data-token-social-links] a")
  const socialCount = await socialLinks.count()
  if (socialCount > 0) {
    const socialChecks = await socialLinks.first().evaluate((link) => {
      const rect = link.getBoundingClientRect()
      return {
        width: rect.width,
        height: rect.height,
        ariaLabel: link.getAttribute("aria-label"),
        title: link.getAttribute("title"),
      }
    })
    expect(socialChecks.width).toBe(24)
    expect(socialChecks.height).toBe(24)
    expect(socialChecks.ariaLabel).toBeTruthy()
    expect(socialChecks.title).toBeTruthy()
  }

  await page.getByRole("button", { name: "Toggle theme" }).click()
  await page.getByRole("menuitem", { name: "Dark" }).click()
  await expect(page.locator("html")).toHaveClass(/dark/)
  await testInfo.attach("token-cards-dark", {
    body: await grid.screenshot(),
    contentType: "image/png",
  })

  await page.getByRole("button", { name: "Toggle theme" }).click()
  await page.getByRole("menuitem", { name: "Light" }).click()
  await expect(page.locator("html")).not.toHaveClass(/dark/)
  await testInfo.attach("token-cards-light", {
    body: await grid.screenshot(),
    contentType: "image/png",
  })

  await graduationFilter.click()
  await page.getByRole("option", { name: "Graduated" }).click()
  await expect(cards.first()).toBeVisible()
  await expect(page.locator("[data-token-bonding-progress]")).toHaveCount(0)
  const graduatedFits = await cards.first().evaluate((card) => {
    const footer = card.querySelector<HTMLElement>("[data-token-footer]")
    const cardRect = card.getBoundingClientRect()
    const footerRect = footer?.getBoundingClientRect()
    return Boolean(footerRect && footerRect.bottom <= cardRect.bottom)
  })
  expect(graduatedFits).toBe(true)
})

test("alert settings load on demand", async ({ page }) => {
  await page.goto("/")
  await dismissOnboarding(page)
  await page.getByRole("button", { name: "Add to favorites" }).first().click()
  await page.getByRole("button", { name: "Show favorite tokens only" }).click()
  await page.getByRole("button", { name: "Alert settings" }).first().click()
  await expect(page.getByRole("heading", { name: /Alert Settings for/ })).toBeVisible()
  await page.getByRole("button", { name: "Close" }).click()
  await expect(page.getByRole("heading", { name: /Alert Settings for/ })).toBeHidden()
})
