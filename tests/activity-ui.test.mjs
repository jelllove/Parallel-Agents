import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';

test('status motion uses glyph-only transforms and respects reduced motion', async () => {
  const css = await readFile(new URL('../src/renderer/styles/theme.css', import.meta.url), 'utf8');
  assert.match(
    css,
    /\.session-activity-icon\.running \.session-activity-glyph\s*\{[^}]*font-size:\s*18px;[^}]*animation:\s*activity-run/,
  );
  assert.match(
    css,
    /\.session-activity-icon\.waiting \.session-activity-glyph\s*\{[^}]*animation:\s*activity-wait/,
  );
  assert.match(
    css,
    /\.session-activity-icon\.completed\.needs-attention \.session-activity-glyph\s*\{[^}]*animation:\s*activity-complete/,
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.session-activity-glyph\s*\{\s*animation: none !important;/,
  );
});

test('session activity icon shows each approved state with accessible text', async () => {
  const result = await build({
    entryPoints: ['src/renderer/components/SessionActivityIcon.tsx'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    jsx: 'automatic',
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  for (const [state, icon] of [
    ['running', '🏃‍♂️'],
    ['waiting', '❓'],
    ['completed', '✅'],
    ['unknown', '❔'],
    ['failed', '❌'],
  ]) {
    const html = renderToStaticMarkup(createElement(module.exports.SessionActivityIcon, { state }));
    assert.ok(html.includes(icon));
    assert.match(html, /role="img" aria-label=/);
    assert.match(html, /class="session-activity-glyph"/);
  }
  const pending = renderToStaticMarkup(
    createElement(module.exports.SessionActivityIcon, {
      state: 'completed',
      attention: true,
      onAcknowledge() {},
    }),
  );
  assert.match(pending, /<button[^>]*type="button"/);
  assert.match(pending, /needs-attention/);
  assert.match(pending, /Acknowledge completion/);
  const acknowledged = renderToStaticMarkup(
    createElement(module.exports.SessionActivityIcon, {
      state: 'completed',
      attention: false,
    }),
  );
  assert.doesNotMatch(acknowledged, /needs-attention/);
  let acknowledgements = 0;
  let propagated = true;
  const control = module.exports.SessionActivityIcon({
    state: 'completed',
    attention: true,
    onAcknowledge: () => acknowledgements++,
  });
  control.props.onClick({
    stopPropagation: () => {
      propagated = false;
    },
  });
  assert.equal(acknowledgements, 1);
  assert.equal(propagated, false);
  assert.equal(control.type, 'button');
});
