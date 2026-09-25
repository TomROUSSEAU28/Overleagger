import { expect, test, type Browser, type Page } from '@playwright/test';

const SERVER = 'http://localhost:8788';
const stamp = Date.now();

async function person(browser: Browser, name: string, domain = 'lab.test'): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => void d.accept());
  await page.goto('/app/');
  await page.getByTestId('connect-server').click();
  await page.getByTestId('server-url').fill(SERVER);
  await page.getByTestId('server-connect').click();
  await page.getByTestId('sign-in').click();
  await page.getByTestId('auth-switch').click();
  await page.getByTestId('auth-name').fill(name);
  await page.getByTestId('auth-email').fill(`${name.toLowerCase()}.${stamp}@${domain}`);
  await page.getByTestId('auth-password').fill('correct horse battery');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('account-menu')).toContainText(name);
  return page;
}

const elementCount = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { __overleagger: { ed: { elements(): unknown[] } } }
      ).__overleagger.ed.elements().length,
  );

test('two people edit, comment and follow each other in real time', async ({ browser }) => {
  const alice = await person(browser, 'Alice');
  // Alice creates a shared project from the example.
  await alice.getByTestId('open-example').click();
  await expect(alice.getByTestId('canvas')).toBeVisible();
  await alice.getByTestId('open-share').click();
  await alice.getByTestId('share-upload').click();
  await alice.waitForURL(/#\/cloud\//);
  await expect(alice.getByTestId('canvas')).toBeVisible();
  // Invite link for an editor.
  await alice.getByTestId('open-share').click();
  await alice.getByTestId('invite-role').selectOption('editor');
  await alice.getByTestId('create-invite').click();
  const link = await alice.getByTestId('invite-link').first().inputValue();
  await alice.keyboard.press('Escape');

  const bob = await person(browser, 'Bob');
  await bob.goto(link);
  await bob.getByTestId('invite-accept').click();
  await expect(bob.getByTestId('canvas')).toBeVisible();
  await expect(alice.getByTestId('peer-avatar')).toHaveCount(1);

  // Bob adds a part: Alice sees it.
  const before = await elementCount(alice);
  await bob.getByTestId('library-search').fill('resistor');
  await bob.getByTestId('symbol-resistor').click();
  const box = (await bob.getByTestId('canvas').boundingBox())!;
  await bob.mouse.click(box.x + 120, box.y + 120);
  await expect.poll(() => elementCount(alice)).toBe(before + 1);
  // …and his cursor.
  await bob.mouse.move(box.x + 300, box.y + 200);
  await expect(alice.getByTestId('remote-cursor')).toHaveCount(1);

  // Alice comments, Bob replies.
  await alice.keyboard.press('c');
  const abox = (await alice.getByTestId('canvas').boundingBox())!;
  await alice.mouse.click(abox.x + 400, abox.y + 160);
  await alice.getByTestId('comment-text').fill('Is 22 µH enough?');
  await alice.getByTestId('comment-post').click();
  await expect(bob.getByTestId('comment-pin')).toHaveCount(1);
  await bob.getByTestId('comment-pin').click();
  await bob.getByTestId('comment-text').fill('Yes, ripple is 18 %.');
  await bob.getByTestId('comment-post').click();
  await expect(alice.getByTestId('comment-popover')).toContainText('ripple is 18');

  // Alice drags her bubble somewhere else: Bob sees it move.
  const pinPos = (p: typeof alice) =>
    p.evaluate(() => {
      const w = window as unknown as {
        __overleagger: { ed: { project: { getComments(): { x: number; y: number }[] } } };
      };
      const t = w.__overleagger.ed.project.getComments()[0]!;
      return { x: Math.round(t.x), y: Math.round(t.y) };
    });
  const pinBefore = await pinPos(alice);
  const pin = (await alice.getByTestId('comment-pin').boundingBox())!;
  await alice.mouse.move(pin.x + pin.width / 2, pin.y + pin.height / 2);
  await alice.mouse.down();
  await alice.mouse.move(pin.x + pin.width / 2 + 60, pin.y + pin.height / 2 + 40, { steps: 5 });
  await alice.mouse.up();
  await expect.poll(() => pinPos(bob)).not.toEqual(pinBefore);
  expect(await pinPos(bob)).toEqual(await pinPos(alice));

  // Follow mode.
  await alice.getByTestId('peer-avatar').click();
  await expect(alice.getByTestId('follow-frame')).toContainText('Following Bob');

  // History: save a version.
  await alice.getByTestId('open-history').click();
  await alice.getByTestId('version-label').fill('Before review');
  await alice.getByTestId('save-version').click();
  await expect(alice.getByTestId('versions')).toContainText('Before review');
});

test('friends and teams: add a friend by username, share a project with a team', async ({
  browser,
}) => {
  const chloe = await person(browser, 'Chloe');
  const dan = await person(browser, 'Dan');

  // Dan reads his username on the Friends & teams page and gives it to Chloe.
  await dan.getByTestId('dash-people').click();
  const handle = (await dan.getByTestId('my-handle').textContent())!.trim();
  expect(handle).toMatch(/^@dan/);

  await chloe.getByTestId('dash-people').click();
  await chloe.getByTestId('friend-who').fill(handle);
  await chloe.getByTestId('friend-add').click();
  await expect(chloe.getByText('Waiting for an answer')).toBeVisible();

  // Dan sees the request (badge) and accepts.
  await dan.reload();
  await expect(dan.getByTestId('friend-requests')).toContainText('Chloe');
  await expect(dan.locator('.count-badge').first()).toHaveText('1');
  await dan.getByTestId('friend-accept').click();
  await expect(dan.getByTestId('friends')).toContainText('Chloe');

  // Chloe makes a team with Dan.
  await chloe.reload();
  await expect(chloe.getByTestId('friends')).toContainText('Dan');
  await chloe.getByTestId('team-name').fill('Lab group 4');
  await chloe.getByTestId('team-create').click();
  const dansOption = await chloe
    .getByTestId('team-add-member')
    .locator('option', { hasText: 'Dan' })
    .textContent();
  await chloe.getByTestId('team-add-member').selectOption({ label: dansOption! });
  await expect(chloe.getByTestId('team')).toContainText('Dan');

  // A project on the server, shared with the team from the Share button.
  await chloe.goto('/app/');
  await chloe.getByTestId('new-project').click();
  await chloe.getByTestId('new-project-name').fill('Team converter');
  await chloe.getByTestId('new-project-where').selectOption('cloud');
  await chloe.getByTestId('create-project').click();
  await expect(chloe.getByTestId('canvas')).toBeVisible();
  await chloe.getByTestId('open-share').click();
  await chloe.getByTestId('share-pick').selectOption({ label: 'Lab group 4 (2)' });
  await chloe.getByTestId('share-add').click();
  await expect(chloe.getByTestId('project-teams')).toContainText('Lab group 4');

  // Dan finds it on his dashboard, marked with the team, and opens it.
  await dan.goto('/app/');
  const card = dan.getByTestId('cloud-card').filter({ hasText: 'Team converter' });
  await expect(card).toContainText('Team Lab group 4');
  await card.locator('a.card-title').click();
  await expect(dan.getByTestId('canvas')).toBeVisible();
});

test('rights per sheet: edit one sheet only, then a hidden sheet', async ({ browser }) => {
  const emma = await person(browser, 'Emma');
  const fred = await person(browser, 'Fred');
  // Friends, through the Friends & teams page.
  await fred.getByTestId('dash-people').click();
  const handle = (await fred.getByTestId('my-handle').textContent())!.trim();
  await emma.getByTestId('dash-people').click();
  await emma.getByTestId('friend-who').fill(handle);
  await emma.getByTestId('friend-add').click();
  await fred.reload();
  await fred.getByTestId('friend-accept').click();

  // Emma: the example on the server, Fred as a viewer…
  await emma.goto('/app/');
  await emma.getByTestId('new-project').click();
  await emma.getByTestId('start-example').click();
  await emma.getByTestId('new-project-where').selectOption('cloud');
  await emma.getByTestId('create-project').click();
  await expect(emma.getByTestId('canvas')).toBeVisible();
  await emma.getByTestId('open-share').click();
  const fredOption = await emma
    .getByTestId('share-pick')
    .locator('option', { hasText: 'Fred' })
    .textContent();
  await emma.getByTestId('share-pick').selectOption({ label: fredOption! });
  await emma.locator('.share-add select').nth(1).selectOption('viewer');
  await emma.getByTestId('share-add').click();
  // …who may edit the controller sheet.
  const ctrlSheet = await emma
    .getByTestId('access-sheet')
    .locator('option', { hasText: 'Voltage controller' })
    .getAttribute('value');
  await emma.getByTestId('access-sheet').selectOption(ctrlSheet!);
  await emma.getByTestId('sheet-level').first().selectOption('editor');
  await expect(emma.getByTestId('sheet-level').first()).toHaveValue('editor');
  const url = emma.url();
  await emma.keyboard.press('Escape');

  // Fred: view only on the power stage…
  await fred.goto(url);
  await expect(fred.getByTestId('canvas')).toBeVisible();
  await expect(fred.getByTestId('access-banner')).toContainText('View only on this sheet');
  const canEdit = () =>
    fred.evaluate(() =>
      (
        window as unknown as { __overleagger: { ed: { canEdit(): boolean } } }
      ).__overleagger.ed.canEdit(),
    );
  expect(await canEdit()).toBe(false);
  // …but he edits the controller.
  await fred.getByTestId('tab-sheets').click();
  await fred.getByTestId('sheet-Voltage controller').click();
  await expect(fred.getByTestId('access-banner')).toHaveCount(0);
  expect(await canEdit()).toBe(true);
  await fred.evaluate(() => {
    const { ed } = (
      window as unknown as {
        __overleagger: { ed: { commit(f: () => void): void; addElement(e: object): void } };
      }
    ).__overleagger;
    ed.commit(() =>
      ed.addElement({
        type: 'text',
        x: 0,
        y: 400,
        text: 'Fred was here',
        size: 16,
        align: 'start',
      }),
    );
  });
  // Emma sees it (live), on the controller sheet.
  await expect
    .poll(() =>
      emma.evaluate(() => {
        const p = (
          window as unknown as {
            __overleagger: {
              ed: {
                project: {
                  listSheets(): { id: string; name: string }[];
                  getElements(id: string): { text?: string }[];
                };
              };
            };
          }
        ).__overleagger.ed.project;
        const s = p.listSheets().find((x) => x.name === 'Voltage controller')!;
        return p.getElements(s.id).some((e) => e.text === 'Fred was here');
      }),
    )
    .toBe(true);

  // Emma now hides the controller from Fred: he is taken out of it, and its content leaves
  // his browser; the block stays, with a padlock.
  const fredSees = () =>
    fred.evaluate(() => {
      const p = (
        window as unknown as {
          __overleagger: {
            ed: {
              project: {
                listSheets(): { id: string; name: string }[];
                getElements(id: string): unknown[];
              };
            };
          };
        }
      ).__overleagger.ed.project;
      const s = p.listSheets().find((x) => x.name === 'Voltage controller')!;
      return p.getElements(s.id).length;
    });
  expect(await fredSees()).toBeGreaterThan(0);
  await emma.getByTestId('open-share').click();
  await emma.getByTestId('access-sheet').selectOption(ctrlSheet!);
  await emma.getByTestId('sheet-level').first().selectOption('hidden');
  await expect(emma.getByTestId('sheet-level').first()).toHaveValue('hidden');
  await emma.keyboard.press('Escape');
  await expect.poll(fredSees).toBe(0);
  await expect(fred.getByTestId('sheet-Voltage controller')).toHaveClass(/hidden-sheet/);
  await expect(fred.locator('[data-restricted]')).toHaveCount(1);
  await fred.getByTestId('sheet-Voltage controller').click();
  await expect(fred.getByTestId('toast')).toContainText('hidden from you');
  // The PDF of Fred leaves the sheet out: one page less than Emma's.
  const pages = (page: typeof fred) =>
    page.evaluate(async () => {
      const { ed } = (
        window as unknown as {
          __overleagger: {
            ed: { project: { listSheets(): { id: string }[]; canRead(id: string): boolean } };
          };
        }
      ).__overleagger;
      return ed.project.listSheets().filter((x) => ed.project.canRead(x.id)).length;
    });
  expect(await pages(fred)).toBe((await pages(emma)) - 1);

  // Back to "Can edit": the sheet comes back.
  await emma.getByTestId('open-share').click();
  await emma.getByTestId('access-sheet').selectOption(ctrlSheet!);
  await emma.getByTestId('sheet-level').first().selectOption('editor');
  await emma.keyboard.press('Escape');
  await expect.poll(fredSees).toBeGreaterThan(0);
  await expect(fred.locator('[data-restricted]')).toHaveCount(0);
});

test('beta limits: a few projects on the server, the rest in this browser; admin page', async ({
  browser,
}) => {
  const ida = await person(browser, 'Ida');
  const quota = ida.getByTestId('server-quota');
  await expect(quota).toContainText('0 / 2 projects');
  // Two projects on the server (the test server allows 2).
  for (const name of ['Lab 1', 'Lab 2']) {
    await ida.goto('/app/');
    await ida.getByTestId('new-project').click();
    await ida.getByTestId('new-project-name').fill(name);
    await ida.getByTestId('new-project-where').selectOption('cloud');
    await ida.getByTestId('create-project').click();
    await expect(ida.getByTestId('canvas')).toBeVisible();
  }
  await ida.goto('/app/');
  await expect(quota).toContainText('2 / 2 projects');
  await expect(quota).toContainText('full');
  // A third one can only stay in this browser.
  await ida.getByTestId('new-project').click();
  await expect(
    ida.getByTestId('new-project-where').locator('option[value="cloud"]'),
  ).toHaveAttribute('disabled', '');
  await ida.keyboard.press('Escape');
  // Move "Lab 1" to this computer: it is saved locally and frees a place.
  const lab1 = ida.getByTestId('cloud-card').filter({ hasText: 'Lab 1' });
  await lab1.getByTestId('card-menu').click();
  await ida.getByTestId('move-local').click();
  await expect(ida.getByTestId('project-card').filter({ hasText: 'Lab 1' })).toHaveCount(1);
  await expect(quota).toContainText('1 / 2 projects');
  await expect(ida.getByTestId('cloud-card').filter({ hasText: 'Lab 1' })).toHaveCount(0);

  // The administrator sees the accounts and gives Ida more room.
  const boss = await person(browser, 'Boss', 'admin.test');
  await boss.getByTestId('account-menu').click();
  await boss.getByTestId('open-admin').click();
  await expect(boss.getByTestId('admin-stats')).toContainText('Accounts');
  const row = boss.getByTestId('admin-users').locator('tr', { hasText: `ida.${stamp}` });
  await expect(row).toContainText('1');
  await row.getByTestId('admin-limit').fill('5');
  await row.getByTestId('admin-limit').press('Enter');
  await ida.reload();
  await expect(quota).toContainText('1 / 5 projects');
  // Ida is not an administrator.
  await ida.goto('/app/#/admin');
  await expect(ida.getByText('This page is for the administrators')).toBeVisible();
});

test('delete my account: says what goes away, asks for the password', async ({ browser }) => {
  const zoe = await person(browser, 'Zoe');
  await zoe.getByTestId('account-menu').click();
  await zoe.getByTestId('delete-account').click();
  await expect(zoe.getByRole('dialog')).toContainText('you own none on the server');
  await zoe.getByTestId('delete-confirm').fill('not my password');
  await zoe.getByTestId('delete-submit').click();
  await expect(zoe.getByRole('dialog')).toContainText('Wrong password');
  await zoe.getByTestId('delete-confirm').fill('correct horse battery');
  await zoe.getByTestId('delete-submit').click();
  // Signed out, and the account no longer exists.
  await expect(zoe.getByTestId('sign-in')).toBeVisible();
  const login = await zoe.request.post(`${SERVER}/api/auth/login`, {
    data: { email: `zoe.${stamp}@lab.test`, password: 'correct horse battery' },
  });
  expect(login.status()).toBe(401);
});

test('a new account confirms its e-mail with a code; a forgotten password', async ({ browser }) => {
  // The test server sends no e-mails: its answers about codes are played here, and the account
  // is really created (then signed in) once the right code is typed.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const email = `vera.${stamp}@lab.test`;
  let signup = '';
  await page.route(`${SERVER}/api/health`, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ json: { ...(await res.json()), verify: true, reset: true } });
  });
  await page.route(`${SERVER}/api/auth/signup`, async (route) => {
    signup = route.request().postData() ?? '';
    await route.fulfill({ json: { verify: true, email } });
  });
  await page.route(`${SERVER}/api/auth/signup/verify`, async (route) => {
    const { code } = JSON.parse(route.request().postData() ?? '{}') as { code: string };
    if (code.replace(/\s/g, '') !== '123456')
      return route.fulfill({
        status: 400,
        json: { error: 'Wrong code: check the last e-mail we sent you.' },
      });
    const res = await route.fetch({ url: `${SERVER}/api/auth/signup`, postData: signup });
    await route.fulfill({ response: res });
  });
  await page.goto('/app/');
  await page.getByTestId('connect-server').click();
  await page.getByTestId('server-url').fill(SERVER);
  await page.getByTestId('server-connect').click();
  await page.getByTestId('sign-in').click();
  await page.getByTestId('auth-switch').click();
  await expect(page.getByText('We will send a code to this address')).toBeVisible();
  await page.getByTestId('auth-name').fill('Vera');
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('correct horse battery');
  await page.getByTestId('auth-submit').click();

  await expect(page.getByText('Check your e-mail')).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByTestId('auth-code').fill('000000');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByText('Wrong code')).toBeVisible();
  await page.getByTestId('auth-resend').click();
  await expect(page.getByText('A new code is on its way')).toBeVisible();
  await page.getByTestId('auth-code').fill('123 456');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('account-menu')).toContainText('Vera');

  // Signed out, the password is forgotten: a code, then a new password (played here too).
  await page.evaluate(() => localStorage.removeItem('sb.token'));
  await page.route(`${SERVER}/api/auth/forgot`, (route) => route.fulfill({ json: { ok: true } }));
  await page.route(`${SERVER}/api/auth/reset`, async (route) => {
    const res = await route.fetch({
      url: `${SERVER}/api/auth/login`,
      postData: JSON.stringify({ email, password: 'correct horse battery' }),
    });
    await route.fulfill({ response: res });
  });
  await page.reload();
  await page.getByTestId('sign-in').click();
  await page.getByTestId('auth-forgot').click();
  await expect(page.getByText('Forgot your password?')).toBeVisible();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByText('Choose a new password')).toBeVisible();
  await page.getByTestId('auth-code').fill('654321');
  await page.getByTestId('auth-password').fill('a brand new password');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('account-menu')).toContainText('Vera');
  await ctx.close();
});
