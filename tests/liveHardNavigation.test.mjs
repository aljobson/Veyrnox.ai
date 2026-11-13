import test from 'node:test';
import assert from 'node:assert/strict';
import { inPhotoStudio, leavesPhotoStudio, installHardNavigation, reloadIfLeft } from '../app/veyrnox/_lib/liveEdit/hardNavigation.js';

test('only paths outside Photo Studio count as leaving it', () => {
    for (const path of ['/app/photo-studio', '/app/photo-studio/', '/app/photo-studio/x', '/veyrnox/app/photo-studio']) assert.equal(inPhotoStudio(path), true, path);
    for (const path of ['/', '/app', '/app/photo-studio-other', '/app/editor', '/pricing']) assert.equal(inPhotoStudio(path), false, path);
    const here = 'https://veyrnox.ai/app/photo-studio';
    assert.equal(leavesPhotoStudio('/app', here), true); assert.equal(leavesPhotoStudio('https://veyrnox.ai/pricing?x=1', here), true);
    assert.equal(leavesPhotoStudio('/app/photo-studio?tab=1', here), false); assert.equal(leavesPhotoStudio('https://example.com/', here), false); // other origins are already full navigations
    assert.equal(leavesPhotoStudio('http://[', here), false);
});

function rig(pathname = '/app/photo-studio') {
    const calls = { assign: [], reload: 0 }, doc = new EventTarget(), win = new EventTarget();
    win.location = { href: `https://veyrnox.ai${pathname}`, pathname, assign: url => calls.assign.push(url), reload: () => { calls.reload++; } };
    const dispose = installHardNavigation({ doc, win });
    const click = (href, init = {}) => {
        const event = new Event('click', { cancelable: true });
        // Event.target is a read-only getter; define what the handler reads.
        Object.defineProperties(event, {
            target: { value: { closest: () => href === null ? null : { href, target: init.target ?? '', hasAttribute: name => name === 'download' && Boolean(init.download) } } },
            button: { value: init.button ?? 0 }, metaKey: { value: Boolean(init.metaKey) }, ctrlKey: { value: Boolean(init.ctrlKey) }, shiftKey: { value: Boolean(init.shiftKey) }, altKey: { value: Boolean(init.altKey) },
            stopImmediatePropagation: { value: () => { event.stopped = true; } },
        });
        event.stopped = false;
        doc.dispatchEvent(event); return event;
    };
    return { calls, win, doc, dispose, click };
}

test('a link out of Photo Studio becomes a full navigation instead of a soft one', () => {
    const r = rig(), event = r.click('https://veyrnox.ai/app');
    assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true); assert.deepEqual(r.calls.assign, ['https://veyrnox.ai/app']);
});

test('links that stay inside, open elsewhere, download, or use a modifier or non-primary button are left alone', () => {
    const r = rig();
    for (const [href, init] of [['https://veyrnox.ai/app/photo-studio?x=1', {}], ['https://example.com/', {}], ['https://veyrnox.ai/app', { target: '_blank' }], ['https://veyrnox.ai/app', { download: true }],
        ['https://veyrnox.ai/app', { metaKey: true }], ['https://veyrnox.ai/app', { ctrlKey: true }], ['https://veyrnox.ai/app', { shiftKey: true }], ['https://veyrnox.ai/app', { button: 1 }], [null, {}]]) {
        const event = r.click(href, init); assert.equal(event.defaultPrevented, false, JSON.stringify([href, init]));
    }
    assert.deepEqual(r.calls.assign, []);
});

test('back/forward to a page outside Photo Studio reloads the document; staying inside does not; the disposer removes both listeners', () => {
    const r = rig('/app/photo-studio');
    r.win.dispatchEvent(new Event('popstate')); assert.equal(r.calls.reload, 0);
    r.win.location.pathname = '/app'; r.win.dispatchEvent(new Event('popstate')); assert.equal(r.calls.reload, 1);
    r.dispose(); r.win.dispatchEvent(new Event('popstate')); r.click('https://veyrnox.ai/pricing');
    assert.equal(r.calls.reload, 1); assert.deepEqual(r.calls.assign, []);
});

test('an SVG anchor (non-string href) is ignored, and an unmount outside Photo Studio forces a real document load', () => {
    const r = rig();
    const event = new Event('click', { cancelable: true });
    Object.defineProperties(event, { target: { value: { closest: () => ({ href: { baseVal: '/app' }, target: '', hasAttribute: () => false }) } }, button: { value: 0 }, metaKey: { value: false }, ctrlKey: { value: false }, shiftKey: { value: false }, altKey: { value: false } });
    r.doc.dispatchEvent(event); assert.equal(event.defaultPrevented, false); assert.deepEqual(r.calls.assign, []);
    r.win.location.pathname = '/app/photo-studio/x'; reloadIfLeft(r.win); assert.equal(r.calls.reload, 0); // still inside: nothing
    r.win.location.pathname = '/pricing'; reloadIfLeft(r.win); assert.equal(r.calls.reload, 1); // router.push / redirect landed outside
});
