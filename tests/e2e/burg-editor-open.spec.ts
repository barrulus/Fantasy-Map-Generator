import { test, expect } from "@playwright/test";

// The burg editor's identity must not depend on the rendered DOM: with viewport-culled icons
// (and labels), a burg opened from the overview - or any burg outside the viewport or below
// its zoom gate - has no node, and deriving the id from one crashed open() outright.
test.describe("burg editor opens", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?seed=icon-viewport&width=1280&height=720");
    await page.waitForFunction(() => (window as any).mapId !== undefined, { timeout: 120000 });
    await page.waitForTimeout(500);
  });

  test("by clicking a materialized burg icon", async ({ page }) => {
    await page.evaluate(async () => {
      (window as any).setMapZoom(3);
      await new Promise(resolve => setTimeout(resolve, 600));
    });
    const icon = page.locator("#burgIcons use").first();
    const id = await icon.getAttribute("data-id");
    await icon.click({ force: true });
    await expect(page.locator("#burgEditor")).toBeVisible();
    expect(await page.locator("#burgEditor").getAttribute("data-burg-id")).toBe(id);
  });

  test("for a burg with no materialized node", async ({ page }) => {
    const opened = await page.evaluate(async () => {
      const burg = (window as any).pack.burgs.find(
        (b: any) => b.i && !b.removed && !document.querySelector(`[data-id='${b.i}']`)
      );
      await (window as any).Controllers.BurgEditor.open(burg.i);
      return { id: burg.i, dialogId: document.getElementById("burgEditor")?.dataset.burgId };
    });
    expect(opened.dialogId).toBe(String(opened.id));
  });
});
