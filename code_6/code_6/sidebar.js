// Sidebar script for MemoryPal Chrome extension
let relatedPages = []
let allPages = []

const mockRelatedPages = [
  {
    id: 1,
    title: "Reinforcement Learning Basics",
    description: "Introduction to RL concepts and fundamental algorithms",
    similarity: 0.89,
    url: "https://example.com/rl-basics",
    visitDate: "Jan 14, 2024",
    summary:
      "A comprehensive introduction to reinforcement learning covering key concepts like agents, environments, rewards, and the exploration-exploitation tradeoff. This article provides a solid foundation for understanding more advanced RL techniques.",
    notes: [],
  },
  {
    id: 2,
    title: "Actor-Critic Methods Explained",
    description: "Deep dive into actor-critic architectures",
    similarity: 0.82,
    url: "https://example.com/actor-critic",
    visitDate: "Jan 12, 2024",
    summary:
      "An in-depth exploration of actor-critic methods, combining value-based and policy-based approaches. Learn how these hybrid algorithms achieve stable and efficient learning in complex environments.",
    notes: [],
  },
  {
    id: 3,
    title: "Deep Q-Networks (DQN)",
    description: "Value-based RL approach",
    similarity: 0.76,
    url: "https://example.com/dqn",
    visitDate: "Jan 10, 2024",
    summary:
      "Understanding the breakthrough DQN algorithm that combines Q-learning with deep neural networks. Discover how experience replay and target networks enable stable learning in high-dimensional state spaces.",
    notes: [],
  },
  {
    id: 4,
    title: "Reward Shaping Techniques",
    description: "Optimizing reward functions",
    similarity: 0.71,
    url: "https://example.com/reward-shaping",
    visitDate: "Jan 8, 2024",
    summary:
      "Strategies for designing effective reward functions that guide agent learning without introducing unintended behaviors. Learn about potential-based shaping and reward engineering best practices.",
    notes: [],
  },
  {
    id: 5,
    title: "Proximal Policy Optimization",
    description: "PPO algorithm overview",
    similarity: 0.68,
    url: "https://example.com/ppo",
    visitDate: "Jan 5, 2024",
    summary:
      "Explore the PPO algorithm and its advantages in stable policy learning. Understand clipped surrogate objectives and how PPO balances exploration with exploitation for robust performance.",
    notes: [],
  },
  {
    id: 6,
    title: "Multi-Agent RL Systems",
    description: "Coordination in multi-agent environments",
    similarity: 0.62,
    url: "https://example.com/marl",
    visitDate: "Jan 3, 2024",
    summary:
      "Introduction to multi-agent reinforcement learning, covering cooperative and competitive scenarios. Learn about communication protocols and emergent behaviors in agent populations.",
    notes: [],
  },
  {
    id: 7,
    title: "Model-Based RL Approaches",
    description: "Learning environment dynamics",
    similarity: 0.58,
    url: "https://example.com/model-based",
    visitDate: "Dec 28, 2023",
    summary:
      "Understanding model-based reinforcement learning where agents learn a model of the environment. Discover how planning with learned models can improve sample efficiency.",
    notes: [],
  },
  {
    id: 8,
    title: "Exploration Strategies in RL",
    description: "Balancing exploration vs exploitation",
    similarity: 0.54,
    url: "https://example.com/exploration",
    visitDate: "Dec 25, 2023",
    summary:
      "Deep dive into exploration strategies including epsilon-greedy, UCB, and curiosity-driven approaches. Learn how to balance discovering new information with exploiting known rewards.",
    notes: [],
  },
]

const currentPageData = {
  title: "Advanced Deep Learning Techniques",
  url: "https://example.com/current-page",
  notes: [],
}

let currentThreshold = 0.67
let currentPage = null
const settings = {
  accentColor: "blue",
  density: "comfortable",
  showSimilarityBars: true,
  keyboardShortcuts: true,
  searchSuggestions: true,
}

window.__graphControls = null

window.addEventListener("memorypal:pageProcessed", async () => {
  await hydrateFromIndexedDB()
  updateRelatedPages()
  updateIndexedCountUI(allPages.length)
})

document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners()
  await hydrateFromIndexedDB()
  updateRelatedPages()
  updateIndexedCountUI(allPages.length)
  setupKeyboardShortcuts()
  document.documentElement.style.scrollBehavior = "smooth"
  // Uncomment to test: showEmptyState()
})

