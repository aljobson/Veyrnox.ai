// The footer's "Last updated" date is the newest date printed on a legal
// page, so it moves when a legal document is revised and cannot drift from
// them. Each document keeps its own date in lib/i18n/legal/<name>.mjs.
import { updated as aup } from './i18n/legal/aup.mjs';
import { updated as cinemaContent } from './i18n/legal/cinema-content.mjs';
import { updated as gdpr } from './i18n/legal/gdpr.mjs';
import { updated as privacy } from './i18n/legal/privacy.mjs';
import { updated as refund } from './i18n/legal/refund.mjs';
import { updated as terms } from './i18n/legal/terms.mjs';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// "17 November 2026" -> "2026-11-17"
export function legalDateToIso(text) {
  const m = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(String(text).trim());
  const month = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
  if (month < 0) throw new Error(`Unreadable legal date: ${text}`);
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

export const LEGAL_DATES = { aup, cinemaContent, gdpr, privacy, refund, terms };

export const LEGAL_UPDATED = Object.values(LEGAL_DATES).map(legalDateToIso).sort().at(-1);
