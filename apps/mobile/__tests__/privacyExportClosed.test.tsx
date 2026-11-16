import { act } from 'react';
import { Linking } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Screen from '../src/app/(app)/privacy-export';
import { copyText } from '../src/lib/clipboard';

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('../src/lib/clipboard', () => ({ copyText: jest.fn().mockResolvedValue(true) }));

let root: Root;
const has = (text: string) => root.container.queryAll(n => n.children.some(c => typeof c === 'string' && c.includes(text))).length > 0;
const email = () => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Email privacy@veyrnox.com');
async function press() { await act(async () => { email()[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); }); }
beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks();
    root = createRoot(); await act(async () => root.render(<Screen />));
});
afterEach(async () => { await act(async () => root.unmount()); });

test('says up front that the in-app copy is not open, with no file promises and no dead button', () => {
    expect(has('Getting your data in the app is not open yet. Email privacy@veyrnox.com and we will send it.')).toBe(true);
    expect(has('JSON')).toBe(false);
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Prepare my file')).toHaveLength(0);
    expect(email()).toHaveLength(1);
});

test('the email button opens a mail composer with a generic subject and no personal data', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await press();
    expect(open).toHaveBeenCalledWith('mailto:privacy@veyrnox.com?subject=Copy%20of%20my%20data');
    expect(copyText).not.toHaveBeenCalled();
});

test('with no mail app the address is copied and the screen says so', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no mail app'));
    await press();
    expect(copyText).toHaveBeenCalledWith('privacy@veyrnox.com');
    expect(has('Address copied.')).toBe(true);
});
