// Synthetic word-shaped Scribe fixtures, not claims about live provider accuracy.
export const assetId = '33333333-3333-4333-8333-333333333333';
const vocabulary = [
    ['en', 'eng', 'I would like some tea', 'I would like some coffee', 'Today we walked around town'],
    ['es', 'spa', 'Yo quiero tomar un té', 'Yo quiero tomar un café', 'Hoy paseamos por la ciudad'],
    ['zh', 'zho', '我今天想喝', '我今天想喝咖啡', '外面的天空非常蓝'],
    ['hi', 'hin', 'मैं आज एक चाय चाहता', 'मैं आज एक कॉफी चाहता', 'हम कल शहर घूमने गए'],
    ['ar', 'ara', 'أنا أريد أن أشرب الشاي', 'أنا أريد أن أشرب القهوة', 'ذهبنا أمس إلى وسط المدينة'],
    ['fr', 'fra', 'Je voudrais boire du thé', 'Je voudrais boire du café', 'Nous marchons ensemble en ville'],
    ['pt', 'por', 'Eu quero tomar um chá', 'Eu quero tomar um café', 'Hoje passeamos juntos pela cidade'],
    ['ru', 'rus', 'Я хотел бы выпить чай', 'Я хотел бы выпить кофе', 'Сегодня мы гуляли по городу'],
    ['ja', 'jpn', '今日はお茶を飲みたい', '今日はお茶を飲みたいです', '空には白い雲が浮かぶ'],
    ['de', 'deu', 'Ich möchte heute einen Tee', 'Ich möchte heute einen Kaffee', 'Heute gehen wir zusammen spazieren'],
    ['ko', 'kor', '나는 오늘 따뜻한 차를 마시고 싶다', '나는 오늘 따뜻한 커피를 마시고 싶다', '우리는 어제 함께 공원에서 오래 걸었다'],
];
export function words(text, start, language = 'en') {
    const parts = ['zh', 'ja'].includes(language) ? Array.from(text) : text.split(' ');
    return parts.map((text, i) => ({ type: 'word', text, start: start + i * .2, end: start + i * .2 + .15 }));
}
export const fixtures = vocabulary.map(([language, iso3, first, last, control]) => {
    const make = (a, b) => ({ language_code: iso3, text: `${a} ${b}`, words: [...words(a, 1, language), ...words(b, 5, language)] });
    return { language, duration: 12, restart: make(first, last), control: make(first, control),
        repetition: make(language === 'en' ? 'had had' : first.split(' ').slice(0, 2).join(' '), control) };
});
export const silence = { language_code: 'eng', text: '', words: [] };
export const stretched = { language_code: 'eng', text: 'held word', words: [
    { type: 'word', text: 'held', start: .2, end: 5 }, { type: 'word', text: 'word', start: 5.1, end: 5.8 },
] };
