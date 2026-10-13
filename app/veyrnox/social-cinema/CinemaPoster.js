import Image from 'next/image';
import Link from 'next/link';
import { cinemaPosterFor } from './cinemaPosters';

export function CinemaPoster({ id, title, href, eager = false, sizes = '(min-width: 1024px) 30vw, (min-width: 640px) 50vw, 100vw', className = '' }) {
  const src = cinemaPosterFor(id);
  if (!src) return null;

  const image = <Image
    src={src}
    width={1280}
    height={720}
    sizes={sizes}
    loading={eager ? 'eager' : 'lazy'}
    alt={`${title} poster frame`}
    className="h-full w-full object-cover"
  />;

  return href
    ? <Link href={href} aria-label={`Open ${title}`} className={`block aspect-video overflow-hidden bg-vx-panel ${className}`}>{image}</Link>
    : <div className={`aspect-video overflow-hidden rounded-2xl border border-vx-border bg-vx-panel ${className}`}>{image}</div>;
}
