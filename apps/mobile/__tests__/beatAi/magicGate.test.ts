import { MAGIC_BAR_ON_PHONE } from '../../src/lib/beatAi/magicGate';
test('the phone Magic Bar stays off while the web magicBar key has no API-visible state', () => { expect(MAGIC_BAR_ON_PHONE).toBe(false); });
