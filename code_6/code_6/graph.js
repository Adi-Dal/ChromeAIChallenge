const mockGraphData = {
  nodes: [
    { id: "current", label: "Current Page", type: "page-current", url: "", summary: "" },
    { id: "ent:reinforcement-learning", label: "Reinforcement Learning", type: "entity", entityType: "Concept" },
    { id: "page:example", label: "Some Related Page", type: "page", url: "https://example.com/related", summary: "Example related page used as a fallback graph node." },
  ],
  edges: [
    { source: "current", target: "ent:reinforcement-learning", similarity: 0.7, relType: "MENTIONS" },
    { source: "ent:reinforcement-learning", target: "page:example", similarity: 0.45, relType: "MENTION_SHARED" },
  ],
}

const GRAPH_PADDING = 80
const ENTITY_RADIUS = 220
const ENTITY_PAGE_RADIUS = 320
const SIMILAR_PAGE_RADIUS = 420

let graphData = mockGraphData
let svg
let graphGroup
let edgeGroup
let nodeGroup
let nodeElements = new Map()
let transform = { scale: 1, tx: 0, ty: 0 }
let isPanning = false
let lastPanPoint = null

document.addEventListener("DOMContentLoaded", async () => {
  await hydrateGraphFromIndexedDB()
  initializeCanvas()
  renderGraph()
  setupEventListeners()
})

async function hydrateGraphFromIndexedDB() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    const activeUrl = tab?.url
    const activeTitle = tab?.title || "Current Page"
    const pages = (await window.MemoryPalDB?.getAllPages?.()) || []
    if (!pages.length) return

    const activePage = pages.find((p) => p.url === activeUrl) || pages[0]
    const pageNodeId = activePage.id

    const nodeMap = new Map()
    const edges = []
    const entityCache = new Map()
    const missingEntityIds = new Set()

    const addNode = (node) => {
      if (!node?.id) return
      const existing = nodeMap.get(node.id)
      nodeMap.set(node.id, existing ? { ...existing, ...node } : node)
    }

    const clampSimilarity = (value) => Math.max(0.05, Math.min(1, value))

    addNode({
      id: pageNodeId,
      label: activePage.title || activeTitle,
      type: "page-current",
      url: activePage.url,
      summary: activePage.summary,
    })

    const rels = await window.MemoryPalDB.getRelationsBySource("page", pageNodeId)
    const mentionRels = rels
      .filter((r) => r.relType === "MENTIONS")
      .sort((a, b) => (b.weight || 1) - (a.weight || 1))
      .slice(0, 8)

    const entityIds = mentionRels.map((r) => r.targetId)
    const entities = await window.MemoryPalDB.getEntitiesByIds(entityIds)
    for (const ent of entities) entityCache.set(ent.id, ent)

    for (const ent of entities) {
      addNode({
        id: ent.id,
        label: ent.name,
        type: "entity",
        entityType: ent.type,
      })

      const weight = mentionRels.find((r) => r.targetId === ent.id)?.weight || 1
      edges.push({
        source: pageNodeId,
        target: ent.id,
        similarity: clampSimilarity(0.25 + Math.log1p(weight)),
        relType: "MENTIONS",
      })

      const incoming = await window.MemoryPalDB.getRelationsByTarget("entity", ent.id)
      const relatedPageIds = Array.from(
        new Set(
          incoming
            .filter((r) => r.sourceType === "page" && r.sourceId !== pageNodeId)
            .map((r) => r.sourceId)
        )
      ).slice(0, 4)

      if (relatedPageIds.length) {
        const relatedPages = await window.MemoryPalDB.getPagesByIds(relatedPageIds)
        for (const page of relatedPages) {
          addNode({
            id: page.id,
            label: page.title || page.url,
            type: "page",
            url: page.url,
            summary: page.summary,
          })
          edges.push({
            source: ent.id,
            target: page.id,
            similarity: clampSimilarity(0.35),
            relType: "MENTION_SHARED",
          })
        }
      }

      const coRelations = await window.MemoryPalDB.getRelationsBySource("entity", ent.id)
      const coTargets = coRelations
        .filter((r) => r.relType === "CO_MENTION")
        .sort((a, b) => (b.weight || 1) - (a.weight || 1))
        .slice(0, 4)

      for (const rel of coTargets) {
        if (!entityCache.has(rel.targetId)) missingEntityIds.add(rel.targetId)
        const target = entityCache.get(rel.targetId)
        addNode({
          id: rel.targetId,
          label: target?.name || rel.targetId,
          type: "entity",
          entityType: target?.type,
        })
        edges.push({
          source: ent.id,
          target: rel.targetId,
          similarity: clampSimilarity(0.25 + (rel.weight || 0) / 5),
          relType: "CO_MENTION",
        })
      }
    }

    if (missingEntityIds.size) {
      const extras = await window.MemoryPalDB.getEntitiesByIds(Array.from(missingEntityIds))
      for (const ent of extras) {
        entityCache.set(ent.id, ent)
        const existing = nodeMap.get(ent.id)
        if (existing) {
          nodeMap.set(ent.id, { ...existing, label: ent.name || existing.label, entityType: ent.type || existing.entityType })
        } else {
          addNode({ id: ent.id, label: ent.name, type: "entity", entityType: ent.type })
        }
      }
    }

    const similarPageRels = rels
      .filter((r) => r.relType === "PAGE_SIMILAR")
      .sort((a, b) => (b.weight || 0) - (a.weight || 0))
      .slice(0, 8)
    if (similarPageRels.length) {
      const similarIds = similarPageRels.map((r) => r.targetId)
      const similarPages = await window.MemoryPalDB.getPagesByIds(similarIds)
      for (const rel of similarPageRels) {
        const page = similarPages.find((p) => p.id === rel.targetId)
        if (!page) continue
        addNode({
          id: page.id,
          label: page.title || page.url,
          type: "page",
          url: page.url,
          summary: page.summary,
        })
        edges.push({
          source: pageNodeId,
          target: page.id,
          similarity: clampSimilarity(rel.weight || 0.3),
          relType: "PAGE_SIMILAR",
        })
      }
    }

    graphData = {
      nodes: Array.from(nodeMap.values()),
      edges,
    }
  } catch (e) {
    console.warn("Graph hydration failed, using mock data", e)
  }
}