async function hydrateFromIndexedDB() {
  try {
    // Get active tab info
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    const activeUrl = tab?.url || currentPageData.url
    const activeTitle = tab?.title || currentPageData.title

    allPages = (await window.MemoryPalDB?.getAllPages?.()) || []
    if (!allPages.length) {
      relatedPages = mockRelatedPages
      updateIndexedCountUI(0)
      return
    }

    const activePage =
      allPages.find((p) => p.url === activeUrl) ||
      allPages.find((p) => p.id === currentPageData.id) ||
      allPages[0]

    currentPageData.id = activePage?.id
    currentPageData.title = activePage?.title || activeTitle || ''
    currentPageData.url = activePage?.url || activeUrl || ''
    currentPageData.summary = activePage?.summary || ''
    currentPageData.notes = Array.isArray(activePage?.notes) ? activePage.notes : []
    currentPageData.timestamp = activePage?.timestamp

    const baseEmbedding =
      activePage?.embedding instanceof Float32Array
        ? activePage.embedding
        : activePage?.embedding
        ? new Float32Array(activePage.embedding)
        : null

    const results = []
    if (baseEmbedding && window.MemoryPalEmbeddings?.cosineSimilarity) {
      for (const page of allPages) {
        if (!page || page.id === activePage.id || !page.embedding) continue
        const vec =
          page.embedding instanceof Float32Array
            ? page.embedding
            : new Float32Array(page.embedding)
        const sim = window.MemoryPalEmbeddings.cosineSimilarity(baseEmbedding, vec)
        const normalizedSim = Math.max(0, Math.min(1, (sim + 1) / 2))
        results.push({
          id: page.id,
          title: page.title || page.url,
          description: page.summary || page.content?.slice(0, 200) || page.url,
          similarity: normalizedSim,
          url: page.url,
          visitDate: page.timestamp ? new Date(page.timestamp).toLocaleDateString() : '',
          summary: page.summary || '',
          notes: page.notes || [],
        })
      }
    } else {
      const activeTokens = tokenize(
        (activePage?.title || '') + ' ' + (activePage?.summary || '')
      )
      for (const p of allPages) {
        if (!p.url || p.url === activePage?.url) continue
        const tokens = tokenize((p.title || '') + ' ' + (p.summary || ''))
        const sim = jaccard(activeTokens, tokens)
        results.push({
          id: p.id,
          title: p.title || p.url,
          description: p.summary || p.url,
          similarity: sim,
          url: p.url,
          visitDate: p.timestamp ? new Date(p.timestamp).toLocaleDateString() : '',
          summary: p.summary || '',
          notes: p.notes || [],
        })
      }
    }

    results.sort((a, b) => b.similarity - a.similarity)
    relatedPages = results
    updateIndexedCountUI(allPages.length)
  } catch (err) {
    console.warn('Failed to load pages from IndexedDB, using mock data.', err)
    relatedPages = mockRelatedPages
    updateIndexedCountUI()
  }
}

function tokenize(text) {
  return new Set((text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => w.length > 2))
}

function jaccard(aSet, bSet) {
  if (!aSet || !bSet || aSet.size === 0 || bSet.size === 0) return 0
  let inter = 0
  for (const t of aSet) if (bSet.has(t)) inter++
  const union = aSet.size + bSet.size - inter
  return union === 0 ? 0 : inter / union
}

function updateIndexedCountUI(count) {
  try {
    const el = document.getElementById('pagesIndexedText')
    if (!el) return
    if (typeof count === 'number') {
      el.textContent = `${count} page${count === 1 ? '' : 's'} indexed`
      return
    }
    // If count not provided, try fetching
    window.MemoryPalDB?.getAllPages?.().then((pages) => {
      const c = (pages || []).length
      el.textContent = `${c} page${c === 1 ? '' : 's'} indexed`
    }).catch(() => {})
  } catch (_) {}
}

async function persistPageNotes(pageId, notes) {
  if (!pageId || !window.MemoryPalDB?.upsertPage) return
  try {
    const existing = await window.MemoryPalDB.getPageById(pageId)
    if (!existing) return
    await window.MemoryPalDB.upsertPage({ ...existing, notes })
    await hydrateFromIndexedDB()
    updateRelatedPages()
    updateIndexedCountUI(allPages.length)
  } catch (err) {
    console.warn('Failed to persist notes', err)
  }
}

