import { expect, test } from './fixtures';

// These tests move items in and out of the one queue, so they take turns.
test.describe.configure({ mode: 'serial' });

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

  await page.getByRole('tab', { name: /Approved or rejected/ }).click();
  const settled = page.getByRole('listitem').filter({ hasText: 'Sample Draft 02' });
  await expect(settled).toContainText('rejected by reviewer@example.org');
  await expect(settled).toContainText('Reviewer’s note: Checked by a browser test');

  // Put it back, so the sample is as it was.
  await settled.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByRole('tab', { name: /Waiting/ })).toContainText('3');
  await page.getByRole('tab', { name: /Waiting/ }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Sample Draft 02' })).toHaveCount(1);
});

test('an incomplete record can be archived, found in the archive, and reopened', async ({ page }) => {
  await page.goto('/review/');
  const card = page.getByRole('listitem').filter({ hasText: 'Sample Draft 01' });
  await expect(card.getByRole('button', { name: 'Archive' })).toBeVisible();
  await card.getByRole('button', { name: 'Archive' }).click();
  await card.getByLabel('What is missing').fill('No address yet');
  await card.getByRole('button', { name: 'Move to the archive' }).click();
  await expect(page.getByRole('tab', { name: /Archived/ })).toContainText('1');
  await expect(page.getByRole('listitem').filter({ hasText: 'Sample Draft 01' })).toHaveCount(0);

  // It is in the archive, not among the approved and rejected.
  await page.getByRole('tab', { name: /Archived/ }).click();
  const archived = page.getByRole('listitem').filter({ hasText: 'Sample Draft 01' });
  await expect(archived).toContainText('archived by reviewer@example.org');
  await expect(archived).toContainText('Reviewer’s note: No address yet');

  // Put it back, so the sample is as it was.
  await archived.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByRole('tab', { name: /Archived/ })).toContainText('0');
});

test('a funding round read from the news is shown with what it was read from', async ({ page }) => {
  // The sample has no news, so two proposed rounds are added to the waiting list on its way to the page.
  const round = (id: string, changes: object) => ({
    id, kind: 'round', status: 'pending', reason: 'Read from a news report by an extractor; a person must confirm it before it is published',
    note: null, source: 'news', created_at: '2026-10-08T09:00:00Z', reviewed_at: null, reviewed_by: null, organisation: null, proposal: null,
    round: {
      title: 'Sample Startup 07 raises $2.5 million seed round', source_url: 'https://news.example/sample-startup-07-raises',
      publisher: 'test-feed', extractor: 'rules', announced_on: '2026-10-06', company: 'Sample Startup 07', company_quote: 'Sample Startup 07',
      company_match: { id: '00000000-0000-4000-8000-000000000007', name: 'Sample Startup 07', types: ['startup'] },
      amount: 2500000, amount_quote: '$2.5 million', currency: 'USD', stage: 'seed', stage_quote: 'seed round',
      investors: [
        { name: 'Sample Fund 02', quote: 'Sample Fund 02', match: { id: '00000000-0000-4000-8000-000000000002', name: 'Sample Fund 02', types: ['fund'] } },
        { name: 'Unknown Capital', quote: 'Unknown Capital', match: null },
      ],
      duplicate: true,
      ...changes,
    },
  });
  await page.route('**/review/items?status=pending', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.items.push(round('00000000-0000-4000-8000-0000000000a1', {}), round('00000000-0000-4000-8000-0000000000a2', { company: 'Nobody Knows Ltd', company_match: null, duplicate: false }));
    await route.fulfill({ response, json: body });
  });

  await page.goto('/review/');
  const rounds = page.getByRole('region', { name: 'Funding rounds' }).getByRole('listitem');
  await expect(rounds).toHaveCount(2);

  const known = rounds.first();
  await expect(known).toContainText('Funding round read from the news · test-feed');
  await expect(known).toContainText('Sample Startup 07');
  await expect(known).toContainText('$2.5M');
  await expect(known).toContainText('“$2.5 million”');
  await expect(known).toContainText(/Unknown Capital\s*not on record/);
  await expect(known).toContainText('already has a round on record');
  await expect(known.getByRole('link', { name: 'news.example' })).toHaveAttribute('href', 'https://news.example/sample-startup-07-raises');
  await expect(known.getByRole('button', { name: 'Approve and publish' })).toBeEnabled();

  // A company nobody has on record has to be named before the round can be approved.
  const unknown = rounds.nth(1);
  await expect(unknown).toContainText('Nobody Knows Ltd not on record');
  await expect(unknown.getByRole('button', { name: 'Approve and publish' })).toBeDisabled();
  await unknown.getByLabel('It means').fill('Sample Startup 08');
  await unknown.getByRole('button', { name: 'Sample Startup 08', exact: true }).click();
  await expect(unknown.getByRole('button', { name: 'Approve and publish' })).toBeEnabled();
});

