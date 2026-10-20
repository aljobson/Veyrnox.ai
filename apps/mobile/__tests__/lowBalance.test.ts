
import { shortfall } from '../src/lib/lowBalance';

describe('credits still missing for a shown price', () => {
    test('the gap when the balance is short, 0 when it is enough', () => {
        expect(shortfall(5, 12)).toBe(7);
        expect(shortfall(12, 12)).toBe(0);
        expect(shortfall(20, 12)).toBe(0);
    });
    test('an unknown or odd balance never blocks anything', () => {
        expect(shortfall(null, 12)).toBe(0);
        expect(shortfall(undefined, 12)).toBe(0);
        expect(shortfall(Number.NaN, 12)).toBe(0);
        expect(shortfall(5, Number.NaN)).toBe(0);
    });
    test('a free batch (price 0) is never short', () => expect(shortfall(0, 0)).toBe(0));
    test('rounds up a fractional gap', () => expect(shortfall(1, 2.5)).toBe(2));
});
