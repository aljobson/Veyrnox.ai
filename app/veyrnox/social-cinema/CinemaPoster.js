'use client';

import Image from 'next/image';
import { useI18n } from '../../../components/I18nProvider';
import Link from 'next/link';
import { useState } from 'react';
import { cinemaPosterFor } from './cinemaPosters';

const externalPoster = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'i.ytimg.com' ? url.toString() : '';
  } catch { return ''; }
};

export function CinemaPoster({ id, title, href, src: requestedSrc = '', eager = false, sizes = '(min-width: 1024px) 30vw, (min-width: 640px) 50vw, 100vw', className = '' }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState('');
  const external = externalPoster(requestedSrc);
  const curated = cinemaPosterFor(id);
  const automatic = `/api/cinema/posters/${encodeURIComponent(id)}`;
  const src = external && failed !== external ? external : curated && failed !== curated ? curated : automatic;
  if (failed === automatic) return null;

  const image = <Image
    src={src}
    width={1280}
    height={720}
    sizes={sizes}
    loading={eager ? 'eager' : 'lazy'}
    alt={t('cinema.poster', { title })}
    className="h-full w-full object-cover"
    unoptimized={src === automatic || src === external}
    onError={() => setFailed(src)}
  />;

  return href
    ? <Link href={href} aria-label={t('home.cards.open', { title })} className={`block aspect-video overflow-hidden bg-vx-panel ${className}`}>{image}</Link>
    : <div className={`aspect-video overflow-hidden rounded-2xl border border-vx-border bg-vx-panel ${className}`}>{image}</div>;
}
