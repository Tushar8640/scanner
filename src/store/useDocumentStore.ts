import { create } from 'zustand';
import { Document, Folder, Page, PageFilter, PageRotation } from '@/core/types';
import { DatabaseService } from '@/services/database/DatabaseService';
import { StorageService } from '@/services/storage/StorageService';
import { ImageService } from '@/services/image/ImageService';
import { OcrService } from '@/services/ocr/OcrService';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { useSettingsStore } from './useSettingsStore';

export type SortOption = 'newest' | 'oldest' | 'nameAsc' | 'nameDesc';

interface DocumentState {
  documents: Document[];
  folders: Folder[];
  trashDocuments: Document[];
  activeFolderId: string | null;
  searchQuery: string;
  sortBy: SortOption;
  isLoading: boolean;
  pendingScanImages: { uri: string }[];

  setPendingScanImages: (images: { uri: string }[]) => void;
  setSearchQuery: (query: string) => void;
  setSortBy: (sort: SortOption) => void;
  setActiveFolderId: (folderId: string | null) => void;

  loadAll: () => Promise<void>;
  loadTrash: () => Promise<void>;
  
  createDocument: (
    title: string | null,
    images: ({ uri: string } | { originalUri: string; previewUri: string; rotation?: PageRotation; filter?: PageFilter })[],
    folderId?: string | null,
    filter?: PageFilter
  ) => Promise<Document>;

  updateTitle: (id: string, title: string) => Promise<void>;
  moveToFolder: (documentId: string, folderId: string | null) => Promise<void>;
  softDelete: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
  permanentDelete: (id: string) => Promise<void>;

  createFolder: (name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
}

function generateDefaultTitle(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `Doc_${y}${m}${d}_${h}${min}`;
}

function sortDocuments(docs: Document[], sortBy: SortOption): Document[] {
  const list = [...docs];
  switch (sortBy) {
    case 'newest':
      return list.sort((a, b) => b.created_at - a.created_at);
    case 'oldest':
      return list.sort((a, b) => a.created_at - b.created_at);
    case 'nameAsc':
      return list.sort((a, b) => a.title.localeCompare(b.title));
    case 'nameDesc':
      return list.sort((a, b) => b.title.localeCompare(a.title));
    default:
      return list;
  }
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  folders: [],
  trashDocuments: [],
  activeFolderId: null,
  searchQuery: '',
  sortBy: 'newest',
  isLoading: false,
  pendingScanImages: [],

  setPendingScanImages: (pendingScanImages) => set({ pendingScanImages }),

  setSearchQuery: (searchQuery) => {
    set({ searchQuery });
    get().loadAll();
  },

  setSortBy: (sortBy) => {
    set({ sortBy, documents: sortDocuments(get().documents, sortBy) });
  },

  setActiveFolderId: (activeFolderId) => {
    set({ activeFolderId });
    get().loadAll();
  },

  loadAll: async () => {
    try {
      set({ isLoading: true });
      await StorageService.init();

      const { searchQuery, activeFolderId, sortBy } = get();
      const folders = await DatabaseService.getFolders();
      
      let docs: Document[] = [];
      if (searchQuery.trim().length > 0) {
        docs = await DatabaseService.searchDocuments(searchQuery);
      } else {
        docs = await DatabaseService.getDocuments(activeFolderId);
      }

      set({
        folders,
        documents: sortDocuments(docs, sortBy),
        isLoading: false,
      });
    } catch (e) {
      console.error('Error loading documents:', e);
      set({ isLoading: false });
    }
  },

  loadTrash: async () => {
    try {
      const trash = await DatabaseService.getDocuments(undefined, true);
      set({ trashDocuments: trash });
    } catch (e) {
      console.error('Error loading trash:', e);
    }
  },

  createDocument: async (title, images, folderId = null, filter = 'enhanced') => {
    if (images.length === 0) {
      throw new Error('At least one page is required to create a document');
    }

    const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const finalTitle = title && title.trim().length > 0 ? title.trim() : generateDefaultTitle();
    const now = Date.now();

    await StorageService.ensureDocumentDir(docId);

    const pages: Page[] = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i] as any;
      const pageId = `page_${i + 1}_${Math.random().toString(36).substring(2, 6)}`;
      const origSource = img.originalUri || img.uri;
      const procSource = img.previewUri || img.uri;
      const pageRotation = img.rotation || 0;
      const pageFilter = img.filter || filter;

      // Save original image to private storage (NFR-20)
      const origPath = await StorageService.saveOriginalImage(docId, pageId, origSource);

      let procPath: string;
      if (img.previewUri && img.previewUri !== origSource) {
        // Already processed and approved on review screen
        procPath = await StorageService.saveProcessedImage(docId, pageId, procSource);
      } else {
        // Generate transformed/filtered page (FR-10)
        const transformed = await ImageService.transformPage(origPath, pageRotation, pageFilter, 'medium');
        procPath = await StorageService.saveProcessedImage(docId, pageId, transformed);
      }

      pages.push({
        id: pageId,
        document_id: docId,
        position: i,
        original_path: origPath,
        processed_path: procPath,
        filter: pageFilter,
        intensity: img.intensity ?? 0.6,
        rotation: pageRotation,
        ocr_text: null,
      });
    }

