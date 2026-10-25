'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { mediaIdentity, moveMedia } from '../../../../lib/social/carouselSelection.js';

export default function CarouselSelection({ items, onChange, max, disabled }) {
    const { t } = useI18n();
    return <section aria-label={t('app.publish.composer.selectedPreview')} className="space-y-2">
        {max > 1 && <p className="text-sm">{t('app.publish.carousel.limit', { count: items.length, max })}</p>}
        <ol className="flex flex-wrap gap-3">{items.map((item, index) => <li key={mediaIdentity(item)} className="space-y-1 rounded-lg border border-vx-border p-2">
            <p className="text-sm">{t('app.publish.carousel.item', { count: index + 1 })}</p>
            {item.thumbUrl && (item.mediaType === 'video'
                ? <video src={item.thumbUrl} controls playsInline preload="metadata" className="h-24 w-32 object-contain" />
                : <img src={item.thumbUrl} alt="" className="h-24 w-32 object-contain" />)}
            <div className="flex gap-2 text-sm">
                <button type="button" disabled={disabled || index === 0} onClick={() => onChange(moveMedia(items, index, -1))}>{t('app.publish.carousel.earlier')}</button>
                <button type="button" disabled={disabled || index === items.length - 1} onClick={() => onChange(moveMedia(items, index, 1))}>{t('app.publish.carousel.later')}</button>
                <button type="button" disabled={disabled} onClick={() => onChange(items.filter((_, i) => i !== index))}>{t('app.publish.common.remove')}</button>
            </div>
        </li>)}</ol>
    </section>;
}
