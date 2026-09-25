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
  await page.locator('footer').getByRole('link', { name: 'Legal notice' }).click();
  await expect(page.getByTestId('legal')).toContainText('Hetzner Online GmbH');
  await page.locator('header').getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.locator('.beta-pill')).toBeVisible();
});

test('homepage: the notebook turns its pages as you scroll', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.nb')).toHaveClass(/nb-on/);
  await expect(page.locator('.nb-page')).toHaveCount(6);
  const tab = (name: string) => page.locator('.nb-tab', { hasText: name });
  const written = (id: string) =>
    page.locator(id).evaluate((e) => Number(getComputedStyle(e).getPropertyValue('--q')));
  // The tab of the third page opens it: the first two are turned over the spiral.
  await tab('Waveforms').click();
  await expect(tab('Waveforms')).toHaveClass(/on/);
  await expect(page.locator('#p-schematics')).toBeHidden();
  await expect(page.locator('#p-hierarchy')).toBeHidden();
  await expect(page.locator('#p-waveforms h2')).toBeInViewport();
  // Its pencil notes are written.
  await expect.poll(() => written('#p-waveforms')).toBeGreaterThan(0.9);
  // Scrolling on turns the next page.
  await page.mouse.wheel(0, 1200);
  await expect(tab('Together')).toHaveClass(/on/);
  await expect(page.locator('#p-waveforms')).toBeHidden();
  // A link to a page lands on it.
  await page.goto('/#p-present');
  await expect(tab('Present')).toHaveClass(/on/);
  expect(errors).toEqual([]);
});

test('homepage: with reduced motion, the pages are simply one under the other', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.nb')).not.toHaveClass(/nb-on/);
  const pages = page.locator('.nb-page');
  await pages.nth(3).scrollIntoViewIfNeeded();
  await expect(pages.nth(3)).toBeInViewport();
  // Nothing is left half written.
  const hw = page.locator('#p-together .hw').first();
  expect(await hw.evaluate((e) => getComputedStyle(e).clipPath)).not.toContain('100%');
});

test('version, what is new, manual and changelog', async ({ page }) => {
  await page.goto('/app/#/example');
  const chip = page.getByTestId('version-chip');
  await expect(chip).toHaveClass(/fresh/);
  await chip.click();
  await expect(page.getByTestId('whatsnew')).toContainText('First open beta');
  await expect(chip).not.toHaveClass(/fresh/);
  // Its links open the manual and the versions (in a new tab, the dialog stays).
  for (const [name, path] of [
    ['User manual', '/manual/'],
    ['All versions', '/changelog/'],
  ] as const) {
    const opened = page.context().waitForEvent('page');
    await page.getByRole('link', { name }).click();
    const tab = await opened;
    await expect(tab).toHaveURL(new RegExp(`${path}$`));
    await tab.close();
    await expect(page.getByTestId('whatsnew')).toBeVisible();
  }
  await page.goto('/manual/');
  await expect(page.getByTestId('manual')).toContainText('How to use Circuit Notebook');
  await expect(page.locator('[data-version]').first()).toContainText('beta');
  await page.goto('/changelog/');
  await expect(page.locator('.release')).toHaveCount(1);
  await expect(page.locator('.release').first()).toContainText('current version');
});
