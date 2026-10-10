import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPostmortem } from '../src/index.js';

const T = Date.parse('2026-01-01T00:00:00Z');

test('golden postmortem', () => {
  const events = [
    { ts: T + 5000, type: 'recovery', job: 'a' },
    { ts: T, type: 'failure', job: 'a', class: 'timeout', message: 'slow' },
    { ts: T + 1000, type: 'failure', job: 'b', class: 'transient' },
    { ts: T + 2000, type: 'failure', job: 'b', class: 'transient' },
    { ts: T + 4000, type: 'recovery', job: 'b' },
    { ts: T + 6000, type: 'failure', job: 'c', class: 'permanent' },
  ];
  assert.equal(buildPostmortem(events), `# Postmortem

## Timeline

- 2026-01-01T00:00:00.000Z failure: a [timeout] slow
- 2026-01-01T00:00:01.000Z failure: b [transient]
- 2026-01-01T00:00:02.000Z failure: b [transient]
- 2026-01-01T00:00:04.000Z recovery: b
- 2026-01-01T00:00:05.000Z recovery: a
- 2026-01-01T00:00:06.000Z failure: c [permanent]

## Root causes

- transient: 2
- permanent: 1
- timeout: 1

## MTTR

- 4s across 2 resolved incident(s)
- unresolved: 1

## Affected jobs

- a
- b
- c
`);
});

test('empty input', () => {
  assert.equal(buildPostmortem([]), `# Postmortem

## Timeline

- none

## Root causes

- none

## MTTR

- n/a (no resolved incidents)

## Affected jobs

- none
`);
});

test('rejects unknown event types', () => {
  assert.throws(() => buildPostmortem([{ ts: T, type: 'retry', job: 'a' }]), TypeError);
});

test('collapses newlines in values', () => {
  const out = buildPostmortem([
    { ts: T, type: 'failure', job: 'a', class: 'c', message: 'l1\n# h\nl3' },
  ]);
  assert.match(out, /failure: a \[c\] l1 # h l3\n/);
});

test('edge cases: orphan recovery, Date/ISO ts, missing job, sub-second MTTR', () => {
  const out = buildPostmortem([
    { ts: new Date(T), type: 'failure', class: 'x' },
    { ts: new Date(T + 250).toISOString(), type: 'recovery' },
    { ts: T + 300, type: 'recovery', job: 'orphan' },
  ]);
  assert.match(out, /failure: \(unknown\) \[x\]/);
  assert.match(out, /- 250ms across 1 resolved incident\(s\)\n/);
  assert.doesNotMatch(out, /unresolved/);
  assert.match(out, /- orphan\n/);
});

test('rejects bad input', () => {
  assert.throws(() => buildPostmortem('x'), TypeError);
  assert.throws(() => buildPostmortem([{ ts: 'nope', type: 'failure' }]), TypeError);
});
