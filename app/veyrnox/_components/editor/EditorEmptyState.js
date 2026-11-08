'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { Button } from '../Button';
export function EditorEmptyState({ onAdd, disabled }) {
    const { t } = useI18n();
    return <section data-testid="editor-empty" className="rounded-2xl border border-dashed border-vx-border p-4 text-center">
        <p className="text-sm text-vx-fg-muted">{t('app.editor.simple.empty')}</p>
        <Button data-testid="editor-empty-add" className="mt-4 min-h-13" disabled={disabled} onClick={onAdd}>{t('app.editor.simple.addMedia')}</Button>
    </section>;
}
