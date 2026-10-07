import { expect, test } from './fixtures';

// The test API treats every request as the sample's reviewer, so saved views
// are kept with that account.

test('a view can be saved under a name, opened again, and removed', async ({ page }) => {
  const name = `Investors only ${Date.now()}`;
  await page.goto('/map/#v=1&p=investors');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Investors' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Saved views' }).click();
  const menu = page.getByRole('dialog', { name: 'Saved views' });
  await menu.getByLabel('Save this view').fill(name);
  await menu.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(menu.getByRole('button', { name: new RegExp('^' + name) })).toContainText('Map');
  await expect(menu).toContainText('Kept with your account.');

  // From another page, it leads back to the map as it was saved.
  await page.goto('/dashboard/');
  await page.getByRole('button', { name: 'Saved views' }).click();
  await page.getByRole('dialog', { name: 'Saved views' }).getByRole('button', { name: new RegExp('^' + name) }).click();
  await expect(page).toHaveURL(/\/map\/#v=1&p=investors/);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Investors' })).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', { name: 'Saved views' }).click();
  await page.getByRole('dialog', { name: 'Saved views' }).getByRole('button', { name: `Remove ${name}` }).click();
  await expect(page.getByRole('dialog', { name: 'Saved views' }).getByRole('button', { name: new RegExp('^' + name) })).toHaveCount(0);
});

test('the bell tells a reviewer what is waiting', async ({ page }) => {
  await page.goto('/graph/');
  const bell = page.getByRole('button', { name: /^What is new/ });
  await expect(bell).toHaveAccessibleName(/new$/);
  await bell.click();
  const menu = page.getByRole('dialog', { name: 'What is new' });
  await expect(menu.getByRole('link', { name: /waiting for review/ })).toHaveAttribute('href', /\/review\/$/);
  await expect(menu).toContainText('Published since you last looked');
});

test('the landing page leads to sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', /\/map\/\?signin$/);
});
