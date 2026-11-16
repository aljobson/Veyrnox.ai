'use client';

import { useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../_lib/gateway';
import { coverJobId } from '../_lib/projectCover.mjs';

// Signed links last at most 15 minutes, so the cache keeps them for 10.
const LINK_TTL_MS = 10 * 60_000;
const links = new Map();

function linkFor(jobId) {
  const hit = links.get(jobId);
  if (hit && Date.now() - hit.at < LINK_TTL_MS) return hit.promise;
  const promise = gatewayFetch(`/jobs/${encodeURIComponent(jobId)}/asset`)
    .then((a) => ({ url: a.url, mime: a.mime_type || '' }))
    .catch((e) => { links.delete(jobId); return { held: e?.code === 'held', url: null, mime: '' }; });
  links.set(jobId, { at: Date.now(), promise });
  return promise;
}

const covers = new Map();
function coverFor(projectId) {
  const hit = covers.get(projectId);
  if (hit && Date.now() - hit.at < LINK_TTL_MS) return hit.promise;
  const promise = gatewayFetch(`/projects/${encodeURIComponent(projectId)}/document`)
    .then((head) => coverJobId(head?.document))
    .catch(() => { covers.delete(projectId); return null; });
  covers.set(projectId, { at: Date.now(), promise });
  return promise;
}

function useNearViewport(ref) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || near) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return undefined; }
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setNear(true); }, { rootMargin: '300px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, near]);
  return near;
}

const GLYPH = { audio: '♫', video: '▶', image: '▧' };

// The picture of one creation: the image, the first frame of a video, or a note for audio.
// It resolves its link only when it is about to be seen, so a long list does not fetch every file.
export function JobThumb({ jobId, label = '', size = 56, className = '' }) {
  const ref = useRef(null);
  const near = useNearViewport(ref);
  const [file, setFile] = useState(null);
  useEffect(() => {
    if (!near || !jobId) return undefined;
    let live = true;
    linkFor(jobId).then((result) => { if (live) setFile(result); });
    return () => { live = false; };
  }, [near, jobId]);
  const mime = file?.mime || '';
  const box = { width: size, height: size };
  return (
    <span ref={ref} data-testid="job-thumb" style={box} className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-vx-panel text-vx-fg-muted ${className}`}>
      {file?.url && mime.startsWith('image/') && <img src={file.url} alt={label} width={size} height={size} loading="lazy" decoding="async" className="h-full w-full object-cover" />}
      {file?.url && mime.startsWith('video/') && <video src={`${file.url}#t=0.1`} aria-label={label} muted playsInline preload="metadata" tabIndex={-1} className="h-full w-full object-cover" />}
      {file?.url && mime.startsWith('audio/') && <span aria-hidden="true" className="text-xl">{GLYPH.audio}</span>}
      {!file?.url && <span aria-hidden="true" className="text-xl">{file ? GLYPH.image : ''}</span>}
      {file?.url && mime.startsWith('video/') && <span aria-hidden="true" className="absolute bottom-1 end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-black/55 text-[8px] text-white">{GLYPH.video}</span>}
    </span>
  );
}

// A saved editor project stands for itself with the first picture or clip on its timeline.
export function ProjectThumb({ projectId, label = '', size = 56, className = '' }) {
  const ref = useRef(null);
  const near = useNearViewport(ref);
  const [jobId, setJobId] = useState(null);
  useEffect(() => {
    if (!near || !projectId) return undefined;
    let live = true;
    coverFor(projectId).then((id) => { if (live) setJobId(id); });
    return () => { live = false; };
  }, [near, projectId]);
  return (
    <span ref={ref} className="inline-flex shrink-0">
      {jobId ? <JobThumb jobId={jobId} label={label} size={size} className={className} />
        : <span aria-hidden="true" style={{ width: size, height: size }} className={`inline-flex items-center justify-center rounded-lg bg-vx-panel text-xl text-vx-fg-muted before:content-['▤'] ${className}`} />}
    </span>
  );
}
