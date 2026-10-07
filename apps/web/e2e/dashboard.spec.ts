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

test('the by-country tab puts every kind side by side for each country', async ({ page }) => {
  await page.goto('/dashboard/');
  await page.getByRole('tab', { name: /By country/ }).click();
  await expect(page).toHaveURL(/#v=1&t=countries/);
  await expect(page.getByText('Organisations by country')).toBeVisible();

  // The sample is all in Kenya: one row, with its 48 organisations split by kind.
  const row = page.locator('tbody tr');
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('rowheader')).toHaveText('Kenya');
  const cells = row.getByRole('cell');
  await expect(cells.nth(0)).toHaveText('48');
  await expect(cells.nth(2)).toHaveText('30'); // startups
  await expect(cells.nth(3)).toHaveText('10'); // investors
  await expect(row.getByRole('link', { name: 'Kenya' })).toHaveAttribute('href', /\/map\/#v=1&fk=KE/);

  // The address reopens the same tab.
  await page.reload();
  await expect(page.getByRole('tab', { name: /By country/ })).toHaveAttribute('aria-selected', 'true');
});

test('investors with no office can be listed on their own', async ({ page }) => {
  // The sample places every investor, so two are stripped of their office on the way to the page.
  await page.route('**/orgs?*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    let stripped = 0;
    for (const row of body.organisations) {
      if (stripped < 2 && row.types.includes('fund')) {
        Object.assign(row, { city: null, country: null, precision: null });
        stripped += 1;
      }
    }
    await route.fulfill({ response, json: body });
  });

  await page.goto('/dashboard/#v=1&t=investors');
  const button = page.getByRole('button', { name: /Not on the map/ });
  await expect(button).toContainText('2');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByText('1–2 of 2 (10 in all)')).toBeVisible();
  await expect(page.getByText(/cannot draw them/)).toBeVisible();
  await expect(page).toHaveURL(/#v=1&t=investors&u=1/);

  // The address reopens the same list; another tab starts without it.
  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('tab', { name: /Startups/ }).click();
  await expect(page.getByRole('button', { name: /Not on the map/ })).toHaveCount(0);
  await expect(page.locator('tbody tr')).toHaveCount(25);
});
