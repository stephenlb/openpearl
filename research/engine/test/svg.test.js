import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barChart, lineChart, escapeXml } from '../src/svg.js';

test('barChart has structure, axes and labels', () => {
  const svg = barChart([{ label: 'a', value: 3 }, { label: 'b', value: 7 }], { title: 'T', xLabel: 'X', yLabel: 'Y' });
  assert.ok(svg.startsWith('<svg ') && svg.endsWith('</svg>'));
  assert.equal((svg.match(/class="bar"/g) || []).length, 2);
  assert.ok(svg.includes('x-axis') && svg.includes('y-axis'));
  assert.ok(svg.includes('>X</text>') && svg.includes('>Y</text>') && svg.includes('>T</text>'));
});

test('barChart escapes labels', () => {
  const svg = barChart([{ label: '<b>&"', value: 1 }], { title: 'a<b&c' });
  assert.ok(!svg.includes('<b>'));
  assert.ok(svg.includes('&lt;b&gt;&amp;&quot;'));
  assert.ok(svg.includes('a&lt;b&amp;c'));
});

test('lineChart draws a polyline per series and escapes names', () => {
  const svg = lineChart(
    [{ name: 'x<y&z', points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] }, { name: 'b', points: [{ x: 0, y: 2 }, { x: 1, y: 0 }] }],
    { xLabel: 'n' },
  );
  assert.equal((svg.match(/<polyline/g) || []).length, 2);
  assert.ok(svg.includes('x&lt;y&amp;z'));
  assert.ok(!svg.includes('x<y'));
});

test('empty input and determinism', () => {
  assert.ok(barChart([]).includes('</svg>'));
  assert.ok(lineChart([]).includes('</svg>'));
  const d = [{ label: 'a', value: 2 }];
  assert.equal(barChart(d), barChart(d));
  assert.equal(escapeXml("'"), '&apos;');
});
