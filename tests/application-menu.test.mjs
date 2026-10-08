import assert from 'node:assert/strict';
import test from 'node:test';
import { applicationMenu, hidesOnClose } from '../src/main/application-menu.ts';

test('Mac has an app menu with guarded Command+Q and native edit/window roles', () => {
  let quits = 0;
  const menu = applicationMenu('darwin', () => {
    quits += 1;
  });
  assert.equal(menu[0].label, 'Parallel Agents');
  const quit = menu[0].submenu.find((item) => item.label === 'Quit Parallel Agents');
  assert.equal(quit.accelerator, 'Command+Q');
  quit.click();
  assert.equal(quits, 1);
  assert.ok(menu.some((item) => item.role === 'editMenu'));
  assert.ok(menu.some((item) => item.role === 'windowMenu'));
});

test('Linux has an accessible Quit action even when no system tray is available', () => {
  const menu = applicationMenu('linux', () => {});
  assert.equal(menu[0].label, 'File');
  assert.equal(menu[0].submenu[0].accelerator, 'Ctrl+Q');
  assert.equal(hidesOnClose('linux'), false);
  assert.equal(hidesOnClose('darwin'), true);
  assert.equal(hidesOnClose('win32'), true);
  assert.equal(
    applicationMenu('win32', () => {}),
    null,
  );
});
