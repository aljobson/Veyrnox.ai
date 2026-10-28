import { createElement, act } from 'react';
import { createRoot } from 'test-renderer';
import { NETWORK_LOGOS, networkName } from '../src/lib/networkLogos';
import { NetworkLogo } from '../src/components/publish/NetworkLogo';
declare const __dirname: string;
const fs = require('fs'), path = require('path');

test('network assets match the web paths and have 96 by 96 PNG headers', () => {
    const web = fs.readFileSync(path.join(__dirname, '../../../app/veyrnox/app/publish/NetworkLogo.js'), 'utf8');
    const paths = JSON.parse(web.match(/const paths = (\{[\s\S]*?\n\});/)[1]);
    expect(Object.keys(NETWORK_LOGOS).sort()).toEqual(Object.keys(paths).sort());
    for (const key of Object.keys(paths)) {
        const data = fs.readFileSync(path.join(__dirname, `../assets/networks/${key}.png`));
        expect(data.subarray(1, 4).toString()).toBe('PNG');
        expect(data.subarray(12, 16).toString()).toBe('IHDR');
        expect(data.readUInt32BE(16)).toBe(96); expect(data.readUInt32BE(20)).toBe(96);
    }
    expect(networkName('twitch')).toBe('Twitch'); expect(networkName('twitter')).toBe('X');
});
test('unknown networks have no decorative image, including prototype keys', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot();
    for (const network of ['unknown', 'toString', '__proto__']) {
        await act(async () => root.render(createElement(NetworkLogo, { network })));
        expect(root.container.children).toEqual([]);
    }
    await act(async () => root.unmount());
});