function setupEventListeners() {
  const slider = document.getElementById("similaritySlider")
  slider.addEventListener("input", function () {
    currentThreshold = this.value / 100
    document.getElementById("thresholdValue").textContent = currentThreshold.toFixed(2)
    updateRelatedPages()
  })

  document.getElementById("backBtn").addEventListener("click", () => {
    showMainView()
  })

  document.getElementById("openGraphBtn").addEventListener("click", () => {
    showGraphModal()
  })

  document.getElementById("closeGraphBtn").addEventListener("click", () => {
    hideGraphModal()
  })

  document.getElementById("editCurrentPageBtn").addEventListener("click", () => {
    showCurrentPageNotesModal()
  })

  document.getElementById("closeNotesModalBtn").addEventListener("click", () => {
    hideCurrentPageNotesModal()
  })

  document.getElementById("saveCurrentNoteBtn").addEventListener("click", () => {
    saveCurrentPageNote()
  })

  document.getElementById("cancelCurrentNoteBtn").addEventListener("click", () => {
    hideCurrentPageNotesModal()
  })

  document.getElementById("settingsBtn").addEventListener("click", () => {
    showSettingsModal()
  })

  document.getElementById("closeSettingsBtn").addEventListener("click", () => {
    hideSettingsModal()
  })

  document.querySelectorAll(".theme-color-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".theme-color-btn").forEach((b) => b.classList.remove("active"))
      this.classList.add("active")
      const color = this.dataset.color
      applyThemeColor(color)
    })
  })

  document.querySelectorAll(".density-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".density-btn").forEach((b) => b.classList.remove("active"))
      this.classList.add("active")
      const density = this.dataset.density
      applyDensity(density)
    })
  })

  document.getElementById("toggleSimilarityBars").addEventListener("change", function () {
    settings.showSimilarityBars = this.checked
    updateRelatedPages()
  })

  document.getElementById("toggleKeyboardShortcuts").addEventListener("change", function () {
    settings.keyboardShortcuts = this.checked
  })

  document.getElementById("toggleSearchSuggestions").addEventListener("change", function () {
    settings.searchSuggestions = this.checked
  })

  document.getElementById("surpriseBtn").addEventListener("click", () => {
    showSerendipityModal()
  })

  document.getElementById("closeSerendipityBtn").addEventListener("click", () => {
    hideSerendipityModal()
  })

  document.getElementById("closeEmptyStateBtn")?.addEventListener("click", () => {
    hideEmptyState()
  })

  const infoIcon = document.getElementById("infoIcon")
  const infoTooltip = document.getElementById("infoTooltip")

  infoIcon.addEventListener("mouseenter", (e) => {
    const rect = infoIcon.getBoundingClientRect()
    infoTooltip.style.display = "block"
    infoTooltip.style.top = `${rect.bottom + 10}px`
    infoTooltip.style.left = `${rect.left - 150}px`
  })

  infoIcon.addEventListener("mouseleave", () => {
    infoTooltip.style.display = "none"
  })

  document.getElementById("addNoteBtn").addEventListener("click", () => {
    document.getElementById("notesPlaceholder").style.display = "none"
    document.getElementById("notesEditor").style.display = "block"
    document.getElementById("notesTextarea").focus()
  })

  document.getElementById("cancelNoteBtn").addEventListener("click", () => {
    document.getElementById("notesEditor").style.display = "none"
    const notesList = document.getElementById("notesList")
    if (notesList.children.length === 0) {
      document.getElementById("notesPlaceholder").style.display = "block"
    }
    document.getElementById("notesTextarea").value = ""
  })

  document.getElementById("saveNoteBtn").addEventListener("click", async () => {
    const noteText = document.getElementById("notesTextarea").value.trim()
    if (noteText && currentPage) {
      const noteId = Date.now()
      const note = { id: noteId, text: noteText, timestamp: new Date().toISOString() }
      currentPage.notes = currentPage.notes || []
      currentPage.notes.push(note)
      await persistPageNotes(currentPage.id, currentPage.notes)
      displayNotes()
      document.getElementById("notesEditor").style.display = "none"
      document.getElementById("notesTextarea").value = ""
    }
  })

  document.getElementById("visitPageBtn").addEventListener("click", () => {
    if (currentPage) {
      window.open(currentPage.url, "_blank")
    }
  })

  document.getElementById("exportNotesBtn").addEventListener("click", () => {
    if (currentPage && currentPage.notes.length > 0) {
      exportNotesAsCSV()
    }
  })

  const searchInput = document.getElementById("searchInput")
  searchInput.addEventListener("input", function () {
    filterPages(this.value)
  })

  searchInput.addEventListener("focus", function () {
    if (settings.searchSuggestions && this.value === "") {
      document.getElementById("searchSuggestions").style.display = "block"
    }
  })

  searchInput.addEventListener("blur", () => {
    setTimeout(() => {
      document.getElementById("searchSuggestions").style.display = "none"
    }, 200)
  })
}

