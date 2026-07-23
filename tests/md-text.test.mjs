import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mdToPlainText, extractHeadings } from '../src/common/md-text.js';

test('mdToPlainText strips markdown syntax but keeps readable text', () => {
  const src = [
    '# Title',
    '',
    'Some **bold** and _em_ text with `code`.',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '> quoted line',
    '',
    '- [x] task item',
    '',
    '[label](https://x.y) and ![alt](img.png) and [[Wiki|Shown]] and [[Plain]]',
  ].join('\n');
  const out = mdToPlainText(src);
  assert.ok(out.includes('Title'));
  assert.ok(out.includes('Some bold and em text with code.'));
  assert.ok(out.includes('const x = 1;'));
  assert.ok(out.includes('quoted line'));
  assert.ok(out.includes('task item'));
  assert.ok(out.includes('label'));
  assert.ok(out.includes('alt'));
  assert.ok(out.includes('Shown'));
  assert.ok(out.includes('Plain'));
  assert.ok(!out.includes('**'));
  assert.ok(!out.includes('](')); // link syntax gone
  assert.ok(!out.includes('```'));
  assert.ok(!out.includes('[['));
});

test('extractHeadings returns heading texts in order', () => {
  const src = '# One\n\ntext\n\n## Two `code`\n\n```md\n# not a heading\n```\n\n### Three\n';
  assert.deepEqual(extractHeadings(src), ['One', 'Two code', 'Three']);
});
