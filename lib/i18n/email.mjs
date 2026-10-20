import en from './messages/email/en.mjs';
import es from './messages/email/es.mjs';
import zh from './messages/email/zh.mjs';
import hi from './messages/email/hi.mjs';
import ar from './messages/email/ar.mjs';
import fr from './messages/email/fr.mjs';
import pt from './messages/email/pt.mjs';
import ru from './messages/email/ru.mjs';
import ja from './messages/email/ja.mjs';
import de from './messages/email/de.mjs';
import ko from './messages/email/ko.mjs';

export const emailMessages = { en, es, zh, hi, ar, fr, pt, ru, ja, de, ko };
const AUP = 'https://veyrnox.ai/legal/aup';
const APPEALS = 'https://veyrnox.ai/app/account/appeals';
const day = iso => new Date(iso).toISOString().slice(0, 10);
function translator(locale) {
    const messages = Object.hasOwn(emailMessages, locale) ? emailMessages[locale] : en;
    return (key, values = {}) => (messages[key] || en[key]).replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
}

export function renderViolation({ tier, takedowns = 0, frozen = false, holdUntil = null }, locale = null) {
    const t = translator(locale);
    const sign = `${t('sign')}\n${APPEALS}\n\nVeyrnox.ai`;
    if (tier === 'warning') return {
        subject: t('warningSubject'), text: `${t('warningIntro')}\n${AUP}\n\n${t('warning')}\n\n${sign}`,
    };
    const remaining = Math.max(3 - takedowns, 0);
    const hold = holdUntil ? ` ${t('hold', { date: day(holdUntil) })}` : '';
    const consequence = frozen ? t('frozen') : `${t('removal', { takedowns, total: 3 })} ${t(remaining === 1 ? 'oneMore' : 'more', { remaining })}${hold}`;
    return { subject: t(frozen ? 'frozenSubject' : 'removedSubject'),
        text: `${t('removedIntro')}\n${AUP}\n\n${t('files')}\n\n${consequence}\n\n${sign}` };
}

export function renderAppeal({ decision, appealedAction = 'takedown', unfrozen = false, holdUntil = null }, locale = null) {
    const t = translator(locale);
    if (decision === 'upheld') {
        const what = appealedAction === 'warning' ? t('withdrawn')
            : t('uncounted') + (unfrozen ? ` ${t('unfrozen')}` : '')
                + ` ${holdUntil ? t('resume', { date: day(holdUntil) }) : t('open')} ${t('unrestorable')}`;
        return { subject: t('upheldSubject'), text: `${t('upheldIntro')} ${what}\n\n${t('sorry')}\n\nVeyrnox.ai` };
    }
    return { subject: t('rejectedSubject'), text: `${t('rejectedIntro')}\n${AUP}\n\n${t('final')}\n\nVeyrnox.ai` };
}

export function renderReportDefault({ from, to }, locale = null) {
    return translator(locale)('reportDefault', { from, to });
}
