import { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
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
import { ScanEngineProvider } from '@/ui/components/ScanEngine';
import { DocSelectionBar } from '@/ui/components/DocSelectionBar';
import { useUiStore } from '@/store/useUiStore';
import { useItemLock } from '@/ui/hooks/useItemLock';
import { AdBanner } from '@/ui/components/AdBanner';
import { useScanActions } from '@/ui/hooks/useScanActions';
import { useThemeColors } from '@/core/theme/colors';
import { Document, Folder } from '@/core/types';

type ViewMode = 'list' | 'grid';

export default function FilesScreen() {
  // The scan engine renders pages with their filters for sharing, printing and saving
  return (
    <ScanEngineProvider>
      <FilesContent />
    </ScanEngineProvider>
  );
}

function FilesContent() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ search?: string; newFolder?: string; select?: string; selectFor?: 'lock' | 'tags'; toolAt?: string; toolAction?: 'sign' | 'watermark' | 'pdf' | 'erase' | 'word' | 'protect' }>();
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
  // Documents being moved (one from the "more" sheet, or several from selection mode)
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  // Ids in the order they were tapped; this is also the merge order
  const [selected, setSelected] = useState<string[]>([]);
  // Selection was opened from the Merge tool
  const [mergeIntent, setMergeIntent] = useState(false);
  const [selectFor, setSelectFor] = useState<'lock' | 'tags' | null>(null);
  const [activeToolAction, setActiveToolAction] = useState<'sign' | 'watermark' | 'pdf' | 'erase' | 'word' | 'protect' | null>(null);

  // Deep links from Home: focus search, or open "Create Folder"
  useEffect(() => {
    if (params.search) setTimeout(() => searchRef.current?.focus(), 250);
  }, [params.search]);
  useEffect(() => {
    if (params.newFolder) setTimeout(() => setFolderModalVisible(true), 0);
  }, [params.newFolder]);
  useEffect(() => {
    if (params.select)
      setTimeout(() => {
        setSelectMode(true);
        // Merge by default; Tools > Lock Docs / Tags reuse selection with their own hint
        setSelectFor(params.selectFor ?? null);
        setMergeIntent(true);
      }, 0);
    // selectFor arrives together with select
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.select]);
  useEffect(() => {
    if (params.toolAction) {
      setTimeout(() => setActiveToolAction(params.toolAction ?? null), 0);
    }
    // toolAt changes on every tap, so picking the same tool twice still shows the banner
  }, [params.toolAction, params.toolAt]);

  const exitSelect = () => {
    setSelectMode(false);
    setMergeIntent(false);
    setSelected([]);
  };
  const toggleSelected = (docId: string) =>
    setSelected((prev) => (prev.includes(docId) ? prev.filter((x) => x !== docId) : [...prev, docId]));
  // Selected ids in the order they were tapped, skipping any that are no longer listed
  const selectedInOrder = () => selected.filter((id) => documents.some((d) => d.id === id));

  // Selection actions (share, move/copy, rename, merge, delete, more) live in DocSelectionBar
  const setTabBarHidden = useUiStore((st) => st.setTabBarHidden);
  useEffect(() => {
    setTabBarHidden(selectMode);
    return () => setTabBarHidden(false);
  }, [selectMode, setTabBarHidden]);
  // Android back leaves selection first
  useEffect(() => {
    if (!selectMode) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      exitSelect();
      return true;
    });
    return () => sub.remove();
  }, [selectMode]);
  // The finger lifting after a long press can arrive as a tap; ignore that one
  const longPressAtRef = useRef(0);
  const chosenDocs = selectedInOrder()
    .map((id) => documents.find((d) => d.id === id))
    .filter(Boolean) as Document[];

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

  const { unlock } = useItemLock();
  const { setFolderLocked, tags, docTags } = useDocumentStore();
  // Tag filter chip; null shows every document
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const visibleDocs = tagFilter ? documents.filter((d) => docTags[d.id]?.includes(tagFilter)) : documents;

  /** Locked folders open only after the fingerprint or app PIN. */
  const openFolder = async (folder: Folder) => {
    if (folder.is_locked && !(await unlock(folder.id))) return;
    setActiveFolderId(folder.id);
  };

  const deleteFolderConfirm = (folder: Folder) =>
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

  const handleFolderOptions = (folder: Folder) => {
    Alert.alert(folder.name, undefined, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: folder.is_locked ? t('unlockDoc') : t('lockDoc'),
        onPress: async () => {
          if (!(await unlock(folder.id))) return;
          await setFolderLocked(folder.id, !folder.is_locked);
        },
      },
      { text: t('delete'), style: 'destructive', onPress: () => deleteFolderConfirm(folder) },
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
        { key: 'move', label: t('moveToFolder'), icon: 'folder-outline', onPress: () => setMoveIds([docSheetTarget.id]) },
        {
          key: 'compress',
          label: t('compressPdf'),
          icon: 'contract-outline',
          // Opens the document with the Compress PDF choices showing
          onPress: () => router.push({ pathname: '/document/[id]', params: { id: docSheetTarget.id, action: 'compress' } }),
        },
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
        {selectMode ? (
          <View style={styles.crumb}>
            <TouchableOpacity onPress={exitSelect} hitSlop={10} accessibilityLabel={t('cancel')}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.selectTitle, { color: colors.text }]}>
              {t('selectedCount').replace('{n}', String(selected.length))}
            </Text>
          </View>
        ) : activeFolder ? (
          <TouchableOpacity style={styles.crumb} onPress={() => setActiveFolderId(null)}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
            <Text style={[styles.listTitle, { color: colors.text }]} numberOfLines={1}>
              {activeFolder.name}
            </Text>
            <Text style={[styles.listCount, { color: colors.textMuted }]}> ({visibleDocs.length})</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.crumb}>
            <Text style={[styles.listTitle, { color: colors.text }]}>{searching ? t('search') : t('all')}</Text>
            <Text style={[styles.listCount, { color: colors.textMuted }]}> ({visibleDocs.length})</Text>
          </View>
        )}
        {selectMode ? (
          <TouchableOpacity
            style={styles.selectAllBtn}
            onPress={() =>
              setSelected(selected.length === documents.length ? [] : [...selected, ...documents.map((d) => d.id).filter((id) => !selected.includes(id))])
            }
          >
            <Text style={[styles.selectAllText, { color: colors.primary }]}>{t('selectAll')}</Text>
          </TouchableOpacity>
        ) : (
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
          <TouchableOpacity style={styles.iconBtn} onPress={() => setSelectMode(true)} accessibilityLabel={t('select')}>
            <Ionicons name="checkbox-outline" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        )}
      </View>

      {/* Folders (only at the top level) */}
      {/* Tag filter */}
      {tags.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagRow} style={{ backgroundColor: colors.surface }}>
          {[{ id: null as string | null, name: t('allTags') }, ...tags].map((tag) => {
            const on = tagFilter === tag.id;
            return (
              <TouchableOpacity
                key={tag.id ?? 'all'}
                style={[styles.tagChip, { backgroundColor: on ? colors.primary : colors.surfaceVariant }]}
                onPress={() => setTagFilter(tag.id)}
              >
                {tag.id && <Ionicons name="pricetag-outline" size={13} color={on ? '#FFFFFF' : colors.textSecondary} />}
                <Text style={[styles.tagText, { color: on ? '#FFFFFF' : colors.text }]}>{tag.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {!activeFolder && !searching && folders.length > 0 && (
        <View style={[styles.folderList, { backgroundColor: colors.surface }]}>
          {folders.map((f) => (
            <TouchableOpacity
              key={f.id}
              style={[styles.folderRow, { backgroundColor: colors.surfaceVariant }]}
              onPress={() => openFolder(f)}
              onLongPress={() => handleFolderOptions(f)}
            >
              <Ionicons name={f.is_locked ? 'lock-closed' : 'folder'} size={34} color={colors.primary} />
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

      {selectMode && mergeIntent && (
        <View style={[styles.toolBanner, { backgroundColor: colors.primary }]}>
          <Ionicons name={selectFor === 'lock' ? 'lock-closed' : selectFor === 'tags' ? 'pricetag' : 'git-merge'} size={20} color="#FFFFFF" />
          <Text style={styles.toolBannerText} numberOfLines={2}>
            {t(selectFor === 'lock' ? 'lockHint' : selectFor === 'tags' ? 'tagsHint' : 'mergeHint')}
          </Text>
        </View>
      )}

      {/* Active tool action banner */}
      {activeToolAction && (
        <View style={[styles.toolBanner, { backgroundColor: colors.primary }]}>
          <Ionicons
            name={
              activeToolAction === 'sign'
                ? 'create'
                : activeToolAction === 'watermark'
                ? 'water'
                : activeToolAction === 'erase'
                ? 'bandage'
                : activeToolAction === 'word'
                ? 'document-text'
                : activeToolAction === 'protect'
                ? 'shield-checkmark'
                : 'document'
            }
            size={20}
            color="#FFFFFF"
          />
          <Text style={styles.toolBannerText} numberOfLines={1}>
            {activeToolAction === 'sign'
              ? 'Select a document to sign'
              : activeToolAction === 'watermark'
              ? 'Select a document to add watermark'
              : activeToolAction === 'erase'
              ? 'Select a document to erase marks'
              : activeToolAction === 'word'
              ? 'Select a document to export as Word'
              : activeToolAction === 'protect'
              ? 'Select a document to protect with a password'
              : 'Select a document to export as PDF'}
          </Text>
          <TouchableOpacity onPress={() => setActiveToolAction(null)} hitSlop={10}>
            <Ionicons name="close-circle" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        key={viewMode}
        data={visibleDocs}
        numColumns={viewMode === 'grid' ? 3 : 1}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <DocumentCard
            document={item}
            variant={viewMode}
            selectionMode={selectMode}
            selected={selected.includes(item.id)}
            selectionIndex={selected.includes(item.id) ? selected.indexOf(item.id) + 1 : undefined}
            onPress={() => {
              if (Date.now() - longPressAtRef.current < 700) return;
              if (selectMode) {
                toggleSelected(item.id);
                return;
              }
              if (activeToolAction) {
                const act = activeToolAction;
                setActiveToolAction(null);
                router.push({ pathname: '/document/[id]', params: { id: item.id, action: act } });
                return;
              }
              router.push(`/document/${item.id}`);
            }}
            onMore={() => {
              if (selectMode) {
                toggleSelected(item.id);
              } else {
                setDocSheetTarget(item);
              }
            }}
            // Long press starts selection with this document, like the reference app
            onLongPress={() => {
              longPressAtRef.current = Date.now();
              if (selectMode) {
                toggleSelected(item.id);
              } else {
                setSelectMode(true);
                setSelected([item.id]);
              }
            }}
          />
        )}
        columnWrapperStyle={viewMode === 'grid' ? styles.gridRow : undefined}
        contentContainerStyle={styles.listContent}
        ListFooterComponent={<AdBanner placement="files_banner" />}
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

      {selectMode ? (
        <DocSelectionBar
          docs={chosenDocs}
          onDone={() => {
            exitSelect();
            loadAll();
          }}
        />
      ) : (
        <ScanFab />
      )}

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
      <Modal visible={moveIds !== null} transparent animationType="fade" onRequestClose={() => setMoveIds(null)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, maxHeight: 420 }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('moveToFolder')}</Text>
            <ScrollView style={styles.moveList}>
              {[{ id: null as string | null, name: t('noFolderRoot') }, ...folders].map((f) => {
                const current = moveIds?.length === 1 && documents.find((d) => d.id === moveIds[0])?.folder_id === f.id;
                return (
                  <TouchableOpacity
                    key={f.id ?? 'root'}
                    style={[styles.moveRow, current && { backgroundColor: colors.primaryLight }]}
                    onPress={async () => {
                      for (const id of moveIds ?? []) await moveToFolder(id, f.id);
                      setMoveIds(null);
                      if (selectMode) exitSelect();
                    }}
                  >
                    <Ionicons name={f.id ? 'folder' : 'folder-outline'} size={20} color={colors.primary} />
                    <Text style={[styles.moveName, { color: colors.text }]}>{f.name}</Text>
                    {current && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <ActionButton title={t('cancel')} variant="outline" onPress={() => setMoveIds(null)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  tagRow: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  tagChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 32, borderRadius: 16 },
  tagText: { fontSize: 13, fontWeight: '600' },
  selectTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 12,
  },
  selectAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  selectAllText: {
    fontSize: 15,
    fontWeight: '600',
  },
  selectBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  selectAction: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  selectActionText: {
    fontSize: 12,
    fontWeight: '500',
  },
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
  toolBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
  },
  toolBannerText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
