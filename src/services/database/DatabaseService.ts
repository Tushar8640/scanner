import * as SQLite from 'expo-sqlite';
import { Document, Folder, Page } from '@/core/types';
import { isDefaultAdjust, normaliseAdjust } from '@/services/image/FilterUtils';

/** Reads crop corners stored as JSON; anything malformed counts as "no crop". */
function parseCorners(value: unknown): { x: number; y: number }[] | null {
  if (!value) return null;
  try {
    const v = typeof value === 'string' ? JSON.parse(value) : value;
    if (Array.isArray(v) && v.length === 4 && v.every((p) => typeof p?.x === 'number' && typeof p?.y === 'number')) return v;
  } catch {
    // ignore
  }
  return null;
}

export class DatabaseService {
  private static db: SQLite.SQLiteDatabase | null = null;

  static async getDb(): Promise<SQLite.SQLiteDatabase> {
    if (!this.db) {
      this.db = await SQLite.openDatabaseAsync('scanner.db');
      await this.initSchema(this.db);
    }
    return this.db;
  }

  private static async initSchema(db: SQLite.SQLiteDatabase): Promise<void> {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id TEXT NULL,
        is_locked INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        folder_id TEXT NULL,
        title TEXT NOT NULL,
        page_count INTEGER NOT NULL DEFAULT 0,
        pdf_path TEXT NULL,
        thumbnail_path TEXT NOT NULL,
        ocr_text TEXT NULL,
        deleted_at INTEGER NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        original_path TEXT NOT NULL,
        processed_path TEXT NOT NULL,
        filter TEXT DEFAULT 'magic',
        intensity REAL DEFAULT 0.6,
        adjust TEXT NULL,
        source_path TEXT NULL,
        corners TEXT NULL,
        rotation INTEGER CHECK(rotation IN (0, 90, 180, 270)) DEFAULT 0,
        ocr_text TEXT NULL,
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_docs_deleted ON documents(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_docs_folder ON documents(folder_id);
      CREATE INDEX IF NOT EXISTS idx_pages_doc ON pages(document_id, position);

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Migration for intensity column if table was previously created
    try {
      await db.execAsync('ALTER TABLE pages ADD COLUMN intensity REAL DEFAULT 0.6;');
    } catch {
      // column already exists
    }
    try {
      await db.execAsync('ALTER TABLE pages ADD COLUMN adjust TEXT NULL;');
    } catch {
      // column already exists
    }
    for (const col of ['source_path', 'corners']) {
      try {
        await db.execAsync(`ALTER TABLE pages ADD COLUMN ${col} TEXT NULL;`);
      } catch {
        // column already exists
      }
    }
    await this.dropPageFilterCheck(db);
  }

  /**
   * Older installs created pages with CHECK(filter IN (...)) listing only five filters, which
   * rejects newer ones (lighten, noshadow, eco, invert). SQLite cannot drop a constraint, so the
   * table is rebuilt once, keeping every row.
   */
  private static async dropPageFilterCheck(db: SQLite.SQLiteDatabase): Promise<void> {
    const row = await db.getFirstAsync<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pages'");
    if (!row?.sql || !/CHECK\s*\(\s*filter\s+IN/i.test(row.sql)) return;
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE pages_new (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          original_path TEXT NOT NULL,
          processed_path TEXT NOT NULL,
          filter TEXT DEFAULT 'magic',
          intensity REAL DEFAULT 0.6,
          adjust TEXT NULL,
          source_path TEXT NULL,
          corners TEXT NULL,
          rotation INTEGER CHECK(rotation IN (0, 90, 180, 270)) DEFAULT 0,
          ocr_text TEXT NULL,
          FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
        );
        INSERT INTO pages_new (id, document_id, position, original_path, processed_path, filter, intensity, adjust, source_path, corners, rotation, ocr_text)
          SELECT id, document_id, position, original_path, processed_path, filter, intensity, adjust, source_path, corners, rotation, ocr_text FROM pages;
        DROP TABLE pages;
        ALTER TABLE pages_new RENAME TO pages;
        CREATE INDEX IF NOT EXISTS idx_pages_doc ON pages(document_id, position);
      `);
    });
  }

  // Whitelist of valid column names to prevent SQL injection
  private static readonly ALLOWED_DOC_COLUMNS = new Set([
    'folder_id',
    'title',
    'page_count',
    'pdf_path',
    'thumbnail_path',
    'ocr_text',
    'deleted_at',
    'created_at',
    'updated_at',
  ]);

  private static readonly ALLOWED_PAGE_COLUMNS = new Set([
    'document_id',
    'position',
    'original_path',
    'processed_path',
    'filter',
    'intensity',
    'adjust',
    'source_path',
    'corners',
    'rotation',
    'ocr_text',
  ]);

  // --- Settings Operations ---
  static async getSetting(key: string): Promise<string | null> {
    const db = await this.getDb();
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [key]);
    return row ? row.value : null;
  }

  static async setSetting(key: string, value: string): Promise<void> {
    const db = await this.getDb();
    await db.runAsync(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value]
    );
  }

  static async getAllSettings(): Promise<Record<string, string>> {
    const db = await this.getDb();
    const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM app_settings');
    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  }

  // --- Folder Operations ---
  static async getFolders(): Promise<Folder[]> {
    const db = await this.getDb();
    return await db.getAllAsync<Folder>('SELECT * FROM folders ORDER BY created_at ASC');
  }

  static async createFolder(folder: Folder): Promise<void> {
    const db = await this.getDb();
    await db.runAsync(
      'INSERT INTO folders (id, name, parent_id, is_locked, created_at) VALUES (?, ?, ?, ?, ?)',
      [folder.id, folder.name, folder.parent_id, folder.is_locked, folder.created_at]
    );
  }

  static async deleteFolder(folderId: string): Promise<void> {
    const db = await this.getDb();
    await db.runAsync('DELETE FROM folders WHERE id = ?', [folderId]);
  }

  // --- Document Operations ---
  static async getDocuments(folderId?: string | null, includeTrash: boolean = false): Promise<Document[]> {
    const db = await this.getDb();
    if (includeTrash) {
      return await db.getAllAsync<Document>(
        'SELECT * FROM documents WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
      );
    }

    if (folderId !== undefined) {
      if (folderId === null) {
        return await db.getAllAsync<Document>(
          'SELECT * FROM documents WHERE deleted_at IS NULL AND folder_id IS NULL ORDER BY created_at DESC'
        );
      } else {
        return await db.getAllAsync<Document>(
          'SELECT * FROM documents WHERE deleted_at IS NULL AND folder_id = ? ORDER BY created_at DESC',
          [folderId]
        );
      }
    }

    return await db.getAllAsync<Document>(
      'SELECT * FROM documents WHERE deleted_at IS NULL ORDER BY created_at DESC'
    );
  }

  static async getDocumentById(id: string): Promise<Document | null> {
    const db = await this.getDb();
    return await db.getFirstAsync<Document>('SELECT * FROM documents WHERE id = ?', [id]);
  }

  static async searchDocuments(query: string): Promise<Document[]> {
    const db = await this.getDb();
    const pattern = `%${query.trim()}%`;
    return await db.getAllAsync<Document>(
      'SELECT * FROM documents WHERE deleted_at IS NULL AND (title LIKE ? OR ocr_text LIKE ?) ORDER BY updated_at DESC',
      [pattern, pattern]
    );
  }

  static async insertDocument(doc: Document): Promise<void> {
    const db = await this.getDb();

    // Verify folder_id exists to satisfy FOREIGN KEY constraint safely
    let safeFolderId: string | null = doc.folder_id;
    if (safeFolderId) {
      try {
        const folder = await db.getFirstAsync('SELECT id FROM folders WHERE id = ?', [safeFolderId]);
        if (!folder) {
          safeFolderId = null;
        }
      } catch {
        safeFolderId = null;
      }
    }

    await db.runAsync(
      `INSERT INTO documents (id, folder_id, title, page_count, pdf_path, thumbnail_path, ocr_text, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        doc.id,
        safeFolderId,
        doc.title || 'Untitled Document',
        doc.page_count,
        doc.pdf_path,
        doc.thumbnail_path,
        doc.ocr_text,
        doc.deleted_at,
        doc.created_at,
        doc.updated_at,
      ]
    );
  }

  static async updateDocument(id: string, updates: Partial<Document>): Promise<void> {
    const db = await this.getDb();
    const keys = Object.keys(updates).filter((k) => k !== 'id' && this.ALLOWED_DOC_COLUMNS.has(k));
    if (keys.length === 0) return;

    const setClauses = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => {
      const v = (updates as any)[k];
      if (k === 'adjust') return isDefaultAdjust(v) ? null : JSON.stringify(normaliseAdjust(v));
      if (k === 'corners') return v ? JSON.stringify(v) : null;
      return v;
    });
    values.push(id);

    await db.runAsync(`UPDATE documents SET ${setClauses} WHERE id = ?`, values);
  }

