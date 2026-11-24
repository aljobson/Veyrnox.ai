import { HStack, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { activityBackgroundTint, font, foregroundStyle, padding, progressViewStyle, tint } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity } from 'expo-widgets';

export type SmartCutLiveActivityProps = {
    title: string;
    status: string;
    current: number;
    total: number;
    progress: number;
    complete: boolean;
};

const green = '#34C759';
const secondary = '#A7A7AD';

const SmartCutLiveActivity = createLiveActivity<SmartCutLiveActivityProps>('VeyrnoxSmartCut', (props, environment) => {
    'widget';
    const accent = environment.isLuminanceReduced ? '#FFFFFF' : green;
    const count = `${Math.max(1, props.current)}/${Math.max(1, props.total)}`;
    return {
        banner: (
            <VStack alignment="leading" spacing={8} modifiers={[padding({ all: 14 }), activityBackgroundTint('#101311')] }>
                <HStack alignment="center" spacing={8}>
                    <Text modifiers={[font({ weight: 'bold' }), foregroundStyle('#FFFFFF')]}>{props.title}</Text>
                    <Spacer />
                    <Text modifiers={[font({ weight: 'semibold' }), foregroundStyle(accent)]}>{props.complete ? 'Done' : count}</Text>
                </HStack>
                <ProgressView value={Math.min(1, Math.max(0, props.progress))} modifiers={[progressViewStyle('linear'), tint(accent)]} />
                <Text modifiers={[font({ size: 13 }), foregroundStyle(secondary)]}>{props.status}</Text>
            </VStack>
        ),
        compactLeading: <Text modifiers={[font({ weight: 'bold' }), foregroundStyle(accent)]}>✦</Text>,
        compactTrailing: <Text modifiers={[font({ weight: 'semibold' }), foregroundStyle('#FFFFFF')]}>{props.complete ? 'Done' : count}</Text>,
        minimal: <Text modifiers={[font({ weight: 'bold' }), foregroundStyle(accent)]}>✦</Text>,
        expandedLeading: <Text modifiers={[font({ weight: 'bold' }), foregroundStyle(accent)]}>✦ Smart Cut</Text>,
        expandedTrailing: <Text modifiers={[font({ weight: 'semibold' }), foregroundStyle('#FFFFFF')]}>{props.complete ? 'Done' : count}</Text>,
        expandedBottom: <ProgressView value={Math.min(1, Math.max(0, props.progress))} modifiers={[progressViewStyle('linear'), tint(accent)]} />,
    };
});

export default SmartCutLiveActivity;
