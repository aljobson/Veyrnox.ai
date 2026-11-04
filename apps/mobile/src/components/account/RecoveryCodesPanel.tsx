import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { isAccountChanged } from '../../auth/sessionTask';
import { verifyFactor } from '../../lib/auth/accountCalls';
import { toSession } from '../../lib/auth/supabaseAuth';
import { copyText } from '../../lib/clipboard';
import { t } from '../../lib/i18n';
import { mfaErrorKey, validCode } from '../../lib/mfa';
import { codesErrorKey, fetchRecoveryStatus, generateRecoveryCodes, type RecoveryStatus } from '../../lib/mfaRecovery';
import { CodeField } from './CodeField';
import { Status } from './AccountParts';
import { Button, Text, themedStyles, useThemedStyles } from '../ui';

// Recovery codes for two-factor sign-in (web RecoveryCodesPanel, ADR-0311). Shown once, in memory only: nothing
// here writes a code to storage, logs or analytics. Making new codes needs a fresh authenticator code first, and
// replaces every earlier code.
export function RecoveryCodesPanel({ factorId, codes, onCodes }: { factorId: string; codes: string[] | null; onCodes: (codes: string[] | null) => void }) {
    const styles = useThemedStyles(sheets);
    const { api, adoptSession, beginSessionTask } = useAuth();
    const [status, setStatus] = useState<RecoveryStatus | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    const load = useCallback(async () => {
        const task = beginSessionTask();
        try {
            const next = await fetchRecoveryStatus(api);
            if (task.current()) setStatus(next);
        } catch (err) {
            if (!task.current() || isAccountChanged(err)) return;
            setNote(t(codesErrorKey(err)));
        }
    }, [api, beginSessionTask]);

    useEffect(() => {
        if (!codes) void load();
    }, [load, codes]);

    async function regenerate() {
        const task = beginSessionTask();
        setBusy(true);
        setNote(null);
        try {
            // A fresh challenge every time: the server checks the second factor was proved in the last five minutes.
            const session = toSession(await verifyFactor(task.tokens, factorId, code), Date.now());
            if (!task.current()) return;
            await adoptSession(session, task.gen);
            if (!task.current()) return;
            const next = await generateRecoveryCodes(api);
            if (!task.current()) return;
            onCodes(next);
            setConfirming(false);
            setCode('');
            setCopied(false);
        } catch (err) {
            if (!task.current() || isAccountChanged(err)) return;
            setNote(t(err instanceof Error && err.name === 'ApiError' ? codesErrorKey(err) : mfaErrorKey(err)));
        } finally {
            setBusy(false);
        }
    }

    if (codes) {
        return (
            <View style={styles.group}>
                <Text variant="bodyStrong" accessibilityRole="header">{t('app.account.mfa.recovery.title')}</Text>
                <Text variant="footnote" tone="secondary">{t('app.account.mfa.recovery.saveHelp')}</Text>
                <Text selectable variant="bodyStrong" style={styles.codes}>{codes.join('\n')}</Text>
                <Button variant="secondary" label={t('app.account.mfa.recovery.copy')} onPress={() => void copyText(codes.join('\n')).then((ok) => { setCopied(ok); if (!ok) setNote(t('libraryCreate.copyFailed')); })} />
                <Text accessibilityLiveRegion="polite" variant="footnote" tone="secondary">{copied ? t('app.account.mfa.recovery.copied') : ''}</Text>
                <Button variant="primary" label={t('app.account.mfa.recovery.saved')} onPress={() => { onCodes(null); setCopied(false); }} />
                <Status text={note} error />
            </View>
        );
    }

    const summary = !status ? t('app.account.mfa.recovery.loading') : status.needsRegeneration || status.usable === 0 ? t('app.account.mfa.recovery.needed') : t('app.account.mfa.recovery.remaining', { count: status.usable });
    const generateLabel = t(status && !status.needsRegeneration && status.usable > 0 ? 'app.account.mfa.recovery.regenerate' : 'app.account.mfa.recovery.generate');
    return (
        <View style={styles.group}>
            <Text variant="bodyStrong" accessibilityRole="header">{t('app.account.mfa.recovery.title')}</Text>
            {!status && !note ? <ActivityIndicator color={styles.accent.color} accessibilityLabel={t('app.account.mfa.recovery.loading')} /> : <Text variant="footnote" tone="secondary" accessibilityLiveRegion="polite">{summary}</Text>}
            {confirming ? (
                <>
                    <Text variant="footnote" tone="secondary">{t('app.account.mfa.recovery.verifyHelp')}</Text>
                    <CodeField value={code} onChange={setCode} />
                    <Button variant="primary" label={generateLabel} disabled={busy || !validCode(code)} onPress={() => void regenerate()} />
                </>
            ) : (
                <Button variant="secondary" label={generateLabel} disabled={busy || !status} onPress={() => setConfirming(true)} />
            )}
            <Status text={note} error />
        </View>
    );
}

const sheets = themedStyles((p) => ({
    accent: { color: p.accent },
    group: { gap: 12 },
    codes: { fontVariant: ['tabular-nums'], letterSpacing: 1 },
}));
