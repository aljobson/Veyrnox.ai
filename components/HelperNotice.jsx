'use client';
import { useI18n } from './I18nProvider.jsx';
import { helperCopy } from '../lib/i18n/helperCopy.mjs';

/** Shared editor alert: local diagnostic codes are resolved only during rendering. */
export function HelperNotice({ message, className }) {
  const { t, locale } = useI18n();
  return message ? <p role="alert" className={className}>{helperCopy(t, locale, message)}</p> : null;
}
