;(function (global) {
  if (!global.chrome?.runtime) return

  const MAX_SUMMARIZER_CONTEXT = 6500
  const ENTITY_LIMIT = 24
  const PAGE_SIMILARITY_THRESHOLD = 0.18
  const processingTasks = new Set()

  document.addEventListener('DOMContentLoaded', () => {
    bootstrapPipeline()
  })

  async function bootstrapPipeline() {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'PIPELINE_NEW_TASK' && message.task) {
        processPipelineTask(message.task)
      }
    })

    try {
      const response = await chrome.runtime.sendMessage({ type: 'PIPELINE_REQUEST_QUEUE' })
      const tasks = response?.queue || []
      for (const task of tasks) {
        await processPipelineTask(task)
      }
    } catch (err) {
      if (!err?.message?.includes('Receiving end')) {
        console.warn('No pending pipeline queue', err)
      }
    }
  }

  async function processPipelineTask(task) {
    if (!task || processingTasks.has(task.taskId)) return
    processingTasks.add(task.taskId)
    try {
      const summaryResult = await summarizeTask(task)
      const embeddingText = `${task.title}\n${summaryResult.summary}\n${task.text}`.slice(
        0,
        MAX_SUMMARIZER_CONTEXT
      )
      const embedding = global.MemoryPalEmbeddings?.computeEmbedding(embeddingText) || null
      const entities = await extractEntities(task, summaryResult.summary)
      await persistKnowledge(task, summaryResult, embedding, entities)
      try {
        await chrome.runtime.sendMessage({ type: 'PIPELINE_TASK_COMPLETE', taskId: task.taskId })
      } catch (_) {
        /* ignore */
      }
      window.dispatchEvent(
        new CustomEvent('memorypal:pageProcessed', { detail: { pageId: task.pageId } })
      )
    } catch (err) {
      console.warn('Pipeline task failed', err)
    } finally {
      processingTasks.delete(task.taskId)
    }
  }

  // Summarization ------------------------------------------------------------
  let summarizerSessionPromise = null

  async function getSummarizerSession() {
    if (summarizerSessionPromise) return summarizerSessionPromise
    summarizerSessionPromise = (async () => {
      const factory = global.ai?.summarizer
      if (!factory?.create) return null
      try {
        return await factory.create({
          type: 'key-points',
          format: 'paragraph',
          sharedContext: 'memorypal-local-summarizer',
        })
      } catch (err) {
        console.warn('Chrome summarizer unavailable', err)
        return null
      }
    })()
    return summarizerSessionPromise
  }

  async function summarizeTask(task) {
    const context = `${task.title || ''}\n${task.meta || ''}\n${task.text || ''}`.slice(
      0,
      MAX_SUMMARIZER_CONTEXT
    )
    if (!context.trim()) {
      return { summary: '', source: 'empty' }
    }
    const session = await getSummarizerSession()
    if (session) {
      try {
        const response = await session.summarize({ context, format: 'paragraph' })
        if (response?.summary) {
          return { summary: response.summary, source: 'chrome-ai' }
        }
      } catch (err) {
        console.warn('Chrome summarizer summarize failed', err)
        summarizerSessionPromise = null
      }
    }
    return { summary: summarizeLocally(context), source: 'local-fallback' }
  }

  function summarizeLocally(text, maxSentences = 3) {
    try {
      const sentences =
        (text || '')
          .replace(/\s+/g, ' ')
          .match(/[^.!?]+[.!?]/g) || []
      if (!sentences.length) return (text || '').slice(0, 240)
      const stop = new Set([
        'the',
        'and',
        'for',
        'that',
        'with',
        'this',
        'from',
        'you',
        'are',
        'was',
        'have',
        'not',
        'but',
        'they',
        'his',
        'her',
        'she',
        'him',
        'our',
        'your',
        'about',
        'into',
        'over',
        'after',
        'before',
        'when',
        'while',
        'what',
        'which',
        'who',
        'where',
        'how',
        'why',
        'can',
        'will',
        'just',
      ])
      const freq = Object.create(null)
      for (const s of sentences) {
        for (const w of s
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .split(/\s+/)) {
          if (!w || w.length < 3 || stop.has(w)) continue
          freq[w] = (freq[w] || 0) + 1
        }
      }
      const scored = sentences.map((s, i) => {
        let score = 0
        for (const w of s
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .split(/\s+/)) {
          if (freq[w]) score += freq[w]
        }
        return { i, s: s.trim(), score }
      })
      scored.sort((a, b) => b.score - a.score)
      const top = scored
        .slice(0, maxSentences)
        .sort((a, b) => a.i - b.i)
        .map((x) => x.s)
      return top.join(' ')
    } catch (_) {
      return (text || '').slice(0, 240)
    }
  }

  // Entity extraction --------------------------------------------------------
  async function extractEntities(task, summary) {
    const textSlice = task.text?.slice(0, 15000) || ''
    const combined = `${task.title || ''}\n${summary || ''}\n${textSlice}`.trim()
    const candidates = new Map()

    const addCandidate = (name, type, weight, source) => {
      const cleaned = (name || '').trim()
      if (!cleaned || cleaned.length < 3) return
      const key = cleaned.toLowerCase()
      const entry = candidates.get(key) || {
        name: cleaned,
        type,
        weight: 0,
        frequency: 0,
        aliases: new Set([cleaned]),
        sources: new Set(),
      }
      entry.weight += weight
      entry.frequency += 1
      entry.aliases.add(cleaned)
      entry.sources.add(source)
      candidates.set(key, entry)
    }

    const proper = combined.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g) || []
    for (const value of proper) {
      addCandidate(value, guessEntityType(value), 2, 'proper-noun')
    }

    const acronyms = combined.match(/\b([A-Z]{2,})\b/g) || []
    for (const value of acronyms) {
      if (value.length < 3 || value.length > 8) continue
      addCandidate(value, 'Acronym', 1.5, 'acronym')
    }

    const hashtags = combined.match(/#([A-Za-z0-9_]{3,})/g) || []
    for (const tag of hashtags) {
      addCandidate(tag.replace('#', ''), 'Tag', 1, 'hashtag')
    }

    const patternMatches = combined.match(
      /\b([A-Z][a-zA-Z]+)\s+(framework|library|algorithm|model|dataset|standard|protocol)\b/gi
    )
    if (patternMatches) {
      for (const match of patternMatches) {
        addCandidate(match, 'Concept', 2.5, 'pattern')
      }
    }

    const headlineEntities = (task.title || '').match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g) || []
    for (const value of headlineEntities) {
      addCandidate(value, guessEntityType(value), 3, 'title')
    }

    const ranked = Array.from(candidates.values())
      .map((entry) => ({
        name: entry.name,
        type: entry.type,
        weight: entry.weight + entry.frequency * 0.2,
        aliases: Array.from(entry.aliases),
        source: Array.from(entry.sources).join(','),
        frequency: entry.frequency,
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, ENTITY_LIMIT)

    const resolved = []
    for (const candidate of ranked) {
      const nameL = candidate.name.toLowerCase()
      let existingId
      try {
        const matches = await global.MemoryPalDB?.findEntitiesByNameL?.(nameL)
        if (matches && matches.length) {
          existingId = matches[0].id
        }
      } catch (err) {
        console.warn('findEntitiesByNameL failed', err)
      }
      const id = existingId || `ent:${hashLite(nameL + '|' + candidate.type)}`
      resolved.push({ ...candidate, id })
    }
    return resolved
  }

  function guessEntityType(value) {
    if (!value) return 'Concept'
    if (/\b(inc|corp|llc|ltd|company|university|institute)\b/i.test(value)) return 'Organization'
    if (/\b(mr|mrs|dr|prof|sir)\b/i.test(value)) return 'Person'
    if (/^[A-Z]{2,}$/.test(value.replace(/\s+/g, ''))) return 'Acronym'
    return 'Concept'
  }

  function hashLite(str) {
    let h = 2166136261 >>> 0
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i)
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)
    }
    return (h >>> 0).toString(36)
  }

  // Persistence --------------------------------------------------------------
  async function persistKnowledge(task, summaryResult, embedding, entities) {
    const timestamp = task.timestamp || new Date().toISOString()
    try {
      await global.MemoryPalDB.upsertPage({
        id: task.pageId,
        title: task.title || '',
        url: task.url,
        timestamp,
        summary: summaryResult.summary,
        content: task.text,
        contentHash: task.contentHash,
        embedding,
        metadata: {
          ...(task.metadata || {}),
          summarySource: summaryResult.source,
        },
      })
    } catch (err) {
      console.warn('Failed to upsert page with pipeline results', err)
    }

    try {
      await global.MemoryPalDB.deleteRelationsBySource('page', task.pageId)
    } catch (err) {
      console.warn('Failed to clear previous relations', err)
    }

    const relations = []
    const entityRecords = []

    for (const ent of entities) {
      try {
        await global.MemoryPalDB.upsertEntity({
          id: ent.id,
          name: ent.name,
          type: ent.type,
          aliases: ent.aliases,
          weight: ent.weight,
          metadata: { source: ent.source },
        })
        entityRecords.push(ent)
        relations.push({
          sourceType: 'page',
          sourceId: task.pageId,
          targetType: 'entity',
          targetId: ent.id,
          relType: 'MENTIONS',
          weight: Number(ent.weight || 1),
          metadata: { frequency: ent.frequency, source: ent.source },
        })
      } catch (err) {
        console.warn('Failed to upsert entity', ent, err)
      }
    }

    const coMention = []
    for (let i = 0; i < entityRecords.length; i++) {
      for (let j = i + 1; j < entityRecords.length; j++) {
        const a = entityRecords[i]
        const b = entityRecords[j]
        const weight = Math.min(Number(a.weight || 1), Number(b.weight || 1))
        coMention.push({
          sourceType: 'entity',
          sourceId: a.id,
          targetType: 'entity',
          targetId: b.id,
          relType: 'CO_MENTION',
          weight,
          metadata: { pageId: task.pageId },
        })
      }
    }

    try {
      if (relations.length) await global.MemoryPalDB.bulkUpsertRelations(relations)
      if (coMention.length) await global.MemoryPalDB.bulkUpsertRelations(coMention)
    } catch (err) {
      console.warn('Failed to store relations', err)
    }

    if (embedding) {
      await updatePageSimilarities(task.pageId, embedding)
    }
  }

  async function updatePageSimilarities(pageId, embedding) {
    try {
      await global.MemoryPalDB.deleteRelationsBySource('page', pageId, 'PAGE_SIMILAR')
      const pages = await global.MemoryPalDB.getAllPages()
      const sims = []
      for (const page of pages) {
        if (!page.embedding || page.id === pageId) continue
        const vec = page.embedding instanceof Float32Array ? page.embedding : new Float32Array(page.embedding)
        const score = global.MemoryPalEmbeddings.cosineSimilarity(embedding, vec)
        if (Number.isFinite(score)) {
          sims.push({ pageId: page.id, score })
        }
      }
      sims.sort((a, b) => b.score - a.score)
      const top = sims.filter((s) => s.score >= PAGE_SIMILARITY_THRESHOLD).slice(0, 12)
      if (!top.length) return
      const relations = top.map((item) => ({
        sourceType: 'page',
        sourceId: pageId,
        targetType: 'page',
        targetId: item.pageId,
        relType: 'PAGE_SIMILAR',
        weight: item.score,
      }))
      await global.MemoryPalDB.bulkUpsertRelations(relations)
    } catch (err) {
      console.warn('Failed to update page similarity relations', err)
    }
  }
})(typeof self !== 'undefined' ? self : window)
