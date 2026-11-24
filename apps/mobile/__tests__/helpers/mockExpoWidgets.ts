export const createLiveActivity = (_name: string, _component: unknown) => ({
    getInstances: () => [],
    start: () => ({ update: async () => {}, end: async () => {} }),
});

export const after = (date: Date) => ({ after: date });
