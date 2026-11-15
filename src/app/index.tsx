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
import { useThemeColors } from '@/core/theme/colors';
import { Document, Folder } from '@/core/types';

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

  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [folderModalVisible, setFolderModalVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Move to folder modal
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
      Alert.alert('Error', error.message || 'Failed to scan document');
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
      Alert.alert('Error', error.message || 'Failed to import from gallery');
    }
  };

  const handleShare = async (doc: Document) => {
    if (!doc.pdf_path) {
      Alert.alert('Info', 'PDF file has not been generated yet. Open the document to export PDF.');
      return;
    }
    try {
      await PdfService.shareFile(doc.pdf_path, 'application/pdf', doc.title);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to share file');
    }
  };

  const handleDelete = (docId: string) => {
    Alert.alert(
      t('deleteConfirmTitle'),
      t('deleteConfirmMsg'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'),
          style: 'destructive',
          onPress: async () => {
            await softDelete(docId);
          },
        },
      ]
    );
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
    Alert.alert(
      t('deleteFolder'),
      `"${folder.name}"? ${t('deleteFolderConfirm')}`,
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'),
          style: 'destructive',
          onPress: async () => {
            if (activeFolderId === folder.id) {
              setActiveFolderId(null);
            }
            await deleteFolder(folder.id);
          },
        },
      ]
    );
  };

  const handleOpenMoveToFolder = (doc: Document) => {
    setTargetDoc(doc);
    setMoveModalVisible(true);
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Top Header */}
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <View style={styles.headerTitleContainer}>
          <Ionicons name="scan-outline" size={24} color={colors.primary} />
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('appName')}</Text>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => setSortModalVisible(true)}
          >
            <Ionicons name="swap-vertical" size={22} color={colors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => router.push('/trash')}
          >
            <Ionicons name="trash-outline" size={22} color={colors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => router.push('/settings')}
          >
            <Ionicons name="settings-outline" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Bar */}
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder={t('search')}
      />

      {/* Folders Tabs */}
      <FolderTabs
        folders={folders}
        activeFolderId={activeFolderId}
        onSelectFolder={setActiveFolderId}
        onAddFolder={() => setFolderModalVisible(true)}
        onLongPressFolder={handleLongPressFolder}
        allLabel={t('allDocuments')}
      />

      {/* Document List */}
      <FlatList
        data={documents}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <DocumentCard
            document={item}
            onPress={() => router.push(`/document/${item.id}`)}
            onShare={() => handleShare(item)}
            onDelete={() => handleDelete(item.id)}
            onRename={() => handleOpenRename(item)}
            onMoveToFolder={() => handleOpenMoveToFolder(item)}
          />
        )}
        contentContainerStyle={[
          styles.listContent,
          documents.length === 0 && styles.emptyListContent,
        ]}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={loadAll} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconBg, { backgroundColor: colors.primaryLight }]}>
                <Ionicons name="documents-outline" size={48} color={colors.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('noDocuments')}</Text>
              <Text style={[styles.emptyDesc, { color: colors.textSecondary }]}>{t('noDocumentsDesc')}</Text>
            </View>
          ) : undefined
        }
      />

      {/* Bottom Floating Action Buttons */}
      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
      >
        <TouchableOpacity
          style={[styles.galleryButton, { backgroundColor: colors.primaryLight }]}
          onPress={handleGalleryImport}
          disabled={isProcessing}
        >
          <Ionicons name="images-outline" size={20} color={colors.primary} />
          <Text style={[styles.galleryButtonText, { color: colors.primary }]} numberOfLines={1}>
            {t('importGallery')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.scanButton, { backgroundColor: colors.primary }]}
          onPress={handleCameraScan}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <Ionicons name="camera" size={20} color={colors.primaryContrast} />
              <Text style={[styles.scanButtonText, { color: colors.primaryContrast }]} numberOfLines={1}>
                {t('scan')}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Create Folder Modal */}
      <Modal visible={folderModalVisible} transparent animationType="fade">
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
              placeholder="Enter folder name..."
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
              <ActionButton
                title={t('save')}
                onPress={handleCreateFolder}
                style={styles.modalActionBtn}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Rename Document Modal */}
      <Modal visible={renameModalVisible} transparent animationType="fade">
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
              <ActionButton
                title={t('save')}
                onPress={handleSaveRename}
                style={styles.modalActionBtn}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Move to Folder Modal */}
      <Modal visible={moveModalVisible} transparent animationType="fade">
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, maxHeight: 400 }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('moveToFolder')}</Text>
            <ScrollView style={{ marginBottom: 16 }}>
              <TouchableOpacity
                style={[
                  styles.folderOptionItem,
                  targetDoc?.folder_id === null && { backgroundColor: colors.primaryLight },
                  { borderBottomColor: colors.border },
                ]}
                onPress={() => handleSelectTargetFolder(null)}
              >
                <Ionicons name="folder-outline" size={20} color={colors.primary} />
                <Text style={[styles.folderOptionText, { color: colors.text }]}>{t('noFolderRoot')}</Text>
                {targetDoc?.folder_id === null && (
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
              {folders.map((f) => (
                <TouchableOpacity
                  key={f.id}
                  style={[
                    styles.folderOptionItem,
                    targetDoc?.folder_id === f.id && { backgroundColor: colors.primaryLight },
                    { borderBottomColor: colors.border },
                  ]}
                  onPress={() => handleSelectTargetFolder(f.id)}
                >
                  <Ionicons name="folder" size={20} color={colors.primary} />
                  <Text style={[styles.folderOptionText, { color: colors.text }]}>{f.name}</Text>
                  {targetDoc?.folder_id === f.id && (
                    <Ionicons name="checkmark" size={20} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
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

      {/* Sort Options Modal */}
      <Modal visible={sortModalVisible} transparent animationType="fade">
        <TouchableOpacity
          style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
          activeOpacity={1}
          onPress={() => setSortModalVisible(false)}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('sortBy')}</Text>
            {sortOptions.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.sortOptionItem,
                  sortBy === opt.value && { backgroundColor: colors.primaryLight },
                  { borderBottomColor: colors.border },
                ]}
                onPress={() => {
                  setSortBy(opt.value);
                  setSortModalVisible(false);
                }}
              >
                <Text
                  style={[
                    styles.sortOptionText,
                    { color: colors.text },
                    sortBy === opt.value && { color: colors.primary, fontWeight: '600' },
                  ]}
                >
                  {opt.label}
                </Text>
                {sortBy === opt.value && (
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingBottom: 110,
    paddingTop: 8,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyIconBg: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 12,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    gap: 12,
  },
  galleryButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 6,
  },
  galleryButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  scanButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 6,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  scanButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
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
  sortOptionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  sortOptionText: {
    fontSize: 15,
  },
  folderOptionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderRadius: 8,
  },
  folderOptionText: {
    fontSize: 15,
    flex: 1,
  },
});
