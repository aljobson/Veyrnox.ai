import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Card, Text } from '../ui';
import { videoShapeLabel } from '../VideoShapeBadge';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { matchingOption, requestedMismatch, requestedShape, type ShapeItem } from '../../lib/videoShape';
import { createMeasuredVideoCache, measureFinishedVideo } from '../../lib/videoShapeQueries';
import type { ApiClient } from '../../lib/api';
import { t } from '../../lib/i18n';

const ShapeSession = createContext<{ completedJobKey: string; measured: (id: string) => void }>({ completedJobKey: '', measured: () => {} });
export function SmartCutShapeSession({ children }: { children: ReactNode }) {
    const [completedJobKey, measured] = useState('');
    return <ShapeSession.Provider value={{ completedJobKey, measured }}>{children}</ShapeSession.Provider>;
}
type HintProps = { api: ApiClient; video: boolean; options: readonly string[]; value: string | null; onChange: (value: string) => void };
export function SmartCutShapeHint(props: HintProps) {
    const { completedJobKey } = useContext(ShapeSession);
    return <ShapeHint {...props} completedJobKey={completedJobKey} />;
}
function ShapeHint({ api, video, options, value, onChange, completedJobKey }: HintProps & { completedJobKey: string }) {
    const owner = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);
    const [cachedVideo] = useState(createMeasuredVideoCache);
    const [snapshot, setSnapshot] = useState<{ owner: string | undefined; item: ShapeItem | null } | null>(null);
    const previous = snapshot?.owner === owner ? snapshot?.item : null;
    const enabled = video && options.length > 0;
    useEffect(() => {
        let live = true;
        if (owner && enabled) cachedVideo((path, opts) => api.request(path, opts), owner, completedJobKey, () => getCacheUser() === owner).then(item => { if (live) setSnapshot({ owner, item }); }).catch(() => {});
        return () => { live = false; };
    }, [api, owner, enabled, completedJobKey, cachedVideo]);
    if (!enabled || !previous || !requestedMismatch(previous, value)) return null;
    const match = matchingOption(previous, options), label = videoShapeLabel(previous, true) ?? '';
    return <Card>
        <Text>{t('videoShape.hint', { previous: label, chosen: videoShapeLabel({ aspect: requestedShape(value) }) ?? '' })}</Text>
        {match ? <Button variant="secondary" label={t('videoShape.match', { shape: label })} onPress={() => onChange(match)} /> : <Text>{t('videoShape.unsupported', { shape: label })}</Text>}
    </Card>;
}
export function FinishedShapeWarning({ api, id, requested }: { api: ApiClient; id: string; requested: string | null }) {
    const owner = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);
    const { measured } = useContext(ShapeSession);
    const [actual, setActual] = useState<ShapeItem | null>(null);
    useEffect(() => {
        let live = true;
        setActual(null);
        if (owner) measureFinishedVideo((path, opts) => api.request(path, opts), id).then(item => { if (live) { setActual(item); if (item) measured(id); } }).catch(() => {});
        return () => { live = false; };
    }, [api, owner, id, measured]);
    return actual && requestedMismatch(actual, requested) ? <Text>{t('videoShape.warning', { requested: requested ?? '', actual: videoShapeLabel(actual, true) ?? '' })}</Text> : null;
}
