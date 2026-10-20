import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bindingFiles, bindingLabels, renderBinding } from './helpers/legalBindingRender.mjs';
import { BINDINGS } from '../lib/i18n/legal/binding.mjs';

const baseline = JSON.parse(readFileSync('tests/fixtures/legal-binding-labels-main.json', 'utf8'));
for (const file of bindingFiles) for (const { id, jsx } of bindingLabels(file)) {
  test(`${id}: every locale preserves origin/main label; explanation is a described sibling`, () => {
    for (const locale of Object.keys(BINDINGS)) {
      const html = renderBinding(file, jsx, locale);
      if (locale === 'en') {
        assert.equal(html, baseline.labels[id], `${baseline.commit}/${id}`);
        continue;
      }
      const label = html.match(/^<label\b[^>]*>[\s\S]*?<\/label>/)?.[0];
      assert.ok(label, `${locale}/${id}: original label is first`);
      assert.doesNotMatch(label, /data-binding-translation/);
      const sibling = html.slice(label.length);
      const descriptionId = sibling.match(/^<span id="([^"]+)"/)?.[1];
      assert.ok(descriptionId, `${locale}/${id}: explanation is a sibling with an ID`);
      assert.ok(sibling.includes(`data-binding-translation="${id}"`));
      const described = label.match(/aria-describedby="([^"]+)"/)?.[1];
      assert.ok(described?.split(' ').includes(descriptionId));
      const originalDescription = described.split(' ').filter(value => value !== descriptionId).join(' ');
      const restored = label.replace(/ aria-describedby="[^"]+"/, originalDescription ? ` aria-describedby="${originalDescription}"` : '');
      assert.equal(restored, baseline.labels[id], `${locale}/${id}: identical English label, inputs, flags and links`);
    }
  });
}

test('repeated bindings use distinct description IDs and retain existing descriptions', async () => {
  const React = await import('react');
  const { fixture } = await import('./helpers/publicSiteRender.mjs');
  const f = fixture('de', '/app/create');
  const BindingText = f.load('components/BindingText.jsx').default;
  const label = React.createElement('label', null, React.createElement('input', { type: 'checkbox', 'aria-describedby': 'status' }), BINDINGS.en.pass);
  const html = f.render(React.createElement(React.Fragment, null,
    React.createElement(BindingText, { id: 'pass' }, label),
    React.createElement(BindingText, { id: 'pass' }, label)));
  const ids = [...html.matchAll(/<span id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, 2);
  for (const id of ids) assert.ok(html.includes(`aria-describedby="status ${id}"`));
});
