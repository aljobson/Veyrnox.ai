import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { creativeFeature, featurePrompt, type CreativeFeature } from '../../../lib/creativeFeatures';
import { fetchCatalog, type CatalogModel } from '../../../lib/media';
import { colors, fonts } from '../../../theme';

export default function CreativeFeatureDetail() {
    const { slug } = useLocalSearchParams<{ slug?: string }>();
    const feature = creativeFeature(typeof slug === 'string' ? slug : undefined);
    if (!feature) return <View style={styles.center}><Stack.Screen options={{ title: 'Creative tool' }} /><Text style={styles.error}>That creative tool is not available.</Text></View>;
    return <FeatureStudio key={feature.slug} feature={feature} />;
}

function FeatureStudio({ feature }: { feature: CreativeFeature }) {
    const router = useRouter();
    const [brief, setBrief] = useState('');
    const [script, setScript] = useState<string | null>(null);
    const [model, setModel] = useState<CatalogModel | null | undefined>(undefined);
    const [error, setError] = useState('');
    useEffect(() => {
        let live = true;
        fetchCatalog().then((models) => { if (live) setModel(models.find((item) => item.id === feature.model) ?? null); }, () => { if (live) setModel(null); });
        return () => { live = false; };
    }, [feature.model]);
    const required = useMemo(() => feature.media.map((slot) => slot === 'image' ? 'image' : slot === 'video' ? 'video' : 'audio recording'), [feature.media]);
    const prompt = featurePrompt(feature, brief);
    const canContinue = model !== undefined && model !== null && (!feature.scriptUpload || !!script) && (feature.input === 'Production note' || !!brief.trim());

    async function chooseScript() {
        setError('');
        try {
            const result = await DocumentPicker.getDocumentAsync({ type: ['text/plain', 'text/markdown', '*/*'], copyToCacheDirectory: true, multiple: false });
            if (result.canceled) return;
            const asset = result.assets[0];
            if (!/\.(?:txt|md|markdown)$/i.test(asset.name) || typeof asset.size !== 'number' || asset.size > 128_000) throw new Error('invalid_script');
            const text = (await new File(asset.uri).text()).trim().slice(0, 1000);
            if (!text) throw new Error('invalid_script');
            setBrief(text); setScript(asset.name);
        } catch { setScript(null); setError('Choose a TXT or Markdown file up to 128 KB.'); }
    }
    function openCreate() {
        if (!canContinue) { setError(model === null ? 'The live model is not available right now.' : feature.scriptUpload && !script ? 'Upload a script first.' : `Complete “${feature.input}” first.`); return; }
        router.push({ pathname: '/create/[modelId]', params: { modelId: feature.model, prompt: prompt || feature.title, ...(feature.kind === 'video' ? { duration: '5' } : {}), recipe: feature.slug } });
    }
    return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Stack.Screen options={{ title: feature.title }} />
        <View style={styles.hero}><Text style={styles.kicker}>{feature.group.toUpperCase()} · {feature.kind.toUpperCase()}</Text><Text style={styles.title} accessibilityRole="header">{feature.title}</Text><Text style={styles.lead}>Follow the guided setup, then review uploads, price and final settings in Create before anything is generated.</Text></View>
        <Example feature={feature} />
        <View style={styles.card}>
            <View style={styles.row}><Text style={styles.cardTitle}>{feature.input}</Text><Text style={styles.counter}>{brief.length}/1000</Text></View>
            {feature.scriptUpload ? <><Pressable accessibilityRole="button" style={styles.secondary} onPress={() => void chooseScript()}><Text style={styles.secondaryText}>{script ? 'Replace script' : 'Upload TXT or Markdown script'}</Text></Pressable>{script ? <Text style={styles.note}>{script}</Text> : null}</> : null}
            <TextInput accessibilityLabel={feature.input} value={brief} onChangeText={(value) => { setBrief(value.slice(0, 1000)); setError(''); }} placeholder={feature.placeholder} placeholderTextColor={colors.muted} style={styles.input} multiline maxLength={1000} />
        </View>
        <View style={styles.card}><Text style={styles.kicker}>REQUIRED UPLOADS</Text><Text style={styles.cardTitle}>{required.length ? required.join(' + ') : 'No media required'}</Text><Text style={styles.note}>{required.length ? 'The next screen has native Photos, Files and Library pickers for every required source.' : 'Your script is the source for this workflow.'}</Text></View>
        <View style={styles.card}><Text style={styles.kicker}>WORKFLOW</Text>{feature.steps.map((step, index) => <View key={step} style={styles.step}><Text style={styles.number}>0{index + 1}</Text><Text style={styles.stepText}>{step}</Text></View>)}</View>
        <View style={styles.card}><Text style={styles.kicker}>LIVE MODEL</Text>{model === undefined ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.cardTitle}>{model ? `Veyrnox ${feature.kind} model · ${model.credits} credits` : 'Unavailable'}</Text>}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}<Pressable accessibilityRole="button" disabled={model === undefined} style={[styles.primary, model === undefined && styles.off]} onPress={openCreate}><Text style={styles.primaryText}>Continue to uploads and final review</Text></Pressable><Text style={styles.note}>You will see the exact price before generating. A failed generation is refunded automatically.</Text></View>
    </ScrollView>;
}

