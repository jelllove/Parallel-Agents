/* global window, document, requestAnimationFrame, KeyboardEvent, PointerEvent */
const assert = require('node:assert/strict');
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { app, ipcMain, contentTracing } = require('electron');
const { trackNativePtys } = require('../helpers/native-pty-lifecycle.cjs');
const [home, reports, mainEntry] = process.argv.slice(2);
const sourceHash = require('node:crypto')
  .createHash('sha256')
  .update(require('node:fs').readFileSync(mainEntry))
  .digest('hex');
assert.ok(home && reports && mainEntry);
const tracker = trackNativePtys();
const pty = require('node-pty');
const native = pty.spawn;
pty.spawn = (...args) => tracker.track(native(...args));
const child = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const counts = { invokes: {}, sends: {}, git: 0, streams: 0, reads: 0 };
const received = new Map();
const expectedLines = new Map();
const deliveredSequences = new Map();
const exec = child.execFile;
child.execFile = function (command, ...args) {
  if (command === 'git') counts.git++;
  return exec.call(this, command, ...args);
};
const stream = fs.createReadStream;
fs.createReadStream = function (...args) {
  counts.streams++;
  return stream.apply(this, args);
};
const read = fsp.readFile;
fsp.readFile = function (...args) {
  counts.reads++;
  return read.apply(this, args);
};
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) =>
  handle(channel, (event, ...args) => {
    counts.invokes[channel] = (counts.invokes[channel] ?? 0) + 1;
    return handler(event, ...args);
  });
