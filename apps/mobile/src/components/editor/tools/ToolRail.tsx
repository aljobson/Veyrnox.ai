import { Pressable, ScrollView, Text, View } from 'react-native';
import { rawText } from '../../../lib/i18n';
import { colors } from '../../../theme';
import { styles } from '../fullEditorStyles';
import { tools, type Tool } from './editorTools';
export function ToolRail({ tool, setTool }: { tool: Tool; setTool(tool: Tool): void }) {
    return <ScrollView testID="editor-tool-rail" horizontal showsHorizontalScrollIndicator={false} style={styles.toolRail} contentContainerStyle={styles.toolContent}>
            {tools.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={rawText(item.label)} accessibilityState={{ selected: tool === item.id }} onPress={() =>
        setTool(item.id)} style={({ pressed }) => [styles.tool, tool === item.id && styles.toolActive, pressed && styles.pressed]}>
        {item.id === 'markers' ? <View style={{ width: 12, height: 12, backgroundColor: colors.accent, transform: [{ rotate: '45deg' }] }} /> : <Text style={[styles.toolIcon, tool ===
            item.id && styles.toolIconActive]}>{item.icon}</Text>}
        <Text style={[styles.toolLabel, tool === item.id && styles.toolLabelActive]}>{item.label}</Text>
            </Pressable>)}
        </ScrollView>;
}
