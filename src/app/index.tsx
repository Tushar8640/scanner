import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useDocumentStore, SortOption } from '@/store/useDocumentStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { scannerService } from '@/services/scanner/ScannerService';
import { PdfService } from '@/services/pdf/PdfService';
import { DocumentCard } from '@/ui/components/DocumentCard';
import { FolderTabs } from '@/ui/components/FolderTabs';
import { SearchBar } from '@/ui/components/SearchBar';
import { ActionButton } from '@/ui/components/ActionButton';
import { ActionSheet, ActionSheetItem } from '@/ui/components/ActionSheet';
import { useThemeColors } from '@/core/theme/colors';
import { Document, Folder } from '@/core/types';

type ViewMode = 'list' | 'grid';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const {
    documents,
    folders,
    activeFolderId,
    searchQuery,
    sortBy,
    isLoading,
    setPendingScanImages,
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

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [searchVisible, setSearchVisible] = useState(false);
  const [sortSheetVisible, setSortSheetVisible] = useState(false);
  const [menuSheetVisible, setMenuSheetVisible] = useState(false);
  const [docSheetTarget, setDocSheetTarget] = useState<Document | null>(null);
  const [folderModalVisible, setFolderModalVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [moveModalVisible, setMoveModalVisible] = useState(false);
  const [targetDoc, setTargetDoc] = useState<Document | null>(null);

  // Scan with camera
  const handleCameraScan = async () => {
    try {
      setIsProcessing(true);
      const result = await scannerService.scanWithCamera({ maxNumDocuments: 50 });
      setIsProcessing(false);
      if (result && result.pages.length > 0) {
        setPendingScanImages(result.pages);
        router.push('/scan-review');
      }
    } catch (error: any) {
      setIsProcessing(false);
      Alert.alert(t('error'), error.message || 'Failed to scan document');
    }
  };

  // Import from gallery
  const handleGalleryImport = async () => {
    try {
      setIsProcessing(true);
      const result = await scannerService.importFromGallery({ allowsMultiple: true });
      setIsProcessing(false);
      if (result && result.pages.length > 0) {
        setPendingScanImages(result.pages);
        router.push('/scan-review');
      }
    } catch (error: any) {
      setIsProcessing(false);
      Alert.alert(t('error'), error.message || 'Failed to import from gallery');
    }
  };

  const handleShare = async (doc: Document) => {
    if (!doc.pdf_path) {
      // The PDF is generated on the document screen; open it there
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

  const handleOpenRename = (doc: Document) => {
    setEditingDocId(doc.id);
    setEditingTitle(doc.title);
    setRenameModalVisible(true);
  };

  const handleSaveRename = async () => {
    if (editingDocId && editingTitle.trim().length > 0) {
      await updateTitle(editingDocId, editingTitle.trim());
      setRenameModalVisible(false);
      setEditingDocId(null);
    }
  };

  const handleCreateFolder = async () => {
    if (newFolderName.trim().length > 0) {
      await createFolder(newFolderName.trim());
      setNewFolderName('');
      setFolderModalVisible(false);
    }
  };

  const handleLongPressFolder = (folder: Folder) => {
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

  const handleSelectTargetFolder = async (folderId: string | null) => {
    if (targetDoc) {
      await moveToFolder(targetDoc.id, folderId);
      setMoveModalVisible(false);
      setTargetDoc(null);
    }
  };

  const sortOptions: { label: string; value: SortOption }[] = [
    { label: t('sortNewest'), value: 'newest' },
    { label: t('sortOldest'), value: 'oldest' },
    { label: t('sortNameAsc'), value: 'nameAsc' },
    { label: t('sortNameDesc'), value: 'nameDesc' },
  ];

  const sortItems: ActionSheetItem[] = sortOptions.map((opt) => ({
    key: opt.value,
    label: opt.label,
    icon: 'swap-vertical',
    selected: sortBy === opt.value,
    onPress: () => setSortBy(opt.value),
  }));

  const menuItems: ActionSheetItem[] = [
    { key: 'sort', label: t('sortBy'), icon: 'swap-vertical', onPress: () => setSortSheetVisible(true) },
    { key: 'folder', label: t('createFolder'), icon: 'folder-open-outline', onPress: () => setFolderModalVisible(true) },
    { key: 'trash', label: t('trash'), icon: 'trash-outline', onPress: () => router.push('/trash') },
    { key: 'settings', label: t('settings'), icon: 'settings-outline', onPress: () => router.push('/settings') },
  ];

  const docItems: ActionSheetItem[] = docSheetTarget
    ? [
        { key: 'share', label: t('share'), icon: 'share-social-outline', onPress: () => handleShare(docSheetTarget) },
        { key: 'rename', label: t('rename'), icon: 'create-outline', onPress: () => handleOpenRename(docSheetTarget) },
        {
          key: 'move',
          label: t('moveToFolder'),
          icon: 'folder-outline',
          onPress: () => {
            setTargetDoc(docSheetTarget);
            setMoveModalVisible(true);
          },
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

  const quickTools: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; tint: string; onPress: () => void }[] = [
    { key: 'scan', label: t('smartScan'), icon: 'scan', tint: colors.primary, onPress: handleCameraScan },
    { key: 'import', label: t('importImages'), icon: 'images', tint: '#F59E0B', onPress: handleGalleryImport },
    { key: 'folder', label: t('createFolder'), icon: 'folder-open', tint: '#3B82F6', onPress: () => setFolderModalVisible(true) },
    { key: 'trash', label: t('trash'), icon: 'trash', tint: '#EF4444', onPress: () => router.push('/trash') },
  ];

  const showSearch = searchVisible || searchQuery.length > 0;

  const listHeader = (
    <View>
      {/* Quick tools */}
      <View style={[styles.toolsCard, { backgroundColor: colors.surface }]}>
        {quickTools.map((tool) => (
          <TouchableOpacity key={tool.key} style={styles.toolItem} onPress={tool.onPress} disabled={isProcessing}>
            <View style={[styles.toolIcon, { backgroundColor: `${tool.tint}1A` }]}>
              <Ionicons name={tool.icon} size={24} color={tool.tint} />
            </View>
            <Text style={[styles.toolLabel, { color: colors.text }]} numberOfLines={1}>
              {tool.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FolderTabs
        folders={folders}
        activeFolderId={activeFolderId}
        onSelectFolder={setActiveFolderId}
        onAddFolder={() => setFolderModalVisible(true)}
        onLongPressFolder={handleLongPressFolder}
        allLabel={t('allDocuments')}
      />

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {t('recentDocuments')} <Text style={{ color: colors.textSecondary }}>({documents.length})</Text>
        </Text>
        <TouchableOpacity onPress={() => setSortSheetVisible(true)} style={styles.sortLink}>
          <Ionicons name="swap-vertical" size={16} color={colors.textSecondary} />
          <Text style={[styles.sortLinkText, { color: colors.textSecondary }]}>
            {sortOptions.find((o) => o.value === sortBy)?.label}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('appName')}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => {
              if (showSearch) {
                setSearchQuery('');
                setSearchVisible(false);
              } else {
                setSearchVisible(true);
              }
            }}
            accessibilityLabel={t('search')}
          >
            <Ionicons name={showSearch ? 'close' : 'search'} size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
            accessibilityLabel="Toggle view"
          >
            <Ionicons name={viewMode === 'list' ? 'grid-outline' : 'list-outline'} size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={() => setMenuSheetVisible(true)} accessibilityLabel="More">
            <Ionicons name="ellipsis-vertical" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {showSearch && <SearchBar value={searchQuery} onChangeText={setSearchQuery} placeholder={t('search')} />}

      {/* Documents */}
      <FlatList
        key={viewMode}
        data={documents}
        numColumns={viewMode === 'grid' ? 3 : 1}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={listHeader}
        renderItem={({ item }) => (
          <DocumentCard
            document={item}
            variant={viewMode}
            onPress={() => router.push(`/document/${item.id}`)}
            onMore={() => setDocSheetTarget(item)}
          />
        )}
        ItemSeparatorComponent={
          viewMode === 'list'
            ? () => <View style={[styles.separator, { backgroundColor: colors.border }]} />
            : undefined
        }
        columnWrapperStyle={viewMode === 'grid' ? styles.gridRow : undefined}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={loadAll} tintColor={colors.primary} />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconBg, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="document-text-outline" size={44} color={colors.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('noDocuments')}</Text>
              <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>{t('noDocumentsDesc')}</Text>
            </View>
          ) : undefined
        }
      />

      {/* Bottom navigation with raised camera button */}
      <View
        style={[
          styles.bottomNav,
          { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 8) },
        ]}
      >
        <NavItem icon="home" label={t('home')} active color={colors.primary} onPress={() => setActiveFolderId(null)} />
        <NavItem icon="images-outline" label={t('importShort')} color={colors.textSecondary} onPress={handleGalleryImport} />
        <View style={styles.fabSlot}>
          <TouchableOpacity
            style={[styles.fab, { backgroundColor: colors.primary, borderColor: colors.surface }]}
            onPress={handleCameraScan}
            disabled={isProcessing}
            accessibilityLabel={t('scan')}
          >
            {isProcessing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Ionicons name="camera" size={30} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        </View>
        <NavItem icon="trash-outline" label={t('trash')} color={colors.textSecondary} onPress={() => router.push('/trash')} />
        <NavItem
          icon="settings-outline"
          label={t('settings')}
          color={colors.textSecondary}
          onPress={() => router.push('/settings')}
        />
      </View>

      <ActionSheet visible={menuSheetVisible} items={menuItems} onClose={() => setMenuSheetVisible(false)} />
      <ActionSheet
        visible={sortSheetVisible}
        title={t('sortBy')}
        items={sortItems}
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
              style={[
                styles.modalInput,
                { color: colors.text, borderColor: colors.borderStrong, backgroundColor: colors.surfaceVariant },
              ]}
              value={newFolderName}
              onChangeText={setNewFolderName}
              placeholder={t('folderNamePlaceholder')}
              placeholderTextColor={colors.textMuted}
              autoFocus
            />
            <View style={styles.modalActions}>
              <ActionButton
                title={t('cancel')}
                variant="outline"
                onPress={() => setFolderModalVisible(false)}
                style={styles.modalActionBtn}
              />
              <ActionButton title={t('save')} onPress={handleCreateFolder} style={styles.modalActionBtn} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Rename document */}
      <Modal visible={renameModalVisible} transparent animationType="fade" onRequestClose={() => setRenameModalVisible(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('rename')}</Text>
            <TextInput
              style={[
                styles.modalInput,
                { color: colors.text, borderColor: colors.borderStrong, backgroundColor: colors.surfaceVariant },
              ]}
              value={editingTitle}
              onChangeText={setEditingTitle}
              autoFocus
            />
            <View style={styles.modalActions}>
              <ActionButton
                title={t('cancel')}
                variant="outline"
                onPress={() => setRenameModalVisible(false)}
                style={styles.modalActionBtn}
              />
              <ActionButton title={t('save')} onPress={handleSaveRename} style={styles.modalActionBtn} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Move to folder */}
      <Modal visible={moveModalVisible} transparent animationType="fade" onRequestClose={() => setMoveModalVisible(false)}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, maxHeight: 420 }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('moveToFolder')}</Text>
            <ScrollView style={styles.folderList}>
              {[{ id: null as string | null, name: t('noFolderRoot') }, ...folders].map((f) => {
                const selected = targetDoc?.folder_id === f.id;
                return (
                  <TouchableOpacity
                    key={f.id ?? 'root'}
                    style={[styles.folderOptionItem, selected && { backgroundColor: colors.primaryLight }]}
                    onPress={() => handleSelectTargetFolder(f.id)}
                  >
                    <Ionicons name={f.id ? 'folder' : 'folder-outline'} size={20} color={colors.primary} />
                    <Text style={[styles.folderOptionText, { color: colors.text }]}>{f.name}</Text>
                    {selected && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <ActionButton
              title={t('cancel')}
              variant="outline"
              onPress={() => {
                setMoveModalVisible(false);
                setTargetDoc(null);
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const NavItem: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  active?: boolean;
  onPress: () => void;
}> = ({ icon, label, color, active, onPress }) => (
  <TouchableOpacity style={styles.navItem} onPress={onPress}>
    <Ionicons name={icon} size={22} color={color} />
    <Text style={[styles.navLabel, { color, fontWeight: active ? '700' : '500' }]} numberOfLines={1}>
      {label}
    </Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolsCard: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 4,
    paddingVertical: 14,
    borderRadius: 14,
  },
  toolItem: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  toolIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  sortLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sortLinkText: {
    fontSize: 12,
  },
  listContent: {
    paddingBottom: 120,
  },
  gridRow: {
    paddingHorizontal: 10,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 88,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 48,
  },
  emptyIconBg: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
  },
  emptyDesc: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  bottomNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  navLabel: {
    fontSize: 11,
  },
  fabSlot: {
    flex: 1,
    alignItems: 'center',
  },
  fab: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginTop: -30,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
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
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalActionBtn: {
    flex: 1,
    height: 44,
  },
  folderList: {
    marginBottom: 16,
  },
  folderOptionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  folderOptionText: {
    fontSize: 15,
    flex: 1,
  },
});
