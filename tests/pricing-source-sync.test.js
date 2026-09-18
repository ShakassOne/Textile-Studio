'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PRINT = require('../utils/print-tiers');

const studio = fs.readFileSync(path.join(__dirname, '../public/textilelab-studio.html'), 'utf8');
const storefront = fs.readFileSync(path.join(__dirname, '../routes/storefront.js'), 'utf8');

test('le studio, ses cartes de format et le checkout interne partagent le même barème', () => {
  const labels = { A6: '1,50', A5: '2,00', A4: '3,00', A3: '4,00' };

  for (const [format, amount] of Object.entries(PRINT.FACE_SURCHARGES)) {
    assert.match(studio, new RegExp(`${format}: \\{[^\\n]+extra: ${String(amount).replace('.', '\\.')}0?`));
    assert.match(studio, new RegExp(`data-fmt="${format}"[\\s\\S]{0,220}\\+${labels[format]} €`));
  }

  assert.match(storefront, /const EXTRA_PRICE\s*=\s*\{ A3: 4, A4: 3, A5: 2, A6: 1\.5 \}/);
});
