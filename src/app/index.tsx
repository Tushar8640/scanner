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
import { lightColors } from '@/core/theme/colors';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
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
  } = useDocumentStore();
  const { t } = useSettingsStore();

  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [folderModalVisible, setFolderModalVisible] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

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

  const handleShare = async (doc: any) => {
    if (!doc.pdf_path) {
      Alert.alert('Info', 'PDF file has not been generated yet');
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

  const handleOpenRename = (doc: any) => {
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

  const sortOptions: { label: string; value: SortOption }[] = [
    { label: t('sortNewest'), value: 'newest' },
    { label: t('sortOldest'), value: 'oldest' },
    { label: t('sortNameAsc'), value: 'nameAsc' },
    { label: t('sortNameDesc'), value: 'nameDesc' },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleContainer}>
          <Ionicons name="scan-outline" size={24} color={lightColors.primary} />
          <Text style={styles.headerTitle}>{t('appName')}</Text>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => setSortModalVisible(true)}
          >
            <Ionicons name="swap-vertical" size={22} color={lightColors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => router.push('/trash')}
          >
            <Ionicons name="trash-outline" size={22} color={lightColors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => router.push('/settings')}
          >
            <Ionicons name="settings-outline" size={22} color={lightColors.text} />
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
          />
        )}
        contentContainerStyle={[
          styles.listContent,
          documents.length === 0 && styles.emptyListContent,
        ]}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={loadAll} />
        }
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconBg}>
                <Ionicons name="documents-outline" size={48} color={lightColors.primary} />
              </View>
              <Text style={styles.emptyTitle}>{t('noDocuments')}</Text>
              <Text style={styles.emptyDesc}>{t('noDocumentsDesc')}</Text>
            </View>
          ) : undefined
        }
      />

      {/* Bottom Floating Action Buttons */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity
          style={styles.galleryButton}
          onPress={handleGalleryImport}
          disabled={isProcessing}
        >
          <Ionicons name="images-outline" size={20} color={lightColors.primary} />
          <Text style={styles.galleryButtonText} numberOfLines={1}>{t('importGallery')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.scanButton}
          onPress={handleCameraScan}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <Ionicons name="camera" size={20} color="#FFFFFF" />
              <Text style={styles.scanButtonText} numberOfLines={1}>{t('scan')}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Create Folder Modal */}
      <Modal visible={folderModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('createFolder')}</Text>
            <TextInput
              style={styles.modalInput}
              value={newFolderName}
              onChangeText={setNewFolderName}
              placeholder="Enter folder name..."
              placeholderTextColor={lightColors.textMuted}
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
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('rename')}</Text>
            <TextInput
              style={styles.modalInput}
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

      {/* Sort Options Modal */}
      <Modal visible={sortModalVisible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSortModalVisible(false)}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('sortBy')}</Text>
            {sortOptions.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.sortOptionItem,
                  sortBy === opt.value && styles.activeSortOption,
                ]}
                onPress={() => {
                  setSortBy(opt.value);
                  setSortModalVisible(false);
                }}
              >
                <Text
                  style={[
                    styles.sortOptionText,
                    sortBy === opt.value && styles.activeSortText,
                  ]}
                >
                  {opt.label}
                </Text>
                {sortBy === opt.value && (
                  <Ionicons name="checkmark" size={20} color={lightColors.primary} />
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
    backgroundColor: lightColors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: lightColors.text,
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
    backgroundColor: lightColors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: lightColors.text,
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 14,
    color: lightColors.textSecondary,
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
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopWidth: 1,
    borderTopColor: lightColors.border,
    gap: 12,
  },
  galleryButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: lightColors.primaryLight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 6,
  },
  galleryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: lightColors.primary,
  },
  scanButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: lightColors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 6,
    shadowColor: lightColors.primary,
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
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: lightColors.text,
    marginBottom: 16,
  },
  modalInput: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: lightColors.borderStrong,
    paddingHorizontal: 12,
    fontSize: 15,
    color: lightColors.text,
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
    borderBottomColor: lightColors.border,
  },
  activeSortOption: {
    backgroundColor: lightColors.primaryLight,
    marginHorizontal: -12,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  sortOptionText: {
    fontSize: 15,
    color: lightColors.text,
  },
  activeSortText: {
    color: lightColors.primary,
    fontWeight: '600',
  },
});
