import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Handle = {
  __overleagger: {
    ed: {
      viewport(): { x: number; y: number; zoom: number };
      elements(): { type: string }[];
      setViewport(v: object): void;
    };
  };
};

async function toScreen(page: Page, x: number, y: number) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const vp = await page.evaluate(() => (window as unknown as Handle).__overleagger.ed.viewport());
  return { x: box.x + vp.x + x * vp.zoom, y: box.y + vp.y + y * vp.zoom };
}

async function dragWorld(page: Page, a: [number, number], b: [number, number]) {
  const p = await toScreen(page, ...a);
  const q = await toScreen(page, ...b);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(q.x, q.y, { steps: 6 });
  await page.mouse.up();
}

const types = (page: Page) =>
  page.evaluate(() => (window as unknown as Handle).__overleagger.ed.elements().map((e) => e.type));

async function newProject(page: Page, name: string) {
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByTestId('new-project-name').fill(name);
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as Handle).__overleagger.ed.setViewport({ x: 80, y: 80, zoom: 1 }),
  );
}

test('whiteboard tools: shapes, arrows, notes, pencil, waveforms, images and links', async ({
  page,
}) => {
  await newProject(page, 'Board');
  await page.getByTestId('theme-whiteboard').click();

  await page.keyboard.press('s');
  await expect(page.getByTestId('tool-options')).toBeVisible();
  await dragWorld(page, [0, 0], [120, 80]);
  await page.keyboard.press('Shift+L');
  await dragWorld(page, [0, 120], [200, 120]);
  // Tool goes back to select; dragging the curve handle bends the arrow instead of drawing.
  const bend = page.locator('[data-handle=bend]');
  const bb = (await bend.boundingBox())!;
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + 40, { steps: 4 });
  await page.mouse.up();
  expect((await types(page)).filter((t) => t === 'line')).toHaveLength(1);

  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  let p = await toScreen(page, 260, 0);
  await page.mouse.click(p.x, p.y);
  await page.getByTestId('inline-editor').fill('Note with $x^2$');
  await page.getByTestId('inline-editor').press('Control+Enter');

  await page.keyboard.press('Escape');
  await page.keyboard.press('d');
  p = await toScreen(page, 0, 200);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i < 20; i++) {
    const q = await toScreen(page, i * 8, 200 + (i % 2) * 10);
    await page.mouse.move(q.x, q.y);
  }
  await page.mouse.up();

  await page.keyboard.press('o');
  await dragWorld(page, [0, 260], [300, 400]);
  await page.getByTestId('wave-preset').selectOption('buck');

  // Link button to an online PDF.
  await page.keyboard.press('Escape');
  await page.keyboard.press('k');
  p = await toScreen(page, 400, 0);
  await page.mouse.click(p.x, p.y);
  await page.getByTestId('inline-editor').fill('Datasheet');
  await page.getByTestId('inline-editor').press('Enter');
  await page.getByTestId('prop-link-url').fill('https://example.com/datasheet.pdf');

  // Image through the image tool.
  await page.keyboard.press('Escape');
  await page.keyboard.press('i');
  p = await toScreen(page, 450, 200);
  await page.mouse.click(p.x, p.y);
  await page
    .getByTestId('image-input')
    .setInputFiles(fileURLToPath(new URL('./fixture.png', import.meta.url)));
  await expect.poll(async () => (await types(page)).includes('image')).toBe(true);

  const all = (await types(page)).sort();
  for (const t of ['button', 'image', 'line', 'note', 'shape', 'stroke', 'waveform'])
    expect(all).toContain(t);

  // The link survives in the PDF.
  await page.getByTestId('open-export').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-pdf').click();
  const pdf = readFileSync((await (await download).path())!).toString('latin1');
  expect(pdf).toContain('https://example.com/datasheet.pdf');
});

test('save a selection as a template and reuse it in another project', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-example').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  const dots = await page.getByTestId('canvas').locator('.junctions circle').count();
  expect(dots).toBeGreaterThan(2);
  await page.getByTestId('canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+a');
  await page.getByTestId('tab-templates').click();
  await page.getByTestId('save-template').click();
  await page.getByTestId('template-name').fill('My buck');
  // A category of my own.
  await page.getByTestId('template-category').fill('Power stages');
  await page.getByTestId('template-save').click();
  await expect(page.getByTestId('templates')).toContainText('Power stages');

  await newProject(page, 'Reuse');
  await page.getByTestId('tab-templates').click();
  await page.getByTestId('template-My buck').click();
  expect((await types(page)).filter((t) => t === 'component').length).toBeGreaterThan(5);
  await expect(page.getByTestId('canvas').locator('.junctions circle')).toHaveCount(dots);
});

