import { emptyStyleForm, formFromStyle, styleFromForm, textStyleProblem, TEXT_DEFAULTS, type TextStyle } from '../src/lib/brandKitStyles';
const base = (): TextStyle => ({ name: 'Headline', size: 6, style: { ...TEXT_DEFAULTS } });
test('a style from the default form passes the server rules', () => {
    const result = styleFromForm({ ...emptyStyleForm(), name: 'Headline' });
    expect(result).toEqual({ style: base() });
    expect('style' in result && textStyleProblem(result.style)).toBeNull();
});
test.each([
    ...['', ' ', 'x'.repeat(81), 'a\nb'].map(name => ({ ...base(), name })),
    ...[1, 41, 6.5].map(size => ({ ...base(), size })),
    { ...base(), style: { ...TEXT_DEFAULTS, color: undefined } },
    ...[{ unknown: 1 }, { color: '#fff' }, { backgroundOpacity: 1.1 }, { strokeWidth: 13 }, { weight: 'heavy' }, { align: 'justify' }, { font: 'Comic Sans' }, { font: `VXFont_${'a'.repeat(64)}` }, { italic: 'yes' }, { lineHeight: 3.1 }, { shadowX: -51 }].map(style => ({ ...base(), style: { ...TEXT_DEFAULTS, ...style } })),
    { ...base(), style: Object.fromEntries(Object.entries(TEXT_DEFAULTS).filter(([k]) => k !== 'color')) },
    { ...base(), extra: true }, null,
])('the server text-style rules (%#)', value => expect(textStyleProblem(value)).not.toBeNull());
test('editing a web style keeps its shadow and spacing', () => {
    const original = { ...base(), style: { ...TEXT_DEFAULTS, shadowColor: '#123456', shadowOpacity: .5, shadowBlur: 13, shadowX: -2, shadowY: 8, letterSpacing: 4, lineHeight: 1.8 } };
    const result = styleFromForm({ ...formFromStyle(original), name: 'New', color: 'ABC', backgroundOpacity: '25' }, original);
    expect(result).toEqual({ style: { ...original, name: 'New', style: { ...original.style, color: '#aabbcc', backgroundOpacity: .25 } } });
    expect(original.name).toBe('Headline');
});
test('italic and underline are only written when on or already present', () => {
    const form = { ...emptyStyleForm(), name: 'Title' };
    expect(styleFromForm(form)).toEqual({ style: { ...base(), name: 'Title' } });
    expect(styleFromForm({ ...form, italic: true, underline: true })).toMatchObject({ style: { style: { italic: true, underline: true } } });
    expect(styleFromForm(form, { ...base(), style: { ...TEXT_DEFAULTS, italic: true, underline: false } })).toMatchObject({ style: { style: { italic: false, underline: false } } });
});
test.each([['name', '', 'name'], ['size', '6.5', 'size'], ['color', 'no', 'colour'], ['backgroundOpacity', '101', 'opacity'], ['strokeWidth', '-1', 'stroke']] as const)('form rejects %s', (field, value, error) => {
    expect(styleFromForm({ ...emptyStyleForm(), name: 'Title', [field]: value })).toEqual({ errorKey: `brand.style.err.${error}` });
});
test('an unchanged fractional opacity round-trips without losing web precision', () => {
    const original = { ...base(), style: { ...TEXT_DEFAULTS, backgroundOpacity: 0.295 } };
    const form = formFromStyle(original);
    expect(form.backgroundOpacity).toBe('29.5');
    expect(styleFromForm(form, original)).toEqual({ style: original });
    expect(styleFromForm({ ...form, backgroundOpacity: '33.33' }, original)).toMatchObject({ style: { style: { backgroundOpacity: .33 } } });
});
