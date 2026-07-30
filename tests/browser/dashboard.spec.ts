import { expect, test } from "@playwright/test"

test("dashboard preserves controls and removes obsolete KOTH surfaces", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("v4.0.0")).toBeVisible()
  await expect(page.getByRole("button", { name: "Pause automatic token ordering" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Open settings" })).toBeVisible()
  await expect(page.locator("[data-radix-toast-viewport]")).toHaveCount(1)

  await page.getByRole("button", { name: "Open settings" }).click()
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()
  await expect(page.getByText("KOTH", { exact: false })).toHaveCount(0)
  const firstSlider = page.getByRole("slider").first()
  await firstSlider.focus()
  const before = await firstSlider.getAttribute("aria-valuenow")
  await firstSlider.press("ArrowRight")
  await expect(firstSlider).not.toHaveAttribute("aria-valuenow", before ?? "")
})

test("pause defers ordering and query changes automatically resume", async ({ page }) => {
  await page.goto("/")
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
  await page.waitForTimeout(2_000)
  expect(forbidden).toEqual([])
  const images = page.locator('img[src*="/api/token-image/"]')
  if (await images.count()) {
    await expect(images.first()).toBeVisible()
  }
})
