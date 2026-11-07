import { useState, type ComponentProps } from 'react';
import { View } from 'react-native';
import { t } from '../../lib/i18n';
import { attachCapacity } from '../../lib/attachModel';
import type { CatalogModel } from '../../lib/media';
import { MAX_UNUSED_UPLOADS } from '../../lib/uploads';
import { AttachFromDevice } from '../AttachFromDevice';
import { Button, Text } from '../ui';

type Props = ComponentProps<typeof AttachFromDevice> & { readonly hasSlots: boolean };

// Models with their own file slots keep the multi-file picker one tap away; models without slots show it straight away.
// It stays mounted while collapsed so an upload in progress is not lost.
export function AttachMore({ hasSlots, ...attach }: Props) {
    const [open, setOpen] = useState(false);
    const shown = !hasSlots || open;
    return (
        <>
            {hasSlots ? <Button variant="tertiary" accessibilityState={{ expanded: open }} onPress={() => setOpen((value) => !value)} label={t(open ? 'create.workspace.addSeveralHide' : 'create.workspace.addSeveral')} /> : null}
            <View style={shown ? undefined : { display: 'none' }}><AttachFromDevice {...attach} /></View>
        </>
    );
}

// States the limits up front: files per creation, and what an account can hold unused.
export function UploadLimitNote({ model }: { readonly model: CatalogModel }) {
    // The server takes at most 3 references of one kind (lib/generationSources.js), whatever the model's slots declare.
    const count = Object.values(attachCapacity(model)).reduce((sum, n) => sum + Math.min(n, 3), 0);
    return <Text variant="caption" tone="tertiary">{t('create.workspace.referencesLimit', { count })}. {t('uploads.holdLimit', { max: MAX_UNUSED_UPLOADS })}</Text>;
}
