'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { cinemaPosterFor } from './cinemaPosters';

export function CinemaPoster({ id, title, href, eager = false, sizes = '(min-width: 1024px) 30vw, (min-width: 640px) 50vw, 100vw', className = '' }) {
  const [failed, setFailed] = useState('');
  const curated = cinemaPosterFor(id);
  const automatic = `/api/cinema/posters/${encodeURIComponent(id)}`;
  const src = curated && failed !== curated ? curated : automatic;
  if (failed === automatic) return null;

  const image = <Image
    src={src}
    width={1280}
    height={720}
    sizes={sizes}
    loading={eager ? 'eager' : 'lazy'}
    alt={`${title} poster frame`}
    className="h-full w-full object-cover"
    unoptimized={src === automatic}
    onError={() => setFailed(src)}
  />;

  return href
    ? <Link href={href} aria-label={`Open ${title}`} className={`block aspect-video overflow-hidden bg-vx-panel ${className}`}>{image}</Link>
    : <div className={`aspect-video overflow-hidden rounded-2xl border border-vx-border bg-vx-panel ${className}`}>{image}</div>;
}