    // Generate thumbnail from first page
    const thumbUri = await ImageService.generateThumbnail(pages[0].processed_path);
    const thumbPath = await StorageService.saveThumbnail(docId, thumbUri);

    // Initial document record
    const newDoc: Document = {
      id: docId,
      folder_id: folderId,
      title: finalTitle,
      page_count: pages.length,
      pdf_path: null,
      thumbnail_path: thumbPath,
      ocr_text: null,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };

    await DatabaseService.insertDocument(newDoc);
    await DatabaseService.insertPages(pages);

    // Auto-save to gallery if enabled in settings (Step 6)
    try {
      const autoSave = useSettingsStore.getState().auto_save_to_gallery;
      if (autoSave) {
        const { status } = await requestPermissionsAsync();
        if (status === 'granted') {
          for (const page of pages) {
            const savePath = page.processed_path || page.original_path;
            if (savePath) {
              await Asset.create(savePath);
            }
          }
        }
      }
    } catch (galleryErr) {
      console.warn('Auto-save to gallery warning:', galleryErr);
    }

    // Run OCR in background after saving so save isn't held up (Step 4)
    (async () => {
      try {
        const ocrTexts: string[] = [];
        for (const page of pages) {
          const text = await OcrService.recognizeText(page.processed_path || page.original_path);
          if (text) {
            ocrTexts.push(text);
            await DatabaseService.updatePage(page.id, { ocr_text: text });
          }
        }
        if (ocrTexts.length > 0) {
          const joinedText = ocrTexts.join('\n');
          await DatabaseService.updateDocument(docId, { ocr_text: joinedText });
          get().loadAll();
        }
      } catch (ocrErr) {
        console.warn('Background OCR error:', ocrErr);
      }
    })();

    // Clear pending scan images now that document is created
    set({ pendingScanImages: [] });

    // Refresh list
    await get().loadAll();
    return newDoc;
  },

  updateTitle: async (id, title) => {
    await DatabaseService.updateDocument(id, { title, updated_at: Date.now() });
    await get().loadAll();
  },

  moveToFolder: async (documentId, folderId) => {
    await DatabaseService.updateDocument(documentId, { folder_id: folderId, updated_at: Date.now() });
    await get().loadAll();
  },

  softDelete: async (id) => {
    await DatabaseService.softDeleteDocument(id);
    await get().loadAll();
    await get().loadTrash();
  },

  restore: async (id) => {
    await DatabaseService.restoreDocument(id);
    await get().loadAll();
    await get().loadTrash();
  },

  permanentDelete: async (id) => {
    await DatabaseService.permanentDeleteDocument(id);
    await StorageService.deleteDocumentDir(id);
    await get().loadTrash();
  },

  createFolder: async (name) => {
    const newFolder: Folder = {
      id: `folder_${Date.now()}`,
      name: name.trim(),
      parent_id: null,
      is_locked: 0,
      created_at: Date.now(),
    };
    await DatabaseService.createFolder(newFolder);
    await get().loadAll();
  },

  deleteFolder: async (id) => {
    await DatabaseService.deleteFolder(id);
    await get().loadAll();
  },
}));
