import { expect, test, type Page } from '@playwright/test';

interface Handle {
  ed: {
    viewport(): { x: number; y: number; zoom: number };
    elements(): { id: string; type: string; groupId?: string }[];
    sheetId: string;
    project: { listSheets(): { id: string; name: string }[] };
  };
}

/** Screen position (page coordinates) of a world point of the current sheet. */
async function toScreen(page: Page, x: number, y: number) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const vp = await page.evaluate(() =>
    (window as unknown as { __overleagger: Handle }).__overleagger.ed.viewport(),
  );
  return { x: box.x + vp.x + x * vp.zoom, y: box.y + vp.y + y * vp.zoom };
}

async function clickWorld(page: Page, x: number, y: number, opts: { clickCount?: number } = {}) {
  const p = await toScreen(page, x, y);
  await page.mouse.click(p.x, p.y, opts);
}

async function elementTypes(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { __overleagger: Handle }).__overleagger.ed.elements().map((e) => e.type),
  );
}

test('draw a schematic with a hierarchical block, then export a smart PDF', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByTestId('new-project-name').fill('E2E project');
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('canvas')).toBeVisible();

  // Set a known viewport: zoom 1, world origin at the canvas centre.
  await page.evaluate(() => {
    const h = (
      window as unknown as {
        __overleagger: {
          ed: { setViewport(v: object): void; canvasSize: { w: number; h: number } };
        };
      }
    ).__overleagger;
    h.ed.setViewport({ x: 300, y: 200, zoom: 1 });
  });

  // Place a resistor (pins at x = 70 and 130) and a MOSFET.
  await page.getByTestId('symbol-resistor').click();
  await clickWorld(page, 100, 100);
  await page.getByTestId('symbol-mosfet').click();
  await clickWorld(page, 350, 100);
  await page.keyboard.press('Escape');
  expect((await elementTypes(page)).filter((t) => t === 'component')).toHaveLength(2);

  // Wire from the resistor pin, then a second wire starting on the first one → T junction.
  await page.keyboard.press('w');
  await clickWorld(page, 130, 100);
  await clickWorld(page, 250, 100, { clickCount: 1 });
  await page.keyboard.press('Enter');
  await clickWorld(page, 190, 100);
  await clickWorld(page, 190, 180);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  expect((await elementTypes(page)).filter((t) => t === 'wire')).toHaveLength(2);
  await expect(page.locator('.junctions circle')).toHaveCount(1);

  // Draw a hierarchical block and name it.
  await page.keyboard.press('b');
  const a = await toScreen(page, 100, 260);
  const b = await toScreen(page, 260, 340);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  const editor = page.getByTestId('inline-editor');
  await expect(editor).toBeVisible();
  await editor.fill('Driver');
  await editor.press('Enter');
  expect(await elementTypes(page)).toContain('block');

  // Open it, add a port, go back up.
  await clickWorld(page, 180, 300, { clickCount: 1 });
  await clickWorld(page, 180, 300, { clickCount: 1 });
  await expect(page.getByTestId('breadcrumbs')).toContainText('Driver');
  await page.keyboard.press('p');
  await clickWorld(page, 0, 0);
  await expect(editor).toBeVisible();
  await editor.fill('vin');
  await editor.press('Enter');
  expect(await elementTypes(page)).toEqual(['port']);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('breadcrumbs').locator('button.current')).toHaveText('Main');
  // The port became a pin of the block.
  await expect(page.locator('.block')).toContainText('vin');

  // Group everything, ungroup, undo, redo.
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  expect((await elementTypes(page)).filter((t) => t === 'group')).toHaveLength(1);
  await page.keyboard.press('Control+Shift+g');
  expect((await elementTypes(page)).filter((t) => t === 'group')).toHaveLength(0);
  await page.keyboard.press('Control+z');
  expect((await elementTypes(page)).filter((t) => t === 'group')).toHaveLength(1);
  await page.keyboard.press('Control+Shift+z');
  expect((await elementTypes(page)).filter((t) => t === 'group')).toHaveLength(0);

  // Rotate the MOSFET with R: it stays a component, now rotated.
  await clickWorld(page, 350, 100);
  await page.keyboard.press('r');

  // Everything is saved in the browser: reload and find the project again.
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect
    .poll(async () => (await elementTypes(page)).sort())
    .toEqual(['block', 'component', 'component', 'wire', 'wire']);
  await expect(page.locator('.junctions circle')).toHaveCount(1);

  // Smart PDF: one page per sheet.
  await page.getByTestId('open-export').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-pdf').click();
  const file = await download;
  const path = await file.path();
  const { readFileSync } = await import('node:fs');
  const pdf = readFileSync(path!).toString('latin1');
  expect(pdf.startsWith('%PDF')).toBe(true);
  expect(pdf.match(/\/Type \/Page\b(?!s)/g)?.length).toBe(2);
  expect(pdf).toContain('/Outlines');
});

test('dashboard lists projects and the example opens with its sub-sheet', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-example').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.locator('.junctions circle').first()).toBeVisible();
  await page.getByTestId('tab-sheets').click();
  await page.getByTestId('sheet-Voltage controller').click();
  await expect(page.getByTestId('breadcrumbs')).toContainText('Voltage controller');
  await page.goto('/');
  await expect(page.getByTestId('project-card').first()).toBeVisible();
});
