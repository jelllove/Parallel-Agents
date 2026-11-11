const assert = require('node:assert/strict');

exports.assertSessionPreservation = (before, after, deleted) => {
  const key = (session) => `${session.agent}:${session.id}`;
  const removed = new Set(deleted.map(key));
  const remaining = new Set(after.map(key));
  for (const session of before) {
    if (!removed.has(key(session)))
      assert.ok(
        remaining.has(key(session)),
        `Unselected native history disappeared: ${key(session)}`,
      );
  }
  for (const identity of removed)
    assert.ok(!remaining.has(identity), `Selected native history remains: ${identity}`);
};
