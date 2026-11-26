import { expect, test } from './fixtures';

// Drawing an area to filter by, and replaying funding rounds over time. As in drawn.spec.ts the
// basemap is answered with an empty style, so there is a map to click on and to ask what it drew.

type Page = import('@playwright/test').Page;
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
const inspect = (page: Page) => page.evaluate(() => (window as any).__ecosightMap.inspect());
const statusBar = (page: Page) => page.locator('footer');

test('a link with an area narrows the records and outlines the area', async ({ page }) => {
  await openMap(page, '#fz=c:36.82,-1.29,2');
  await expect(statusBar(page)).toContainText('Entities');
  await expect(statusBar(page)).not.toContainText('54');
  await expect.poll(async () => (await inspect(page)).area).toBe(true);
  await page.getByRole('button', { name: /Filters/ }).click();
  await expect(page.getByLabel('Radius in kilometres')).toHaveValue('2');
  await page.getByRole('button', { name: 'Remove area' }).click();
  await expect(statusBar(page)).toContainText('54');
  await expect.poll(async () => (await inspect(page)).area).toBe(false);
  await expect(page).not.toHaveURL(/fz=/);
});

test('a radius is drawn with two clicks and a polygon with a click for each corner', async ({ page }) => {
  await openMap(page);
  await page.getByRole('button', { name: /Filters/ }).click();
  const map = page.getByLabel('Map of the ecosystem');
  const box = (await map.boundingBox())!;
  const middle = { x: box.x + box.width / 2 - 100, y: box.y + box.height / 2 };

  await page.getByRole('button', { name: 'Draw a radius' }).click();
  await expect.poll(async () => (await inspect(page)).drawing).toBe(true);
  await page.mouse.click(middle.x, middle.y);
  await page.mouse.move(middle.x + 60, middle.y, { steps: 4 });
  await page.mouse.click(middle.x + 60, middle.y);
  await expect.poll(async () => (await inspect(page)).drawing).toBe(false);
  await expect(page).toHaveURL(/fz=c:36\.\d+,-1\.\d+,[\d.]+/);
  await expect(page.getByLabel('Radius in kilometres')).toBeVisible();
  await expect.poll(async () => (await inspect(page)).area).toBe(true);

  await page.getByRole('button', { name: 'Draw a polygon' }).click();
  for (const [dx, dy] of [[-80, -80], [80, -80], [80, 80], [-80, 80]] as const) await page.mouse.click(middle.x + dx, middle.y + dy);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/fz=p:/);
  await expect(page.getByText('Inside the polygon (4 corners)')).toBeVisible();
});

test('Escape stops a drawing and leaves the filters as they were', async ({ page }) => {
  await openMap(page);
  await page.getByRole('button', { name: /Filters/ }).click();
  await page.getByRole('button', { name: 'Draw a radius' }).click();
  await expect.poll(async () => (await inspect(page)).drawing).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await inspect(page)).drawing).toBe(false);
  await expect(page).not.toHaveURL(/fz=/);
});

test('the timeline replays rounds month by month', async ({ page }) => {
  // Several steps and a wait for the player to move: give it room when the whole suite runs at once.
  test.slow();
  await openMap(page, '#l=startups,activity');
  const timeline = page.getByRole('group', { name: 'Funding rounds over time' });
  await expect(timeline).toBeVisible();
  // The sample's rounds are all from 2024 and 2025, so this month holds none.
  await expect(timeline).toContainText('0 rounds');
  const slider = timeline.getByRole('slider', { name: 'Month' });
  // The whole of the sample's history: twelve months to the end of the span shows rounds.
  await timeline.getByRole('button', { name: '12 mo' }).click();
  await slider.fill('0');
  await expect(timeline).not.toContainText('0 rounds');

  const before = Number(await slider.inputValue());
  await timeline.getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => Number(await slider.inputValue()), { timeout: 5000 }).toBeGreaterThan(before);
  await timeline.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('checkbox', { name: /Recent activity/ })).toBeChecked();
});

test('the timeline is not there until the layer is on', async ({ page }) => {
  await openMap(page);
  await expect(page.getByRole('group', { name: 'Funding rounds over time' })).toHaveCount(0);
  await page.locator('label', { hasText: 'Recent activity' }).first().getByRole('checkbox').check();
  await expect(page.getByRole('group', { name: 'Funding rounds over time' })).toBeVisible();
});
