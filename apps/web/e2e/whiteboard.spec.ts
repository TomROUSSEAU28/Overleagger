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
  await page.goto('/app/');
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
  await page.goto('/app/');
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
  await page.goto('/app/');
  await page.getByTestId('open-example').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('present').click();
  const show = page.getByTestId('presentation');
  await expect(show).toBeVisible();
  const count = page.getByTestId('present-count');
  // The five frames of the example (an overview, then zooms), then the controller's sheet.
  await expect(count).toContainText('1 / 6');
  await expect(count).toContainText('Overview');
  // Clicking the block zooms into its sub-sheet.
  await page.locator('.present-stage .el.block').first().click();
  await expect(count).toContainText('6 / 6');
  await page.keyboard.press('Backspace');
  await expect(count).toContainText('1 / 6');
  // The power stage builds up in 5 clicks (the currents, a load step, the controller)…
  await page.keyboard.press('ArrowRight');
  await expect(count).toContainText('Power stage');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('ArrowRight');
    await expect(count).toContainText('2 / 6');
  }
  // …whose button leads into the controller.
  await page.locator('.present-stage').getByText('Open the controller').click();
  await expect(count).toContainText('6 / 6');
  await page.keyboard.press('Backspace');
  await expect(count).toContainText('2 / 6');
  // A closer zoom on the output filter (2 clicks), then the waveforms.
  await page.keyboard.press('ArrowRight');
  await expect(count).toContainText('Output filter');
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('ArrowRight');
    await expect(count).toContainText('3 / 6');
  }
  await page.keyboard.press('ArrowRight');
  await expect(count).toContainText('4 / 6');
  await expect(count).toContainText('Waveforms');
  await page.keyboard.press('p');
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(500, 360, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.present-ink path')).toHaveCount(1);
  // Blank screen: the button shows it is on, and so does a note; a click brings the slide back.
  await page.keyboard.press('p');
  await page.keyboard.press('b');
  await expect(page.getByTestId('present-blank')).toHaveClass(/on/);
  await expect(page.getByTestId('present-blank-note')).toBeVisible();
  await page.mouse.click(400, 300);
  await expect(page.getByTestId('present-blank-note')).toBeHidden();
  await expect(count).toContainText('4 / 6');
  await page.keyboard.press('Escape');
  await expect(show).toBeHidden();
});