  static async softDeleteDocument(id: string): Promise<void> {
    const db = await this.getDb();
    await db.runAsync('UPDATE documents SET deleted_at = ? WHERE id = ?', [Date.now(), id]);
  }

  static async restoreDocument(id: string): Promise<void> {
    const db = await this.getDb();
    await db.runAsync('UPDATE documents SET deleted_at = NULL WHERE id = ?', [id]);
  }

  static async permanentDeleteDocument(id: string): Promise<void> {
    const db = await this.getDb();
    await db.runAsync('DELETE FROM documents WHERE id = ?', [id]);
  }

  // --- Page Operations ---
  static async getPagesByDocumentId(documentId: string): Promise<Page[]> {
    const db = await this.getDb();
    const rows = await db.getAllAsync<Page>(
      'SELECT * FROM pages WHERE document_id = ? ORDER BY position ASC',
      [documentId]
    );
    // adjust is stored as JSON text
    return rows.map((r) => ({
      ...r,
      adjust: r.adjust ? normaliseAdjust(r.adjust) : null,
      corners: parseCorners(r.corners),
    }));
  }

  static async insertPages(pages: Page[]): Promise<void> {
    const db = await this.getDb();
    const validFilters = ['original', 'lighten', 'magic', 'enhanced', 'noshadow', 'bw', 'eco', 'grayscale', 'invert'];

    for (const page of pages) {
      const safeFilter = validFilters.includes(page.filter?.toLowerCase()) ? page.filter.toLowerCase() : 'magic';
      const safeRotation = [0, 90, 180, 270].includes(page.rotation) ? page.rotation : 0;
      const safeIntensity = typeof page.intensity === 'number' && !isNaN(page.intensity) ? page.intensity : 0.6;

      try {
        await db.runAsync(
          `INSERT INTO pages (id, document_id, position, original_path, processed_path, filter, intensity, adjust, source_path, corners, rotation, ocr_text)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            page.id,
            page.document_id,
            page.position,
            page.original_path,
            page.processed_path,
            safeFilter,
            safeIntensity,
            isDefaultAdjust(page.adjust) ? null : JSON.stringify(normaliseAdjust(page.adjust)),
            page.source_path ?? null,
            page.corners ? JSON.stringify(page.corners) : null,
            safeRotation,
            page.ocr_text,
          ]
        );
      } catch {
        // Fallback in case schema on device has not added intensity column yet
        await db.runAsync(
          `INSERT INTO pages (id, document_id, position, original_path, processed_path, filter, rotation, ocr_text)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            page.id,
            page.document_id,
            page.position,
            page.original_path,
            page.processed_path,
            safeFilter,
            safeRotation,
            page.ocr_text,
          ]
        );
      }
    }
  }

  static async updatePage(id: string, updates: Partial<Page>): Promise<void> {
    const db = await this.getDb();
    const keys = Object.keys(updates).filter((k) => k !== 'id' && this.ALLOWED_PAGE_COLUMNS.has(k));
    if (keys.length === 0) return;

    const setClauses = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => (updates as any)[k]);
    values.push(id);

    await db.runAsync(`UPDATE pages SET ${setClauses} WHERE id = ?`, values);
  }

  static async deletePage(id: string): Promise<void> {
    const db = await this.getDb();
    await db.runAsync('DELETE FROM pages WHERE id = ?', [id]);
  }
}
