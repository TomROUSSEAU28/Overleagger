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

test('homepage: open beta, support link, and the contact form reaches the admin', async ({
  page,
  request,
}) => {
  const SERVER = 'http://localhost:8788';
  // The page talks to the server this browser knows (here: the test server).
  await page.addInitScript((s) => localStorage.setItem('sb.server', s), SERVER);
  await page.goto('/');
  await expect(page.locator('.beta-pill')).toContainText('Open beta');
  await expect(page.getByTestId('kofi')).toHaveAttribute('href', /ko-fi\.com/);
  const stamp = Date.now();
  const form = page.getByTestId('contact-form');
  await form.locator('input[name=email]').fill('nope');
  await form.locator('textarea').fill('Hello there');
  await form.getByRole('button', { name: 'Send' }).click();
  await expect(form.locator('.form-status')).toContainText('e-mail address');
  await form.locator('input[name=name]').fill('Léa');
  await form.locator('input[name=email]').fill(`lea.${stamp}@univ.fr`);
  await form.locator('textarea').fill(`The PDF export is great (${stamp})`);
  await form.getByRole('button', { name: 'Send' }).click();
  await expect(form.locator('.form-status')).toContainText('Thank you');

  // The administrator finds it in the admin page's messages.
  const signup = await request.post(`${SERVER}/api/auth/signup`, {
    data: { email: `boss.${stamp}@admin.test`, name: 'Boss', password: 'correct horse battery' },
  });
  const { token } = (await signup.json()) as { token: string };
  const list = await request.get(`${SERVER}/api/admin/messages`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { messages } = (await list.json()) as { messages: { body: string; name: string }[] };
  expect(messages.find((m) => m.body.includes(String(stamp)))?.name).toBe('Léa');
});

test('the privacy policy is one click away from the homepage', async ({ page }) => {
  await page.goto('/');
  await page.locator('footer').getByRole('link', { name: 'Privacy' }).click();
  await expect(page).toHaveURL(/\/privacy\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy policy');
  await expect(page.getByTestId('privacy')).toContainText('contact@circuitnotebook.com');
  // Styled like the homepage, and the way back works.
  await expect(page.locator('.legal-summary')).toBeVisible();
  await page.locator('header').getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.locator('.beta-pill')).toBeVisible();
});
