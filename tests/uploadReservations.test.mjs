import test from 'node:test';
import assert from 'node:assert/strict';
import { removeReservedUpload, sweepUploadReservations } from '../lib/uploadReservations.js';
const key = 'uploads/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png';
test('failed deletion retains the reservation', async () => {
    const result = await removeReservedUpload(key, {}, {}, {
        remove: async () => ({ ok: false }), release: () => assert.fail('released live bytes'),
    });
    assert.equal(result.ok, false);
});
test('confirmed deletion releases once; failed release remains a failure', async () => {
    let released = 0;
    const result = await removeReservedUpload(key, {}, {}, {
        remove: async () => ({ ok: true }), release: async (name, args) => {
            assert.equal(name, 'release_upload'); assert.equal(args.p_key, key); released++;
        },
    });
    assert.equal(result.ok, true); assert.equal(released, 1);
    assert.equal((await removeReservedUpload(key, {}, {}, {
        remove: async () => ({ ok: true }), release: async () => { throw Error('unavailable'); },
    })).ok, false);
});
test('abandoned unused URLs recover slots only via confirmed deletion', async () => {
    const result = await sweepUploadReservations({}, {}, {
        now: new Date('2026-09-24T18:00:00Z'),
        find: async (_table, options) => {
            assert.match(options.filter, /2026-09-23T18%3A00%3A00/);
            assert.equal(options.limit, 50); return [{ r2_key: key }];
        },
        remove: async (k) => { assert.equal(k, key); return { ok: true }; },
    });
    assert.deepEqual(result, { ok: true, deleted: 1, failed: 0 });
});
