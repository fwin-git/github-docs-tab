import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBlobEviction } from '../src/content/blob-cache.js';

test('keeps everything when under budget', () => {
  const manifest = [
    { sha: 'a', at: 1, bytes: 100 },
    { sha: 'b', at: 2, bytes: 100 },
  ];
  const { keep, evict } = planBlobEviction(manifest, 1000);
  assert.deepEqual(evict, []);
  assert.equal(keep.length, 2);
});

test('evicts oldest first when over budget', () => {
  const manifest = [
    { sha: 'old', at: 10, bytes: 600 },
    { sha: 'mid', at: 20, bytes: 600 },
    { sha: 'new', at: 30, bytes: 600 },
  ];
  const { keep, evict } = planBlobEviction(manifest, 1000);
  // newest first: keep 'new' (600), 'mid' would make 1200 > 1000 -> evict mid, old
  assert.deepEqual(evict.sort(), ['mid', 'old']);
  assert.deepEqual(
    keep.map((e) => e.sha),
    ['new']
  );
});

test('a single oversized entry is still kept (never evict the newest write)', () => {
  const manifest = [{ sha: 'huge', at: 5, bytes: 5000 }];
  const { keep, evict } = planBlobEviction(manifest, 1000);
  assert.deepEqual(evict, []);
  assert.equal(keep.length, 1);
});

test('empty manifest is a no-op', () => {
  const { keep, evict } = planBlobEviction([], 1000);
  assert.deepEqual(keep, []);
  assert.deepEqual(evict, []);
});
