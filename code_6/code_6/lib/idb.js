
(function (global) {
  const DB_NAME = 'memorypal';
  const DB_VERSION = 3;
  const STORES = {
    pages: { keyPath: 'id' },
    settings: { keyPath: 'key' },
    entities: { keyPath: 'id' },
    relations: { keyPath: 'id' },
  };
  const DEFAULT_EMBEDDING_DIM = 384;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        for (const [name, opts] of Object.entries(STORES)) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, opts);
          }
        }
        // Useful indexes for lookups
        try {
          const pages = req.transaction.objectStore('pages');
          if (!pages.indexNames.contains('by_url')) pages.createIndex('by_url', 'url', { unique: true });
          if (!pages.indexNames.contains('by_timestamp')) pages.createIndex('by_timestamp', 'timestamp');
        } catch (_) {}

        // Entities: index by lowercase name/type for quick lookup
        try {
          const entities = req.transaction.objectStore('entities');
          if (!entities.indexNames.contains('by_name')) entities.createIndex('by_name', 'nameL', { unique: false });
          if (!entities.indexNames.contains('by_type')) entities.createIndex('by_type', 'type', { unique: false });
        } catch (_) {}

        // Relations: index by source and target composite keys
        try {
          const rels = req.transaction.objectStore('relations');
          if (!rels.indexNames.contains('by_source')) rels.createIndex('by_source', 'sourceKey', { unique: false });
          if (!rels.indexNames.contains('by_target')) rels.createIndex('by_target', 'targetKey', { unique: false });
          if (!rels.indexNames.contains('by_rel')) rels.createIndex('by_rel', 'relType', { unique: false });
        } catch (_) {}
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function cloneArrayBuffer(buf) {
    if (!(buf instanceof ArrayBuffer)) return buf;
    return buf.slice(0);
  }

  function serializeEmbedding(vec) {
    if (!vec) return null;
    if (vec instanceof ArrayBuffer) return cloneArrayBuffer(vec);
    if (vec instanceof Float32Array) return cloneArrayBuffer(vec.buffer);
    if (Array.isArray(vec)) return new Float32Array(vec).buffer;
    if (typeof vec.length === 'number') return new Float32Array(Array.from(vec)).buffer;
    return null;
  }

  function deserializeEmbedding(value) {
    if (!value) return null;
    if (value instanceof Float32Array) return value;
    if (value instanceof ArrayBuffer) return new Float32Array(value);
    if (Array.isArray(value)) return new Float32Array(value);
    return null;
  }

  function normalizeNotes(notes) {
    if (!Array.isArray(notes)) return [];
    return notes.map((note) => ({
      id: note.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      text: note.text || '',
      timestamp: note.timestamp || new Date().toISOString(),
    }));
  }

  function normalizePage(page) {
    const now = new Date().toISOString();
    const embeddingBuffer = serializeEmbedding(page.embedding);
    return {
      id: page.id,
      title: page.title || '',
      url: page.url || '',
      timestamp: page.timestamp || now,
      summary: page.summary || '',
      content: page.content || '',
      contentHash: page.contentHash || null,
      embedding: embeddingBuffer,
      embeddingDim: page.embeddingDim || DEFAULT_EMBEDDING_DIM,
      notes: normalizeNotes(page.notes),
      tags: Array.isArray(page.tags) ? page.tags : [],
      metadata: page.metadata || {},
      created_at: page.created_at || now,
      updated_at: now,
    };
  }

  function revivePage(rec) {
    if (!rec) return rec;
    const embedding = deserializeEmbedding(rec.embedding);
    return { ...rec, embedding };
  }

  async function withStore(storeName, mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const result = fn(store);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // Pages
  async function getPageById(id) {
    if (!id) return undefined;
    return withStore('pages', 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(revivePage(req.result || undefined));
        req.onerror = () => reject(req.error);
      });
    });
  }

  async function upsertPage(page) {
    const existing = page?.id ? await getPageById(page.id) : undefined;
    const merged = {
      ...(existing || {}),
      ...(page || {}),
      notes: page?.notes !== undefined ? page.notes : existing?.notes,
      tags: page?.tags !== undefined ? page.tags : existing?.tags,
      metadata: { ...(existing?.metadata || {}), ...(page?.metadata || {}) },
    };
    const normalized = normalizePage(merged);
    return withStore('pages', 'readwrite', (store) => store.put(normalized));
  }

  async function getAllPages() {
    return withStore('pages', 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const items = [];
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            items.push(revivePage(cursor.value));
            cursor.continue();
          } else {
            resolve(items);
          }
        };
        req.onerror = () => reject(req.error);
      });
    });
  }

  async function getPageByUrl(url) {
    return withStore('pages', 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        let index;
        try {
          index = store.index('by_url');
        } catch (_) {
          // Fallback: scan all
          const items = [];
          const req = store.openCursor();
          req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) {
              if (cursor.value.url === url) resolve(revivePage(cursor.value));
              else cursor.continue();
            } else {
              resolve(undefined);
            }
          };
          req.onerror = () => reject(req.error);
          return;
        }
        const req = index.get(url);
        req.onsuccess = () => resolve(revivePage(req.result || undefined));
        req.onerror = () => reject(req.error);
      });
    });
  }

  // Settings
  async function setSetting(key, value) {
    return withStore('settings', 'readwrite', (store) => store.put({ key, value }));
  }

  async function getSetting(key) {
    return withStore('settings', 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
        req.onerror = () => reject(req.error);
      });
    });
  }

  // Entities
  function normalizeEntity(entity, existing = {}) {
    const base = { ...(existing || {}) };
    const name = (entity.name || base.name || '').trim();
    const type = entity.type || base.type || 'Unknown';
    const id =
      entity.id ||
      base.id ||
      (name
        ? `ent:${hashKey(name + '|' + type)}`
        : `ent:${hashKey((entity.aliases || []).join('|') || Math.random().toString())}`);
    const aliases = new Set(
      []
        .concat(base.aliases || [])
        .concat(entity.aliases || [])
        .concat(name ? [name] : [])
        .map((a) => (a || '').trim())
        .filter(Boolean)
    );
    return {
      id,
      name,
      nameL: name.toLowerCase(),
      type,
      aliases: Array.from(aliases),
      created_at: base.created_at || entity.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...entity,
    };
  }

  async function upsertEntity(entity) {
    const existing = entity?.id ? await getEntityById(entity.id) : undefined;
    const e = normalizeEntity(entity, existing);
    return withStore('entities', 'readwrite', (store) => store.put(e));
  }

  async function getEntityById(id) {
    return withStore('entities', 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || undefined);
        req.onerror = () => reject(req.error);
      });
    });
  }

  async function findEntitiesByNameL(nameL) {
    return withStore('entities', 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        let index;
        try {
          index = store.index('by_name');
        } catch (_) { resolve([]); return; }
        const results = [];
        const range = IDBKeyRange.only((nameL || '').toLowerCase());
        const req = index.openCursor(range);
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) { results.push(cursor.value); cursor.continue(); }
          else resolve(results);
        };
        req.onerror = () => reject(req.error);
      });
    });
  }

  async function getEntitiesByIds(ids) {
    return withStore('entities', 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const items = [];
        let remaining = ids.length;
        if (remaining === 0) return resolve([]);
        ids.forEach((id) => {
          const req = store.get(id);
          req.onsuccess = () => { if (req.result) items.push(req.result); if (--remaining === 0) resolve(items); };
          req.onerror = () => { if (--remaining === 0) resolve(items); };
        });
      });
    });
  }

  // Relations
  function buildRelId(sourceType, sourceId, relType, targetType, targetId) {
    return `${sourceType}:${sourceId}|${relType}|${targetType}:${targetId}`;
  }

  function isUndirectedRelationType(relType) {
    return relType === 'CO_MENTION' || relType === 'PAGE_SIMILAR' || relType === 'SIMILAR';
  }

  function normalizeRelation(rel) {
    let { sourceType, sourceId, targetType, targetId } = rel;
    const relType = rel.relType || 'RELATED_TO';

    if (
      isUndirectedRelationType(relType) &&
      sourceType === targetType &&
      `${targetType}:${targetId}` < `${sourceType}:${sourceId}`
    ) {
      [sourceType, targetType] = [targetType, sourceType];
      [sourceId, targetId] = [targetId, sourceId];
    }

    const sourceKey = `${sourceType}:${sourceId}`;
    const targetKey = `${targetType}:${targetId}`;
    const id = rel.id || buildRelId(sourceType, sourceId, relType, targetType, targetId);
    return {
      id,
      sourceType,
      sourceId,
      sourceKey,
      targetType,
      targetId,
      targetKey,
      relType,
      weight: typeof rel.weight === 'number' ? rel.weight : 1,
      created_at: rel.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: rel.metadata || {},
    };
  }

  async function upsertRelation(rel) {
    const r = normalizeRelation(rel);
    return withStore('relations', 'readwrite', (store) => store.put(r));
  }

  async function getRelationsBySource(sourceType, sourceId) {
    const sourceKey = `${sourceType}:${sourceId}`;
    return withStore('relations', 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        let index;
        try { index = store.index('by_source'); } catch (_) { resolve([]); return; }
        const results = [];
        const range = IDBKeyRange.only(sourceKey);
        const req = index.openCursor(range);
        req.onsuccess = () => { const c = req.result; if (c) { results.push(c.value); c.continue(); } else resolve(results); };
        req.onerror = () => reject(req.error);
      });
    });
  }

  async function getRelationsByTarget(targetType, targetId) {
    const targetKey = `${targetType}:${targetId}`;
    return withStore('relations', 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        let index;
        try { index = store.index('by_target'); } catch (_) { resolve([]); return; }
        const results = [];
        const range = IDBKeyRange.only(targetKey);
        const req = index.openCursor(range);
        req.onsuccess = () => { const c = req.result; if (c) { results.push(c.value); c.continue(); } else resolve(results); };
        req.onerror = () => reject(req.error);
      });
    });
  }

  async function deleteRelationsBySource(sourceType, sourceId, relType) {
    const sourceKey = `${sourceType}:${sourceId}`;
    return withStore('relations', 'readwrite', (store) => {
      return new Promise((resolve, reject) => {
        let index;
        try { index = store.index('by_source'); } catch (_) { resolve(); return; }
        const range = IDBKeyRange.only(sourceKey);
        const req = index.openCursor(range);
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            if (!relType || cursor.value.relType === relType) cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => reject(req.error);
      });
    });
  }

  async function getRelationsBetween(aType, aId, bType, bId, relType) {
    const rels = await getRelationsBySource(aType, aId);
    return rels.filter((rel) => {
      return (
        rel.targetType === bType &&
        rel.targetId === bId &&
        (!relType || rel.relType === relType)
      );
    });
  }

  async function bulkUpsertRelations(relations) {
    if (!Array.isArray(relations) || relations.length === 0) return;
    const normalized = relations.map(normalizeRelation);
    return withStore('relations', 'readwrite', (store) => {
      for (const rel of normalized) {
        store.put(rel);
      }
    });
  }

  async function getPagesByIds(ids) {
    return withStore('pages', 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const items = [];
        let remaining = ids.length;
        if (remaining === 0) return resolve([]);
        ids.forEach((id) => {
          const req = store.get(id);
          req.onsuccess = () => {
            if (req.result) items.push(revivePage(req.result));
            if (--remaining === 0) resolve(items);
          };
          req.onerror = () => { if (--remaining === 0) resolve(items); };
        });
      });
    });
  }

  // Small stable hash for IDs (not cryptographic)
  function hashKey(str) {
    let h = 2166136261 >>> 0; // FNV-1a
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0).toString(36);
  }

  const api = {
    openDB,
    // pages
    upsertPage,
    getAllPages,
    getPageById,
    getPageByUrl,
    getPagesByIds,
    // settings
    setSetting,
    getSetting,
    // entities
    upsertEntity,
    getEntityById,
    findEntitiesByNameL,
    getEntitiesByIds,
    // relations
    upsertRelation,
    getRelationsBySource,
    getRelationsByTarget,
    deleteRelationsBySource,
    getRelationsBetween,
    bulkUpsertRelations,
  };

  // Expose in both window and worker contexts
  if (typeof global !== 'undefined') {
    global.MemoryPalDB = api;
  }
})(typeof self !== 'undefined' ? self : window);
