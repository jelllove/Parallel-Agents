#!/usr/bin/env node
// Advisory PR review: map changed files to the active learned rules that govern them.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const corpusPath = join(repositoryRoot, '.github/agent-rules/learned-rules.json');

function globToRegExp(glob) {
  let pattern = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      pattern += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (ch === '*') pattern += '[^/]*';
    else if (ch === '?') pattern += '[^/]';
    else pattern += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`);
}

export function matchesGlob(path, glob) {
  return globToRegExp(glob).test(path.replaceAll('\\', '/'));
}

export function reviewChangedFiles(corpus, changedFiles) {
  const active = corpus.rules.filter((rule) => rule.state === 'active');
  const findings = [];
  for (const rule of active) {
    const files = changedFiles.filter((file) => rule.appliesTo.some((g) => matchesGlob(file, g)));
    if (files.length > 0) findings.push({ ruleId: rule.id, summary: rule.summary, files });
  }
  return {
    mode: 'advisory',
    reviewedFiles: changedFiles.length,
    activeRules: active.length,
    findings,
  };
}

function changedFilesAgainst(base) {
  const output = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  return output.split(/\r?\n/).filter(Boolean);
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const base = option('--base') ?? 'origin/main';
  const output = option('--output') ?? 'reports/learned-rules-review/report.json';
  const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
  const report = { base, ...reviewChangedFiles(corpus, changedFilesAgainst(base)) };
  const destination = resolve(repositoryRoot, output);
  if (!destination.startsWith(join(repositoryRoot, 'reports'))) {
    throw new Error('Review reports must be written under reports/.');
  }
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  for (const finding of report.findings) {
    console.log(
      `::notice title=Learned rule ${finding.ruleId}::${finding.summary} (${finding.files.join(', ')})`,
    );
  }
  console.log(
    `Reviewed ${report.reviewedFiles} changed file(s) against ${report.activeRules} active rule(s); ${report.findings.length} advisory finding(s).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
