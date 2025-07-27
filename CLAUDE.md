# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Azgaar's Fantasy Map Generator is a web-based cartography tool for creating fantasy maps. It's a client-side JavaScript application that runs entirely in the browser without backend dependencies.

## Development Commands

### Running the Application
- `./run_python_server.sh` - Start development server on Linux/macOS (opens Chromium browser)
- `run_python_server.bat` - Start development server on Windows (opens Chrome browser)
- `run_php_server.bat` - Alternative PHP server option for Windows
- Both scripts serve the application on `http://localhost:8000`

### Docker Development
- `docker build -t fmg .` - Build Docker image using nginx
- Container serves static files via nginx

## Architecture Overview

### Core Structure
- **Single Page Application**: All functionality runs client-side in the browser
- **Main Entry Point**: `index.html` loads `main.js` which initializes the entire application
- **Modular Design**: Core logic split across specialized modules in `/modules/`
- **No Build Process**: Pure ES6 modules loaded directly by the browser
- **SVG-Based Rendering**: Maps rendered as scalable vector graphics using D3.js

### Key Directories

**`/modules/`** - Core application logic organized by function:
- **Generators**: `heightmap-generator.js`, `names-generator.js`, `cultures-generator.js`, `religions-generator.js`, etc.
- **Renderers**: `renderers/` - Drawing functions for map elements (borders, labels, icons, etc.)
- **UI**: `ui/` - Editor interfaces and tools for manipulating map data
- **I/O**: `io/` - Save/load functionality and export options
- **Dynamic**: `dynamic/` - Runtime-loaded features and editor interfaces

**`/utils/`** - Utility functions organized by domain (arrays, colors, numbers, strings, etc.)

**`/libs/`** - Third-party dependencies (D3.js, jQuery, Three.js for 3D view, etc.)

### Data Flow Architecture
1. **Map Generation**: Heightmap → Voronoi cells → Geographic features → Political entities
2. **Rendering Pipeline**: Data structures → SVG layer management → Visual output
3. **User Interaction**: UI editors modify data → Re-render affected layers
4. **Persistence**: JSON serialization for save/load, multiple export formats

### Module Dependencies
- **D3.js**: Primary rendering and DOM manipulation library
- **Voronoi Diagrams**: Core spatial data structure for map cells
- **ES6 Modules**: Dynamic imports used extensively for code splitting
- **No Framework**: Vanilla JavaScript with jQuery for some UI interactions

### Key Technical Concepts
- **Graph-based Geography**: Map represented as connected cells with properties
- **Layered Rendering**: Separate SVG groups for different map elements
- **Procedural Generation**: Algorithmic creation of realistic geographic and political features
- **Real-time Editing**: Direct manipulation of generated content through specialized editors

### File Naming Conventions
- Generators: `*-generator.js`
- Renderers: `draw-*.js` 
- Editors: `*-editor.js`
- Utilities: `*Utils.js`

The application is designed for extensibility - new generators, renderers, and editors can be added by following existing patterns in their respective directories.