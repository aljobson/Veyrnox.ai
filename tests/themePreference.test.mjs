import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEME_COOKIE, parseTheme, resolveTheme, themeCookie } from '../lib/themePreference.mjs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('only light, dark and system are accepted', () => {
  for (const v of ['light', 'dark', 'system']) assert.equal(parseTheme(v), v);
  for (const v of [undefined, null, '', 'Light', 'auto', '<x>']) assert.equal(parseTheme(v), null);
});

test('system follows the device and falls back to dark', () => {
  assert.equal(resolveTheme('system', true), 'light');
  assert.equal(resolveTheme('system', false), 'dark');
  assert.equal(resolveTheme('light', false), 'light');
  assert.equal(resolveTheme('dark', true), 'dark');
  assert.equal(resolveTheme(null, true), 'dark');
});

test('the cookie is a year, lax, site-wide and holds only the choice', () => {
  const c = themeCookie('light');
  assert.match(c, new RegExp(`^${THEME_COOKIE}=light; Path=/; Max-Age=31536000; SameSite=Lax; Secure$`));
  assert.doesNotMatch(themeCookie('dark', false), /Secure/);
});

test('the server paints the remembered theme on <html> with no inline script', () => {
  const layout = read('app/layout.js');
  assert.match(layout, /cookies\(\)\)\.get\(THEME_COOKIE\)/);
  assert.match(layout, /<html [^>]*data-theme=\{theme \|\| undefined\}/);
  assert.doesNotMatch(layout, /<script/i);
});

test('the system block is the light block, only under a light device', () => {
  const css = read('app/globals.css');
  const tokens = (block) => [...block.matchAll(/--vx-[a-z-]+: [^;]+;/g)].map((m) => m[0]);
  const light = /:root\[data-theme='light'\] \{\n([\s\S]*?)\n\}/.exec(css)[1];
  const system = /@media \(prefers-color-scheme: light\) \{\n  :root\[data-theme='system'\] \{\n([\s\S]*?)\n  \}\n\}/.exec(css)[1];
  assert.deepEqual(tokens(system), tokens(light));
  assert.match(system, /color-scheme: light;/);
});

test('the chart set follows the system choice too', () => {
  const css = read('app/globals.css');
  const chart = (re) => [...re.exec(css)[1].matchAll(/--chart-[a-z0-9-]+: [^;]+;/g)].map((m) => m[0]);
  assert.deepEqual(
    chart(/@media \(prefers-color-scheme: light\) \{\n    :root\[data-theme='system'\] \{\n([\s\S]*?)\n    \}/),
    chart(/:root\[data-theme='light'\] \{\n(    --chart-1[\s\S]*?)\n  \}/),
  );
});

test('the account page offers the three-way picker', () => {
  assert.match(read('app/veyrnox/app/account/page.js'), /<ThemePicker \/>/);
  assert.match(read('app/veyrnox/_components/ThemeToggle.js'), /\['system', 'ui\.themeSystem'\]/);
});
