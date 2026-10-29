import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '../../auth/AuthProvider';
import { isAccountChanged } from '../../auth/sessionTask';
import { ASSET_MAX, nextAssetKey, assetFromCatalog, assetProblem, attachAsset, editAssetRow, isAttachable, removeAssetRow, type AssetRow, type BrandAsset, type KitAsset } from '../../lib/brandKit';
import { uploadBrandAsset, uploadErrorKey } from '../../lib/brandAssetUpload';
import { checkPicked, kindOfMime, pickedProblem, type PickedFile } from '../../lib/sources';
import { putFromDisk } from '../../lib/uploads';
import type { Project } from '../../lib/projects';
import { formatNumber, t } from '../../lib/i18n';
import { Action, Card, Status, styles } from '../account/shared';

type Props = {
    workspaceId: string; rows: readonly AssetRow[]; catalog: { list: BrandAsset[]; truncated: boolean } | null;
    projects: Project[] | null; locked: boolean;
    onAssetsChange<T>(change: (rows: readonly AssetRow[]) => { next: AssetRow[]; result: T }): T;
    onCatalogChanged(): void;
};
const sizeLabel = (b: number | null) => b === null ? '' : b >= 1_000_000 ? `${formatNumber(b / 1_000_000, 1)} MB` : `${formatNumber(Math.max(1, Math.round(b / 1000)))} KB`;
const details = (a: BrandAsset) => [a.type, a.width && a.height ? `${a.width}×${a.height}` : '', a.seconds ? `${a.seconds}s` : '', sizeLabel(a.bytes)].filter(Boolean).join(' · ');

