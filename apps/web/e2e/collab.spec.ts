import { expect, test, type Browser, type Page } from '@playwright/test';

const SERVER = 'http://localhost:8788';
const stamp = Date.now();

async function person(browser: Browser, name: string): Promise<Page> {
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
  await page.getByTestId('auth-email').fill(`${name.toLowerCase()}.${stamp}@lab.test`);
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
