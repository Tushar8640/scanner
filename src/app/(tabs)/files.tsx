import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  type TextInputInstance,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useDocumentStore, SortOption } from '@/store/useDocumentStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { PdfService } from '@/services/pdf/PdfService';
import { DocumentCard } from '@/ui/components/DocumentCard';
import { ActionButton } from '@/ui/components/ActionButton';
import { ActionSheet, ActionSheetItem } from '@/ui/components/ActionSheet';
import { ScanFab } from '@/ui/components/ScanFab';
import { useScanActions } from '@/ui/hooks/useScanActions';
import { useThemeColors } from '@/core/theme/colors';
import { Document, Folder } from '@/core/types';

type ViewMode = 'list' | 'grid';

export default function FilesScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ search?: string; newFolder?: string }>();
  const {
    documents,
    folders,
    activeFolderId,
    searchQuery,
    sortBy,
    isLoading,
    setSearchQuery,
    setSortBy,
    setActiveFolderId,
    loadAll,
    softDelete,
    updateTitle,
    createFolder,
    deleteFolder,
    moveToFolder,
  } = useDocumentStore();
  const { t } = useSettingsStore();
  const { busy, importImages } = useScanActions();
  const searchRef = useRef<TextInputInstance>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sortSheetVisible, setSortSheetVisible] = useState(false);
  const [docSheetTarget, setDocSheetTarget] = useState<Document | null>(null);
  const [folderModalVisible, setFolderModalVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameTarget, setRenameTarget] = useState<Document | null>(null);
  const [renameText, setRenameText] = useState('');
  const [moveTarget, setMoveTarget] = useState<Document | null>(null);

  // Deep links from Home: focus search, or open "Create Folder"
  useEffect(() => {
    if (params.search) setTimeout(() => searchRef.current?.focus(), 250);
  }, [params.search]);
  useEffect(() => {
    if (params.newFolder) setTimeout(() => setFolderModalVisible(true), 0);
  }, [params.newFolder]);

  const activeFolder = folders.find((f) => f.id === activeFolderId) ?? null;
  const searching = searchQuery.trim().length > 0;

  const handleShare = async (doc: Document) => {
    if (!doc.pdf_path) {
      router.push(`/document/${doc.id}`);
      return;
    }
    try {
      await PdfService.shareFile(doc.pdf_path, 'application/pdf', doc.title);
    } catch (e: any) {
      Alert.alert(t('error'), e.message || 'Failed to share file');
    }
  };

  const handleDelete = (docId: string) => {
    Alert.alert(t('deleteConfirmTitle'), t('deleteConfirmMsg'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => softDelete(docId) },
    ]);
  };

  const handleCreateFolder = async () => {
    if (newFolderName.trim().length > 0) {
      await createFolder(newFolderName.trim());
      setNewFolderName('');
      setFolderModalVisible(false);
    }
  };

  const handleFolderOptions = (folder: Folder) => {
    Alert.alert(t('deleteFolder'), `"${folder.name}"? ${t('deleteFolderConfirm')}`, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          if (activeFolderId === folder.id) setActiveFolderId(null);
          await deleteFolder(folder.id);
        },
      },
    ]);
  };

  const sortOptions: { label: string; value: SortOption }[] = [
    { label: t('sortNewest'), value: 'newest' },
    { label: t('sortOldest'), value: 'oldest' },
    { label: t('sortNameAsc'), value: 'nameAsc' },
    { label: t('sortNameDesc'), value: 'nameDesc' },
  ];

  const docItems: ActionSheetItem[] = docSheetTarget
    ? [
        { key: 'share', label: t('share'), icon: 'share-social-outline', onPress: () => handleShare(docSheetTarget) },
        {
          key: 'rename',
          label: t('rename'),
          icon: 'create-outline',
          onPress: () => {
            setRenameTarget(docSheetTarget);
            setRenameText(docSheetTarget.title);
          },
        },
        { key: 'move', label: t('moveToFolder'), icon: 'folder-outline', onPress: () => setMoveTarget(docSheetTarget) },
        {
          key: 'delete',
          label: t('delete'),
          icon: 'trash-outline',
          destructive: true,
          onPress: () => handleDelete(docSheetTarget.id),
        },
      ]
    : [];

  const cards: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; tint: string; onPress: () => void }[] = [
    { key: 'import', label: t('importImages'), icon: 'image', tint: colors.primary, onPress: importImages },
    { key: 'folder', label: t('createFolder'), icon: 'folder-open', tint: '#3B82F6', onPress: () => setFolderModalVisible(true) },
    { key: 'trash', label: t('trash'), icon: 'trash', tint: '#EF4444', onPress: () => router.push('/trash') },
  ];

  const header = (
    <View>
      {!activeFolder && !searching && (
        <View style={[styles.cardsArea, { backgroundColor: colors.background }]}>
          {cards.map((c) => (
            <TouchableOpacity
              key={c.key}
              style={[styles.card, { backgroundColor: colors.surface }]}
              onPress={c.onPress}
              disabled={busy}
            >
              <Ionicons name={c.icon} size={34} color={c.tint} />
              <Text style={[styles.cardLabel, { color: colors.text }]} numberOfLines={1}>
                {c.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={[styles.listHeader, { backgroundColor: colors.surface }]}>
        {activeFolder ? (
          <TouchableOpacity style={styles.crumb} onPress={() => setActiveFolderId(null)}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
            <Text style={[styles.listTitle, { color: colors.text }]} numberOfLines={1}>
              {activeFolder.name}
            </Text>
            <Text style={[styles.listCount, { color: colors.textMuted }]}> ({documents.length})</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.crumb}>
            <Text style={[styles.listTitle, { color: colors.text }]}>{searching ? t('search') : t('all')}</Text>
            <Text style={[styles.listCount, { color: colors.textMuted }]}> ({documents.length})</Text>
          </View>
        )}
        <View style={styles.listActions}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setSortSheetVisible(true)} accessibilityLabel={t('sortBy')}>
            <Ionicons name="swap-vertical" size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
            accessibilityLabel="Toggle view"
          >
            <Ionicons name={viewMode === 'list' ? 'grid-outline' : 'list-outline'} size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Folders (only at the top level) */}
      {!activeFolder && !searching && folders.length > 0 && (
        <View style={[styles.folderList, { backgroundColor: colors.surface }]}>
          {folders.map((f) => (
            <TouchableOpacity
              key={f.id}
              style={[styles.folderRow, { backgroundColor: colors.surfaceVariant }]}
              onPress={() => setActiveFolderId(f.id)}
              onLongPress={() => handleFolderOptions(f)}
            >
              <Ionicons name="folder" size={34} color={colors.primary} />
              <Text style={[styles.folderName, { color: colors.text }]} numberOfLines={1}>
                {f.name}
              </Text>
              <TouchableOpacity onPress={() => handleFolderOptions(f)} hitSlop={10}>
                <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
      {/* Search */}
      <View style={[styles.searchWrap, { backgroundColor: colors.background }]}>
        <View style={[styles.search, { backgroundColor: colors.surface }]}>
          <Ionicons name="search" size={20} color={colors.textSecondary} />
          <TextInput
            ref={searchRef}
            style={[styles.searchInput, { color: colors.text }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('search')}
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
          />
          {searching && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        key={viewMode}
        data={documents}
        numColumns={viewMode === 'grid' ? 3 : 1}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <DocumentCard
            document={item}
            variant={viewMode}
            onPress={() => router.push(`/document/${item.id}`)}
            onMore={() => setDocSheetTarget(item)}
          />
        )}
        columnWrapperStyle={viewMode === 'grid' ? styles.gridRow : undefined}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={loadAll} tintColor={colors.primary} />}
        ListEmptyComponent={
          !isLoading && (activeFolder || searching || folders.length === 0) ? (
            <View style={styles.empty}>
              <Ionicons name="document-text-outline" size={44} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                {searching ? t('noSearchResults') : t('noDocuments')}
              </Text>
            </View>
          ) : undefined
        }
      />

      <ScanFab />

      <ActionSheet
        visible={sortSheetVisible}
        title={t('sortBy')}
        items={sortOptions.map((o) => ({
          key: o.value,
          label: o.label,
          icon: 'swap-vertical',
          selected: sortBy === o.value,
          onPress: () => setSortBy(o.value),
        }))}
        onClose={() => setSortSheetVisible(false)}
      />
      <ActionSheet
        visible={docSheetTarget !== null}
        title={docSheetTarget?.title}
        items={docItems}
        onClose={() => setDocSheetTarget(null)}
      />

      {/* Create folder */}
      <Modal visible={folderModalVisible} transparent animationType="fade" onRequestClose={() => setFolderModalVisible(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('createFolder')}</Text>
            <TextInput
              style={[styles.modalInput, { color: colors.text, borderColor: colors.borderStrong, backgroundColor: colors.surfaceVariant }]}
              value={newFolderName}
              onChangeText={setNewFolderName}
              placeholder={t('folderNamePlaceholder')}
              placeholderTextColor={colors.textMuted}
              autoFocus
            />
            <View style={styles.modalActions}>
              <ActionButton title={t('cancel')} variant="outline" onPress={() => setFolderModalVisible(false)} style={styles.modalBtn} />
              <ActionButton title={t('save')} onPress={handleCreateFolder} style={styles.modalBtn} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Rename */}
      <Modal visible={renameTarget !== null} transparent animationType="fade" onRequestClose={() => setRenameTarget(null)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('rename')}</Text>
            <TextInput
              style={[styles.modalInput, { color: colors.text, borderColor: colors.borderStrong, backgroundColor: colors.surfaceVariant }]}
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
            />
            <View style={styles.modalActions}>
              <ActionButton title={t('cancel')} variant="outline" onPress={() => setRenameTarget(null)} style={styles.modalBtn} />
              <ActionButton
                title={t('save')}
                onPress={async () => {
                  if (renameTarget && renameText.trim()) await updateTitle(renameTarget.id, renameText.trim());
                  setRenameTarget(null);
                }}
                style={styles.modalBtn}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Move to folder */}
      <Modal visible={moveTarget !== null} transparent animationType="fade" onRequestClose={() => setMoveTarget(null)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, maxHeight: 420 }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('moveToFolder')}</Text>
            <ScrollView style={styles.moveList}>
              {[{ id: null as string | null, name: t('noFolderRoot') }, ...folders].map((f) => {
                const selected = moveTarget?.folder_id === f.id;
                return (
                  <TouchableOpacity
                    key={f.id ?? 'root'}
                    style={[styles.moveRow, selected && { backgroundColor: colors.primaryLight }]}
                    onPress={async () => {
                      if (moveTarget) await moveToFolder(moveTarget.id, f.id);
                      setMoveTarget(null);
                    }}
                  >
                    <Ionicons name={f.id ? 'folder' : 'folder-outline'} size={20} color={colors.primary} />
                    <Text style={[styles.moveName, { color: colors.text }]}>{f.name}</Text>
                    {selected && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <ActionButton title={t('cancel')} variant="outline" onPress={() => setMoveTarget(null)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 46,
    borderRadius: 10,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  cardsArea: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  card: {
    flex: 1,
    height: 100,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 10,
  },
  crumb: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  listTitle: {
    fontSize: 22,
    fontWeight: '700',
    flexShrink: 1,
  },
  listCount: {
    fontSize: 18,
  },
  listActions: {
    flexDirection: 'row',
  },
  iconBtn: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderList: {
    paddingHorizontal: 16,
    gap: 10,
    paddingBottom: 8,
  },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 10,
  },
  folderName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 110,
  },
  gridRow: {
    paddingHorizontal: 10,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 48,
    gap: 10,
  },
  emptyText: {
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  modalInput: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 15,
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  modalBtn: {
    flex: 1,
    height: 44,
  },
  moveList: {
    marginBottom: 16,
  },
  moveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  moveName: {
    flex: 1,
    fontSize: 15,
  },
});
