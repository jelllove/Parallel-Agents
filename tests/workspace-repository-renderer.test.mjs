import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import test from 'node:test';

test('late repository responses cannot replace a newer folder selection or an unmounted dialog', async () => {
  const requests = new Map();
  const slots = [];
  let cursor = 0;
  let effects = [];
  const react = {
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: initial };
      return [slots[i].value, (value) => (slots[i].value = value)];
    },
    useEffect(effect, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((value, n) => value !== slots[i].deps[n]))
        effects.push(() => {
          slots[i]?.cleanup?.();
          slots[i] = { deps, cleanup: effect() };
        });
    },
  };
  const { code } = await transform(
    await readFile(
      new URL('../src/renderer/hooks/use-workspace-repository.ts', import.meta.url),
      'utf8',
    ),
    { loader: 'ts', format: 'cjs' },
  );
  const module = { exports: {} };
  const require = createRequire(import.meta.url);
  new Function('require', 'module', 'exports', 'window', code)(
    (id) => (id === 'react' ? react : require(id)),
    module,
    module.exports,
    {
      api: {
        workspace: {
          repository(path) {
            const request = Promise.withResolvers();
            requests.set(path, request);
            return request.promise;
          },
        },
      },
    },
  );
  const render = (path) => {
    cursor = 0;
    effects = [];
    const result = module.exports.useWorkspaceRepository(path);
    effects.forEach((effect) => effect());
    return result;
  };
  assert.equal(render('/one').loading, true);
  assert.equal(render('/two').loading, true);
  requests.get('/two').resolve({ defaultRef: 'refs/heads/two' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(render('/two').info.defaultRef, 'refs/heads/two');
  requests.get('/one').resolve({ defaultRef: 'refs/heads/one' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(render('/two').info.defaultRef, 'refs/heads/two');
  render('/three');
  slots.forEach((slot) => slot.cleanup?.());
  requests.get('/three').resolve({ defaultRef: 'stale' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(render('/two').info.defaultRef, 'refs/heads/two');
});
