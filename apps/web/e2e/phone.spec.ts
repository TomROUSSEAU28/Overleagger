import { expect, test, type Page } from '@playwright/test';

// A phone: small screen, fingers.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

type Vp = { x: number; y: number; zoom: number };
const view = (page: Page) =>
  page.evaluate(() => {
    const { ui } = (
      window as unknown as {
        __overleagger: {
          ui: { getState(): { sheetId: string; viewports: Record<string, Vp> } };
        };
      }
    ).__overleagger;
    const s = ui.getState();
    return s.viewports[s.sheetId]!;
  });
const elementCount = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { __overleagger: { ed: { elements(): unknown[] } } }
      ).__overleagger.ed.elements().length,
  );

/** Real touch events (the browser turns them into pointer events, like on a phone). */
async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: { x: number; y: number }[],
  ) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })),
    });
  return {
    async drag(from: { x: number; y: number }, dx: number, dy: number) {
      await send('touchStart', [from]);
      for (let i = 1; i <= 8; i++)
        await send('touchMove', [{ x: from.x + (dx * i) / 8, y: from.y + (dy * i) / 8 }]);
      await send('touchEnd', []);
    },
    async pinch(center: { x: number; y: number }, from: number, to: number) {
      const at = (d: number) => [
        { x: center.x - d / 2, y: center.y },
        { x: center.x + d / 2, y: center.y },
      ];
      await send('touchStart', at(from));
      for (let i = 1; i <= 8; i++) await send('touchMove', at(from + ((to - from) * i) / 8));
      await send('touchEnd', []);
    },
  };
}

test('dashboard: everything fits on a phone', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.getByTestId('connect-server')).toBeInViewport();
  await expect(page.getByTestId('new-project')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('editor on a phone: whole-screen drawing, drawers, fingers', async ({ page }) => {
  await page.goto('/app/#/example');
  const canvas = page.getByTestId('canvas');
  await expect(canvas).toBeVisible();
  // The desktop panels give way to a bar at the bottom.
  await expect(page.getByTestId('tool-select')).toHaveCount(0);
  await expect(page.getByTestId('phone-tools')).toBeVisible();
  await page.getByTestId('phone-tips').locator('button').click();
  const box = (await canvas.boundingBox())!;
  expect(box.width).toBe(390);

  // One finger on the empty page moves the view; two fingers zoom.
  const f = await fingers(page);
  const before = await view(page);
  await f.drag({ x: box.x + 60, y: box.y + 80 }, 80, 60);
  const moved = await view(page);
  expect(moved.x - before.x).toBeCloseTo(80, -1);
  expect(moved.y - before.y).toBeCloseTo(60, -1);
  expect(moved.zoom).toBe(before.zoom);
  await f.pinch({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, 80, 240);
  expect((await view(page)).zoom).toBeGreaterThan(moved.zoom * 2);
  await page.getByTestId('phone-more').click();
  await page.getByText('Fit the drawing to the screen').click();
  await page.waitForTimeout(600); // the view glides to its place

  // Tap a part: a bar of actions appears; delete it, then undo.
  const count = await elementCount(page);
  const id = await page.evaluate(() => {
    const ed = (
      window as unknown as {
        __overleagger: { ed: { elements(): { id: string; type: string }[] } };
      }
    ).__overleagger.ed;
    // The inductor: a thin symbol, easy to miss with a finger.
    return ed.elements().find((e) => (e as { symbolId?: string }).symbolId === 'inductor')!.id;
  });
  // Zoom in on it first, as one would with two fingers.
  await page.evaluate((id) => {
    const ed = (
      window as unknown as {
        __overleagger: {
          ed: {
            elements(): { id: string; x?: number; y?: number }[];
            setViewport(v: Vp): void;
          };
        };
      }
    ).__overleagger.ed;
    const el = ed.elements().find((e) => e.id === id)!;
    const c = document.querySelector('[data-testid=canvas]')!.getBoundingClientRect();
    ed.setViewport({ x: c.width / 2 - el.x! * 1.5, y: c.height / 2 - el.y! * 1.5, zoom: 1.5 });
  }, id);
  await page.waitForTimeout(300);
  const pb = (await page.locator(`[data-id="${id}"]`).first().boundingBox())!;
  await page.touchscreen.tap(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await expect(page.getByTestId('phone-selection')).toBeVisible();
  // Drag it with a finger: it moves (the view does not).
  const pos = (page: Page) =>
    page.evaluate((id) => {
      const ed = (
        window as unknown as {
          __overleagger: { ed: { elements(): { id: string; x?: number }[] } };
        }
      ).__overleagger.ed;
      return ed.elements().find((e) => e.id === id)!.x;
    }, id);
  const x0 = await pos(page);
  const vp0 = await view(page);
  await page.waitForTimeout(400); // not a double tap
  await f.drag({ x: pb.x + pb.width / 2, y: pb.y + pb.height / 2 }, 60, 0);
  await expect.poll(() => pos(page)).toBeGreaterThan(x0!);
  expect((await view(page)).x).toBe(vp0.x);
  await page.getByTestId('phone-delete').click();
  await expect.poll(() => elementCount(page)).toBeLessThan(count);
  await page.getByTestId('undo').click();
  await expect.poll(() => elementCount(page)).toBe(count);

  // Tools drawer: pick the wire tool; a note says what to do, Done goes back.
  await page.getByTestId('phone-tools').click();
  await page.getByTestId('phone-tool-wire').click();
  await expect(page.getByTestId('phone-drawer')).toHaveCount(0);
  await expect(page.getByTestId('phone-mode')).toContainText('wire');
  await page.getByTestId('phone-mode-done').click();
  await expect(page.getByTestId('phone-mode')).toHaveCount(0);

  // Parts drawer: picking a part closes it; a tap places the part.
  await page.getByTestId('phone-parts').click();
  await page.getByPlaceholder(/Search parts/).fill('resistor');
  await page.getByTestId('symbol-resistor').click();
  await expect(page.getByTestId('phone-drawer')).toHaveCount(0);
  await expect(page.getByTestId('phone-mode')).toContainText('Tap where the part goes');
  await page.touchscreen.tap(box.x + 80, box.y + 120);
  await expect.poll(() => elementCount(page)).toBe(count + 1);
  await page.getByTestId('phone-mode-done').click();

  // Sheets drawer: opening a sheet closes it and shows where we are.
  await page.getByTestId('phone-sheets').click();
  await page.getByTestId('phone-drawer').getByText('Voltage controller').click();
  await expect(page.getByTestId('phone-drawer')).toHaveCount(0);
  await expect(page.locator('.phone-crumbs')).toContainText('Voltage controller');
});