test('drawing order: to the back, one step forward, to the front', async ({ page }) => {
  await newProject(page, 'Order');
  const ids = await page.evaluate(() => {
    const ed = (
      window as unknown as {
        __overleagger: { ed: { addElement(e: object): { id: string } } };
      }
    ).__overleagger.ed;
    const box = (x: number) =>
      ed.addElement({ type: 'shape', kind: 'rect', x, y: 0, w: 60, h: 60 });
    return [box(0).id, box(30).id, box(60).id];
  });
  const order = () =>
    page.evaluate(() =>
      (
        window as unknown as { __overleagger: { ed: { elements(): { id: string }[] } } }
      ).__overleagger.ed
        .elements()
        .map((e) => e.id),
    );
  const [a, b, c] = ids as [string, string, string];
  // Select the top one and send it to the back, then bring it one step forward.
  await page.evaluate((id) => {
    (
      window as unknown as { __overleagger: { ed: { select(ids: string[]): void } } }
    ).__overleagger.ed.select([id]);
  }, c);
  await page.getByTestId('order-back').click();
  expect(await order()).toEqual([c, a, b]);
  await page.getByTestId('order-forward').click();
  expect(await order()).toEqual([a, c, b]);
  await page.keyboard.press('Control+]');
  expect(await order()).toEqual([a, b, c]);
  await page.keyboard.press('Control+[');
  expect(await order()).toEqual([a, c, b]);
  await page.getByTestId('order-front').click();
  expect(await order()).toEqual([a, b, c]);
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

test('hide things from the presentation or the export, export only the selection', async ({
  page,
  context,
}) => {
  await newProject(page, 'Visibility');
  const ids = await page.evaluate(() => {
    const { ed } = (window as unknown as { __overleagger: { ed: any } }).__overleagger; // eslint-disable-line @typescript-eslint/no-explicit-any
    const S = (x: number, text: string) =>
      ed.addElement({ type: 'shape', kind: 'rect', x, y: 0, w: 120, h: 60, text }).id as string;
    return { a: S(0, 'Alpha'), b: S(200, 'Bravo'), d: S(400, 'Draft') };
  });
  const select = (id: string) =>
    page.evaluate(
      (i) => (window as unknown as { __overleagger: { ed: any } }).__overleagger.ed.select([i]), // eslint-disable-line @typescript-eslint/no-explicit-any
      id,
    );

  // "Draft" out of the export, "Bravo" out of the presentation.
  await select(ids.d);
  await page.getByTestId('show-in-export').uncheck();
  await select(ids.b);
  await page.getByTestId('show-in-present').uncheck();
  await expect(page.getByTestId('hidden-badge')).toHaveCount(2);

  // CircuiTikZ of the sheet: no Draft. Only the selection: Alpha alone.
  await select(ids.a);
  await page.getByTestId('open-export').click();
  await expect(page.getByTestId('export-hidden-note')).toContainText('1 element');
  await page.getByTestId('export-tikz').click();
  let tex = await page.getByTestId('tikz-code').inputValue();
  expect(tex).toContain('Alpha');
  expect(tex).toContain('Bravo');
  expect(tex).not.toContain('Draft');
  await page.getByTestId('export-selection').check();
  await page.getByTestId('export-tikz').click();
  tex = await page.getByTestId('tikz-code').inputValue();
  expect(tex).toContain('Alpha');
  expect(tex).not.toContain('Bravo');

  // Copy as image puts a PNG on the clipboard.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('export-copy-image').click();
  await expect(page.getByTestId('export-copy-image')).toContainText('Copied');
  const types = await page.evaluate(async () =>
    (await navigator.clipboard.read()).flatMap((i) => [...i.types]),
  );
  expect(types).toContain('image/png');
  await page.keyboard.press('Escape');

  // The presentation shows Alpha and Draft, not Bravo.
  await page.getByTestId('present').click();
  const show = page.getByTestId('presentation');
  await expect(show).toContainText('Alpha');
  await expect(show).toContainText('Draft');
  await expect(show).not.toContainText('Bravo');
  await page.getByTestId('present-close').click();

  // A whole sheet can be left out too.
  await page.evaluate(
    () => (window as unknown as { __overleagger: { ed: any } }).__overleagger.ed.select([]), // eslint-disable-line @typescript-eslint/no-explicit-any
  );
  await page.getByTestId('sheet-in-present').uncheck();
  await page.getByTestId('present').click();
  await expect(page.getByTestId('present-count')).toHaveText('0 / 0');
});

test('undo shows the sheet where the change was made', async ({ page }) => {
  await page.goto('/app/#/example');
  await expect(page.getByTestId('canvas')).toBeVisible();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type W = { __overleagger: { ed: any } };
  await page.evaluate(() => {
    const { ed } = (window as unknown as W).__overleagger;
    const blk = ed.elements().find((e: { type: string }) => e.type === 'block');
    ed.openSheet(blk.childSheetId);
    ed.commit(() =>
      ed.addElement({ type: 'text', x: 0, y: 300, text: 'child edit', size: 16, align: 'start' }),
    );
    ed.openSheet(ed.project.rootSheetId);
  });
  await page.keyboard.press('Control+z');
  const after = await page.evaluate(() => {
    const { ed } = (window as unknown as W).__overleagger;
    return {
      onChild: ed.sheetId !== ed.project.rootSheetId,
      text: ed.elements().some((e: { text?: string }) => e.text === 'child edit'),
    };
  });
  expect(after).toEqual({ onChild: true, text: false });
  await expect(page.getByTestId('breadcrumbs')).toContainText('Voltage controller');
});

test('comments: Enter posts, resolve and delete can be undone; panels resize and hide', async ({
  page,
}) => {
  await page.goto('/app/#/example');
  await expect(page.getByTestId('canvas')).toBeVisible();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type W = { __overleagger: { ed: any } };
  const threads = () =>
    page.evaluate(() =>
      (window as unknown as W).__overleagger.ed.project
        .getComments()
        .map(
          (t: { messages: unknown[]; resolved?: boolean }) =>
            `${t.messages.length}${t.resolved ? 'R' : ''}`,
        )
        .join(','),
    );
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.keyboard.press('c');
  await page.mouse.click(box.x + 700, box.y + 250);
  // The box has the focus right away; Enter sends.
  await page.keyboard.type('Is the dead time long enough?');
  await page.keyboard.press('Enter');
  await expect.poll(threads).toBe('1');
  await page.keyboard.type('Yes');
  await page.keyboard.press('Enter');
  await expect.poll(threads).toBe('2');

  await page.getByTestId('comment-resolve').click();
  await expect.poll(threads).toBe('2R');
  await page.getByTestId('toast-action').click();
  await expect.poll(threads).toBe('2');

  // Delete key (not typing): the thread goes, the drawing stays; Undo brings it back.
  const count = await page.evaluate(
    () => (window as unknown as W).__overleagger.ed.elements().length,
  );
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Delete');
  await expect.poll(threads).toBe('');
  expect(
    await page.evaluate(() => (window as unknown as W).__overleagger.ed.elements().length),
  ).toBe(count);
  await page.getByTestId('toast-action').click();
  await expect.poll(threads).toBe('2');

  // Side panels: drag the edge wider, hide, show again with the same width.
  const width = () =>
    page.evaluate(() => document.querySelector('.left-panel')?.getBoundingClientRect().width ?? 0);
  const edge = (await page.getByTestId('resize-left').boundingBox())!;
  await page.mouse.move(edge.x + 2, edge.y + 300);
  await page.mouse.down();
  await page.mouse.move(edge.x + 100, edge.y + 300, { steps: 5 });
  await page.mouse.up();
  const wide = await width();
  expect(wide).toBeGreaterThan(330);
  await page.getByTestId('hide-left').click();
  await expect(page.locator('.left-panel')).toHaveCount(0);
  await page.getByTestId('show-left').click();
  expect(await width()).toBe(wide);
});

test('presentation animations: appear on a click, then the next slide', async ({ page }) => {
  await newProject(page, 'Animations');
  const id = await page.evaluate(() => {
    const ed = (
      window as unknown as {
        __overleagger: {
          ed: { addElement(e: object): { id: string }; select(ids: string[]): void };
        };
      }
    ).__overleagger.ed;
    ed.addElement({ type: 'frame', x: 0, y: 0, w: 400, h: 240, name: 'One' });
    ed.addElement({ type: 'frame', x: 500, y: 0, w: 400, h: 240, name: 'Two' });
    const t = ed.addElement({
      type: 'text',
      x: 40,
      y: 100,
      text: 'Hello',
      size: 20,
      align: 'start',
    });
    ed.select([t.id]);
    return t.id;
  });
  // Folded until opened; then add an entrance.
  await expect(page.getByTestId('anim-add')).toHaveCount(0);
  await page.getByTestId('anim-toggle').click();
  await page.getByTestId('anim-add').click();
  await page.getByTestId('anim-add-appear').click();
  await expect(page.getByTestId('anim-card')).toHaveCount(1);
  await expect(page.getByTestId('anim-badge')).toHaveText('1');

  await page.getByTestId('anim-preview').click();
  const count = page.getByTestId('present-count');
  await expect(count).toContainText('1 / 2');
  const text = page.locator(`.present-stage [data-id="${id}"]`);
  await expect(text).toHaveCount(0);
  // First click: the text comes in, still on slide 1. Second click: slide 2.
  await page.keyboard.press('ArrowRight');
  await expect(text).toHaveCount(1);
  await expect(count).toContainText('1 / 2');
  await page.keyboard.press('ArrowRight');
  await expect(count).toContainText('2 / 2');
  // Back: slide 1 with its steps played.
  await page.keyboard.press('ArrowLeft');
  await expect(count).toContainText('1 / 2');
  await expect(text).toHaveCount(1);
  await page.keyboard.press('ArrowLeft');
  await expect(text).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('slide order: move a frame one slide earlier, then back to reading order', async ({
  page,
}) => {
  await newProject(page, 'Slide order');
  await page.evaluate(() => {
    const ed = (
      window as unknown as {
        __overleagger: {
          ed: { addElement(e: object): { id: string }; select(ids: string[]): void };
        };
      }
    ).__overleagger.ed;
    ed.addElement({ type: 'frame', x: 0, y: 0, w: 400, h: 240, name: 'One' });
    const two = ed.addElement({ type: 'frame', x: 500, y: 0, w: 400, h: 240, name: 'Two' });
    ed.select([two.id]);
  });
  const order = page.getByTestId('slide-order');
  await expect(order).toContainText('Slide 2 of 2');
  await expect(page.getByTestId('slide-number')).toHaveCount(2);
  await page.getByTestId('slide-earlier').click();
  await expect(order).toContainText('Slide 1 of 2');
  await page.getByTestId('present').click();
  await expect(page.getByTestId('present-count')).toContainText('1 / 2');
  await page.keyboard.press('Escape');
  await page.getByTestId('slide-reset').click();
  await expect(order).toContainText('Slide 2 of 2');
  await expect(page.getByTestId('slide-reset')).toHaveCount(0);
});

test('animated current: through the selected wires, settings, presentation and export', async ({
  page,
}) => {
  type Ed = {
    __overleagger: {
      ed: {
        addElement(e: object): { id: string };
        elements(): { type: string; current?: number; symbol?: string; closed?: boolean }[];
        select(ids: string[]): void;
      };
    };
  };
  await newProject(page, 'Current');
  await page.evaluate(() => {
    const { ed } = (window as unknown as Ed).__overleagger;
    const w = (...pts: number[]) => ed.addElement({ type: 'wire', pts, kind: 'power' }).id;
    ed.select([w(0, 0, 200, 0), w(200, 0, 200, 120), w(200, 120, 0, 120), w(0, 120, 0, 0)]);
  });
  // A loop is selected: one click, and a current runs around it.
  await page.getByTestId('flow-from-selection').click();
  const flow = () =>
    page.evaluate(() =>
      (window as unknown as Ed).__overleagger.ed.elements().find((e) => e.type === 'flow'),
    );
  await expect.poll(async () => (await flow())?.closed).toBe(true);
  await page.getByTestId('flow-current').fill('-2');
  await page.getByTestId('flow-symbol-electron').click();
  await expect.poll(async () => (await flow())?.current).toBe(-2);
  expect((await flow())?.symbol).toBe('electron');
  // Selected: its preview runs in the editor.
  const where = (sel: string) => page.locator(`${sel} .flow > g`).first().getAttribute('transform');
  const a = await where('[data-testid=canvas]');
  await page.waitForTimeout(300);
  expect(await where('[data-testid=canvas]')).not.toBe(a);

  // In the presentation it runs too.
  await page.getByTestId('present').click();
  await expect(page.locator('.present-stage .flow circle').first()).toBeVisible();
  const b = await where('.present-stage');
  await page.waitForTimeout(300);
  expect(await where('.present-stage')).not.toBe(b);
  await page.keyboard.press('Escape');

  // Exports draw it still (and do not break).
  await page.getByTestId('open-export').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-svg').click();
  const svg = readFileSync((await (await download).path())!).toString('utf8');
  expect(svg).toContain('<circle');
  await page.keyboard.press('Escape');

  // Nothing selected: the tool draws the path, point by point (clicking the start closes it).
  await page.evaluate(() => (window as unknown as Ed).__overleagger.ed.select([]));
  await page.keyboard.press('Shift+I');
  for (const [x, y] of [
    [300, 0],
    [400, 0],
    [400, 100],
    [300, 100],
    [300, 0],
  ] as const) {
    const p = await toScreen(page, x, y);
    await page.mouse.click(p.x, p.y);
  }
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as Ed).__overleagger.ed.elements().filter((e) => e.type === 'flow')
            .length,
      ),
    )
    .toBe(2);
});

test('animated current: goes on flowing when the next slide zooms on a part of it', async ({
  page,
}) => {
  type Ed = { __overleagger: { ed: { addElement(e: object): { id: string } } } };
  await newProject(page, 'Zoom');
  await page.evaluate(() => {
    const { ed } = (window as unknown as Ed).__overleagger;
    ed.addElement({ type: 'wire', pts: [0, 0, 300, 0, 300, 200, 0, 200, 0, 0], kind: 'power' });
    ed.addElement({
      type: 'flow',
      pts: [0, 0, 300, 0, 300, 200, 0, 200],
      closed: true,
      current: 1,
      signal: 'dc',
      symbol: 'dot',
    });
    // An overview, then a zoom on its top-left corner.
    ed.addElement({ type: 'frame', x: -60, y: -60, w: 420, h: 320, name: 'Overview', slide: 0 });
    ed.addElement({ type: 'frame', x: -40, y: -40, w: 180, h: 120, name: 'Zoom', slide: 1 });
  });
  await page.getByTestId('present').click();
  const count = page.getByTestId('present-count');
  await expect(count).toContainText('Overview');
  const where = () => page.locator('.present-stage .flow > g').first().getAttribute('transform');
  const moves = async () => {
    const a = await where();
    await page.waitForTimeout(300);
    return (await where()) !== a;
  };
  await expect.poll(moves).toBe(true);
  await page.keyboard.press('ArrowRight');
  await expect(count).toContainText('Zoom');
  // While the camera glides, and once it has arrived.
  expect(await moves()).toBe(true);
  await page.waitForTimeout(1200);
  expect(await moves()).toBe(true);
});
