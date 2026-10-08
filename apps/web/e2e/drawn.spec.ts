import { expect, test } from './fixtures';

// What the map itself draws. The other tests refuse every request to the outside
// world, so the basemap never loads and nothing is drawn. Here the basemap is
// answered with an empty style of our own: no tiles, no other site, but a map to
// draw on. The map is then asked what it has drawn, since a canvas cannot be read.

type Page = import('@playwright/test').Page;
type Drawn = { markers: number; clusters: number; ringed: number; lines: number; card: string | null };

const EMPTY_STYLE = {
  version: 8,
  sources: {},
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#071018' } }],
};

async function openMap(page: Page, hash = '') {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) => route.fulfill({ json: EMPTY_STYLE }));
  await page.goto(`/map/${hash}`);
  await page.waitForFunction(() => '__ecosightMap' in window);
}
const drawn = (page: Page) => page.evaluate(() => (window as any).__ecosightMap.inspect() as Drawn);
const details = (page: Page) => page.locator('aside').last();

async function select(page: Page, name: string) {
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Search' }).getByRole('searchbox').fill(name);
  await page.getByRole('dialog', { name: 'Search' }).getByRole('option').first().click();
  await expect(details(page).getByRole('heading', { level: 2 })).toHaveText(name);
}

test('records are drawn as markers and clusters, and a layer switched off is not', async ({ page }) => {
  await openMap(page);
  await expect.poll(async () => (await drawn(page)).markers + (await drawn(page)).clusters).toBeGreaterThan(0);
  const before = await drawn(page);
  expect(before.ringed).toBe(0);

  for (const layer of ['Startups', 'Investors', 'Accelerators', 'Events', 'NGOs'])
    await page.locator('label', { hasText: layer }).first().getByRole('checkbox').uncheck();
  await expect.poll(async () => (await drawn(page)).markers + (await drawn(page)).clusters).toBe(0);
});

test('the selected record is ringed, and its marker shows a card only while the pointer is on it', async ({ page }) => {
  await openMap(page);
  await select(page, 'Sample Startup 10');
  await expect.poll(async () => (await drawn(page)).ringed).toBe(1);

  // Once the map has flown to it, the record is in the middle of the map.
  const place = await page.evaluate(async () => {
    const map = (window as any).__ecosightMap;
    for (let i = 0; i < 80; i++) {
      const centre = map.getCamera();
      await new Promise((done) => setTimeout(done, 100));
      const after = map.getCamera();
      if (centre.lon === after.lon && centre.zoom === after.zoom && after.zoom >= 14) break;
    }
    const camera = map.getCamera();
    return map.screenPoint(camera.lon, camera.lat);
  });
  await page.mouse.move(place.x - 40, place.y - 40);
  await page.mouse.move(place.x, place.y, { steps: 6 });
  await expect(page.locator('.atlas-hover')).toContainText('Sample Startup 10');
  await expect(page.locator('.atlas-hover')).toContainText('Nairobi, Kenya');
  expect((await drawn(page)).card).toContain('Sample Startup 10');

  await page.mouse.move(place.x - 150, place.y - 150, { steps: 6 });
  await expect(page.locator('.atlas-hover')).toHaveCount(0);

  // Closing the record takes the ring away.
  await details(page).getByRole('button', { name: 'Close details' }).click();
  await expect.poll(async () => (await drawn(page)).ringed).toBe(0);
});

test('a line is drawn to each connection, and hiding one takes that line away', async ({ page }) => {
  await openMap(page);
  await select(page, 'Sample Fund 01');
  await expect.poll(async () => (await drawn(page)).lines).toBe(6);

  await details(page).getByRole('button', { name: 'Hide line', exact: true }).first().click();
  await expect.poll(async () => (await drawn(page)).lines).toBe(5);
  await details(page).getByRole('button', { name: 'Show line', exact: true }).click();
  await expect.poll(async () => (await drawn(page)).lines).toBe(6);

  await details(page).getByRole('button', { name: 'Hide all 6 lines' }).click();
  await expect.poll(async () => (await drawn(page)).lines).toBe(0);
});

test('the landing page draws its sections as maps', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) => route.fulfill({ json: EMPTY_STYLE }));
  await page.goto('/');
  for (const heading of [/The ecosystem is everywhere/, /One ecosystem\. Every layer/, /Find the people who can move/, /See deal flow before/, /See where support exists/])
    await page.getByRole('heading', { name: heading }).first().scrollIntoViewIfNeeded();
  // The hero, the five sections, the explore preview and the globe further down each hold a map once in view.
  await expect.poll(() => page.locator('.maplibregl-canvas').count()).toBeGreaterThanOrEqual(6);
  await expect(page.getByRole('img', { name: /Map of the organisations in|Map of one city/ })).toBeVisible();
});