function initializeCanvas() {
  const container = document.getElementById("cy")
  if (!container) return
  container.innerHTML = ""
  svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("class", "graph-svg w-100 h-100")
  svg.setAttribute("role", "presentation")
  graphGroup = document.createElementNS("http://www.w3.org/2000/svg", "g")
  edgeGroup = document.createElementNS("http://www.w3.org/2000/svg", "g")
  nodeGroup = document.createElementNS("http://www.w3.org/2000/svg", "g")
  graphGroup.append(edgeGroup, nodeGroup)
  svg.appendChild(graphGroup)
  container.appendChild(svg)

  svg.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return
    isPanning = true
    lastPanPoint = { x: e.clientX, y: e.clientY }
  })

  window.addEventListener("mousemove", (e) => {
    if (!isPanning) return
    const dx = e.clientX - lastPanPoint.x
    const dy = e.clientY - lastPanPoint.y
    lastPanPoint = { x: e.clientX, y: e.clientY }
    transform.tx += dx
    transform.ty += dy
    applyTransform()
  })

  window.addEventListener("mouseup", () => {
    isPanning = false
  })
}

function renderGraph() {
  if (!graphGroup) return
  nodeElements.clear()
  edgeGroup.innerHTML = ""
  nodeGroup.innerHTML = ""

  if (!graphData?.nodes?.length) {
    const container = document.getElementById("cy")
    container.innerHTML = `
      <div class="d-flex flex-column justify-content-center align-items-center h-100 text-secondary">
        <i class="bi bi-diagram-3 fs-1 mb-2"></i>
        <p class="mb-0">No knowledge graph data available yet. Browse a few related pages to populate it.</p>
      </div>
    `
    return
  }

  const layout = computeLayout(graphData)

  for (const edge of graphData.edges) {
    const source = layout.get(edge.source)
    const target = layout.get(edge.target)
    if (!source || !target) continue
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line")
    line.setAttribute("x1", source.x)
    line.setAttribute("y1", source.y)
    line.setAttribute("x2", target.x)
    line.setAttribute("y2", target.y)
    line.setAttribute("class", `graph-edge edge-${(edge.relType || "generic").toLowerCase()}`)
    line.setAttribute("data-similarity", edge.similarity?.toFixed(2) || "0")
    edgeGroup.appendChild(line)
  }

  for (const node of graphData.nodes) {
    const pos = layout.get(node.id)
    if (!pos) continue
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g")
    group.setAttribute("class", `graph-node node-${node.type}`)
    group.setAttribute("transform", `translate(${pos.x}, ${pos.y})`)
    group.dataset.nodeId = node.id

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle")
    circle.setAttribute("r", node.type === "page-current" ? 26 : 20)
    group.appendChild(circle)

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text")
    text.setAttribute("class", "graph-node-label")
    text.setAttribute("text-anchor", "middle")
    text.setAttribute("y", node.type === "page-current" ? 42 : 36)
    text.textContent = node.label
    group.appendChild(text)

    group.addEventListener("click", () => {
      showNodeInfo(node, computeNodeConnections(node.id))
      highlightNode(node.id)
    })

    group.addEventListener("mouseenter", () => {
      group.classList.add("node-hover")
    })
    group.addEventListener("mouseleave", () => {
      group.classList.remove("node-hover")
    })

    nodeGroup.appendChild(group)
    nodeElements.set(node.id, group)
  }

  transform = { scale: 1, tx: 0, ty: 0 }
  applyTransform()
  requestAnimationFrame(() => fitView())
}

