const { chromium } = require('@playwright/test');
const path = require('path');

const OUT = path.join(__dirname, '..');

function orbitSvg({ size, fullBleed = false, safeScale = 1, detail = true, ring = true }) {
  const glowFilter = detail
    ? `<filter id="glow" x="-120%" y="-120%" width="340%" height="340%"><feGaussianBlur stdDeviation="20"/></filter>
       <filter id="cardShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="14" stdDeviation="20" flood-color="#04060b" flood-opacity="0.55"/></filter>`
    : '';
  const tile = fullBleed
    ? `<rect width="512" height="512" fill="url(#bg)"/>`
    : `<rect width="512" height="512" rx="114" fill="url(#bg)"/>`;
  const dots = [
    { x: 256, y: 80, r: 26, c: '#fbbf24' },
    { x: 88, y: 202, r: 23, c: '#60a5fa' },
    { x: 424, y: 202, r: 23, c: '#5eead4' },
    { x: 150, y: 432, r: 23, c: '#f472b6' },
    { x: 352, y: 428, r: 23, c: '#a78bfa' },
  ];
  const glows = detail
    ? dots.map(d => `<circle cx="${d.x}" cy="${d.y}" r="${d.r * 2.1}" fill="${d.c}" opacity="0.22" filter="url(#glow)"/>`).join('')
    : '';
  const dotEls = dots.map(d => `<circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill="${d.c}"/>`).join('');
  const ringEl = ring
    ? `<circle cx="256" cy="256" r="176" fill="none" stroke="#60a5fa" stroke-opacity="0.35" stroke-width="5" stroke-dasharray="2 20" stroke-linecap="round"/>`
    : '';
  const card = `
    <g transform="rotate(-8 256 256)" ${detail ? 'filter="url(#cardShadow)"' : ''}>
      ${detail ? '<rect x="114" y="124" width="284" height="284" rx="63" fill="#c3cedd"/>' : ''}
      <rect x="114" y="114" width="284" height="284" rx="63" fill="#ffffff"/>
      <line x1="256" y1="134" x2="256" y2="378" stroke="#dbe3ea" stroke-width="6"/>
      <line x1="134" y1="256" x2="378" y2="256" stroke="#dbe3ea" stroke-width="6"/>
      <g fill="#172033">
        <rect x="154" y="178" width="68" height="20" rx="10"/><rect x="178" y="154" width="20" height="68" rx="10"/>
        <rect x="290" y="178" width="68" height="20" rx="10"/>
        <g transform="translate(188,324) rotate(45)"><rect x="-31" y="-10" width="62" height="20" rx="10"/><rect x="-10" y="-31" width="20" height="62" rx="10"/></g>
        <rect x="293" y="314" width="62" height="20" rx="10"/><circle cx="324" cy="292" r="11"/><circle cx="324" cy="356" r="11"/>
      </g>
    </g>`;
  const content = `${ringEl}${glows}${dotEls}${card}`;
  const scaled = safeScale !== 1
    ? `<g transform="translate(256 256) scale(${safeScale}) translate(-256 -256)">${content}</g>`
    : content;
  return `<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1d2739"/><stop offset="1" stop-color="#121a29"/>
      </linearGradient>
      ${glowFilter}
    </defs>
    ${tile}${scaled}
  </svg>`;
}

const targets = [
  { file: 'icon-512.png', size: 512, opts: {} },
  { file: 'icon-192.png', size: 192, opts: {} },
  { file: 'icon-maskable-512.png', size: 512, opts: { fullBleed: true, safeScale: 0.78 } },
  { file: 'apple-touch-icon.png', size: 180, opts: { fullBleed: true } },
  { file: 'favicon-32.png', size: 32, opts: { detail: false, ring: false, safeScale: 1.18 } },
];

(async () => {
  const browser = await chromium.launch();
  for (const t of targets) {
    const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
    const svg = orbitSvg({ size: t.size, ...t.opts });
    await page.setContent(`<style>*{margin:0;padding:0}</style>${svg}`);
    await page.screenshot({ path: path.join(OUT, t.file), omitBackground: true });
    await page.close();
    console.log('wrote', t.file);
  }
  await browser.close();
})();
