import { expect, test } from '@playwright/test';

test('homepage: links to the app, the example, and old links still work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page).toHaveTitle(/Circuit Notebook/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('The engineering notebook');
  // Every screenshot of the page loads.
  for (const img of await page.locator('img').all()) {
    await img.scrollIntoViewIfNeeded();
    await expect
      .poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth))
      .toBeGreaterThan(0);
  }

  // "Open the app" → the dashboard.
  await page.getByRole('link', { name: 'Open the app' }).first().click();
  await expect(page.getByTestId('new-project')).toBeVisible();
  await expect(page).toHaveTitle(/Your projects — Circuit Notebook/);

  // The example opens straight in the editor.
  await page.goto('/app/#/example');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page).toHaveURL(/#\/p\//);
  await expect(page).toHaveTitle(/Buck converter example — Circuit Notebook/);

  // A link from before the homepage existed (/#/p/<id>) is sent on to the editor.
  const hash = new URL(page.url()).hash;
  await page.goto('/' + hash);
  await expect(page).toHaveURL(/\/app\/#\/p\//);
  await expect(page.getByTestId('canvas')).toBeVisible();
  expect(errors).toEqual([]);
});
