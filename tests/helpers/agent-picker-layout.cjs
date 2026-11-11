/* global window, document, getComputedStyle, requestAnimationFrame */
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

async function inspectPicker(theme, enlarged) {
  const waitFor = async (probe) => {
    const deadline = Date.now() + 5000;
    while (!probe()) {
      if (Date.now() > deadline) throw new Error('Agent picker fixture did not settle');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  if (!document.querySelector('.agent-picker')) {
    await waitFor(() =>
      [...document.querySelectorAll('button')].some((b) => b.textContent.includes('New Project')),
    );
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent.includes('New Project'))
      .click();
  }
  await waitFor(() => document.querySelectorAll('.agent-picker-row').length === 5);
  document.documentElement.dataset.theme = theme;
  if (enlarged) {
    document.documentElement.style.setProperty('--app-font-size', '24px');
    for (const [index, row] of [...document.querySelectorAll('.agent-picker-row')].entries()) {
      row.querySelector('.agent-picker-name').textContent += ' — long fixture provider name';
      row.querySelector('.agent-picker-sub').textContent =
        index % 2
          ? '/opt/generated-fixture/very-long-installation-directory/with-spaces-and-a-long-provider-executable-name'
          : 'C:\\Generated fixture\\very long installation directory\\nested tools\\provider-executable-with-a-long-name.cmd';
    }
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const picker = document.querySelector('.agent-picker');
  const rect = picker.getBoundingClientRect();
  const rows = [...picker.querySelectorAll('.agent-picker-row')];
  if (
    rect.left < 8 ||
    rect.top < 8 ||
    rect.right > window.innerWidth - 8 ||
    rect.bottom > window.innerHeight - 8
  )
    throw new Error('Agent picker exceeds viewport gutters');
  if (picker.scrollWidth > picker.clientWidth)
    throw new Error('Agent picker overflows horizontally');
  for (const [index, row] of rows.entries()) {
    const name = row.querySelector('.agent-picker-name');
    const path = row.querySelector('.agent-picker-sub');
    const actions = row.querySelector('.agent-picker-actions');
    if (
      path.scrollWidth > path.clientWidth ||
      name.scrollWidth > name.clientWidth ||
      actions.getBoundingClientRect().left < name.getBoundingClientRect().right
    )
      throw new Error('Agent picker text overlaps or clips actions');
    if (getComputedStyle(row).borderTopWidth !== (index ? '1px' : '0px'))
      throw new Error('Agent picker row divider is missing or trailing');
  }
  const tabs = document.querySelectorAll('.terminal-tab').length;
  for (const [label, id] of [
    ['Claude Code', 'claude'],
    ['Codex CLI', 'codex'],
    ['GitHub Copilot', 'copilot'],
    ['Gemini CLI', 'gemini'],
    ['Aider', 'aider'],
  ]) {
    const options = picker.querySelector(`button[aria-label="Configure ${label} launch"]`);
    if (!options) throw new Error(`Missing Options for ${label}`);
    options.click();
    await waitFor(() =>
      document.querySelector(
        '.agent-launch-dialog[open] input[aria-label="Model ID"]:not(:disabled)',
      ),
    );
    if (
      document.querySelector('.new-session-dialog[open]') ||
      document.querySelectorAll('.terminal-tab').length !== tabs
    )
      throw new Error('Options unexpectedly opened creation or a terminal');
    const dialog = document.querySelector('.agent-launch-dialog[open]');
    const selected = dialog.querySelector('select[aria-label="Agent"]');
    if (selected.value !== id) throw new Error('Options selected the wrong provider');
    [...dialog.querySelectorAll('button')]
      .find((button) => button.textContent === 'Cancel')
      .click();
    await waitFor(() => !document.querySelector('.agent-launch-dialog[open]'));
  }
  rows.at(-1).querySelector('button').scrollIntoView({ block: 'nearest' });
  const last = rows.at(-1).querySelector('.agent-picker-actions').getBoundingClientRect();
  if (last.bottom > rect.bottom || last.top < rect.top)
    throw new Error('Last agent actions are unreachable');
  picker.scrollTop = 0;
  return { theme, enlarged, scrollable: picker.scrollHeight > picker.clientHeight };
}

exports.verifyAgentPicker = async (win, reports, reportName) => {
  const bounds = win.getBounds();
  const previous = await win.webContents.executeJavaScript(`({
    theme: document.documentElement.dataset.theme,
    font: document.documentElement.style.getPropertyValue('--app-font-size')
  })`);
  const checks = [];
  try {
    for (const [theme, enlarged] of [
      ['dark', false],
      ['light', false],
      ['light', true],
    ]) {
      if (enlarged) win.setSize(1000, 600);
      const result = await win.webContents.executeJavaScript(
        `(${inspectPicker.toString()})(${JSON.stringify(theme)}, ${enlarged})`,
      );
      if (enlarged) assert.equal(result.scrollable, true);
      writeFileSync(
        join(reports, `${reportName}-agent-picker-${theme}${enlarged ? '-compact' : ''}.png`),
        (await win.capturePage()).toPNG(),
      );
      checks.push(
        `agent picker ${theme}${enlarged ? ' at minimum size, maximum font and long fixture paths' : ''} wraps text, separates rows, keeps actions reachable and Options creates no terminal`,
      );
    }
    await win.webContents.executeJavaScript(`(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      const deadline = Date.now() + 5000;
      while (document.querySelector('.agent-picker')) {
        if (Date.now() > deadline) throw new Error('Escape did not dismiss picker');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    })()`);
    checks.push('agent picker Escape dismisses without creating a session');
    return checks;
  } finally {
    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('.agent-picker-backdrop')?.click();
      document.documentElement.dataset.theme = ${JSON.stringify(previous.theme)};
      ${previous.font ? `document.documentElement.style.setProperty('--app-font-size', ${JSON.stringify(previous.font)})` : "document.documentElement.style.removeProperty('--app-font-size')"};
    })()`);
    win.setBounds(bounds);
  }
};