test('custom symbol editor: draw, add pins, save and place', async ({ page }) => {
  await newProject(page, 'Symbols');
  await page.getByTestId('new-symbol').click();
  await page.getByTestId('symed-name').fill('Heater');
  const canvas = page.getByTestId('symed-canvas');
  const box = (await canvas.boundingBox())!;
  // 22 px per grid unit, origin in the middle.
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + x * 22,
    y: box.y + box.height / 2 + y * 22,
  });
  await page.getByTestId('symed-rect').click();
  let a = at(-2, -1);
  let b = at(2, 1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await page.getByTestId('symed-line').click();
  a = at(-3, 0);
  b = at(-2, 0);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
  await page.getByTestId('symed-pin').click();
  a = at(-3, 0);
  await page.mouse.click(a.x, a.y);
  a = at(2, 0);
  await page.mouse.click(a.x, a.y);
  await page.getByTestId('symed-save').click();

  const tile = page.locator('[data-testid^="symbol-custom-"]');
  await expect(tile).toHaveCount(1);
  await tile.click();
  const p = await toScreen(page, 100, 100);
  await page.mouse.click(p.x, p.y);
  expect(await types(page)).toContain('component');
});

test('bridge spacing and part size options', async ({ page }) => {
  await newProject(page, 'Sizes');
  await page.getByTestId('library-search').fill('half-bridge');
  await page.getByTestId('symbol-half-bridge').click();
  const p = await toScreen(page, 100, 100);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Escape');
  await page.mouse.click(p.x + 10, p.y - 40);
  await expect(page.getByTestId('properties')).toContainText('Gap high');
  await page.getByTestId('library-search').fill('resistor');
  await page.getByTestId('symbol-resistor').click();
  const q = await toScreen(page, 300, 100);
  await page.mouse.click(q.x, q.y);
  await page.keyboard.press('Escape');
  await page.mouse.click(q.x, q.y);
  await page.getByTestId('prop-scale').selectOption('2');
  const scale = await page.evaluate(
    () =>
      (
        window as unknown as {
          __overleagger: {
            ed: { elements(): { type: string; symbolId?: string; scale?: number }[] };
          };
        }
      ).__overleagger.ed
        .elements()
        .find((e) => e.symbolId === 'resistor')?.scale,
  );
  expect(scale).toBe(2);
});

test('presentation mode: slides, drill into a block, laser and pen', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-example').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('present').click();
  const show = page.getByTestId('presentation');
  await expect(show).toBeVisible();
  const count = page.getByTestId('present-count');
  await expect(count).toContainText('1 / 2');
  // Clicking the block zooms into its sub-sheet.
  await page.locator('.present-stage .el.block').first().click();
  await expect(count).toContainText('2 / 2');
  await page.keyboard.press('Backspace');
  await expect(count).toContainText('1 / 2');
  await page.keyboard.press('ArrowRight');
  await expect(count).toContainText('2 / 2');
  await page.keyboard.press('p');
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(500, 360, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.present-ink path')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(show).toBeHidden();
});

test('links on images/shapes and CircuiTikZ export', async ({ page }) => {
  await newProject(page, 'Links');
  await page.keyboard.press('s');
  await dragWorld(page, [0, 0], [120, 80]);
  await page.getByTestId('prop-link-kind').selectOption('url');
  await page.getByTestId('prop-link-url').fill('https://example.com/datasheet.pdf');
  await expect(page.locator('.link-badge')).toHaveCount(1);
  await page.getByTestId('open-export').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-pdf').click();
  const pdf = readFileSync((await (await download).path())!).toString('latin1');
  expect(pdf).toContain('https://example.com/datasheet.pdf');
  await page.getByTestId('export-tikz').click();
  await expect(page.getByTestId('tikz-code')).toHaveValue(/\\begin\{circuitikz\}/);
});

test('flowchart: connectors attach to shapes and follow them', async ({ page }) => {
  await newProject(page, 'Flow');
  await page.keyboard.press('s');
  await page.getByTestId('shape-terminator').click();
  await dragWorld(page, [0, 0], [120, 60]);
  await page.keyboard.press('s');
  await page.getByTestId('shape-data').click();
  await dragWorld(page, [0, 160], [120, 220]);
  // Line from the bottom of the first shape to the top of the second one.
  await page.keyboard.press('Shift+L');
  await dragWorld(page, [60, 58], [62, 164]);
  const line = () =>
    page.evaluate(() => {
      const els = (
        window as unknown as {
          __overleagger: {
            ed: { elements(): { type: string; pts?: number[]; from?: object; to?: object }[] };
          };
        }
      ).__overleagger.ed.elements();
      return els.find((e) => e.type === 'line')!;
    });
  const l = await line();
  expect(l.from).toMatchObject({ anchor: 's' });
  expect(l.to).toMatchObject({ anchor: 'n' });
  expect(l).toMatchObject({ route: 'elbow' });
  // Move the second shape: the connector follows.
  await page.keyboard.press('Escape');
  await dragWorld(page, [60, 200], [160, 240]);
  await expect.poll(async () => (await line()).pts![2]).toBe(160);
});
