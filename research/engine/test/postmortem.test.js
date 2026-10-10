import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPostmortem } from '../src/index.js';

test('golden postmortem output', () => {
  const events = [
    { t: 1000, type: 'failure', data: { job: 'b', class: 'timeout' } },
    { t: 0, type: 'failure', data: { job: 'a', class: 'transient' } },
    { t: 500, type: 'recovery', data: { job: 'a' } },
    { t: 1500, type: 'failure', data: { job: 'a', class: 'transient' } },
    { t: 2000, type: 'recovery', data: { job: 'b' } },
  ];
  assert.equal(buildPostmortem(events), [
    '# Postmortem',
    '',
    '## Timeline',
    '',
    '- t=0 failure job=a class=transient',
    '- t=500 recovery job=a',
    '- t=1000 failure job=b class=timeout',
    '- t=1500 failure job=a class=transient',
    '- t=2000 recovery job=b',
    '',
    '## Root causes',
    '',
    '- transient: 2',
    '- timeout: 1',
    '',
    '## MTTR',
    '',
    '750ms (2 recovered)',
    '',
    '## Affected jobs',
    '',
    '- a',
    '- b',
    '',
  ].join('\n'));
});

test('empty input', () => {
  assert.equal(buildPostmortem([]), [
    '# Postmortem', '', '## Timeline', '', '_No events._', '',
    '## Root causes', '', '_None._', '', '## MTTR', '', 'n/a', '',
    '## Affected jobs', '', '_None._', '',
  ].join('\n'));
});

test('rejects non-array', () => {
  assert.throws(() => buildPostmortem(null), TypeError);
});
