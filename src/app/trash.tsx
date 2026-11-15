import React, { useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDocumentStore } from '@/store/useDocumentStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { Document } from '@/core/types';
import { lightColors } from '@/core/theme/colors';

export default function TrashScreen() {
  const { trashDocuments, loadTrash, restore, permanentDelete } = useDocumentStore();
  const { t } = useSettingsStore();

  useEffect(() => {
    loadTrash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRestore = (doc: Document) => {
    Alert.alert('Restore Document?', `"${doc.title}" will be restored to your documents list.`, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('restore'),
        onPress: async () => {
          await restore(doc.id);
        },
      },
    ]);
  };

  const handlePermanentDelete = (doc: Document) => {
    Alert.alert(
      t('permanentDelete'),
      `"${doc.title}" and its files will be permanently deleted from this device. This action cannot be undone.`,
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'),
          style: 'destructive',
          onPress: async () => {
            await permanentDelete(doc.id);
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={trashDocuments}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          trashDocuments.length === 0 && styles.emptyListContent,
        ]}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.thumbContainer}>
              {item.thumbnail_path ? (
                <Image source={{ uri: item.thumbnail_path }} style={styles.thumb} />
              ) : (
                <Ionicons name="document-outline" size={24} color={lightColors.textMuted} />
              )}
            </View>

            <View style={styles.info}>
              <Text style={styles.title} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.date}>
                Deleted on: {item.deleted_at ? new Date(item.deleted_at).toLocaleDateString() : ''}
              </Text>
            </View>

            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => handleRestore(item)}
              >
                <Ionicons name="refresh-outline" size={20} color={lightColors.primary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => handlePermanentDelete(item)}
              >
                <Ionicons name="trash-bin-outline" size={20} color={lightColors.danger} />
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconBg}>
              <Ionicons name="trash-outline" size={44} color={lightColors.textSecondary} />
            </View>
            <Text style={styles.emptyTitle}>{t('noTrash')}</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: lightColors.background,
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: lightColors.border,
  },
  thumbContainer: {
    width: 48,
    height: 60,
    borderRadius: 6,
    backgroundColor: lightColors.surfaceVariant,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  info: {
    flex: 1,
    marginLeft: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: lightColors.text,
  },
  date: {
    fontSize: 12,
    color: lightColors.textSecondary,
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
  },
  emptyIconBg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: lightColors.textSecondary,
  },
});
