import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = readFileSync(new URL('../app/veyrnox/_components/ReceiptPrinter.js', import.meta.url), 'utf8');
const { code } = transformSync(source, { loader: 'jsx', jsx: 'automatic', format: 'esm' });
const { ReceiptPrinter } = await import(`data:text/javascript,${encodeURIComponent(code.replace('"motion/react"', `"${import.meta.resolve('motion/react')}"`).replace('"react/jsx-runtime"', `"${import.meta.resolve('react/jsx-runtime')}"`))}`);

test('the receipt renders every row as a term and value, with the title as its accessible name', () => {
  const html = renderToStaticMarkup(React.createElement(ReceiptPrinter, {
    title: 'Receipt',
    footer: 'Thank you for your purchase.',
    rows: [{ label: 'Credits', value: '+500' }, { label: 'Pack price', value: '$10.00' }, { label: 'Ref', value: '1A2B3C4D' }],
  }));
  assert.match(html, /<figure[^>]*aria-label="Receipt"/);
  for (const [label, value] of [['Credits', '\\+500'], ['Pack price', '\\$10\\.00'], ['Ref', '1A2B3C4D']]) {
    assert.match(html, new RegExp(`<dt>${label}</dt><dd[^>]*>${value}</dd>`));
  }
  assert.match(html, /Thank you for your purchase\./);
});

test('the credited top-up shows the receipt only with a whole-cent price, never an app-computed one', () => {
  const topUp = readFileSync(new URL('../app/veyrnox/_components/TopUpPacks.js', import.meta.url), 'utf8');
  assert.match(topUp, /Number\.isInteger\(receipt\?\.priceCents\)/);
  assert.match(topUp, /priceCents: topUp\.price_usd_cents/);
});