function computeLayout(data) {
  const positions = new Map()
  const centerNode = data.nodes.find((n) => n.type === "page-current") || data.nodes[0]
  positions.set(centerNode.id, { x: 0, y: 0 })

  const entities = data.nodes.filter((n) => n.type === "entity")
  const pages = data.nodes.filter((n) => n.type === "page")

  entities.forEach((node, index) => {
    const angle = (index / Math.max(entities.length, 1)) * Math.PI * 2
    positions.set(node.id, {
      x: ENTITY_RADIUS * Math.cos(angle),
      y: ENTITY_RADIUS * Math.sin(angle),
    })
  })

  const entityPageMap = new Map()
  data.edges
    .filter((edge) => edge.relType === "MENTION_SHARED")
    .forEach((edge) => {
      if (!entityPageMap.has(edge.source)) entityPageMap.set(edge.source, [])
      entityPageMap.get(edge.source).push(edge.target)
    })

  for (const [entityId, pageIds] of entityPageMap.entries()) {
    const basePosition = positions.get(entityId) || { x: 0, y: 0 }
    const baseAngle = Math.atan2(basePosition.y, basePosition.x)
    pageIds.forEach((pageId, idx) => {
      const offset = ((idx + 1) / (pageIds.length + 1) - 0.5) * (Math.PI / 1.8)
      const angle = baseAngle + offset
      positions.set(pageId, {
        x: basePosition.x + ENTITY_PAGE_RADIUS * Math.cos(angle),
        y: basePosition.y + ENTITY_PAGE_RADIUS * Math.sin(angle),
      })
    })
  }

  const placedPages = new Set(positions.keys())
  const similarPages = pages.filter((page) => !placedPages.has(page.id))

  similarPages.forEach((node, index) => {
    const angle = (index / Math.max(similarPages.length, 1)) * Math.PI * 2
    positions.set(node.id, {
      x: SIMILAR_PAGE_RADIUS * Math.cos(angle),
      y: SIMILAR_PAGE_RADIUS * Math.sin(angle),
    })
  })

  return positions
}

function setupEventListeners() {
  document.getElementById("backBtn").addEventListener("click", () => {
    window.history.back()
  })

  document.getElementById("zoomInBtn").addEventListener("click", () => {
    transform.scale *= 1.2
    applyTransform()
  })

  document.getElementById("zoomOutBtn").addEventListener("click", () => {
    transform.scale *= 0.8
    applyTransform()
  })

  document.getElementById("fitBtn").addEventListener("click", () => {
    fitView()
  })

  document.getElementById("resetBtn").addEventListener("click", () => {
    transform = { scale: 1, tx: 0, ty: 0 }
    applyTransform()
  })

  document.getElementById("closeInfoBtn").addEventListener("click", () => {
    document.getElementById("infoPanel").classList.remove("active")
    clearNodeHighlight()
  })
}

function applyTransform() {
  if (!graphGroup) return
  graphGroup.setAttribute("transform", `translate(${transform.tx}, ${transform.ty}) scale(${transform.scale})`)
}

