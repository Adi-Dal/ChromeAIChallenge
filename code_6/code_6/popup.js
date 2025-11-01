// Mock data for demonstration
const mockData = {
  totalPages: 127,
  totalConnections: 342,
  currentPage: {
    title: "Understanding Policy Gradients in RL",
    url: "https://example.com/policy-gradients",
  },
}

// Initialize popup
document.addEventListener("DOMContentLoaded", () => {
  loadPopupData()
  setupEventListeners()
  animateStats()
})

function loadPopupData() {
  // Update stats with animation
  animateValue("totalPages", 0, mockData.totalPages, 1000)
  animateValue("totalConnections", 0, mockData.totalConnections, 1200)

  // Update current page
  document.getElementById("currentPageTitle").textContent = mockData.currentPage.title
}

function animateValue(id, start, end, duration) {
  const element = document.getElementById(id)
  const range = end - start
  const increment = range / (duration / 16)
  let current = start

  const timer = setInterval(() => {
    current += increment
    if (current >= end) {
      current = end
      clearInterval(timer)
    }
    element.textContent = Math.floor(current)
  }, 16)
}

function setupEventListeners() {
  // Analyze page button
  document.getElementById("analyzePage").addEventListener("click", function () {
    this.innerHTML = '<i class="bi bi-hourglass-split me-2"></i>Analyzing...'
    this.disabled = true

    setTimeout(() => {
      this.innerHTML = '<i class="bi bi-check-circle me-2"></i>Analyzed!'
      setTimeout(() => {
        this.innerHTML = '<i class="bi bi-lightning-charge me-2"></i>Analyze Current Page'
        this.disabled = false
      }, 1500)
    }, 2000)
  })

  // Open sidebar button
  window.chrome.tabs.create({ url: "sidebar.html" })

  // View graph button
  window.chrome.tabs.create({ url: "graph.html" })

  // Search memory button
  window.chrome.tabs.create({ url: "sidebar.html?search=true" })

  // Settings button
  document.getElementById("settings").addEventListener("click", () => {
    alert("Settings panel coming soon!")
  })
}

function animateStats() {
  const statCards = document.querySelectorAll(".stat-card")
  statCards.forEach((card, index) => {
    setTimeout(() => {
      card.style.animation = "slideUp 0.5s ease forwards"
    }, index * 100)
  })
}

// Add CSS animation
const style = document.createElement("style")
style.textContent = `
  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`
document.head.appendChild(style)
