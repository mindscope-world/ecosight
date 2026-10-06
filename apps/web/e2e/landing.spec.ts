import { expect, test } from './fixtures';

test('the landing page says what the product is and leads to the map', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/See where\s*innovation happens\./);
  // Figures on the hero come from the product's own records, and are marked as such.
  await expect(page.getByText('organisations on the map')).toBeVisible();
  await expect(page.getByText('Live').first()).toBeVisible();

  await page.getByRole('link', { name: 'Explore the Map' }).first().click();
  await expect(page).toHaveURL(/\/map\/$/);
  await expect(page.getByText('Ecosystem overview')).toBeVisible();
});

test('every section of the story is on the page', async ({ page }) => {
  await page.goto('/');
  for (const heading of [
    'The ecosystem is everywhere.',
    'One ecosystem. Every layer.',
    'Explore ecosystems at every scale.',
    'Find the people who can move your company forward.',
    'See deal flow before it becomes a spreadsheet.',
    'A map that becomes smarter over time.',
    'Innovation doesn’t happen in one place.',
    'The ecosystem is moving.',
  ])
    await expect(page.getByRole('heading', { name: new RegExp(heading.replace(/[.?]/g, '\\$&')) })).toBeVisible();
  // Example figures are never shown without saying that they are examples.
  await expect(page.locator('#signals').getByText('Demo data').first()).toBeVisible();
});

test('a share link from before the map moved is sent on to it', async ({ page }) => {
  await page.goto('/#v=1&p=investors');
  await expect(page).toHaveURL(/\/map\/#v=1&p=investors/);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Investors' })).toHaveAttribute('aria-current', 'page');
});

test('the landing page still works when the product records cannot be loaded', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // With nothing real to show, the hero falls back to examples and labels them.
  await expect(page.getByText('Points on this map are illustrative.')).toBeVisible();
  await expect(page.getByText('Demo data').first()).toBeVisible();
});
