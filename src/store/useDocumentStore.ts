import { create } from 'zustand';
import { Document, Folder, Page, PageAdjust, PageFilter, PageRotation } from '@/core/types';
import { DatabaseService } from '@/services/database/DatabaseService';
import { StorageService } from '@/services/storage/StorageService';
import { ImageService } from '@/services/image/ImageService';
import { OcrService } from '@/services/ocr/OcrService';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useSettingsStore } from './useSettingsStore';
import { formatDocumentName } from '@/core/utils/docName';
import { GalleryService } from '@/services/storage/GalleryService';
import * as FileSystem from 'expo-file-system/legacy';

type Corners = { x: number; y: number }[];

/** One page from the editor, ready to be stored. */
export interface EditedPageInput {
  originalUri: string;
  previewUri?: string;
  /** Uncropped capture and the crop on it, kept so the page can be re-cropped later. */
  sourceUri?: string;
  corners?: Corners | null;
  rotation?: PageRotation;
  filter?: PageFilter;
  adjust?: PageAdjust | null;
  /** OCR text to keep when the page image did not change. */
  ocrText?: string | null;
}

/** Copies a page's files into the document folder and returns its database row. */
async function storePage(docId: string, pageId: string, position: number, img: EditedPageInput, fallbackFilter: PageFilter): Promise<Page> {
  const origPath = await StorageService.saveOriginalImage(docId, pageId, img.originalUri);
  const filter = img.filter || fallbackFilter;
  const transformed = await ImageService.transformPage(origPath, 0, filter, 'medium');
  const procPath = await StorageService.saveProcessedImage(docId, pageId, transformed);
  let sourcePath: string | null = null;
  if (img.sourceUri && img.sourceUri !== img.originalUri) {
    sourcePath = await StorageService.saveSourceImage(docId, pageId, img.sourceUri);
  } else if (img.sourceUri) {
    sourcePath = origPath;
  }
  return {
    id: pageId,
    document_id: docId,
    position,
    original_path: origPath,
    processed_path: procPath,
    filter,
    adjust: img.adjust ?? null,
    source_path: sourcePath,
    corners: sourcePath && sourcePath !== origPath ? img.corners ?? null : null,
    rotation: img.rotation || 0,
    ocr_text: img.ocrText ?? null,
  };
}

export type SortOption = 'newest' | 'oldest' | 'nameAsc' | 'nameDesc';

interface DocumentState {
  documents: Document[];
  folders: Folder[];
  trashDocuments: Document[];
  activeFolderId: string | null;
  searchQuery: string;
  sortBy: SortOption;
  isLoading: boolean;
  pendingScanImages: { uri: string; cropped?: boolean }[];
  /** Pages shot from the review screen's Add page; the open review screen appends and clears them. */
  reviewAppendImages: { uri: string; cropped?: boolean }[];

  setPendingScanImages: (images: { uri: string; cropped?: boolean }[]) => void;
  setReviewAppendImages: (images: { uri: string; cropped?: boolean }[]) => void;
  setSearchQuery: (query: string) => void;
  setSortBy: (sort: SortOption) => void;
  setActiveFolderId: (folderId: string | null) => void;

  loadAll: () => Promise<void>;
  loadTrash: () => Promise<void>;
  
  createDocument: (
    title: string | null,
    images: (
      | { uri: string }
      | EditedPageInput
    )[],
    folderId?: string | null,
    filter?: PageFilter
  ) => Promise<Document>;

  /** Appends edited pages to an existing document (the "Add" card on the document screen). */
  addPages: (
    documentId: string,
    images: EditedPageInput[]
  ) => Promise<void>;
  /**
   * Replaces a saved page's image, e.g. after markup, signature or watermark. Returns the updated page.
   * Pass `baked: true` when the new image already has the page's filter and rotation applied; the page
   * is then reset to the original filter and no rotation so they are not applied twice.
   */
  replacePageImage: (page: Page, newImageUri: string, options?: { baked?: boolean }) => Promise<Page>;
  /** Saves a re-edited document: its pages are replaced by the edited list, in order. */
  replaceDocumentPages: (documentId: string, title: string | null, images: EditedPageInput[]) => Promise<void>;

  /** Creates a new document from the pages of several documents, in the given order. Originals are kept. */
  mergeDocuments: (documentIds: string[], title: string) => Promise<Document>;

  updateTitle: (id: string, title: string) => Promise<void>;
  moveToFolder: (documentId: string, folderId: string | null) => Promise<void>;
  softDelete: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
  permanentDelete: (id: string) => Promise<void>;

  createFolder: (name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
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
  reviewAppendImages: [],

  setPendingScanImages: (pendingScanImages) => set({ pendingScanImages }),
  setReviewAppendImages: (reviewAppendImages) => set({ reviewAppendImages }),

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
    const finalTitle =
      title && title.trim().length > 0 ? title.trim() : formatDocumentName(useSettingsStore.getState().doc_name_format);
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
      let sourcePath: string | null = null;
      if (img.sourceUri && img.sourceUri !== origSource) sourcePath = await StorageService.saveSourceImage(docId, pageId, img.sourceUri);
      else if (img.sourceUri) sourcePath = origPath;

      let procPath: string;
      if (img.previewUri && img.previewUri !== origSource) {
        // Already processed and approved on review screen
        procPath = await StorageService.saveProcessedImage(docId, pageId, procSource);
      } else {
        // Generate transformed/filtered page (FR-10)
        // Rotation stays as page data (applied once by the viewer and the PDF export), so it is not baked in here
        const transformed = await ImageService.transformPage(origPath, 0, pageFilter, 'medium');
        procPath = await StorageService.saveProcessedImage(docId, pageId, transformed);
      }

      pages.push({
        id: pageId,
        document_id: docId,
        position: i,
        original_path: origPath,
        processed_path: procPath,
        filter: pageFilter,
        adjust: img.adjust ?? null,
        source_path: sourcePath,
        corners: sourcePath && sourcePath !== origPath ? img.corners ?? null : null,
        rotation: pageRotation,
        ocr_text: null,
      });
    }

