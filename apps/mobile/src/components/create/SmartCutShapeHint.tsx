import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Card, Text } from '../ui';
import { videoShapeLabel } from '../VideoShapeBadge';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { matchingOption, requestedMismatch, requestedShape, type ShapeItem } from '../../lib/videoShape';
import { newestMeasuredVideo, measureFinishedVideo } from '../../lib/videoShapeQueries';
import type { ApiClient } from '../../lib/api';
import { t } from '../../lib/i18n';

export function SmartCutShapeHint({ api, video, options, value, onChange }: { api: ApiClient; video: boolean; options: readonly string[]; value: string | null; onChange: (value: string) => void }) {
    const owner = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);
    const [snapshot, setSnapshot] = useState<{ owner: string | undefined; item: ShapeItem | null } | null>(null);
    const previous = snapshot?.owner === owner ? snapshot?.item : null;
    const enabled = video && options.length > 0;
    useEffect(() => {
        let live = true;
        if (owner && enabled) newestMeasuredVideo((path, opts) => api.request(path, opts), () => live).then(item => { if (live) setSnapshot({ owner, item }); }).catch(() => {});
        return () => { live = false; };
    }, [api, owner, enabled]);
    if (!enabled || !previous || !requestedMismatch(previous, value)) return null;
    const match = matchingOption(previous, options), label = videoShapeLabel(previous) ?? '';
    return <Card>
        <Text>{t('videoShape.hint', { previous: label, chosen: videoShapeLabel({ aspect: requestedShape(value) }) ?? '' })}</Text>
        {match ? <Button variant="secondary" label={t('videoShape.match', { shape: label })} onPress={() => onChange(match)} /> : <Text>{t('videoShape.unsupported', { shape: label })}</Text>}
    </Card>;
}
export function FinishedShapeWarning({ api, id, requested }: { api: ApiClient; id: string; requested: string | null }) {
    const owner = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);
    const [actual, setActual] = useState<ShapeItem | null>(null);
    useEffect(() => {
        let live = true;
        setActual(null);
        if (owner && requestedShape(requested)) measureFinishedVideo((path, opts) => api.request(path, opts), id).then(item => { if (live) setActual(item); }).catch(() => {});
        return () => { live = false; };
    }, [api, owner, id, requested]);
    return actual && requestedMismatch(actual, requested) ? <Text>{t('videoShape.warning', { requested: requested ?? '', actual: videoShapeLabel(actual) ?? '' })}</Text> : null;
}
