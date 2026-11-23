import type { DynamicsProcessor } from '../../src/lib/beatNative/dynamicsProcessor';

export const workletNodes: WorkletProcessingNode[] = [];

export class WorkletProcessingNode {
    readonly kind = 'workletProcessor';
    readonly connect = jest.fn();
    readonly disconnect = jest.fn();

    constructor(readonly context: unknown, readonly processor: DynamicsProcessor) {
        workletNodes.push(this);
    }
}

export const resetAudioWorklets = () => { workletNodes.length = 0; };