    // Generate thumbnail from first page
    const thumbUri = await ImageService.generateThumbnail(pages[0].processed_path, pages[0].rotation);
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

    // Settings > Scan > Auto-save to Gallery
    if (useSettingsStore.getState().auto_save_to_gallery && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient) {
      GalleryService.saveImages(pages.map((p) => p.processed_path || p.original_path).filter(Boolean)).catch((e) =>
        console.warn('Auto-save to gallery failed:', e)
      );
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

  addPages: async (documentId, images) => {
    if (images.length === 0) return;
    const existing = await DatabaseService.getPagesByDocumentId(documentId);
    const start = existing.length;
    const added: Page[] = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const pageId = `page_${start + i + 1}_${Math.random().toString(36).substring(2, 6)}`;
      added.push(await storePage(documentId, pageId, start + i, img, 'magic'));
    }
    await DatabaseService.insertPages(added);
    // The old PDF no longer matches the pages
    await DatabaseService.updateDocument(documentId, {
      page_count: start + added.length,
      pdf_path: null,
      updated_at: Date.now(),
    });
    set({ pendingScanImages: [] });
    await get().loadAll();
  },

  replaceDocumentPages: async (documentId, title, images) => {
    if (images.length === 0) throw new Error('At least one page is required');
    const old = await DatabaseService.getPagesByDocumentId(documentId);
    const stamp = Date.now().toString(36);
    const next: Page[] = [];
    for (let i = 0; i < images.length; i++) {
      // New file names, so cached images of the old version are not shown
      next.push(await storePage(documentId, `page_${i + 1}_${stamp}_${Math.random().toString(36).slice(2, 6)}`, i, images[i], 'magic'));
    }
    for (const p of old) await DatabaseService.deletePage(p.id);
    await DatabaseService.insertPages(next);
    // Remove files that no page uses any more
    const keep = new Set(next.flatMap((p) => [p.original_path, p.processed_path, p.source_path].filter(Boolean) as string[]));
    for (const p of old) {
      for (const f of [p.original_path, p.processed_path, p.source_path]) {
        if (f && !keep.has(f)) await FileSystem.deleteAsync(f, { idempotent: true }).catch(() => undefined);
      }
    }
    const thumb = await ImageService.generateThumbnail(next[0].processed_path, next[0].rotation);
    const docUpdates: Partial<Document> = {
      page_count: next.length,
      pdf_path: null,
      updated_at: Date.now(),
      thumbnail_path: await StorageService.saveThumbnail(documentId, thumb),
    };
    if (title && title.trim()) docUpdates.title = title.trim();
    await DatabaseService.updateDocument(documentId, docUpdates);
    set({ pendingScanImages: [] });
    await get().loadAll();
  },

  replacePageImage: async (page, newImageUri, options) => {
    // New file names, so cached images of the old version are not shown
    const name = `${page.id}_${Date.now()}`;
    const origPath = await StorageService.saveOriginalImage(page.document_id, name, newImageUri);
    const transformed = await ImageService.transformPage(origPath, 0, page.filter, 'medium');
    const procPath = await StorageService.saveProcessedImage(page.document_id, name, transformed);
    const pageUpdates: Partial<Page> = { original_path: origPath, processed_path: procPath };
    // The marked-up image replaces the crop, so there is nothing to re-crop from any more
    pageUpdates.source_path = null;
    pageUpdates.corners = null;
    if (options?.baked) {
      pageUpdates.filter = 'original';
      pageUpdates.adjust = null;
      pageUpdates.rotation = 0;
    }
    await DatabaseService.updatePage(page.id, pageUpdates);
    const updated: Page = { ...page, ...pageUpdates };

    const docUpdates: Partial<Document> = { pdf_path: null, updated_at: Date.now() };
    if (page.position === 0) {
      const thumb = await ImageService.generateThumbnail(procPath, updated.rotation);
      docUpdates.thumbnail_path = await StorageService.saveThumbnail(page.document_id, thumb);
    }
    await DatabaseService.updateDocument(page.document_id, docUpdates);
    await get().loadAll();
    return updated;
  },

  mergeDocuments: async (documentIds, title) => {
    const images: EditedPageInput[] = [];
    let folderId: string | null = null;
    for (let i = 0; i < documentIds.length; i++) {
      const doc = await DatabaseService.getDocumentById(documentIds[i]);
      if (i === 0) folderId = doc?.folder_id ?? null;
      const pages = await DatabaseService.getPagesByDocumentId(documentIds[i]);
      for (const p of pages) {
        images.push({
          originalUri: p.original_path,
          previewUri: p.original_path,
          rotation: p.rotation,
          filter: p.filter,
          adjust: p.adjust,
          // Keep the uncropped photo so merged pages can still be re-cropped from it
          sourceUri: p.source_path || undefined,
          corners: p.corners ?? null,
        });
      }
    }
    if (images.length === 0) throw new Error('The selected documents have no pages');
    return get().createDocument(title, images, folderId);
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
