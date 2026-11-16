import test from 'node:test';
import assert from 'node:assert/strict';
import { appRuntimeFlag } from '../lib/appRuntime.js';
import { checkinEnabled } from '../lib/checkin.js';
import { pushEnabled, musicPushEnabled } from '../lib/pushNotifications.js';

test('a key is on only when it is exactly true; a missing or broken binding is off', () => {
    assert.equal(appRuntimeFlag('push', { APP_RUNTIME_FLAGS: '{"push":true}' }), true);
    for (const value of [undefined, '', 'nope', '[]', '{"push":"true"}', '{"push":1}', '{"push":false}', 'null']) {
        assert.equal(appRuntimeFlag('push', { APP_RUNTIME_FLAGS: value }), false, String(value));
    }
});

test('check-in and push read the grouped binding as well as their legacy vars', () => {
    assert.equal(checkinEnabled({ APP_RUNTIME_FLAGS: '{"checkin":true}' }), true);
    assert.equal(checkinEnabled({ CHECKIN_ENABLED: 'true' }), true);
    assert.equal(checkinEnabled({ APP_RUNTIME_FLAGS: '{"push":true}' }), false);
    assert.equal(pushEnabled({ APP_RUNTIME_FLAGS: '{"push":true}' }), true);
    assert.equal(pushEnabled({ PUSH_NOTIFICATIONS_ENABLED: 'true' }), true);
    assert.equal(pushEnabled({ APP_RUNTIME_FLAGS: '{"checkin":true}' }), false);
    assert.equal(musicPushEnabled({ APP_RUNTIME_FLAGS: '{"push":true}', MUSIC_RUNTIME_FLAGS: '{"notifications":true}' }), true);
});
