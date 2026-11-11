import assert from 'node:assert/strict';
import test from 'node:test';
import { createNoticeExpiry, noticeCanExpire } from '../src/renderer/notice-expiry.ts';

test('all completed notices expire, including failures and warning results; pending work remains', () => {
  for (const status of ['succeeded', 'failed']) {
    assert.equal(noticeCanExpire({ status }), true);
    assert.equal(noticeCanExpire({ status, warning: true }), true);
  }
  for (const status of ['queued', 'running']) assert.equal(noticeCanExpire({ status }), false);
});

test('notices dismiss after exactly fifteen seconds without foreground or interaction prerequisites', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let dismissed = 0;
  const expiry = createNoticeExpiry(() => dismissed++);
  t.mock.timers.tick(14999);
  assert.equal(dismissed, 0);
  t.mock.timers.tick(1);
  assert.equal(dismissed, 1);
  t.mock.timers.tick(30000);
  assert.equal(dismissed, 1);
  expiry.dispose();
});

test('manual dismissal or unmount cancels the pending expiry', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let dismissed = 0;
  const expiry = createNoticeExpiry(() => dismissed++);
  t.mock.timers.tick(2000);
  expiry.dispose();
  t.mock.timers.tick(30000);
  assert.equal(dismissed, 0);
});

test('default browser timer functions are not rebound to a helper object', (t) => {
  const calls = [];
  t.mock.method(globalThis, 'setTimeout', function (callback, delay) {
    assert.equal(this, undefined, 'browser timers reject an unrelated receiver');
    calls.push({ callback, delay });
    return 1;
  });
  t.mock.method(globalThis, 'clearTimeout', function () {
    assert.equal(this, undefined);
  });
  const expiry = createNoticeExpiry(() => {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].delay, 15000);
  expiry.dispose();
});
