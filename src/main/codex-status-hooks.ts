import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';

interface HookConfig {
  hooks: Record<string, unknown[]>;
}
export interface CodexHookStatus {
  path: string;
  digest: string;
  installed: boolean;
  backupPath?: string;
}
export class CodexStatusHooks {
  private pending: Promise<unknown> = Promise.resolve();
  readonly path: string;
  private additions: HookConfig;
  constructor(path: string, additions: HookConfig) {
    this.path = resolve(path);
    this.additions = additions;
  }
  private async read() {
    const parts = this.path.slice(parse(this.path).root.length).split(/[\\/]/).filter(Boolean);
    let current = parse(this.path).root;
    for (const part of parts) {
      current = join(current, part);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) throw new Error('Hook configuration cannot follow linked paths');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    let bytes: Buffer;
    let exists = true;
    try {
      const info = await lstat(this.path);
      if (!info.isFile() || info.size > 512 * 1024)
        throw new Error('Hook configuration must be a bounded regular file');
      bytes = await readFile(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      exists = false;
      bytes = Buffer.from('');
    }
    let data: Record<string, unknown>;
    try {
      data = exists ? JSON.parse(bytes.toString('utf8')) : {};
    } catch {
      throw new Error('Existing hooks JSON is malformed; it was not changed');
    }
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      (data.hooks !== undefined &&
        (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)))
    )
      throw new Error('Invalid hooks JSON object');
    const hooks = (data.hooks ?? {}) as Record<string, unknown[]>;
    for (const groups of Object.values(hooks))
      if (!Array.isArray(groups)) throw new Error('Invalid hooks event array');
    return { bytes, data, hooks, digest: createHash('sha256').update(bytes).digest('hex') };
  }
  async inspect(): Promise<CodexHookStatus> {
    const { hooks, digest } = await this.read();
    const installed = Object.entries(this.additions.hooks).every(([event, groups]) =>
      groups.every((group) =>
        (hooks[event] ?? []).some((existing) => JSON.stringify(existing) === JSON.stringify(group)),
      ),
    );
    return { path: this.path, digest, installed };
  }
  apply(install: boolean, expectedDigest: string): Promise<CodexHookStatus> {
    const operation = this.pending.then(async () => {
      const before = await this.read();
      if (before.digest !== expectedDigest)
        throw new Error('Hook configuration changed; reload the preview before applying');
      const hooks = { ...before.hooks };
      let changed = false;
      for (const [event, additions] of Object.entries(this.additions.hooks)) {
        let groups = [...(hooks[event] ?? [])];
        for (const addition of additions) {
          const signature = JSON.stringify(addition);
          const exists = groups.some((group) => JSON.stringify(group) === signature);
          if (install && !exists) {
            groups.push(addition);
            changed = true;
          }
          if (!install && exists) {
            groups = groups.filter((group) => JSON.stringify(group) !== signature);
            changed = true;
          }
        }
        if (groups.length) hooks[event] = groups;
        else delete hooks[event];
      }
      if (!changed) return this.inspect();
      await mkdir(dirname(this.path), { recursive: true });
      const backupPath = before.bytes.length
        ? `${this.path}.parallel-agents-backup-${randomUUID()}`
        : undefined;
      if (backupPath) await writeFile(backupPath, before.bytes, { flag: 'wx', mode: 0o600 });
      const next = { ...before.data, hooks };
      if (!Object.keys(hooks).length && before.data.hooks === undefined)
        delete (next as Record<string, unknown>).hooks;
      const temporary = `${this.path}.parallel-agents-${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', {
          flag: 'wx',
          mode: 0o600,
        });
        if ((await this.read()).digest !== before.digest)
          throw new Error('Hook configuration changed during installation; original preserved');
        await rename(temporary, this.path);
      } finally {
        await unlink(temporary).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
      return { ...(await this.inspect()), backupPath };
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
