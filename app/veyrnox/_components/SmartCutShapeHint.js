'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { getSession } from '../../lib/authClient.js';
import { useI18n } from '../../../components/I18nProvider';
import { gatewayFetch } from '../_lib/gateway';
import { matchingOption, requestedMismatch, requestedShape } from '../../../lib/videoShape.mjs';
import { createMeasuredVideoCache, measureFinishedVideo } from '../../../lib/videoShapeQueries.mjs';
import { videoShapeLabel } from './VideoShapeBadge';
const request = (path, options) => gatewayFetch(path.replace('/api/v1', ''), options);

const ShapeSession = createContext(['', () => {}]);
export function SmartCutShapeSession({ children }) {
  const state = useState('');
  return <ShapeSession.Provider value={state}>{children}</ShapeSession.Provider>;
}
export function SmartCutShapeHint(props) {
  const [completedJobKey] = useContext(ShapeSession);
  return <ShapeHint {...props} completedJobKey={completedJobKey} />;
}
function ShapeHint({ completedJobKey, video, options = [], value, onChange, actor, jobs }) {
  const { t } = useI18n();
  const [cachedVideo] = useState(createMeasuredVideoCache);
  const [snapshot, setSnapshot] = useState(null);
  const previous = snapshot?.actor === actor ? snapshot.item : null;
  const enabled = video && options.length > 0 && !jobs;
  useEffect(() => {
    let live = true;
    const account = getSession()?.user?.id;
    if (enabled && account) cachedVideo(request, account, completedJobKey, () => getSession()?.user?.id === account).then(item => { if (live) setSnapshot({ actor, item }); }).catch(() => {});
    return () => { live = false; };
  }, [actor, enabled, completedJobKey, cachedVideo]);
  if (jobs) return <>{jobs.filter(job => job.state === 'succeeded' && job.mime_type?.startsWith('video/')).map(job => <FinishedShapeWarning key={`${actor}:${job.job_id}`} job={job} />)}</>;
  if (!enabled || !previous || !requestedMismatch(previous, value)) return null;
  const match = matchingOption(previous, options);
  const label = videoShapeLabel(previous, t, true);
  return <div role="status" className="mt-3 text-sm text-vx-fg-muted">
    <p>{t('app.library.shape.hint', { previous: label, chosen: videoShapeLabel({ aspect: requestedShape(value) }, t) })}</p>
    {match ? <button type="button" className="mt-2 min-h-11 rounded-full border border-vx-border px-4 text-vx-fg" onClick={() => onChange(match)}>{t('app.library.shape.match', { shape: label })}</button>
      : <p>{t('app.library.shape.unsupported', { shape: label })}</p>}
  </div>;
}
function FinishedShapeWarning({ job }) {
  const [, measured] = useContext(ShapeSession);
  const { t } = useI18n();
  const [actual, setActual] = useState(null);
  useEffect(() => {
    let live = true;
    measureFinishedVideo(request, job.job_id).then(item => { if (live) { setActual(item); if (item) measured(job.job_id); } }).catch(() => {});
    return () => { live = false; };
  }, [job.job_id, measured]);
  return actual && requestedMismatch(actual, job.aspect_ratio)
    ? <p role="status" className="mt-3 text-sm text-vx-fg-muted">{t('app.library.shape.warning', { requested: job.aspect_ratio, actual: videoShapeLabel(actual, t) })}</p> : null;
}
