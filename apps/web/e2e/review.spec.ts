import { expect, test } from './fixtures';

// The test API treats every request as the sample's reviewer. The sample has
// three items waiting: two draft organisations, and a relationship that names
// an organisation nobody has on record.

test('a reviewer is shown the way to the queue, and what is waiting in it', async ({ page }) => {
  await page.goto('/dashboard/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Review' }).click();
  await expect(page).toHaveURL(/\/review\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Review queue');
  await expect(page.getByRole('tab', { name: /Waiting/ })).toContainText('3');

  const organisations = page.getByRole('region', { name: 'Organisations' });
  await expect(organisations.getByRole('listitem')).toHaveCount(2);
  await expect(organisations.getByRole('listitem').first()).toContainText('Sample Draft 01');
  await expect(organisations.getByRole('listitem').first()).toContainText('Held because: Dataset marks this row partially_verified');

  // The account menu says who is signed in.
  await page.getByRole('button', { name: 'reviewer@example.org' }).click();
  await expect(page.getByRole('dialog', { name: 'Account' })).toContainText('reviewer');
});

test('a relationship cannot be approved until both organisations are known', async ({ page }) => {
  await page.goto('/review/');
  const card = page.getByRole('region', { name: 'Relationships' }).getByRole('listitem');
  await expect(card).toContainText('Sample Startup 02');
  await expect(card).toContainText('is part of');
  await expect(card).toContainText('Sample Holdings not on record');
  await expect(card).toContainText('Held because: not on record: Sample Holdings');
  const approve = card.getByRole('button', { name: 'Approve and publish' });
  await expect(approve).toBeDisabled();

  // The reviewer says which record the unknown name means, and it can go ahead.
  await card.getByLabel('It means').fill('Sample Fund 03');
  await card.getByRole('button', { name: 'Sample Fund 03', exact: true }).click();
  await expect(approve).toBeEnabled();
});

test('a rejected item leaves the queue with its note, and can be reopened', async ({ page }) => {
  await page.goto('/review/');
  const card = page.getByRole('listitem').filter({ hasText: 'Sample Draft 02' });
  await card.getByRole('button', { name: 'Reject' }).click();
  await card.getByLabel('Why it is rejected').fill('Checked by a browser test');
  await card.getByRole('button', { name: 'Confirm rejection' }).click();
  await expect(page.getByRole('tab', { name: /Waiting/ })).toContainText('2');
  await expect(page.getByRole('listitem').filter({ hasText: 'Sample Draft 02' })).toHaveCount(0);

  await page.getByRole('tab', { name: /Settled/ }).click();
  const settled = page.getByRole('listitem').filter({ hasText: 'Sample Draft 02' });
  await expect(settled).toContainText('rejected by reviewer@example.org');
  await expect(settled).toContainText('Reviewer’s note: Checked by a browser test');

  // Put it back, so the sample is as it was.
  await settled.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByRole('tab', { name: /Waiting/ })).toContainText('3');
  await page.getByRole('tab', { name: /Waiting/ }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Sample Draft 02' })).toHaveCount(1);
});
