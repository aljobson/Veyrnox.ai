import { redirect } from 'next/navigation';
import { getLocale } from '../../../lib/i18n/server';
import { localizedHref } from '../../../lib/i18n/locales.mjs';
export default async function MobileRoot() { redirect(localizedHref(await getLocale(), '/m/create')); }
