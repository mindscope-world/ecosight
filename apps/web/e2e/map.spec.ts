import { expect, test } from './fixtures';

// These run against the synthetic sample: 48 organisations and 6 events around Nairobi.

const details = (page: import('@playwright/test').Page) => page.locator('aside').last();
const statusBar = (page: import('@playwright/test').Page) => page.locator('footer');

async function search(page: import('@playwright/test').Page, query: string) {
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Search' }).getByRole('searchbox').fill(query);
}

test('the map app loads its records and counts them', async ({ page }) => {
  await page.goto('/map/');
  await expect(statusBar(page)).toContainText('Entities');
  await expect(statusBar(page)).toContainText('54');
  await expect(page.getByText('Ecosystem overview')).toBeVisible();
  // The layer list shows how many records each layer holds.
  await expect(page.locator('label', { hasText: 'Startups' })).toContainText('30');
  await expect(page.locator('label', { hasText: 'Investors' })).toContainText('10');
});

test('search finds a record, opens it, and follows a connection', async ({ page }) => {
  await page.goto('/map/');
  await search(page, 'Sampel Startup 10'); // a typo, on purpose
  const first = page.getByRole('option').first();
  await expect(first).toContainText('Sample Startup 10');
  await first.click();

  await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Sample Startup 10');
  await expect(details(page)).toContainText('Inactive');
  await expect(details(page)).toContainText('$1M');
  await expect(page).toHaveURL(/[#&]s=[0-9a-f-]{36}/);

  // From the startup to its investor, then on to another company it backed.
  await details(page).getByRole('button', { name: 'Sample Fund 01' }).click();
  await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Sample Fund 01');
  await expect(details(page)).toContainText('Portfolio · 6');
  await details(page).getByRole('button', { name: 'Sample Startup 25' }).click();
  await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Sample Startup 25');
});

test('search reads a kind, a sector and a city, and groups what it finds', async ({ page }) => {
  await page.goto('/map/');
  await search(page, 'fintech investors in nairobi');
  const palette = page.getByRole('dialog', { name: 'Search' });
  await expect(palette).toContainText('Reading this as');
  await expect(palette).toContainText('Investor · fintech · Nairobi');
  await expect(palette.getByText('Locations', { exact: true })).toBeVisible();
  await expect(palette.getByText('Sectors', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});

test('filters narrow the counts, the panels and the address together', async ({ page }) => {
  await page.goto('/map/');
  await expect(statusBar(page)).toContainText('54');
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('button', { name: 'fintech', exact: true }).click();

  await expect(page.getByText(/^\d+ organisations? match$/)).not.toHaveText('48 organisations match');
  await expect(statusBar(page)).toContainText('Entities in view');
  await expect(page).toHaveURL(/fs=fintech/);
  // The sector list now has one leader at 100%, which only the filtered figures can give.
  await expect(page.locator('aside').first()).toContainText('100%');

  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(statusBar(page)).toContainText('54');
  await expect(page).not.toHaveURL(/fs=/);
});

test('a share link restores the lens, the filters and the selected record', async ({ page }) => {
  await page.goto('/map/');
  await search(page, 'Sample Startup 03');
  await page.getByRole('option').first().click();
  await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Sample Startup 03');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Startups' }).click();
  await expect(page).toHaveURL(/p=startups/);

  const link = page.url();
  await page.goto('about:blank');
  await page.goto(link);
  await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Sample Startup 03');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Startups' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('label', { hasText: 'Investors' }).getByRole('checkbox')).not.toBeChecked();
});

test('panels can be minimised and stay that way', async ({ page }) => {
  await page.goto('/map/');
  const section = page.getByRole('button', { name: /Top sectors/ });
  await expect(section).toHaveAttribute('aria-expanded', 'true');
  await section.click();
  await expect(section).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(page.getByRole('button', { name: /Top sectors/ })).toHaveAttribute('aria-expanded', 'false');
});

test('on a phone the panels become sheets and search a button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/map/');
  await expect(page.locator('aside')).toHaveCount(0);
  await page.getByRole('button', { name: 'Insights' }).click();
  await expect(page.getByText('Ecosystem signal')).toBeVisible();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
});

test('the overview and activity figures lead to the records they count', async ({ page }) => {
  await page.goto('/map/');
  const activity = page.locator('#section-activity');
  await expect(activity.getByRole('link', { name: /Funding rounds/ })).toHaveAttribute('href', /\/dashboard\/#v=1&t=startups&w=rounds/);
  await expect(activity.getByRole('link', { name: /Active investors/ })).toHaveAttribute('href', /\/dashboard\/#v=1&t=investors&w=active/);
  await expect(activity.getByRole('link', { name: /Programs added/ })).toHaveAttribute('href', /\/dashboard\/#v=1&t=accelerators&w=programs/);
  await expect(page.locator('#section-overview').getByRole('link', { name: /Investors/ })).toHaveAttribute('href', /\/dashboard\/#v=1&t=investors/);

  // Upcoming events are on the map itself: the figure switches to the events lens.
  await activity.getByRole('button', { name: /Upcoming events/ }).click();
  await expect(page).toHaveURL(/p=events/);

  await activity.getByRole('link', { name: /Startups added/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/#v=1&t=startups&w=added/);
  await expect(page.getByRole('tab', { name: /Startups/ })).toHaveAttribute('aria-selected', 'true');
  // The list can always be widened again, so the reader is never left on a dead end.
  await page.getByRole('button', { name: /Added in the last 30 days/ }).click();
  await expect(page).toHaveURL(/#v=1&t=startups$/);
  await expect(page.locator('tbody tr')).toHaveCount(25);
});

test('a selected record offers to switch its lines on the map off and on', async ({ page }) => {
  await page.goto('/map/');
  await search(page, 'Sample Fund 01');
  await page.getByRole('dialog', { name: 'Search' }).getByRole('option').first().click();
  const lines = details(page).getByRole('button', { name: /Lines on/ });
  await expect(lines).toHaveAttribute('aria-pressed', 'true');
  await lines.click();
  await expect(details(page).getByRole('button', { name: /Lines off/ })).toHaveAttribute('aria-pressed', 'false');
});

