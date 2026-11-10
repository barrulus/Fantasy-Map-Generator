import { expect, test } from "@playwright/test";
import { countMaps, waitForMap, waitForNextMap } from "./wait-for-map";

declare const FMG: {
  Burgs: typeof import("../../src/model/political/burgs-generator").Burgs;
  Production: typeof import("../../src/model/economy/production-generator").Production;
  Markets: typeof import("../../src/model/economy/markets-generator").Markets;
  Layers: typeof import("../../src/renderers/layers").Layers;
  Controllers: typeof import("../../src/controllers").Controllers;
  Services: typeof import("../../src/services").Services;
  Dialog: typeof import("../../src/ui/dialog/dialog").Dialog;
};

test("shared-cell skyburgs survive editing and a saved-map round trip", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/?seed=bazgaars-sync-smoke&width=1280&height=720");
  await waitForMap(page);

  const ids = await page.evaluate(async () => {
    const ground = pack.burgs.find(burg => burg.i && !burg.removed && !burg.flying && FMG.Markets.ofBurg(burg))!;
    const [x, y] = pack.cells.p[ground.cell];
    const first = FMG.Burgs.add(x, y, { flying: true, altitude: 900 });
    const second = FMG.Burgs.add(x, y, { flying: true, altitude: 1200 });
    options.app.labels.showAll = true;
    await FMG.Layers.draw("burgIcons", "labels", "routes");
    return { ground: ground.i, cell: ground.cell, first, second };
  });
  for (const id of [ids.ground, ids.first, ids.second]) await expect(page.locator(`#burg${id}`)).toHaveCount(1);

  await page.evaluate(id => FMG.Controllers.BurgEditor.open(id), ids.first);
  await expect(page.locator("#burgEditor")).toBeVisible();
  await expect(page.locator("#burgFlying")).not.toHaveClass(/inactive/);
  await expect(page.locator("#burgAltitude")).toHaveValue("900");
  await page.locator("#burgAltitude").fill("950");
  await page.locator("#burgAltitude").dispatchEvent("change");
  await page.evaluate(() => FMG.Dialog.closeAll());
  await page.evaluate(() => FMG.Production.produce());
  await page.evaluate(id => FMG.Controllers.BurgEconomyOverview.open(id), ids.first);
  await expect(page.locator("#burgEconomyOverview")).toBeVisible();
  await page.evaluate(() => FMG.Dialog.closeAll());
  await page.evaluate(() => FMG.Controllers.BurgsOverview.open());
  await expect(page.locator("#burgsOverview")).toBeVisible();
  await page.evaluate(() => FMG.Dialog.closeAll());

  const saved = await page.evaluate(() => FMG.Services.Save.prepareMapData());
  const before = await countMaps(page);
  await page.evaluate(data => FMG.Services.Load.uploadMap(new Blob([data])), saved);
  await waitForNextMap(page, before);
  const restored = await page.evaluate(({ cell, first, second }) => ({
    owner: pack.cells.burg[cell],
    wideIndex: pack.cells.burg instanceof Uint32Array,
    skies: [first, second].map(id => ({ cell: pack.burgs[id].cell, flying: pack.burgs[id].flying, altitude: pack.burgs[id].altitude }))
  }), ids);
  expect(restored).toEqual({
    owner: ids.ground,
    wideIndex: true,
    skies: [{ cell: ids.cell, flying: 1, altitude: 950 }, { cell: ids.cell, flying: 1, altitude: 1200 }]
  });
  await page.evaluate(id => FMG.Burgs.remove(id), ids.second);
  expect(await page.evaluate(cell => pack.cells.burg[cell], ids.cell)).toBe(ids.ground);
  expect(errors).toEqual([]);
});
