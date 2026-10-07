import { expect, test } from './fixtures';

// On the synthetic sample: one fund backs six startups; one accelerator ran a
// programme for two startups and organised a meetup. Eleven nodes, nine links.

type Page = import('@playwright/test').Page;
const details = (page: Page) => page.locator('aside').last();
const controls = (page: Page) => page.locator('aside').first();
const status = (page: Page) => page.locator('footer');

async function choose(page: Page, label: string, name: string) {
  await controls(page).getByLabel(label, { exact: true }).fill(name);
  await controls(page).getByRole('button', { name, exact: true }).click();
}

test('the graph page opens on the whole network', async ({ page }) => {
  await page.goto('/graph/');
  await expect(status(page)).toContainText('Nodes11');
  await expect(status(page)).toContainText('Relationships9');
  await expect(status(page)).toContainText('Whole network');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Graph' })).toHaveAttribute('aria-current', 'page');
  // Everything drawn is also listed, most connected first.
  await expect(page.locator('#section-graph-list button').first()).toContainText('Sample Fund 01');
  await expect(page.locator('svg [data-node]')).toHaveCount(11);
});

test('starting from an investor shows its portfolio, and a company can be expanded', async ({ page }) => {
  await page.goto('/graph/');
  await page.locator('#section-graph-top').getByRole('button', { name: /Sample Fund 01/ }).click();
  await expect(status(page)).toContainText('Nodes7');
  await expect(status(page)).toContainText('From Sample Fund 01');
  await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Sample Fund 01');
  await expect(page).toHaveURL(/#v=1&n=org%3A[0-9a-f-]{36}/);

  // To one of its companies, which shares the investor with five others.
  await page.locator('#section-graph-list').getByRole('button', { name: /Sample Startup 05/ }).click();
  await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Sample Startup 05');
  await expect(details(page)).toContainText('Shares an investor with · 5');
  await expect(details(page).getByRole('link', { name: 'Show on map' })).toHaveAttribute('href', /\/map\/#v=1&s=[0-9a-f-]{36}/);

  // Centred on the company, only its investor is drawn; the rest come in on request.
  await details(page).getByRole('button', { name: 'Centre the graph here' }).click();
  await expect(status(page)).toContainText('Nodes2');
  await page.locator('#section-graph-list').getByRole('button', { name: /Sample Fund 01/ }).click();
  await details(page).getByRole('button', { name: 'Show 5 more connections' }).click();
  await expect(status(page)).toContainText('Nodes7');
  await expect(page.locator('svg [data-node]')).toHaveCount(7);

  // The address restores the same graph.
  await page.reload();
  await expect(status(page)).toContainText('Nodes7');
});

test('switching kinds of link off and on changes what is drawn', async ({ page }) => {
  await page.goto('/graph/');
  await expect(status(page)).toContainText('Nodes11');
  await page.getByLabel('Invested in').uncheck();
  await expect(status(page)).toContainText('Nodes4');
  await expect(status(page)).toContainText('Relationships3');
  // People are followed only when asked for.
  await page.getByLabel('Founded or leads').check();
  await expect(status(page)).toContainText('Nodes5');
  await expect(page).toHaveURL(/k=accelerated_at,organised,[a-z_,]*partner_of,has_role$/);
});

test('the path finder gives the chain between two organisations, or says there is none', async ({ page }) => {
  await page.goto('/graph/');
  await choose(page, 'From', 'Sample Startup 05');
  await choose(page, 'To', 'Sample Startup 30');
  await page.getByRole('button', { name: 'Find the shortest chain' }).click();
  await expect(controls(page)).toContainText('2 links: Sample Startup 05 → Sample Fund 01 → Sample Startup 30');

  await controls(page).getByRole('button', { name: 'Change To' }).click();
  await choose(page, 'To', 'Sample Startup 01');
  await page.getByRole('button', { name: 'Find the shortest chain' }).click();
  await expect(controls(page)).toContainText('No connection on record');
});

test('a link says what it stands for', async ({ page }) => {
  await page.goto('/graph/');
  await page.locator('#section-graph-top').getByRole('button', { name: /Sample Fund 01/ }).click();
  await expect(status(page)).toContainText('Nodes7');
  await page.locator('svg [data-edge]').first().click({ force: true });
  await expect(details(page)).toContainText('Selected link');
  await expect(details(page)).toContainText('Rounds · 1');
  await expect(details(page)).toContainText('lead');
});

test('the map leads to the graph for the selected organisation', async ({ page }) => {
  await page.goto('/map/');
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Search' }).getByRole('searchbox').fill('Sample Fund 01');
  await page.getByRole('option').first().click();
  await details(page).getByRole('link', { name: 'View connections' }).click();
  await expect(page).toHaveURL(/\/graph\/#v=1&n=org/);
  await expect(status(page)).toContainText('Nodes7');
  await expect(details(page).getByRole('heading', { level: 2 })).toHaveText('Sample Fund 01');
});

test('one link, or every link of a record, can be switched off and back on', async ({ page }) => {
  await page.goto('/graph/');
  await expect(status(page)).toContainText('Relationships9');

  // All six of the fund's links at once.
  await page.locator('#section-graph-list').getByRole('button', { name: /Sample Fund 01/ }).click();
  await details(page).getByRole('button', { name: 'Switch off its 6 links' }).click();
  await expect(status(page)).toContainText('(6 off)');
  await expect(page.locator('svg [data-edge][data-off]')).toHaveCount(6);
  // They stay drawn, faint, and are listed so each can be found again.
  await expect(page.locator('svg [data-edge]')).toHaveCount(9);
  await expect(page.locator('#section-graph-off li')).toHaveCount(6);
  await expect(page).toHaveURL(/&o=/);

  // One of them back on from the list, then from its own details.
  await page.locator('#section-graph-off li').first().getByRole('button', { name: 'On', exact: true }).click();
  await expect(status(page)).toContainText('(5 off)');
  await page.locator('#section-graph-off li').first().getByRole('button').first().click();
  await expect(details(page)).toContainText('Selected link');
  await details(page).getByRole('button', { name: 'Switch this link on' }).click();
  await expect(status(page)).toContainText('(4 off)');
  await expect(details(page).getByRole('button', { name: 'Switch this link off' })).toBeVisible();

  // The address carries what is off.
  await page.reload();
  await expect(status(page)).toContainText('(4 off)');
  await page.locator('#section-graph-off').getByRole('button', { name: 'Switch all back on' }).click();
  await expect(page.locator('svg [data-edge][data-off]')).toHaveCount(0);
  await expect(page.locator('#section-graph-off')).toHaveCount(0);
});

