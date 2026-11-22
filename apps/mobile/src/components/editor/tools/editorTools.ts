import { t } from '../../../lib/i18n';
export type Tool = 'media' | 'audio' | 'generate' | 'text' | 'captions' | 'transcript' | 'scenes' | 'effects' | 'transitions' | 'filters' | 'animation' | 'motion' | 'mask' | 'markers' | 'brand' | 'adjust';
export const tools: readonly { id: Tool; icon: string; label: string }[] = [
    { id: 'media', icon: '▣', label: t('editor.media2') },
    { id: 'audio', icon: '♫', label: t('editor.audio') },
    { id: 'generate', icon: '✦', label: t('editor.generate') },
    { id: 'text', icon: 'T', label: t('editor.text2') },
    { id: 'captions', icon: 'CC', label: t('editor.captions') },
    { id: 'transcript', icon: '≡', label: t('editor.transcript') },
    { id: 'scenes', icon: '⌇', label: t('editor.scenes') },
    { id: 'effects', icon: '✺', label: t('editor.effects') },
    { id: 'transitions', icon: '⇄', label: t('editor.transitions') },
    { id: 'filters', icon: '☼', label: t('editor.filters') },
    { id: 'animation', icon: '↝', label: t('editor.animation') },
    { id: 'motion', icon: '↗', label: t('editorMotion.motion') },
    { id: 'mask', icon: '◯', label: t('editorMotion.mask') },
    { id: 'markers', icon: '', label: t('editorCore.markersTool') },
    { id: 'brand', icon: '◆', label: t('editor.brandkit') },
    { id: 'adjust', icon: '☷', label: t('editor.adjust2') },
];
