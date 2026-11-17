import React from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/core/theme/colors';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useDocumentStore } from '@/store/useDocumentStore';
import { ActionButton } from '@/ui/components/ActionButton';
import { askText } from '@/ui/components/PromptHost';

interface TagsModalProps {
  visible: boolean;
  /** Documents the tags are applied to. */
  documentIds: string[];
  onClose: () => void;
}

/** Tick tags on or off for one or more documents; create or delete tags here too. */
export const TagsModal: React.FC<TagsModalProps> = ({ visible, documentIds, onClose }) => {
  const colors = useThemeColors();
  const { t } = useSettingsStore();
  const { tags, docTags, createTag, deleteTag, setTagOnDocuments } = useDocumentStore();

  // A tag counts as on when every chosen document has it
  const isOn = (tagId: string) => documentIds.length > 0 && documentIds.every((id) => docTags[id]?.includes(tagId));

  const addTag = async () => {
    const name = await askText({ title: t('newTag'), placeholder: t('newTagName'), maxLength: 30 });
    if (!name?.trim()) return;
    const existing = tags.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    const tag = existing ?? (await createTag(name));
    await setTagOnDocuments(documentIds, tag.id, true);
  };

  const removeTag = (tagId: string, name: string) =>
    Alert.alert(t('deleteTag'), `"${name}"?`, [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => deleteTag(tagId) },
    ]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.title, { color: colors.text }]}>{t('tags')}</Text>
          <ScrollView style={styles.list}>
            {tags.length === 0 ? (
              <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('noTagsYet')}</Text>
            ) : (
              tags.map((tag) => {
                const on = isOn(tag.id);
                return (
                  <TouchableOpacity
                    key={tag.id}
                    style={styles.row}
                    onPress={() => setTagOnDocuments(documentIds, tag.id, !on)}
                    onLongPress={() => removeTag(tag.id, tag.name)}
                  >
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? colors.primary : colors.textMuted} />
                    <Ionicons name="pricetag-outline" size={18} color={colors.textSecondary} />
                    <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                      {tag.name}
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
          <TouchableOpacity style={styles.row} onPress={addTag}>
            <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
            <Text style={[styles.name, { color: colors.primary }]}>{t('newTag')}</Text>
          </TouchableOpacity>
          <ActionButton title={t('batchDone')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, borderRadius: 16, padding: 20, gap: 10, maxHeight: 520 },
  title: { fontSize: 18, fontWeight: '700' },
  list: { maxHeight: 300 },
  empty: { fontSize: 14, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  name: { fontSize: 16, flex: 1 },
});
