import { expect, test as base } from '@playwright/test';

/**
 * Every test runs without the outside world: requests to anything but the app
 * itself are refused. The basemap therefore never loads, which keeps the tests
 * from depending on a public tile server. What they cover is everything around
 * the map: the data, the panels, search, filters, selection and share links.
 */
export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(
      (url) => !url.href.startsWith(baseURL!),
      (route) => route.abort(),
    );
    await use(page);
    expect(errors, 'the page raised no script errors').toEqual([]);
  },
});

export { expect };
