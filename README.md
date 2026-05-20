# Gridlogo

Simple grid-based logo builder.

## Stack

- React
- TypeScript
- Vite
- Tailwind CSS
- SVG rendering

## Setup

```bash
pnpm install
pnpm dev
```

Open:

```txt
http://127.0.0.1:5173/
```

## Build

```bash
pnpm build
```

## Features

- Infinite-feeling grid canvas
- Slim top toolbar
- Square, right-angle triangle, circle, quarter-arc, and half-disk shapes
- Click a toolbar shape to add it at the current selection
- Shapes can be layered in the same grid square
- Click an empty cell to select it as the paste target
- Drag from an empty cell to select a region, including every layer in that region
- Click a shape cell to select the topmost shape only
- Command-click shapes to add/remove them from the selection
- Spacebar-drag pans the grid
- Arrow keys move the current selection
- Delete/Backspace removes the current selection
- Escape clears the current selection
- Undo/redo via toolbar or Command-Z / Command-Shift-Z
- Zoom controls plus Command-scroll / trackpad pinch-style zoom
- Preview is on by default and shows a square, capped-size export preview in the bottom-right corner
- Dark mode toggle
- URL hash stores the current logo configuration for sharing
- Preset dropdown includes 10 original geometric logo starters
- Command-C copies selected shapes
- Command-X cuts selected shapes
- Command-V pastes at the current selection top-left
- Latest canvas state is saved locally in localStorage
- Resize handles and drag-based rotate handle for single-shape selection
- Toolbar shapes do not rotate when canvas shapes rotate
- Export trims to the smallest bounding box around the logo
- Download supports SVG or PNG

## Export Behavior

SVG export creates a trimmed `viewBox` and a single boolean-unioned `<path>` for the mark. PNG export rasterizes that same merged SVG.
