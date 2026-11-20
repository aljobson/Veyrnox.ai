import { Canvas, Fill, FilterMode, ImageShader, MipmapMode, Shader, Skia } from '@shopify/react-native-skia';
import { Component, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { puppetEffect, type PuppetLayers } from '../../lib/oddlings/puppetNative';
import type { PuppetRig } from '../../lib/oddlings/puppetPrepare';
import { puppetUniforms } from '../../lib/oddlings/puppetSksl';

export class PuppetBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch() { this.props.onFailure(); }
    render() { return this.state.failed ? null : this.props.children; }
}

export function OddlingPuppetCanvas({ id, rig, layers, playing, viewSize }: {
    id: string; rig: PuppetRig; layers: PuppetLayers; playing: boolean; viewSize: number[];
}) {
    const [seconds, setSeconds] = useState(0);
    useEffect(() => {
        if (!playing) return;
        let frame = 0, previous: number | null = null, pending = 0, last = -Infinity;
        const tick = (timestamp: number) => {
            if (previous !== null) pending += Math.min(100, timestamp - previous) / 1000;
            previous = timestamp;
            if (timestamp - last >= 32) {
                const elapsed = pending;
                pending = 0; last = timestamp;
                setSeconds(value => value + elapsed);
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing]);
    return (
        <Canvas style={StyleSheet.absoluteFill}>
            <Fill>
                <Shader source={puppetEffect(Skia)} uniforms={puppetUniforms(rig, layers.lids, id, seconds, viewSize)}>
                    <ImageShader image={layers.plate} tx="clamp" ty="clamp" sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.None }} />
                    <ImageShader image={layers.head} tx="clamp" ty="clamp" sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.None }} />
                </Shader>
            </Fill>
        </Canvas>
    );
}