export function BrandAssetsEditor({ workspaceId, rows, catalog, projects, locked, onAssetsChange, onCatalogChanged }: Props) {
    const { api, beginSessionTask } = useAuth();
    const [project, setProject] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false), [offFor, setOffFor] = useState<readonly string[]>([]);
    const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
    const busy = useRef(false), mounted = useRef(false), workspaceIdRef = useRef(workspaceId), projectsRef = useRef(projects);
    const uploadRef = useRef<{ controller: AbortController; scope: { workspaceId: string; projectId: string } } | null>(null);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; uploadRef.current?.controller.abort(); }; }, []);
    useEffect(() => { workspaceIdRef.current = workspaceId; return () => uploadRef.current?.controller.abort(); }, [workspaceId]);
    useEffect(() => { projectsRef.current = projects; }, [projects]);
    const projectId = projects?.find(p => p.id === project)?.id ?? projects?.[0]?.id;
    const projectOff = projectId !== undefined && offFor.includes(projectId);
    const mutate = (change: (current: readonly AssetRow[]) => AssetRow[]) => onAssetsChange(current => ({ next: change(current), result: undefined }));
    const attach = (entry: KitAsset) => onAssetsChange(current => {
        const result = attachAsset(current, entry, nextAssetKey());
        return { next: result.next, result };
    });
    async function startUpload(source: 'photos' | 'files') {
        if (busy.current || locked || projectOff || rows.length >= ASSET_MAX || !projectId) return;
        busy.current = true;
        const task = beginSessionTask(), scope = { workspaceId, projectId }, controller = new AbortController();
        uploadRef.current = { controller, scope };
        setUploading(true); setNote(null);
        const live = () => task.current() && mounted.current && !controller.signal.aborted && workspaceIdRef.current === scope.workspaceId && !!projectsRef.current?.some(p => p.id === scope.projectId);
        try {
            let file: PickedFile | undefined;
            if (source === 'photos') {
                const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: false, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
                if (!live()) return;
                const a = !picked.canceled ? picked.assets[0] : undefined;
                if (a) file = { uri: a.uri, mimeType: a.mimeType, size: a.fileSize };
            } else {
                const picked = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/wav'], copyToCacheDirectory: true, multiple: false });
                if (!live()) return;
                const a = !picked.canceled ? picked.assets[0] : undefined;
                if (a) file = { uri: a.uri, mimeType: a.mimeType, size: a.size };
            }
            if (!file || !live()) return;
            const kind = kindOfMime(file.mimeType);
            const check = checkPicked(kind ?? 'image', file);
            if (!check.ok) { setNote({ text: pickedProblem(check.error, kind ?? 'image'), error: true }); return; }
            const result = await uploadBrandAsset(api, task, scope.projectId, { uri: file.uri, size: file.size!, contentType: check.contentType }, putFromDisk, controller.signal);
            if (!live()) return;
            const entry = assetFromCatalog({ id: result.assetId, projectId: result.projectId, type: check.contentType, bytes: file.size!, seconds: null, width: null, height: null });
            const { outcome } = attach(entry);
            setNote(outcome === 'duplicate' ? null : { text: t(outcome === 'added' ? 'brand.upload.done' : 'brand.upload.full'), error: outcome === 'full' });
            if (live()) onCatalogChanged();
        } catch (err) {
            if (isAccountChanged(err) || !live()) return;
            const key = uploadErrorKey(err);
            if (key === 'brand.upload.err.off') setOffFor([...offFor, scope.projectId]);
            if (key && key !== 'brand.upload.err.off') setNote({ text: t(key), error: true });
        } finally {
            busy.current = false; uploadRef.current = null;
            if (mounted.current) setUploading(false);
        }
    }
    return <Card title={t('brand.assets')} help={t('brand.assetsHelp')}>
        {rows.map((row, index) => {
            const a = assetProblem(row.value) === 'shape' ? null : row.value as KitAsset;
            const name = a?.name || t('brand.asset.field.name', { number: index + 1 });
            const match = catalog?.list.find(c => c.id === a?.assetId && c.projectId === a?.projectId);
            return <View key={row.key} style={{ gap: 8 }}>
                <Text style={styles.name}>{a ? name : t('brand.asset.unreadable')}</Text>
                {match ? <Text style={styles.help}>{details(match)}</Text> : null}
                {a ? (['name', 'credit', 'usage', 'url'] as const).map(field => <View key={field}>
                    <Text style={styles.label}>{t(`brand.asset.field.${field}`, { number: index + 1 })}</Text>
                    <TextInput accessibilityLabel={t(`brand.asset.field.${field}`, { number: index + 1 })} editable={!locked} style={styles.input} value={a[field]} maxLength={{ name: 120, credit: 120, usage: 240, url: 1000 }[field]} autoCapitalize={field === 'url' ? 'none' : 'sentences'} onChangeText={value => { if (!locked) mutate(current => editAssetRow(current, row.key, { [field]: value })); }} />
                </View>) : null}
                {!locked ? <Action label={t('brand.asset.removeLabel', { name })} onPress={() => mutate(current => removeAssetRow(current, row.key))} /> : null}
            </View>;
        })}
        {!locked ? <>
            <Text style={styles.title} accessibilityRole="header">{t('brand.asset.add')}</Text>
            {rows.length >= ASSET_MAX ? <Text style={styles.help}>{t('brand.asset.full')}</Text> : null}
            {catalog?.list.length === 0 ? <Text style={styles.help}>{t('brand.assetsNone')}</Text> : null}
            {catalog?.list.filter(a => !rows.some(r => (r.value as KitAsset | null)?.assetId === a.id)).map((a, i) => <View key={`${a.id}-${i}`}>
                <Text style={styles.help}>{details(a)}</Text>
                {isAttachable(a) ? <Action label={t('brand.asset.addLabel', { name: t('brand.assetDefault', { type: a.type, id: a.id.slice(0, 8) }) })} disabled={rows.length >= ASSET_MAX} onPress={() => attach(assetFromCatalog(a))} /> : null}
            </View>)}
            {catalog?.truncated ? <Text style={styles.help}>{t('brand.assetsMore')}</Text> : null}
            {rows.length < ASSET_MAX ? <>
                <Text style={styles.title} accessibilityRole="header">{t('brand.upload.title')}</Text>
                {projects?.length === 0 ? <Text style={styles.help}>{t('brand.upload.noProject')}</Text> : null}
                {!!projects?.length ? <>
                    <Text style={styles.label}>{t('brand.upload.project')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{projects.map(p => <Pressable key={p.id} accessibilityRole="radio" accessibilityState={{ checked: p.id === projectId }} style={styles.action} onPress={() => setProject(p.id)}><Text style={styles.actionText}>{p.id === projectId ? '✓ ' : ''}{p.name}</Text></Pressable>)}</View>
                    {projectOff ? <Status text={t('brand.upload.err.off')} error /> : <>
                    <Action label={t('brand.upload.photos')} disabled={uploading} onPress={() => void startUpload('photos')} />
                    <Action label={t('brand.upload.files')} disabled={uploading} onPress={() => void startUpload('files')} />
                    </>}
                </> : null}
            </> : null}
        </> : null}
        <Status text={uploading ? t('brand.upload.sending') : note?.text ?? null} error={!uploading && note?.error} />
    </Card>;
}
