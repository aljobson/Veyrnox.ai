import type { SessionTask } from '../auth/sessionTask';
import { t } from '../lib/i18n';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { JOBS_CHANNEL, PUSH_ENABLED, jobRouteFromPush, registerDevice, removeDevice } from '../lib/push';

// Push for finished creations. Nothing here runs unless the build switch is on, the device
// is real, and the person has switched notifications on in Account (the OS permission is
// asked only at that moment, never on launch).

const PREF_KEY = 'veyrnox_push_pref';
const DEVICE_KEY = 'veyrnox_push_device';

import { PushContext, type EnableResult } from './pushContext';

if (PUSH_ENABLED) {
    // Show a push that arrives while the app is open.
    Notifications.setNotificationHandler({
        handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
}

const SUPPORTED = PUSH_ENABLED && Device.isDevice;

async function deviceId(): Promise<string> {
    try {
        const stored = await SecureStore.getItemAsync(DEVICE_KEY);
        if (stored) return stored;
    } catch {
        // Fall through to a fresh id.
    }
    const fresh = Crypto.randomUUID();
    try {
        await SecureStore.setItemAsync(DEVICE_KEY, fresh);
    } catch {
        // A per-launch id is acceptable; the server caps devices per account.
    }
    return fresh;
}

async function readPref(): Promise<boolean> {
    try {
        return (await SecureStore.getItemAsync(PREF_KEY)) === 'on';
    } catch {
        return false;
    }
}

async function writePref(on: boolean): Promise<void> {
    try {
        await SecureStore.setItemAsync(PREF_KEY, on ? 'on' : 'off');
    } catch {
        // The switch resets next launch; nothing else depends on it.
    }
}

export function PushProviderLive({ children }: { children: ReactNode }) {
    const { status, api, generation, beginSessionTask } = useAuth();
    const router = useRouter();
    const [enabled, setEnabledState] = useState(false);
    const token = useRef<{ readonly value: string; readonly gen: number } | null>(null);

    const register = useCallback(async (task: SessionTask): Promise<boolean> => {
        if (!task.current()) return false;
        try {
            if (Platform.OS === 'android') {
                await Notifications.setNotificationChannelAsync(JOBS_CHANNEL, {
                    name: t('push.creations'),
                    importance: Notifications.AndroidImportance.DEFAULT,
                });
            }
            if (!task.current()) return false;
            const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
            if (!projectId) return false;
            const pushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
            if (!task.current()) return false;
            const id = await deviceId();
            if (!task.current()) return false;
            const out = await registerDevice({ request: (path, init) => api.request(path, init, { task }) }, {
                token: pushToken,
                platform: Platform.OS === 'android' ? 'android' : 'ios',
                deviceId: id,
                appVersion: Constants.expoConfig?.version ?? '0',
                notifyJobs: true,
            });
            if (!task.current()) return false;
            if (out.kind === 'registered') token.current = { value: pushToken, gen: task.gen };
            return out.kind === 'registered';
        } catch {
            return false;
        }
    }, [api]);

    // On every launch and sign-in, register again if the person switched notifications on
    // and the OS still allows them. Never prompts.
    useEffect(() => {
        const task = beginSessionTask();
        if (task.gen !== generation || !task.current() || !SUPPORTED || status !== 'signedIn') return;
        let cancelled = false;
        void (async () => {
            const wanted = await readPref();
            if (cancelled || !task.current()) return;
            setEnabledState(wanted);
            if (!wanted) return;
            const perm = await Notifications.getPermissionsAsync();
            if (!cancelled && task.current() && perm.granted) await register(task);
        })();
        return () => {
            cancelled = true;
        };
    }, [status, register, generation, beginSessionTask]);

    // Open the creation a push is about, both when the app was closed and when it is open.
    useEffect(() => {
        const task = beginSessionTask();
        if (task.gen !== generation || !task.current() || !SUPPORTED || status !== 'signedIn') return;
        let live = true;
        const open = (data: unknown) => {
            if (!live || !task.current()) return;
            const route = jobRouteFromPush(data);
            if (route) router.push(route as never);
        };
        void Notifications.getLastNotificationResponseAsync().then((last) => {
            if (last) open(last.notification.request.content.data);
        });
        const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
        return () => { live = false; sub.remove(); };
    }, [status, router, generation, beginSessionTask]);

    const setEnabled = useCallback(
        async (on: boolean): Promise<EnableResult> => {
            const task = beginSessionTask();
            if (!SUPPORTED) return 'unavailable';
            if (!on) {
                const held = token.current;
                if (held && held.gen === task.gen) {
                    await removeDevice({ request: (path, init) => api.request(path, init, { task }) }, held.value);
                    if (token.current === held) token.current = null;
                }
                if (!task.current()) return 'unavailable';
                await writePref(false);
                if (!task.current()) return 'unavailable';
                setEnabledState(false);
                return 'off';
            }
            const perm = await Notifications.requestPermissionsAsync();
            if (!task.current()) return 'unavailable';
            if (!perm.granted) return 'denied';
            if (!(await register(task)) || !task.current()) return 'unavailable';
            await writePref(true);
            if (!task.current()) return 'unavailable';
            setEnabledState(true);
            return 'on';
        },
        [api, register, beginSessionTask],
    );

    const unregister = useCallback(async () => {
        const task = beginSessionTask();
        const held = token.current;
        if (held && held.gen === task.gen) {
            await removeDevice({ request: (path, init) => api.request(path, init, { task }) }, held.value);
            if (token.current === held) token.current = null;
        }
    }, [api, beginSessionTask]);

    const value = useMemo(() => ({ supported: SUPPORTED, enabled, setEnabled, unregister }), [enabled, setEnabled, unregister]);
    return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}
