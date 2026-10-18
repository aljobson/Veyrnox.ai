// node scripts/export-i18n-review.mjs [outDir]
// One review sheet per language for a native-speaker reader (ADR-0107): every
// key with the English source beside the translation, the policy-critical
// rows first, and empty Verdict / Corrected / Note columns to fill in.
// Default output is .gstack/i18n-review (gitignored); pass a directory to move it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '../lib/i18n/messages/en.mjs';
import { CATALOGS } from '../lib/i18n/translate.mjs';
import { LOCALES } from '../lib/i18n/locales.mjs';

const outDir = process.argv[2] || '.gstack/i18n-review';

// Rows that state policy, price or legal fact: a wrong word here is a wrong
// promise, so a reader should do these first.
const PRIORITY = [
  /^home\.faq\./, /^home\.publish\./, /^home\.ledger\./, /^home\.hero\.lead$/,
  /^pricing\.packs\./, /^pricing\.subs\./, /^pricing\.models\.(note|approx)$/, /^pricing\.free$/,
  /^footer\./, /^dev\.safety\./, /^dev\.oauth\./, /^mcp\.safe\./, /^about\./,
  /^guide\.credits\./, /^guide\.your-own-files\./, /^model\.note$/, /^model\.desc$/,
];
const tierOf = (key) => (PRIORITY.some((re) => re.test(key)) ? 1 : 2);

const csv = (cell) => `"${String(cell).replace(/"/g, '""')}"`;
const keys = Object.keys(en).sort((a, b) => tierOf(a) - tierOf(b) || a.localeCompare(b));

mkdirSync(outDir, { recursive: true });
const index = [];
for (const l of LOCALES.filter((x) => x.code !== 'en')) {
  const catalog = CATALOGS[l.code];
  const rows = [['Priority', 'Key', 'English', `${l.name} (${l.code})`, 'Verdict (ok / fix)', 'Corrected text', 'Note']];
  for (const key of keys) rows.push([tierOf(key), key, en[key], catalog[key], '', '', '']);
  // BOM so Excel and Numbers open the UTF-8 file in the right encoding.
  writeFileSync(join(outDir, `review-${l.code}.csv`), `﻿${rows.map((r) => r.map(csv).join(',')).join('\n')}\n`);
  index.push(`${l.code}\t${l.name}\t${keys.filter((k) => tierOf(k) === 1).length} priority rows of ${keys.length}`);
}
writeFileSync(join(outDir, 'README.txt'), `Veyrnox.ai translation review

One file per language: review-<code>.csv (open in Excel, Numbers or Google Sheets).
Columns: Priority, Key, English source, Translation, Verdict, Corrected text, Note.

How to review
1. Do Priority 1 rows first. They state policy, prices, refunds, data rights and
   limits, so a wrong word is a wrong promise. Then Priority 2.
2. Put "ok" or "fix" in Verdict. For "fix", write the replacement in Corrected text.
3. Keep as they are: Veyrnox.ai, Veyrnox, product names, "cr", numbers, {braces} placeholders.
4. A few words are deliberately English (on-screen labels such as Create, Generate,
   Library): the app itself is not translated yet.
5. Send the file back. Corrections go in as one change per language.

Files
${index.join('\n')}
`);
console.log(`wrote ${index.length} sheets to ${outDir}`);
