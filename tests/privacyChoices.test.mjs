import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { fixture } from './helpers/publicSiteRender.mjs';
import { ANALYTICS_PREFERENCE_KEY } from '../app/lib/analyticsPrivacy.js';

const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

// Execute the real JSX and effects with controlled hooks. No SDK network,
// browser account, stored credentials or telemetry configuration is involved.
function manager(window, posthog) {
  let account = null, cursor = 0, dirty = false, tree;
  const hooks = [], effects = [];
  const react = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: initial };
      return [hooks[index].value, value => {
        if (hooks[index].value !== value) { hooks[index].value = value; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return hooks[index] ||= { current: initial }; },
    useSyncExternalStore: () => account,
    useEffect(callback, dependencies) {
      const index = cursor++, old = hooks[index];
      if (!old || dependencies.some((value, i) => !Object.is(value, old.dependencies[i]))) {
        hooks[index] = { dependencies };
        effects.push(callback);
      }
    },
  };
  const f = fixture('en', '/', { moduleMocks: {
    react, '@posthog/next': { usePostHog: () => posthog },
    './I18nProvider': { useI18n: () => ({ t: key => key }) },
  } });
  const Component = f.load('components/PostHogManager.jsx').default;
  function render(nextAccount = account) {
    account = nextAccount;
    for (let n = 0; n < 10; n += 1) {
      dirty = false; cursor = 0; tree = Component();
      while (effects.length) effects.shift()();
      if (!dirty) return tree;
    }
    throw new Error('Unsettled manager effects');
  }
  function click(label) {
    let button;
    const visit = node => {
      if (!React.isValidElement(node)) return;
      if (node.type === 'button' && node.props.children === label) button = node;
      React.Children.forEach(node.props.children, visit);
    };
    visit(tree);
    assert.ok(button, `Button present: ${label}`);
    button.props.onClick();
    render();
  }
  function hasButton(label) {
    let found = false;
    const visit = node => {
      if (!React.isValidElement(node)) return;
      if (node.type === 'button' && node.props.children === label) found = true;
      React.Children.forEach(node.props.children, visit);
    };
    visit(tree);
    return found;
  }
  function hasNotice() {
    let found = false;
    const visit = node => {
      if (!React.isValidElement(node)) return;
      if (node.props['data-storage-notice'] === 'analytics') found = true;
      React.Children.forEach(node.props.children, visit);
    };
    visit(tree);
    return found;
  }
  return { render, click, hasButton, hasNotice };
}

for (const choice of ['analytics', 'decline']) test(`privacy prompt stays gone after ${choice}, reload and account changes`, () => {
  const prior = global.window;
  const events = new EventTarget();
  global.window = { localStorage: storage(), sessionStorage: storage(), location: { origin: 'https://example.test' },
    addEventListener: (...args) => events.addEventListener(...args), removeEventListener: (...args) => events.removeEventListener(...args) };
  let consent = 'pending';
  const calls = [];
  const posthog = { get_explicit_consent_status: () => consent,
    opt_in_capturing: () => { consent = 'granted'; }, opt_out_capturing: () => { consent = 'denied'; calls.push('out'); },
    set_config() {}, stopSessionRecording() {}, startSessionRecording() {}, identify() {}, reset() {}, capture() {} };
  try {
    let ui = manager(window, posthog);
    ui.render();
    assert.equal(ui.hasNotice(), true);
    ui.click(`privacy.${choice}`);
    assert.equal(ui.hasNotice(), false);
    assert.equal(ui.hasButton('privacy.choices'), false);
    assert.equal(JSON.parse(window.localStorage.getItem(ANALYTICS_PREFERENCE_KEY)).analytics, choice === 'analytics');

    ui = manager(window, posthog);
    for (const account of [null, 'synthetic-account', null]) {
      ui.render(account);
      assert.equal(ui.hasNotice(), false);
      assert.equal(ui.hasButton('privacy.choices'), false);
    }

    Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } });
    ui = manager(window, posthog);
    ui.render();
    assert.equal(ui.hasNotice(), false);
    assert.equal(ui.hasButton('privacy.choices'), false);
    if (choice === 'decline') assert.ok(calls.length >= 1);
  } finally { global.window = prior; }
});
