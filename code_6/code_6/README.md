# MemoryPal Chrome Extension

A semantic memory system for web browsing that helps you visualize and interact with your browser memory.

## Features

- 🧠 **Semantic Memory**: Automatically summarizes and stores every webpage you visit
- 🔗 **Smart Connections**: Finds related pages based on semantic similarity
- 📊 **Knowledge Graph**: Visualize relationships between pages you've visited
- 🎚️ **Interactive Slider**: Control similarity threshold in real-time
- 🎨 **Beautiful UI**: Dark theme with electric blue accents and smooth animations

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory
5. The MemoryPal icon should appear in your toolbar

## Usage

### Popup View
Click the MemoryPal icon to see:
- Total pages stored
- Current page information
- Quick actions to analyze pages and open the memory panel

### Sidebar Panel
Open the full memory panel to:
- View current page summary
- Adjust similarity threshold with the interactive slider
- Browse related pages filtered by similarity
- Search through your memory

### Knowledge Graph
Visualize your browsing memory as an interactive graph:
- Nodes represent pages
- Edges show semantic connections
- Click nodes to see details
- Zoom, pan, and reset the layout

## Technology Stack

- **Bootstrap 5** - UI framework
- **Cytoscape.js** - Graph visualization
- **Chrome Extension Manifest V3** - Extension platform
- **Vanilla JavaScript** - No framework dependencies

## Mock Data

This version uses mock data for demonstration. In production, you would:
- Integrate with an AI API for summarization
- Generate embeddings for semantic search
- Store data in a proper database
- Implement real-time analysis

## Future Enhancements

- [ ] Real AI summarization integration
- [ ] Cloud sync across devices
- [ ] Export/import memory data
- [ ] Advanced search and filtering
- [ ] Tags and categories
- [ ] Privacy controls
- [ ] Performance analytics

## License

MIT License - Feel free to use and modify!
