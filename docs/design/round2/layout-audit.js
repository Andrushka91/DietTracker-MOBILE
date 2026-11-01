// Layout audit for the redesign screenshots: reads a uiautomator dump and
// reports off-screen nodes, sub-44 pt touch targets and content that sits under
// the floating tab bar. Run: node docs/design/round2/layout-audit.js <ui.xml>
const fs = require('fs');

const file = process.argv[2];
const xml = fs.readFileSync(file, 'utf8');
const bounds = (value) => {
  const m = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(value);
  return m ? { l: +m[1], t: +m[2], r: +m[3], b: +m[4] } : null;
};
const nodes = [...xml.matchAll(/<node[^>]*>/g)].map((m) => m[0]).map((tag) => {
  const attr = (name) => {
    const m = new RegExp(`${name}="([^"]*)"`).exec(tag);
    return m ? m[1] : '';
  };
  return {
    text: attr('text'),
    desc: attr('content-desc'),
    clickable: attr('clickable') === 'true',
    cls: attr('class'),
    box: bounds(attr('bounds')),
  };
});

// The tab bar is the row of five tab items at the bottom.
const tabs = nodes.filter((n) => /, (Today|Calendar|Statistics|Templates|Settings)$/.test(n.desc));
const bar = tabs.reduce(
  (acc, n) => ({
    l: Math.min(acc.l, n.box.l),
    t: Math.min(acc.t, n.box.t),
    r: Math.max(acc.r, n.box.r),
    b: Math.max(acc.b, n.box.b),
  }),
  { l: 1e9, t: 1e9, r: 0, b: 0 },
);

const SCREEN = {
  w: Number(process.argv[3] ?? 1080),
  h: Number(process.argv[4] ?? 2400),
};
const DENSITY = Number(process.argv[5] ?? 2.625); // 420 dpi
const MIN = 44 * DENSITY;

const offscreen = nodes.filter(
  (n) => n.box && (n.box.l < 0 || n.box.t < 0 || n.box.r > SCREEN.w || n.box.b > SCREEN.h),
);
const smallTargets = nodes.filter(
  (n) =>
    n.clickable &&
    n.box &&
    !tabs.includes(n) &&
    (n.box.r - n.box.l < MIN || n.box.b - n.box.t < MIN),
);
const underBar = nodes.filter(
  (n) =>
    n.box &&
    !tabs.includes(n) &&
    n.box.t < bar.b &&
    n.box.b > bar.t &&
    n.box.l < bar.r &&
    n.box.r > bar.l &&
    (n.text !== '' || n.desc !== ''),
);

console.log(`file: ${file}`);
console.log(`tab bar: ${JSON.stringify(bar)}`);
console.log(`off-screen nodes: ${offscreen.length}`);
for (const n of offscreen.slice(0, 5)) {
  console.log(`  ${JSON.stringify(n.box)} ${n.cls} "${n.desc || n.text}"`);
}
console.log(`clickable targets below 44 pt: ${smallTargets.length}`);
for (const n of smallTargets.slice(0, 8)) {
  const w = ((n.box.r - n.box.l) / DENSITY).toFixed(1);
  const h = ((n.box.b - n.box.t) / DENSITY).toFixed(1);
  console.log(`  ${w}x${h} dp  "${n.desc || n.text}"`);
}
console.log(`text/interactive nodes under the tab bar: ${underBar.length}`);
for (const n of underBar.slice(0, 6)) {
  console.log(`  ${JSON.stringify(n.box)} "${n.desc || n.text}"`);
}
