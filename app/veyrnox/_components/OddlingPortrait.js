'use client';
import { useI18n } from '../../../components/I18nProvider';

import Image from 'next/image';
import { gallerySource } from '../_lib/oddlingStudio';

export function CharacterPortrait({ oddling, className = '', sizes = '(max-width: 640px) 100vw, 350px' }) {
  const { t } = useI18n();
  const source = gallerySource(oddling);
  return source ? <Image src={source.image} alt={t('app.oddlings.portrait', { name: oddling.name })} width={1024} height={1536} sizes={sizes} className={`h-full w-full object-contain ${className}`} /> : null;
}
