;(function (global) {
  const EMBEDDING_DIM = 384

  function tokenize(text) {
    return (text || '')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  }

  function hashToken(token) {
    let h = 2166136261 >>> 0
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i)
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)
    }
    return h >>> 0
  }

  function l2Normalize(vec) {
    let sumSq = 0
    for (let i = 0; i < vec.length; i++) {
      sumSq += vec[i] * vec[i]
    }
    const norm = Math.sqrt(sumSq) || 1
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= norm
    }
    return vec
  }

  function computeEmbedding(text) {
    const tokens = tokenize(text)
    const vec = new Float32Array(EMBEDDING_DIM)
    if (!tokens.length) return vec
    for (const token of tokens) {
      const hash = hashToken(token)
      const idx = hash % EMBEDDING_DIM
      const sign = (hash & 1) === 0 ? 1 : -1
      vec[idx] += sign
    }
    return l2Normalize(vec)
  }

  function cosineSimilarity(a, b) {
    if (!a || !b) return 0
    const len = Math.min(a.length, b.length)
    if (!len) return 0
    let dot = 0
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i]
    }
    return dot
  }

  global.MemoryPalEmbeddings = {
    EMBEDDING_DIM,
    tokenize,
    computeEmbedding,
    cosineSimilarity,
  }
})(typeof self !== 'undefined' ? self : window)