for (const name of ['userData', 'sessionData']) {
  const path = join(home, name);
  mkdirSync(path, { recursive: true });
  app.setPath(name, path);
}
app.setPath('home', home);
let finished = false;
async function finish(error, metrics) {
  if (finished) return;
  finished = true;
  try {
    tracker.terminate();
    await tracker.drain();
  } catch (shutdown) {
    error ??= shutdown;
  }
  await contentTracing.stopRecording(join(reports, 'trace.json')).catch(() => {});
  writeFileSync(
    join(reports, 'metrics.json'),
    JSON.stringify(
      {
        success: !error,
        error: error ? String(error.stack ?? error) : null,
        electron: process.versions.electron,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        sourceHash,
        counts,
        metrics,
      },
      null,
      2,
    ),
  );
  console.log(error ? String(error) : 'Performance workload completed');
  app.exit(error ? 1 : 0);
}
process.on('uncaughtException', (error) => finish(error));
process.on('unhandledRejection', (error) => finish(error));
setTimeout(() => finish(new Error('Performance workload exceeded 210 seconds')), 210000).unref();
async function workload() {
  const wait = async (probe) => {
    const deadline = Date.now() + 60000;
    while (!(await probe())) {
      if (Date.now() > deadline)
        throw new Error(
          `Performance fixture did not settle: ${probe.toString()}; active=${document.querySelector('.terminal-tab-panel.active')?.textContent.slice(-500)}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const paint = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const sample = (values) => {
    const ordered = [...values].sort((a, b) => a - b);
    return {
      count: values.length,
      p50: ordered[Math.floor(ordered.length * 0.5)] ?? 0,
      p95: ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))] ?? 0,
    };
  };
  const longTasks = [];
  const observer = new PerformanceObserver((list) =>
    longTasks.push(...list.getEntries().map((entry) => entry.duration)),
  );
  observer.observe({ type: 'longtask', buffered: true });
  await wait(() => document.querySelectorAll('[data-project-row]').length >= 100);
  const projects = (await window.api.projects.list()).filter((p) => p.agent === 'claude');
  const sessions = await window.api.sessions.listForProject(projects[0].id);
  document.querySelector('[data-project-row]').querySelector('.project-open').click();
  await wait(() => document.querySelectorAll('.session-open').length >= 10);
  const echo = [],
    switching = [],
    frames = [];
  let watching = true,
    last = performance.now();
  const frame = (now) => {
    frames.push(now - last);
    last = now;
    if (watching) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  for (const session of sessions) {
    const button = [...document.querySelectorAll('.session-open')].find((button) =>
      button.textContent.includes(session.title),
    );
    button.click();
    await wait(
      () => document.querySelectorAll('.tab-bar .tab').length >= sessions.indexOf(session) + 1,
    );
    await wait(() =>
      document.querySelector('.terminal-tab-panel.active')?.textContent.includes('PA_PERF_READY'),
    );
  }
  await wait(() => document.querySelectorAll('.terminal-instance .xterm').length === 10);
  const tabs = [...document.querySelectorAll('.tab-bar .tab')];
  const keys = sessions.map((session) => `${projects[0].id}::session:${session.id}::agent`);
  const input = async (index) => {
    tabs[index % tabs.length].click();
    await paint();
    const pane = document.querySelector('.terminal-tab-panel.active');
    const area = pane.querySelector('.xterm-helper-textarea');
    area.focus();
    const started = performance.now();
    // A unique Greek key is absent from generated background output, so unrelated paint
    // cannot satisfy the input-latency probe while another stream is producing data.
    const letter = String.fromCharCode(945 + index);
    area.dispatchEvent(
      new KeyboardEvent('keypress', {
        key: letter,
        charCode: letter.charCodeAt(0),
        keyCode: letter.charCodeAt(0),
        which: letter.charCodeAt(0),
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait(() => pane.textContent.includes(letter));
    echo.push(performance.now() - started);
    await window.api.pty.write(keys[index % keys.length], '\b \b');
  };
  await input(0);
  const idleStart = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 6000));
  for (const key of keys) await window.api.pty.write(key, 'claude --burst\r');
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    tabs[i % tabs.length].click();
    await paint();
    switching.push(performance.now() - start);
    if (i < 10) await input(i);
    const scroller = document.querySelector('.sidebar-section.scrollable');
    scroller.scrollTop = (i % 2) * scroller.scrollHeight;
    await paint();
  }
  const divider = document.querySelector('.resize-handle');
  const rect = divider.getBoundingClientRect();
  const dividerPositions = [rect.x];
  const pointer = (type, x, buttons) =>
    new PointerEvent(type, {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: x,
      clientY: rect.y + 100,
      button: 0,
      buttons,
      bubbles: true,
      cancelable: true,
    });
  divider.dispatchEvent(pointer('pointerdown', rect.x + 1, 1));
  await paint();
  for (let i = 0; i < 30; i++) {
    document.body.dispatchEvent(pointer('pointermove', rect.x + Math.sin(i) * 80, 1));
    await paint();
    dividerPositions.push(divider.getBoundingClientRect().x);
  }
  window.dispatchEvent(pointer('pointerup', rect.x, 0));
  const dividerTravel = Math.max(...dividerPositions) - Math.min(...dividerPositions);
  if (dividerTravel < 20) throw new Error('Divider probe did not actually resize a panel');
  for (const tab of tabs) {
    tab.click();
    await wait(() =>
      document.querySelector('.terminal-tab-panel.active')?.textContent.includes('PA_PERF_DONE'),
    );
  }
  const large = projects.find((project) => project.dirName === 'fixture-99');
  const largeProjectRow = [...document.querySelectorAll('[data-project-row]')].find(
    (row) => row.dataset.projectRow === large.id,
  );
  largeProjectRow.querySelector('.project-open').click();
  await wait(() => document.querySelectorAll('.project-sessions').length >= 2);
  const largeList = largeProjectRow
    .closest('.project-tree-node')
    .querySelector('.project-sessions');
  await wait(
    () =>
      largeList.querySelector('[data-virtual-key]') ||
      largeList.querySelectorAll('.session-item').length === 1000,
  );
  const sidebar = document.querySelector('.sidebar-section.scrollable');
  sidebar.scrollTop = sidebar.scrollHeight;
  await paint();
  await paint();
  await wait(() => largeList.textContent.includes('Performance fixture 99-999'));
  const largeMounted = largeList.querySelectorAll('.session-item').length;
  const selectedMode = document.querySelector('[aria-label="Select sessions"]');
  selectedMode.click();
  await wait(() => largeList.querySelectorAll('.session-selection-check').length === 1000);
  document.querySelector('[aria-label="Cancel session selection"]')?.click();
  await paint();
  await paint();
  watching = false;
  observer.disconnect();
  return {
    projects: projects.length,
    historiesPerProject: sessions.length,
    terminals: tabs.length,
    elapsedMs: performance.now() - idleStart,
    echoMs: sample(echo),
    tabPaintMs: sample(switching),
    frameMs: sample(frames),
    longTasks: sample(longTasks),
    dividerTravel,
    largeGroupMountedRows: largeMounted,
    mountedRows: document.querySelectorAll('.session-item').length,
    heap: performance.memory?.usedJSHeapSize ?? null,
  };
}
app.once('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false);
  const send = win.webContents.send.bind(win.webContents);
  win.webContents.send = (channel, ...args) => {
    counts.sends[channel] = (counts.sends[channel] ?? 0) + 1;
    if (channel === 'pty:data') {
      const [key, data] = args;
      const tail = (received.get(key) ?? '') + data;
      let consumed = 0;
      for (const match of tail.matchAll(/PA_PERF_LINE_(\d+) 中文🙂/g)) {
        const index = Number(match[1]);
        // ConPTY may repaint earlier lines after a resize; collect identities rather than
        // treating those native redraws as duplicated transport delivery.
        const lines = deliveredSequences.get(key) ?? new Set();
        lines.add(index);
        deliveredSequences.set(key, lines);
        expectedLines.set(key, lines.size);
        consumed = match.index + match[0].length;
      }
      received.set(key, tail.slice(consumed).slice(-200));
    }
    return send(channel, ...args);
  };
  win.webContents.session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (_req, callback) => callback({ cancel: true }),
  );
  win.webContents.once('did-finish-load', async () => {
    try {
      await contentTracing.startRecording({
        included_categories: ['devtools.timeline', 'v8', 'blink.user_timing'],
      });
      const cpu = process.cpuUsage();
      const metrics = await win.webContents.executeJavaScript(`(${workload.toString()})()`);
      assert.equal(expectedLines.size, 10, 'All ten terminal streams must complete');
      assert.ok(
        [...expectedLines.values()].every((count) => count === 3000),
        'All generated Unicode/ANSI output must be delivered',
      );
      metrics.deliveredLines = [...expectedLines.values()];
      metrics.mainCpuMicros = process.cpuUsage(cpu);
      metrics.processes = app
        .getAppMetrics()
        .map(({ type, cpu, memory }) => ({ type, cpu, memory }));
      writeFileSync(join(reports, 'window.png'), (await win.capturePage()).toPNG());
      await finish(null, metrics);
    } catch (error) {
      await finish(error);
    }
  });
});
require(mainEntry);
