import { parentPort, workerData } from 'node:worker_threads';
import * as prettier from 'prettier';

if (parentPort && workerData) {
  const formatted = [];
  for (const file of workerData.files) {
    try {
      const text = await prettier.format(file.text, {
        ...workerData.options,
        parser: file.path.toLowerCase().endsWith('.md') ? 'markdown' : 'yaml',
        embeddedLanguageFormatting: 'off',
      });
      formatted.push({ path: file.path, text });
    } catch {
      parentPort.postMessage({ error: 'format-failed', path: file.path });
      process.exitCode = 1;
      break;
    }
  }
  if (!process.exitCode) parentPort.postMessage({ formatted, version: prettier.version });
}
