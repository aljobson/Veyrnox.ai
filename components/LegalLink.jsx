'use client';
import Link from 'next/link';
import { useI18n } from './I18nProvider';

// Shared by public and app surfaces; the provider applies URL/cookie preference.
// Binding statements keep their original English anchors outside this helper.
export default function LegalLink({ element = 'Link', href, ...props }) {
  const { href: localize } = useI18n();
  return element === 'a' ? <a {...props} href={localize(href)} /> : <Link {...props} href={localize(href)} />;
}