function Example({ feature }: { feature: CreativeFeature }) {
    return <View style={styles.example}><View style={styles.exampleHead}><View><Text style={styles.kicker}>WORKING EXAMPLE</Text><Text style={styles.cardTitle}>See the intended result</Text></View><Pressable accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(feature.example.sourceUrl)}><Text style={styles.link}>Source</Text></Pressable></View>{feature.example.kind === 'video' ? <ExampleVideo url={feature.example.url} title={feature.title} /> : <Image source={{ uri: feature.example.url }} style={styles.exampleMedia} contentFit="contain" accessibilityLabel={`${feature.title} example`} accessibilityIgnoresInvertColors />}</View>;
}
function ExampleVideo({ url, title }: { url: string; title: string }) {
    const player = useVideoPlayer(url, (instance) => { instance.loop = true; });
    return <VideoView player={player} style={styles.exampleMedia} nativeControls contentFit="contain" accessibilityLabel={`${title} example video`} />;
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background }, content: { padding: 16, paddingBottom: 80, gap: 14 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: 24 },
    hero: { gap: 9, paddingVertical: 8 }, kicker: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 }, title: { color: colors.text, fontFamily: fonts.displayHeavy, fontSize: 38, lineHeight: 40 }, lead: { color: colors.body, fontSize: 15, lineHeight: 23 },
    card: { gap: 12, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, cardTitle: { color: colors.text, fontSize: 19, fontWeight: '900' }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, counter: { color: colors.muted, fontSize: 11 },
    input: { minHeight: 132, color: colors.text, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.background, padding: 13, fontSize: 15, lineHeight: 22, textAlignVertical: 'top' }, note: { color: colors.muted, fontSize: 12, lineHeight: 18 },
    step: { flexDirection: 'row', gap: 12 }, number: { color: colors.accent, fontSize: 12, fontWeight: '900' }, stepText: { flex: 1, color: colors.body, fontSize: 14, lineHeight: 20 },
    example: { overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: '#050506' }, exampleHead: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface }, exampleMedia: { width: '100%', height: 260, backgroundColor: '#050506' }, link: { color: colors.accent, fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
    primary: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.accent, paddingHorizontal: 16 }, primaryText: { color: colors.accentInk, fontSize: 15, fontWeight: '900', textAlign: 'center' }, secondary: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.accent }, secondaryText: { color: colors.accent, fontSize: 14, fontWeight: '800' }, off: { opacity: 0.45 }, error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
});
