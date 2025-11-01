// Background service worker orchestrating capture & pipeline dispatch

try {
  importScripts('lib/idb.js')
} catch (e) {
  console.warn('idb helper not loaded', e)
}

const PIPELINE_QUEUE_KEY = 'memorypal_pipelineQueue_v1'
const MAX_CAPTURE_CHARS = 60000
const FORBIDDEN_PROTOCOL = /^(chrome|edge|brave|opera|vivaldi):\/\//i

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['settings', PIPELINE_QUEUE_KEY], (result) => {
    const updates = {}
    if (!result.settings) {
      updates.settings = { autoAnalyze: true, threshold: 0.7 }
    }
    if (!result[PIPELINE_QUEUE_KEY]) {
      updates[PIPELINE_QUEUE_KEY] = []
    }
    if (Object.keys(updates).length) {
      chrome.storage.local.set(updates)
    }
  })
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !isCapturableUrl(tab.url)) return
  chrome.storage.local.get(['settings'], (result) => {
    if (result.settings?.autoAnalyze !== false) {
      analyzePage(tab).catch((err) => console.warn('analyzePage failed', err))
    }
  })
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return

  if (message.type === 'PIPELINE_REQUEST_QUEUE') {
    ;(async () => {
      const queue = await readPipelineQueue()
      await writePipelineQueue([])
      sendResponse({ queue })
    })().catch((err) => {
      console.warn('PIPELINE_REQUEST_QUEUE failed', err)
      sendResponse({ queue: [], error: err?.message })
    })
    return true
  }

  if (message.type === 'PIPELINE_TASK_COMPLETE') {
    const taskId = message.taskId
    ;(async () => {
      const queue = await readPipelineQueue()
      const filtered = queue.filter((task) => task.taskId !== taskId)
      await writePipelineQueue(filtered)
      sendResponse({ ok: true })
    })().catch((err) => {
      console.warn('PIPELINE_TASK_COMPLETE failed', err)
      sendResponse({ ok: false, error: err?.message })
    })
    return true
  }
})

function isCapturableUrl(url) {
  if (!url) return false
  if (url.startsWith('about:')) return false
  if (url.startsWith('chrome-extension://')) return false
  if (FORBIDDEN_PROTOCOL.test(url)) return false
  return /^https?:\/\//i.test(url)
}

async function analyzePage(tab) {
  const capture = await captureTabContent(tab.id)
  if (!capture) return

  const title = capture.title || tab.title || ''
  const url = tab.url
  const text = (capture.text || '').slice(0, MAX_CAPTURE_CHARS)
  if (!text.trim()) return

  const contentHash = await hashString(`${url}|${text}`)
  const timestamp = new Date().toISOString()

  let existing
  try {
    if (self.MemoryPalDB) {
      existing = await self.MemoryPalDB.getPageByUrl(url)
      if (existing?.contentHash === contentHash) {
        console.log('Skipping unchanged page', url)
        return
      }
    }
  } catch (err) {
    console.warn('Failed to read existing page from IDB', err)
  }

  const pageId = existing?.id || (await hashString(url))

  try {
    if (!self.MemoryPalDB) throw new Error('MemoryPalDB not available')
    await self.MemoryPalDB.upsertPage({
      id: pageId,
      title,
      url,
      timestamp,
      summary: existing?.summary || '',
      content: text,
      contentHash,
      embedding: existing?.embedding,
      notes: existing?.notes,
      tags: existing?.tags,
      metadata: { ...(existing?.metadata || {}), metaDescription: capture.meta || '' },
    })
  } catch (err) {
    console.warn('Failed to persist page stub in IDB', err)
    chrome.storage.local.get(['pages'], (result) => {
      const pages = result.pages || []
      const idx = pages.findIndex((p) => p.url === url)
      const entry = {
        id: pageId,
        title,
        url,
        timestamp,
        summary: '',
        content: text,
        contentHash,
      }
      if (idx >= 0) pages[idx] = entry
      else pages.push(entry)
      chrome.storage.local.set({ pages })
    })
  }

  const task = {
    taskId: await hashString(`${pageId}|${contentHash}`),
    pageId,
    url,
    title,
    text,
    meta: capture.meta || '',
    contentHash,
    timestamp,
  }

  await enqueuePipelineTask(task)
  await tryDispatchTask(task)
}

async function captureTabContent(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  if (!tab?.url || !isCapturableUrl(tab.url)) return null
  try {
    const execResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const title = document.title || ''
        const meta = document.querySelector('meta[name="description"]')?.content || ''
        const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim()
        return { title, meta, text }
      },
    })
    return execResults?.[0]?.result || null
  } catch (err) {
    console.warn('captureTabContent failed', err)
    return null
  }
}

async function enqueuePipelineTask(task) {
  const queue = await readPipelineQueue()
  const idx = queue.findIndex((t) => t.taskId === task.taskId)
  if (idx >= 0) queue[idx] = task
  else queue.push(task)
  await writePipelineQueue(queue)
}

async function tryDispatchTask(task) {
  try {
    await chrome.runtime.sendMessage({ type: 'PIPELINE_NEW_TASK', task })
  } catch (err) {
    if (err?.message?.includes('Receiving end does not exist')) {
      // No active consumer; it will fetch from queue later.
      return
    }
    console.warn('Failed to dispatch pipeline task', err)
  }
}

function readPipelineQueue() {
  return new Promise((resolve) => {
    chrome.storage.local.get([PIPELINE_QUEUE_KEY], (result) => {
      resolve(result[PIPELINE_QUEUE_KEY] || [])
    })
  })
}

function writePipelineQueue(queue) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [PIPELINE_QUEUE_KEY]: queue }, () => resolve())
  })
}

async function hashString(input) {
  try {
    const enc = new TextEncoder().encode(input)
    const buf = await crypto.subtle.digest('SHA-256', enc)
    const arr = Array.from(new Uint8Array(buf))
    return arr.map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch (_) {
    let h = 2166136261 >>> 0
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i)
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)
    }
    return (h >>> 0).toString(36)
  }
}
