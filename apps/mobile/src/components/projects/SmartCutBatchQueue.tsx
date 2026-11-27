import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { useRouter } from 'expo-router';
import { Text } from '../ui/Text';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { touchTarget } from '../../lib/a11y';
import type { Project } from '../../lib/projects';
import { cancelSmartCutBatchItem, createSmartCutBatch, failSmartCutBatchItem, finishSmartCutBatchItem, nextSmartCutBatchItem, openSmartCutBatchItem, readSmartCutBatch, removeSmartCutBatch, retrySmartCutBatchItem, smartCutBatchDone, writeSmartCutBatch, type SmartCutBatch } from '../../lib/smartCutBatchQueue';
import { colors, text } from '../../theme';
import { t } from '../../lib/i18n';

export function SmartCutBatchQueue({ workspaceId, projects, router }: { readonly workspaceId: string; readonly projects: readonly Project[]; readonly router: ReturnType<typeof useRouter> }) {
    const [owner, setOwner] = useState(getCacheUser());
    const [selected, setSelected] = useState<string[]>([]);
    const [queue, setQueue] = useState<SmartCutBatch | null>(null);
    const [storageProblem, setStorageProblem] = useState<string | null>(null);
    useEffect(() => subscribeCacheUser(() => { setOwner(getCacheUser()); setSelected([]); setQueue(null); setStorageProblem(null); }), []);
    useEffect(() => { let live = true; if (owner) void readSmartCutBatch(owner, workspaceId).then((value) => { if (live) setQueue(value); }); return () => { live = false; }; }, [owner, workspaceId]);
    const save = async (next: SmartCutBatch) => {
        if (!await writeSmartCutBatch(next)) { setStorageProblem(t('projects.smartCutBatch.saveFailed')); return false; }
        setQueue(next); setStorageProblem(null); return true;
    };
    const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length >= 10 ? current : [...current, id]);
    const start = async () => { if (!owner) return; const next = createSmartCutBatch(owner, workspaceId, projects.filter((project) => selected.includes(project.id)), Crypto.randomUUID()); if (next && await save(next)) setSelected([]); };
    const open = async (projectId: string) => { if (!queue) return; const next = openSmartCutBatchItem(queue, projectId); if (await save(next) && next.items.find((item) => item.projectId === projectId)?.state === 'active') router.push({ pathname: '/editor/[projectId]', params: { projectId, smartCutBatch: next.id } }); };
    const clear = async () => { if (!owner || !await removeSmartCutBatch(owner, workspaceId)) return setStorageProblem(t('projects.smartCutBatch.saveFailed')); setQueue(null); setSelected([]); setStorageProblem(null); };
    const action = (label: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} style={[styles.action, touchTarget, disabled && styles.off]} onPress={onPress}><Text style={styles.actionText}>{label}</Text></Pressable>;
    const next = queue ? nextSmartCutBatchItem(queue) : null;
    return <View testID="smart-cut-batch" style={styles.card}><View style={styles.titleRow}><View style={styles.copy}><Text style={styles.eyebrow}>{t('projects.smartCutBatch.eyebrow').toUpperCase()}</Text><Text accessibilityRole="header" style={styles.title}>{t('projects.smartCutBatch.title')}</Text><Text style={styles.help}>{t('projects.smartCutBatch.help')}</Text></View>{queue ? action(t(smartCutBatchDone(queue) ? 'projects.smartCutBatch.clear' : 'projects.smartCutBatch.discard'), () => void clear()) : null}</View>
        {storageProblem ? <Text accessibilityRole="alert" style={styles.problem}>{storageProblem}</Text> : null}
        {!queue ? <><View style={styles.chips}>{projects.map((project) => <Pressable key={project.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(project.id) }} style={[styles.chip, touchTarget, selected.includes(project.id) && styles.chipOn]} onPress={() => toggle(project.id)}><Text style={[styles.chipText, selected.includes(project.id) && styles.chipTextOn]}>{project.name}</Text></Pressable>)}</View>{action(t('projects.smartCutBatch.create', { count: selected.length }), () => void start(), selected.length < 2)}</>
            : <><Text accessibilityLiveRegion="polite" style={styles.help}>{t('projects.smartCutBatch.progress', { done: queue.items.filter((item) => item.state === 'completed').length, total: queue.items.length })}{next ? ` · ${t('projects.smartCutBatch.next', { name: next.name || t('projects.untitledproject') })}` : ''}</Text>{queue.items.map((item) => <View key={item.projectId} style={styles.row}><View style={styles.copy}><Text style={styles.name}>{item.name || t('projects.untitledproject')}</Text><Text style={styles.state}>{t(`projects.smartCutBatch.state.${item.state}`).toUpperCase()}</Text></View>
                {item.state === 'pending' ? <>{action(t('projects.smartCutBatch.open'), () => void open(item.projectId), queue.items.some((row) => row.state === 'active'))}{action(t('projects.smartCutBatch.cancel'), () => void save(cancelSmartCutBatchItem(queue, item.projectId)))}</> : null}
                {item.state === 'active' ? <>{action(t('projects.smartCutBatch.complete'), () => void save(finishSmartCutBatchItem(queue, item.projectId)))}{action(t('projects.smartCutBatch.fail'), () => void save(failSmartCutBatchItem(queue, item.projectId, 'retry_requested')))}</> : null}
                {item.state === 'failed' ? action(t('projects.smartCutBatch.retry'), () => void save(retrySmartCutBatchItem(queue, item.projectId))) : null}
            </View>)}</>}
    </View>;
}
const styles = StyleSheet.create({
    card: { gap: 10, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.surface, borderRadius: 16, padding: 14 },
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, copy: { flex: 1, gap: 3 }, eyebrow: { ...text.micro, color: colors.accent, letterSpacing: 1 }, title: { ...text.title3, color: colors.text }, help: { ...text.caption, color: colors.muted },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12 }, chipOn: { borderColor: colors.accent, backgroundColor: colors.accent }, chipText: { ...text.caption, color: colors.body }, chipTextOn: { color: colors.accentInk },
    problem: { ...text.caption, color: colors.danger }, row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 9 }, name: { ...text.bodyStrong, color: colors.text }, state: { ...text.micro, color: colors.muted }, action: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: colors.accent, borderRadius: 999, paddingHorizontal: 12 }, actionText: { ...text.caption, color: colors.accent }, off: { opacity: .4 },
});