function updateRelatedPages() {
  const container = document.getElementById("relatedPagesList")
  const source = relatedPages && relatedPages.length ? relatedPages : mockRelatedPages
  const filteredPages = source.filter((page) => page.similarity >= currentThreshold)

  document.getElementById("pageCounter").textContent = `${filteredPages.length} of ${source.length}`

  container.innerHTML = ""

  if (filteredPages.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-inbox"></i>
        <p>No pages match this threshold</p>
        <small>Try lowering the similarity threshold</small>
      </div>
    `
    return
  }

  filteredPages.forEach((page, index) => {
    const pageElement = createPageElement(page, index)
    container.appendChild(pageElement)
  })
}

function createPageElement(page, index) {
  const div = document.createElement("div")
  div.className = "related-page-item"
  div.style.animationDelay = `${index * 0.05}s`

  const similarityPercent = (page.similarity * 100).toFixed(0)
  const barWidth = page.similarity * 100

  const similarityBar = settings.showSimilarityBars
    ? `
    <div class="similarity-bar">
      <div class="similarity-bar-fill" style="width: ${barWidth}%"></div>
    </div>
  `
    : ""

  div.innerHTML = `
    <div class="page-header">
      <h3 class="page-title">${page.title}</h3>
      <div class="similarity-display">
        <span class="similarity-value">${page.similarity.toFixed(2)}</span>
      </div>
    </div>
    <p class="page-description">${page.description}</p>
    ${similarityBar}
  `

  div.addEventListener("click", () => {
    showDetailView(page)
  })

  return div
}

function showDetailView(page) {
  const record = allPages.find((p) => p.id === page.id) || page
  currentPage = {
    ...record,
    similarity: page.similarity,
    description: page.description,
    visitDate: page.visitDate,
  }

  document.getElementById("detailTitle").textContent = currentPage.title || currentPage.url
  document.getElementById("detailSimilarity").textContent = `${Math.round(
    (currentPage.similarity || 0) * 100
  )}%`
  document.getElementById("detailDate").textContent =
    currentPage.visitDate ||
    (currentPage.timestamp ? new Date(currentPage.timestamp).toLocaleDateString() : '')
  document.getElementById("detailSummary").textContent =
    currentPage.summary || currentPage.description || ''

  displayNotes()

  document.getElementById("mainView").style.display = "none"
  document.getElementById("detailView").style.display = "block"
}

function showMainView() {
  document.getElementById("detailView").style.display = "none"
  document.getElementById("mainView").style.display = "block"
  currentPage = null
}

function displayNotes() {
  const notesList = document.getElementById("notesList")
  const notesPlaceholder = document.getElementById("notesPlaceholder")

  if (!currentPage.notes || currentPage.notes.length === 0) {
    notesPlaceholder.style.display = "block"
    notesList.innerHTML = ""
    return
  }

  notesPlaceholder.style.display = "none"
  notesList.innerHTML = ""

  currentPage.notes.forEach((note) => {
    const noteElement = document.createElement("div")
    noteElement.className = "note-item"
    noteElement.innerHTML = `
      <div class="note-content">
        <p class="note-text">${note.text}</p>
        <span class="note-timestamp">${new Date(note.timestamp).toLocaleDateString()}</span>
      </div>
      <div class="note-actions">
        <button class="btn-note-action" onclick="editNote(${note.id})">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="btn-note-action" onclick="deleteNote(${note.id})">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    `
    notesList.appendChild(noteElement)
  })
}

window.editNote = (noteId) => {
  const note = currentPage.notes.find((n) => n.id === noteId)
  if (note) {
    document.getElementById("notesTextarea").value = note.text
    document.getElementById("notesEditor").style.display = "block"
    document.getElementById("notesPlaceholder").style.display = "none"
    currentPage.notes = currentPage.notes.filter((n) => n.id !== noteId)
  }
}

window.deleteNote = async (noteId) => {
  currentPage.notes = currentPage.notes.filter((n) => n.id !== noteId)
  await persistPageNotes(currentPage.id, currentPage.notes)
  displayNotes()
}

function exportNotesAsCSV() {
  if (!currentPage || currentPage.notes.length === 0) return

  const csvContent = [
    ["Page Title", "Note", "Date"],
    ...currentPage.notes.map((note) => [
      currentPage.title,
      note.text.replace(/"/g, '""'),
      new Date(note.timestamp).toLocaleDateString(),
    ]),
  ]
    .map((row) => row.map((cell) => `"${cell}"`).join(","))
    .join("\n")

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${currentPage.title.replace(/\s+/g, "-")}-notes.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function showCurrentPageNotesModal() {
  const modal = document.getElementById("currentPageNotesModal")
  modal.style.display = "flex"

  document.getElementById("currentPageInfo").innerHTML = `
    <h4 class="current-page-title">${currentPageData.title}</h4>
    <p class="current-page-url">${currentPageData.url}</p>
  `

  displayCurrentPageNotes()
}

function hideCurrentPageNotesModal() {
  document.getElementById("currentPageNotesModal").style.display = "none"
  document.getElementById("currentPageNotesTextarea").value = ""
}

async function saveCurrentPageNote() {
  const noteText = document.getElementById("currentPageNotesTextarea").value.trim()
  if (noteText) {
    const noteId = Date.now()
    const note = { id: noteId, text: noteText, timestamp: new Date().toISOString() }
    currentPageData.notes.push(note)
    await persistPageNotes(currentPageData.id, currentPageData.notes)
    await hydrateFromIndexedDB()
    updateRelatedPages()
    displayCurrentPageNotes()
    document.getElementById("currentPageNotesTextarea").value = ""
  }
}

function displayCurrentPageNotes() {
  const notesList = document.getElementById("currentPageNotesList")

  if (currentPageData.notes.length === 0) {
    notesList.innerHTML = '<p class="text-secondary text-center py-3">No notes yet for this page.</p>'
    return
  }

  notesList.innerHTML = ""

  currentPageData.notes.forEach((note) => {
    const noteElement = document.createElement("div")
    noteElement.className = "note-item"
    noteElement.innerHTML = `
      <div class="note-content">
        <p class="note-text">${note.text}</p>
        <span class="note-timestamp">${new Date(note.timestamp).toLocaleDateString()}</span>
      </div>
      <div class="note-actions">
        <button class="btn-note-action" onclick="editCurrentPageNote(${note.id})">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="btn-note-action" onclick="deleteCurrentPageNote(${note.id})">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    `
    notesList.appendChild(noteElement)
  })
}

window.editCurrentPageNote = (noteId) => {
  const note = currentPageData.notes.find((n) => n.id === noteId)
  if (note) {
    document.getElementById("currentPageNotesTextarea").value = note.text
    currentPageData.notes = currentPageData.notes.filter((n) => n.id !== noteId)
  }
}

window.deleteCurrentPageNote = async (noteId) => {
  currentPageData.notes = currentPageData.notes.filter((n) => n.id !== noteId)
  await persistPageNotes(currentPageData.id, currentPageData.notes)
  await hydrateFromIndexedDB()
  updateRelatedPages()
  displayCurrentPageNotes()
}

function showGraphModal() {
  const openModalFallback = () => {
    const modal = document.getElementById("graphModal")
    if (modal) {
      modal.style.display = "flex"
      initializeGraph()
    }
  }

  try {
    const url = chrome.runtime.getURL("graph.html")
    const maybePromise = chrome.tabs.create({ url }, () => {
      if (chrome.runtime.lastError) {
        console.warn("Failed to open graph tab", chrome.runtime.lastError)
        openModalFallback()
      }
    })
    if (maybePromise && typeof maybePromise.then === "function") {
      maybePromise.catch((err) => {
        console.warn("Failed to open graph tab", err)
        openModalFallback()
      })
    }
  } catch (err) {
    console.warn("Graph tab open threw", err)
    openModalFallback()
  }
}

function hideGraphModal() {
  document.getElementById("graphModal").style.display = "none"
}

function initializeGraph() {
  const container = document.getElementById("graphContainer")
  window.__graphControls = null
  if (!container) return
  container.innerHTML = `
    <div class="d-flex flex-column justify-content-center align-items-center h-100 text-center text-secondary p-4">
      <i class="bi bi-diagram-3 fs-1 mb-3"></i>
      <p class="mb-2">The interactive knowledge graph now opens in a full page for better visibility.</p>
      <p class="mb-0">Use the “Open Knowledge Graph” button to launch it.</p>
    </div>
  `
}

function showSettingsModal() {
  document.getElementById("settingsModal").style.display = "flex"
}

function hideSettingsModal() {
  document.getElementById("settingsModal").style.display = "none"
}

function applyThemeColor(color) {
  settings.accentColor = color
  const colors = {
    blue: "#0ea5e9",
    purple: "#a855f7",
    green: "#10b981",
    orange: "#f97316",
    pink: "#ec4899",
  }
  document.documentElement.style.setProperty("--accent-blue", colors[color])
  document.documentElement.style.setProperty("--accent-blue-glow", `${colors[color]}33`)
}

function applyDensity(density) {
  settings.density = density
  document.body.classList.toggle("compact-mode", density === "compact")
}

function showSerendipityModal() {
  const modal = document.getElementById("serendipityModal")
  const content = document.getElementById("serendipityContent")

  // Generate random unexpected connections
  const page1 = mockRelatedPages[Math.floor(Math.random() * mockRelatedPages.length)]
  const page2 = mockRelatedPages[Math.floor(Math.random() * mockRelatedPages.length)]

  content.innerHTML = `
    <div class="serendipity-card">
      <div class="serendipity-icon">
        <i class="bi bi-lightbulb-fill"></i>
      </div>
      <h4 class="serendipity-title">Unexpected Connection Discovered!</h4>
      <p class="serendipity-description">
        You explored <strong>${page1.title}</strong> and <strong>${page2.title}</strong>. 
        Here's an interesting pattern we noticed:
      </p>
      <div class="connection-insight">
        <i class="bi bi-arrow-right-circle me-2"></i>
        Both topics share fundamental concepts about optimization and decision-making under uncertainty. 
        This suggests you're building expertise in adaptive systems!
      </div>
      <div class="serendipity-actions">
        <button class="btn btn-sm btn-primary" onclick="hideSerendipityModal()">Explore More</button>
      </div>
    </div>
  `

  modal.style.display = "flex"
}

function hideSerendipityModal() {
  document.getElementById("serendipityModal").style.display = "none"
}

function showEmptyState() {
  document.getElementById("emptyStateOverlay").style.display = "flex"
}

function hideEmptyState() {
  document.getElementById("emptyStateOverlay").style.display = "none"
}

function filterPages(query) {
  const container = document.getElementById("relatedPagesList")
  const items = container.querySelectorAll(".related-page-item")

  items.forEach((item) => {
    const title = item.querySelector(".page-title").textContent.toLowerCase()
    const description = item.querySelector(".page-description").textContent.toLowerCase()
    const searchQuery = query.toLowerCase()

    if (title.includes(searchQuery) || description.includes(searchQuery)) {
      item.style.display = "block"
    } else {
      item.style.display = "none"
    }
  })
}

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (!settings.keyboardShortcuts) return

    // Cmd/Ctrl + K for search
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault()
      document.getElementById("searchInput").focus()
    }

    // Cmd/Ctrl + G for graph
    if ((e.ctrlKey || e.metaKey) && e.key === "g") {
      e.preventDefault()
      if (document.getElementById("graphModal").style.display === "flex") {
        hideGraphModal()
      } else {
        showGraphModal()
      }
    }

    // Cmd/Ctrl + N for notes
    if ((e.ctrlKey || e.metaKey) && e.key === "n") {
      e.preventDefault()
      showCurrentPageNotesModal()
    }

    // Escape key
    if (e.key === "Escape") {
      if (document.getElementById("graphModal").style.display === "flex") {
        hideGraphModal()
      } else if (document.getElementById("currentPageNotesModal").style.display === "flex") {
        hideCurrentPageNotesModal()
      } else if (document.getElementById("settingsModal").style.display === "flex") {
        hideSettingsModal()
      } else if (document.getElementById("serendipityModal").style.display === "flex") {
        hideSerendipityModal()
      } else if (document.getElementById("detailView").style.display === "block") {
        showMainView()
      }
    }

    // Arrow keys for navigation (when not in input)
    if (!document.activeElement.matches("input, textarea")) {
      const pages = Array.from(document.querySelectorAll(".related-page-item"))
      const currentIndex = pages.findIndex((p) => p.matches(":hover"))

      if (e.key === "ArrowDown" && currentIndex < pages.length - 1) {
        e.preventDefault()
        pages[currentIndex + 1]?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      } else if (e.key === "ArrowUp" && currentIndex > 0) {
        e.preventDefault()
        pages[currentIndex - 1]?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      } else if (e.key === "Enter" && currentIndex >= 0) {
        e.preventDefault()
        pages[currentIndex]?.click()
      }
    }
  })
}