function fitView() {
  if (!graphGroup || !svg) return
  const bbox = graphGroup.getBBox()
  if (!isFinite(bbox.width) || bbox.width === 0 || bbox.height === 0) {
    transform = { scale: 1, tx: 0, ty: 0 }
    applyTransform()
    return
  }
  const container = svg.getBoundingClientRect()
  const scale = Math.min(
    (container.width - GRAPH_PADDING) / bbox.width,
    (container.height - GRAPH_PADDING) / bbox.height
  )
  transform.scale = Math.max(0.3, Math.min(scale, 3))
  transform.tx = container.width / 2 - (bbox.x + bbox.width / 2) * transform.scale
  transform.ty = container.height / 2 - (bbox.y + bbox.height / 2) * transform.scale
  applyTransform()
}

function computeNodeConnections(nodeId) {
  const connections = []
  for (const edge of graphData.edges) {
    if (edge.source === nodeId) {
      const target = graphData.nodes.find((n) => n.id === edge.target)
      if (target) {
        connections.push({
          id: target.id,
          label: target.label,
          relType: edge.relType,
          similarity: edge.similarity,
        })
      }
    } else if (edge.target === nodeId) {
      const source = graphData.nodes.find((n) => n.id === edge.source)
      if (source) {
        connections.push({
          id: source.id,
          label: source.label,
          relType: edge.relType,
          similarity: edge.similarity,
        })
      }
    }
  }
  return connections
}

function highlightNode(nodeId) {
  nodeElements.forEach((el, id) => {
    if (id === nodeId) el.classList.add("node-selected")
    else el.classList.remove("node-selected")
  })
}

function clearNodeHighlight() {
  nodeElements.forEach((el) => el.classList.remove("node-selected"))
}

function showNodeInfo(nodeData, connections) {
  const infoPanel = document.getElementById("infoPanel")
  const infoContent = document.getElementById("infoContent")
  if (!infoContent || !infoPanel) return

  const nodeTypeLabel =
    nodeData.type === "entity"
      ? nodeData.entityType || "Entity"
      : nodeData.type === "page-current"
      ? "Current Page"
      : "Page"

  const description =
    nodeData.type === "entity"
      ? `Identified <strong>${nodeTypeLabel}</strong> from your browsing context.`
      : nodeData.summary
      ? nodeData.summary
      : "Related page discovered from your local knowledge graph."

  const connectionItems = connections.slice(0, 8).map((conn) => {
    const score = conn.similarity != null ? `${Math.round(conn.similarity * 100)}%` : ""
    return `<li><strong>${conn.label}</strong><span class="ms-2 badge bg-secondary text-uppercase">${conn.relType || "related"}</span><span class="float-end text-muted">${score}</span></li>`
  })

  const connectionHtml = connectionItems.length
    ? `<div class="node-meta mt-3">
        <div class="meta-row">
          <span class="meta-label">Connections (${connections.length})</span>
        </div>
        <ul class="list-unstyled node-connection-list">${connectionItems.join("")}</ul>
      </div>`
    : ""

  infoContent.innerHTML = `
    <h4 class="node-title">${nodeData.label}</h4>
    <p class="node-description">${description}</p>
    <div class="node-meta">
      <div class="meta-row">
        <span class="meta-label">Type</span>
        <span class="meta-value">${nodeTypeLabel}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Connections</span>
        <span class="meta-value">${connections.length}</span>
      </div>
    </div>
    ${connectionHtml}
    ${
      nodeData.type === "page" || nodeData.type === "page-current"
        ? `<button class="btn btn-primary btn-sm w-100 mt-3" id="openNodeBtn">
             <i class="bi bi-box-arrow-up-right me-2"></i>
             Open Page
           </button>`
        : ""
    }
  `

  if (nodeData.type === "page" || nodeData.type === "page-current") {
    document.getElementById("openNodeBtn")?.addEventListener("click", () => {
      tryOpenNode(nodeData.id, nodeData.url)
    })
  }

  infoPanel.classList.add("active")
}

window.tryOpenNode = (nodeId, directUrl) => {
  if (directUrl) {
    window.open(directUrl, "_blank")
    return
  }
  if (!nodeId) return
  window.MemoryPalDB.getPagesByIds([nodeId]).then((pages) => {
    const page = pages?.[0]
    if (page?.url) window.open(page.url, "_blank")
  })
}
