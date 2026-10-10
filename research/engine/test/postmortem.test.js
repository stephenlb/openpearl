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

const ev = (t, type, data) => ({ t, type, ...(data === undefined ? {} : { data }) });

test('repeated failure keeps first unresolved time', () => {
  const out = buildPostmortem([ev(0, 'failure', { job: 'a' }), ev(100, 'failure', { job: 'a' }), ev(300, 'recovery', { job: 'a' })]);
  assert.match(out, /300ms \(1 recovered\)/);
});

test('recovery without failure is ignored; unresolved counted', () => {
  const out = buildPostmortem([ev(0, 'recovery', { job: 'x' }), ev(5, 'failure', { job: 'y' })]);
  assert.match(out, /## MTTR\n\nn\/a/);
  const out2 = buildPostmortem([ev(0, 'failure', { job: 'a' }), ev(10, 'recovery', { job: 'a' }), ev(20, 'failure', { job: 'b' })]);
  assert.match(out2, /10ms \(1 recovered, 1 unresolved\)/);
});

test('failure without class is unknown; without job is not listed; no data ok', () => {
  const out = buildPostmortem([ev(0, 'failure', {}), ev(1, 'note')]);
  assert.match(out, /- unknown: 1/);
  assert.match(out, /## Affected jobs\n\n_None\._/);
  assert.match(out, /- t=1 note\n/);
});

test('numeric and string job ids match', () => {
  const out = buildPostmortem([ev(0, 'failure', { job: 1 }), ev(50, 'recovery', { job: '1' })]);
  assert.match(out, /50ms \(1 recovered\)/);
});

test('equal t keeps input order; root-cause ties sort alphabetically', () => {
  const out = buildPostmortem([ev(0, 'failure', { class: 'b' }), ev(0, 'failure', { class: 'a' })]);
  assert.ok(out.indexOf('class=b') < out.indexOf('class=a'));
  assert.ok(out.indexOf('- a: 1') < out.indexOf('- b: 1'));
});

test('multi-line and object values cannot inject markdown', () => {
  const out = buildPostmortem([ev(0, 'failure', { msg: 'x\n# Injected', obj: { a: 1 } })]);
  assert.ok(!out.includes('\n# Injected'));
  assert.ok(!out.includes('[object Object]'));
});

test('rejects invalid events', () => {
  assert.throws(() => buildPostmortem([null]), TypeError);
  assert.throws(() => buildPostmortem([{ type: 'failure' }]), TypeError);
});
