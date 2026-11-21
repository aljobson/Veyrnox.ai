export type PhoneCapability = 'transport' | 'history' | 'pads' | 'stepGrid' | 'stepVelocity' | 'mixer' | 'save' | 'controls' | 'regions' | 'ruler' | 'pianoRoll' | 'automation' | 'takes' | 'keyboard' | 'ripple' | 'dragCancel' | 'takeComp';
export const PHONE_CAPABILITIES: ReadonlySet<PhoneCapability> = new Set(['transport', 'history', 'pads', 'stepGrid', 'mixer', 'save', 'controls', 'regions', 'ruler', 'pianoRoll', 'keyboard']);
export const SHORTCUT_CAPABILITY: Readonly<Record<string, PhoneCapability>> = {
    help: 'controls', play: 'transport', ripple: 'ripple', undo: 'history', redo: 'history',
    gridMove: 'stepGrid', gridToggle: 'stepGrid', gridVelocity: 'stepVelocity',
    regionMove: 'regions', regionResize: 'regions', regionTrim: 'regions', regionDuplicate: 'regions', regionSplit: 'regions', regionDelete: 'regions', regionEdit: 'regions',
    rulerMove: 'ruler', rulerCancel: 'dragCancel', pianoSelectAll: 'pianoRoll', pianoMove: 'pianoRoll', pianoResize: 'pianoRoll', pianoToggle: 'pianoRoll', pianoDelete: 'pianoRoll', pianoVelocity: 'pianoRoll',
    automationMove: 'automation', automationDelete: 'automation', takeMove: 'takeComp', takeAssign: 'takeComp', takeClear: 'takeComp',
    pads: 'pads', notes: 'keyboard', octave: 'keyboard', velocity: 'keyboard',
};
export function touchKey(id: string, available: ReadonlySet<PhoneCapability>): string {
    return available.has(SHORTCUT_CAPABILITY[id]) ? `beatLabs.touch.${id}` : 'beatLabs.unavailable';
}
