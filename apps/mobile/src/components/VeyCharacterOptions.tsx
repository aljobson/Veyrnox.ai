import { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip } from './ui';
import { VEY_CHARACTER_IDS, getVeyCharacter, setVeyCharacter, subscribeVeyCharacter, type VeyCharacterId } from '../lib/veyCharacterChoice';

const name = (id: VeyCharacterId) => id.charAt(0).toUpperCase() + id.slice(1);

// Pick the character Vey wears everywhere in the app. Applies at once; the names are the characters' own.
export function VeyCharacterOptions() {
    const current = useSyncExternalStore(subscribeVeyCharacter, getVeyCharacter, getVeyCharacter);
    return (
        <View style={styles.row} accessibilityRole="radiogroup">
            {VEY_CHARACTER_IDS.map((id) => (
                <Chip key={id} label={name(id)} selected={id === current} accessibilityRole="radio"
                    accessibilityState={{ checked: id === current, selected: id === current }}
                    onPress={() => { void setVeyCharacter(id); }} />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } });
