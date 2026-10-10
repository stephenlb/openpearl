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

test('width/height are coerced and cannot inject attributes', () => {
  const svg = barChart([{ label: 'a', value: 1 }], { width: '1" onload="x', height: 5 });
  assert.ok(!svg.includes('onload'));
  assert.ok(!/(width|height)="-/.test(svg));
  assert.ok(barChart([], { width: 600 }).includes('width="600"'));
});

test('non-finite values are dropped and negatives clamped', () => {
  const bar = barChart([{ label: 'a', value: NaN }, { label: 'b', value: -3 }, { label: 'c', value: 2 }]);
  assert.ok(!bar.includes('NaN'));
  assert.equal((bar.match(/class="bar"/g) || []).length, 2);
  assert.match(bar, /class="bar"[^>]*height="0"/);
  const line = lineChart([{ name: 's', points: [{ x: 0, y: -5 }, { x: 1, y: undefined }, { x: 2, y: 4 }] }]);
  assert.ok(!line.includes('NaN'));
  assert.equal(line.match(/points="([^"]*)"/)[1].split(' ').length, 2);
});

test('malformed input is tolerated', () => {
  assert.ok(barChart(null, {}).startsWith('<svg'));
  assert.ok(barChart([null, { label: 'a', value: '5' }]).startsWith('<svg'));
  assert.ok(lineChart([null, { name: 's' }]).startsWith('<svg'));
  assert.ok(lineChart('x').startsWith('<svg'));
});

test('small-magnitude y ticks stay readable', () => {
  const out = barChart([{ label: 'a', value: 0.001 }]);
  assert.match(out, /class="y-tick"[^>]*>0\.001</);
});
