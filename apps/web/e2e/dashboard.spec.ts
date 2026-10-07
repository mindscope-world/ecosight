import { expect, test } from './fixtures';

// On the synthetic sample: 30 startups, 10 investors, 4 accelerators and 4 NGOs.

test('the dashboard lists each kind of organisation in its own table', async ({ page }) => {
  await page.goto('/dashboard/');
  const tabs = page.getByRole('tablist');
  await expect(tabs.getByRole('tab', { name: /Startups/ })).toContainText('30');
  await expect(tabs.getByRole('tab', { name: /Investors/ })).toContainText('10');
  await expect(tabs.getByRole('tab', { name: /Universities/ })).toContainText('0');

  await expect(page.locator('tbody tr')).toHaveCount(25);
  await expect(page.getByText('1–25 of 30')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(5);

  // Figures and charts are for the open tab.
  await expect(page.getByText('Raised on record')).toBeVisible();
  await expect(page.getByText('By stage')).toBeVisible();
  await expect(page.getByText('Most raised')).toBeVisible();
});

test('a table can be sorted, searched and narrowed to a country', async ({ page }) => {
  await page.goto('/dashboard/#v=1&t=investors');
  await expect(page.getByRole('tab', { name: /Investors/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('tbody tr')).toHaveCount(10);

  // Figures sort largest first: the one fund with a portfolio on record leads.
  await page.getByRole('columnheader', { name: /Portfolio/ }).getByRole('button').click();
  await expect(page.locator('tbody tr').first()).toContainText('Sample Fund 01');
  await expect(page.locator('tbody tr').first()).toContainText('6');
  await expect(page.getByRole('columnheader', { name: /Portfolio/ })).toHaveAttribute('aria-sort', 'descending');

  await page.getByRole('searchbox', { name: 'Search this table' }).fill('angel');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByText('1–2 of 2 (10 in all)')).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search this table' }).fill('no such organisation');
  await expect(page.getByText('No rows match')).toBeVisible();
});

test('a row opens the record, with ways on to the map and the graph', async ({ page }) => {
  await page.goto('/dashboard/#v=1&t=investors');
  await page.locator('tbody tr', { hasText: 'Sample Fund 01' }).click();
  const details = page.locator('aside').last();
  await expect(details.getByRole('heading', { level: 2 })).toHaveText('Sample Fund 01');
  await expect(details).toContainText('Portfolio · 6');
  await expect(page).toHaveURL(/#v=1&t=investors&s=[0-9a-f-]{36}/);
  await expect(details.getByRole('link', { name: 'Show on map' })).toHaveAttribute('href', /\/map\/#v=1&s=/);

  await details.getByRole('link', { name: 'View connections' }).click();
  await expect(page).toHaveURL(/\/graph\/#v=1&n=org/);
  await expect(page.locator('footer')).toContainText('Nodes7');
});
