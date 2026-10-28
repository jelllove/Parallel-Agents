import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { layoutSetting } from '../src/main/config-schema.ts';
import { createConfigStore } from '../src/main/config-store.ts';
import { projectedPanelSizes, togglePane, toggleFocus } from '../src/shared/pane-visibility.ts';

const layout = { order: ['sidebar', 'middle', 'right'], sizes: [20, 58, 22] };

test('project and files panes can hide independently without ever hiding the terminal', () => {
  const projectHidden = togglePane(layout, 'sidebar');
  assert.deepEqual(projectHidden.hiddenPanes, ['sidebar']);
  assert.deepEqual(projectedPanelSizes(projectHidden), [0, 78, 22]);
  assert.deepEqual(togglePane(projectHidden, 'right').hiddenPanes, ['sidebar', 'right']);
  assert.deepEqual(projectedPanelSizes(toggleFocus(layout)), [0, 100, 0]);
  assert.throws(() => togglePane(layout, 'middle'), /pane/i);
});

test('focus hides both side panes and restoring focus shows both without losing expanded sizes', () => {
  const focused = toggleFocus(layout);
  assert.deepEqual(focused.sizes, layout.sizes);
  assert.deepEqual(focused.hiddenPanes, ['sidebar', 'right']);
  const restored = toggleFocus(focused);
  assert.deepEqual(restored.hiddenPanes, []);
  assert.deepEqual(projectedPanelSizes(restored), layout.sizes);
});

test('pane identity rather than physical left/right controls every column permutation', () => {
  for (const order of [
    ['sidebar', 'middle', 'right'],
    ['sidebar', 'right', 'middle'],
    ['middle', 'sidebar', 'right'],
    ['middle', 'right', 'sidebar'],
    ['right', 'sidebar', 'middle'],
    ['right', 'middle', 'sidebar'],
  ]) {
    const current = {
      order,
      sizes: order.map((id) => (id === 'sidebar' ? 20 : id === 'right' ? 22 : 58)),
    };
    const sizes = projectedPanelSizes(toggleFocus(current));
    assert.equal(sizes[order.indexOf('middle')], 100);
    assert.equal(
      sizes.reduce((a, b) => a + b, 0),
      100,
    );
    assert.equal(sizes[order.indexOf('sidebar')], 0);
  }
});

test('legacy layouts remain unchanged and malformed hidden pane settings fail validation', () => {
  assert.deepEqual(layoutSetting(layout), layout);
  assert.deepEqual(layoutSetting({ ...layout, hiddenPanes: ['right'] }).hiddenPanes, ['right']);
  for (const hiddenPanes of [
    null,
    'sidebar',
    ['middle'],
    ['other'],
    ['sidebar', 'sidebar'],
    [null],
  ]) {
    assert.throws(() => layoutSetting({ ...layout, hiddenPanes }), /hiddenPanes/);
  }
});

test('visibility survives config store restart without replacing expanded widths', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pa-pane-visibility-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'config.json');
  const store = createConfigStore(path);
  await store.setLayout(toggleFocus(layout));
  const reopened = createConfigStore(path);
  assert.deepEqual((await reopened.getLayout()).hiddenPanes, ['sidebar', 'right']);
  assert.deepEqual((await reopened.getLayout()).sizes, [20, 58, 22]);
});

test('restoring controls remain outside hidden panes and hide never conditionally unmounts content', async () => {
  const status = await readFile(
    new URL('../src/renderer/components/StatusBar.tsx', import.meta.url),
    'utf8',
  );
  assert.match(status, /Toggle project sidebar/);
  assert.match(status, /Toggle files and Git sidebar/);
  assert.match(status, /Focus coding/);
  const app = await readFile(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /projectedPanelSizes/);
  assert.match(app, /aria-hidden/);
});
