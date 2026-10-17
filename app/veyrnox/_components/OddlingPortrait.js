import Image from 'next/image';
import { gallerySource } from '../_lib/oddlingStudio';

export function CharacterPortrait({ oddling, className = '', sizes = '(max-width: 640px) 100vw, 350px' }) {
  const source = gallerySource(oddling);
  return source ? <Image src={source.image} alt={`${oddling.name} individual portrait`} width={1024} height={1536} sizes={sizes} className={`h-full w-full object-contain ${className}`} /> : null;
}
