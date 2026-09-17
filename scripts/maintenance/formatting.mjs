import { Worker } from 'node:worker_threads';

import { decodeText } from './filesystem.mjs';
import { MaintenanceError } from './policy.mjs';

export function formatFiles(files, options, timeoutMs) {
  if (files.length === 0) return Promise.resolve({ formatted: [], version: null });
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./formatter-worker.mjs', import.meta.url), {
      workerData: {
        files: files.map((file) => ({
          path: file.path,
          text: decodeText(file.content, file.path),
        })),
        options,
      },
      env: {},
      execArgv: [],
    });
    let settled = false;
    let result;
    let timedOut = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(async () => {
      timedOut = true;
      await worker.terminate();
      finish(
        new MaintenanceError('format-timeout', 'The one-pass formatter exceeded its time limit.'),
      );
    }, timeoutMs);
    worker.on('message', (message) => {
      if (timedOut) return;
      if (message.error) {
        result = new MaintenanceError(
          'format-failed',
          'Prettier could not format this document.',
          message.path,
        );
      } else result = message;
    });
    worker.once('error', () =>
      finish(new MaintenanceError('format-failed', 'The formatter worker failed.')),
    );
    worker.once('exit', (code) => {
      if (timedOut) {
        finish(
          new MaintenanceError('format-timeout', 'The one-pass formatter exceeded its time limit.'),
        );
      } else if (result instanceof MaintenanceError) finish(result);
      else if (code !== 0 || !result) {
        finish(
          new MaintenanceError('format-failed', 'The formatter worker exited without a result.'),
        );
      } else finish();
    });
  });
}

function patchLines(text, prefix) {
  if (!text) return [];
  const lines = text.split('\n');
  const newline = lines.at(-1) === '';
  if (newline) lines.pop();
  const output = lines.map((line) => `${prefix}${line}`);
  if (!newline) output.push('\\ No newline at end of file');
  return output;
}

export function makePatch(changes) {
  return changes
    .map(({ path, before, after }) => {
      const oldText = decodeText(before.content, path);
      const newText = decodeText(after, path);
      const oldCount = oldText ? oldText.split('\n').length - Number(oldText.endsWith('\n')) : 0;
      const newCount = newText ? newText.split('\n').length - Number(newText.endsWith('\n')) : 0;
      const oldPath = JSON.stringify(`a/${path}`);
      const newPath = JSON.stringify(`b/${path}`);
      return [
        `diff --git ${oldPath} ${newPath}`,
        `--- ${oldPath}`,
        `+++ ${newPath}`,
        `@@ -${oldCount ? 1 : 0},${oldCount} +${newCount ? 1 : 0},${newCount} @@`,
        ...patchLines(oldText, '-'),
        ...patchLines(newText, '+'),
        '',
      ].join('\n');
    })
    .join('');
}
