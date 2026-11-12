import assert from 'node:assert/strict';
import test from 'node:test';
import { detachDiffModels } from '../src/renderer/diff-editor-lifecycle.ts';

test('diff cleanup detaches both models before disposal and does not dispose the React-owned editor', () => {
  const events = [];
  let attached = true;
  const editor = {
    getModel: () =>
      attached
        ? {
            original: {
              dispose() {
                assert.equal(attached, false);
                events.push('original');
              },
            },
            modified: {
              dispose() {
                assert.equal(attached, false);
                events.push('modified');
              },
            },
          }
        : null,
    setModel(model) {
      assert.equal(model, null);
      attached = false;
      events.push('detach');
    },
    dispose() {
      throw new Error('Wrapper owns editor disposal');
    },
  };
  detachDiffModels(editor);
  detachDiffModels(editor);
  assert.deepEqual(events, ['detach', 'original', 'modified', 'detach']);
});
test('closing before lazy editor mount is safe', () =>
  assert.doesNotThrow(() => detachDiffModels(null)));
