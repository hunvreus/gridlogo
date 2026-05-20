import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Download, Eye, Minus, Moon, Plus, Redo2, Sun, Trash2, Undo2 } from "lucide-react";
import paper from "paper";
import "./styles.css";

const CELL = 48;
const HANDLE = 10;
const ROTATE_OFFSET = 28;
const DRAG_THRESHOLD = 4;
const STORAGE_KEY = "gridlogo.state.v1";
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

type Shape = "square" | "triangle" | "circle" | "arc" | "halfDisk";
type Rotation = 0 | 90 | 180 | 270;
type Corner = "nw" | "ne" | "se" | "sw";

type CellPoint = { row: number; col: number };
type PixelPoint = { x: number; y: number };
type Bounds = { row1: number; col1: number; row2: number; col2: number };
type Item = {
  id: string;
  shape: Shape;
  row: number;
  col: number;
  size: number;
  rotation: Rotation;
};
type CopiedItem = Omit<Item, "id" | "row" | "col"> & {
  rowOffset: number;
  colOffset: number;
};
type PresetItem = Omit<Item, "id">;
type Preset = {
  name: string;
  items: PresetItem[];
};
type UrlItem = {
  s: Shape;
  r: number;
  c: number;
  z: number;
  o: Rotation;
};
type DownloadFormat = "svg" | "png";
type HistoryState = {
  past: Item[][];
  present: Item[];
  future: Item[][];
};
type PersistedState = {
  items: Item[];
  selectedCell: CellPoint | null;
  zoom: number;
  pan: PixelPoint;
  darkMode: boolean;
};
type DragState =
  | {
      kind: "pan";
      startX: number;
      startY: number;
      startPan: PixelPoint;
      moved: boolean;
      hitId: string | null;
    }
  | {
      kind: "select";
      start: CellPoint;
      cell: CellPoint;
    }
  | {
      kind: "move";
      ids: string[];
      beforeItems: Item[];
      startCell: CellPoint;
      lastDelta: CellPoint;
      started: { id: string; row: number; col: number }[];
      moved: boolean;
      startX: number;
      startY: number;
    }
  | {
      kind: "resize";
      ids: string[];
      beforeItems: Item[];
      corner: Corner;
      started: Item[];
      startBounds: Bounds;
      visual: Bounds;
    }
  | {
      kind: "rotate";
      ids: string[];
      beforeItems: Item[];
      started: Item[];
      startBounds: Bounds;
      visualRotation: number;
    };

const shapes: Shape[] = ["square", "triangle", "circle", "arc", "halfDisk"];

function base64UrlEncode(value: string) {
  return btoa(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

function itemsFromUrlHash(): Item[] | null {
  if (typeof window === "undefined") return null;
  const encoded = new URLSearchParams(window.location.hash.slice(1)).get("g");
  if (!encoded) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(encoded)) as { i?: UrlItem[] };
    if (!Array.isArray(parsed.i)) return null;
    return parsed.i
      .filter((item) => shapes.includes(item.s))
      .map((item) => ({
        id: id(),
        shape: item.s,
        row: Number(item.r) || 0,
        col: Number(item.c) || 0,
        size: Math.max(1, Number(item.z) || 1),
        rotation: snapRotation(Number(item.o) || 0),
      }));
  } catch {
    return null;
  }
}

function urlHashFromItems(items: Item[]) {
  if (items.length === 0) return "";
  const payload = {
    i: items.map((item) => ({
      s: item.shape,
      r: item.row,
      c: item.col,
      z: item.size,
      o: item.rotation,
    })),
  };
  return `#g=${base64UrlEncode(JSON.stringify(payload))}`;
}

function normalizePreset(items: PresetItem[]) {
  const bounds = boundsOfItems(items as Item[]);
  if (!bounds) return [];
  return items.map((item) => ({
    ...item,
    row: item.row - bounds.row1,
    col: item.col - bounds.col1,
  }));
}

function presetItem(shape: Shape, row: number, col: number, rotation: Rotation = 0, size = 1): PresetItem {
  return { shape, row, col, rotation, size };
}

const presets: Preset[] = [
  {
    name: "01 Aperture Mark",
    items: normalizePreset([
      presetItem("arc", 0, 0, 0),
      presetItem("arc", 0, 1, 90),
      presetItem("arc", 1, 0, 270),
      presetItem("arc", 1, 1, 180),
      presetItem("circle", 0, 2),
      presetItem("square", 1, 2),
    ]),
  },
  {
    name: "02 Arrow Gate",
    items: normalizePreset([
      presetItem("square", 0, 0),
      presetItem("triangle", 0, 1, 90),
      presetItem("triangle", 1, 0, 270),
      presetItem("square", 1, 1),
      presetItem("halfDisk", 0, 2, 90),
      presetItem("halfDisk", 1, 2, 90),
    ]),
  },
  {
    name: "03 Monolith",
    items: normalizePreset([
      presetItem("square", 0, 0),
      presetItem("circle", 0, 1),
      presetItem("halfDisk", 1, 0, 270),
      presetItem("square", 1, 1),
      presetItem("arc", 2, 0, 270),
      presetItem("triangle", 2, 1, 180),
    ]),
  },
  {
    name: "04 Orbit Leaf",
    items: normalizePreset([
      presetItem("circle", 0, 0),
      presetItem("arc", 0, 1, 90),
      presetItem("halfDisk", 1, 0, 0),
      presetItem("triangle", 1, 1, 90),
      presetItem("arc", 1, 2, 180),
    ]),
  },
  {
    name: "05 Keystone",
    items: normalizePreset([
      presetItem("triangle", 0, 0, 90),
      presetItem("square", 0, 1),
      presetItem("triangle", 0, 2, 180),
      presetItem("halfDisk", 1, 0, 270),
      presetItem("circle", 1, 1),
      presetItem("halfDisk", 1, 2, 90),
    ]),
  },
  {
    name: "06 Ribbon",
    items: normalizePreset([
      presetItem("halfDisk", 0, 0, 90),
      presetItem("square", 0, 1),
      presetItem("triangle", 0, 2, 180),
      presetItem("triangle", 1, 0, 0),
      presetItem("square", 1, 1),
      presetItem("halfDisk", 1, 2, 270),
    ]),
  },
  {
    name: "07 Signal",
    items: normalizePreset([
      presetItem("circle", 0, 0),
      presetItem("arc", 0, 1, 90),
      presetItem("arc", 0, 2, 90),
      presetItem("square", 1, 0),
      presetItem("triangle", 1, 1, 90),
      presetItem("halfDisk", 1, 2, 90),
    ]),
  },
  {
    name: "08 Stone Path",
    items: normalizePreset([
      presetItem("square", 0, 0),
      presetItem("halfDisk", 0, 1, 0),
      presetItem("circle", 1, 0),
      presetItem("triangle", 1, 1, 90),
      presetItem("arc", 2, 1, 180),
      presetItem("square", 2, 2),
    ]),
  },
  {
    name: "09 Window",
    items: normalizePreset([
      presetItem("arc", 0, 0, 0),
      presetItem("arc", 0, 1, 90),
      presetItem("square", 1, 0),
      presetItem("square", 1, 1),
      presetItem("triangle", 1, 2, 180),
      presetItem("circle", 0, 2),
    ]),
  },
  {
    name: "10 Beacon",
    items: normalizePreset([
      presetItem("halfDisk", 0, 1, 0),
      presetItem("triangle", 1, 0, 0),
      presetItem("square", 1, 1),
      presetItem("triangle", 1, 2, 180),
      presetItem("circle", 2, 1),
      presetItem("arc", 2, 2, 180),
    ]),
  },
];

function loadPersistedState(): PersistedState {
  if (typeof window === "undefined") {
    return { items: [], selectedCell: null, zoom: 1, pan: { x: 0, y: 0 }, darkMode: false };
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<PersistedState> | null;
    const hashItems = itemsFromUrlHash();
    return {
      items: hashItems ?? (Array.isArray(parsed?.items) ? parsed.items : []),
      selectedCell: parsed?.selectedCell ?? null,
      zoom: typeof parsed?.zoom === "number" ? parsed.zoom : 1,
      pan: parsed?.pan ?? { x: 0, y: 0 },
      darkMode: Boolean(parsed?.darkMode),
    };
  } catch {
    return { items: [], selectedCell: null, zoom: 1, pan: { x: 0, y: 0 }, darkMode: false };
  }
}

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function snapRotation(degrees: number): Rotation {
  return (((Math.round(degrees / 90) * 90 + 360) % 360) as Rotation);
}

function itemBounds(item: Pick<Item, "row" | "col" | "size">): Bounds {
  return {
    row1: item.row,
    col1: item.col,
    row2: item.row + item.size,
    col2: item.col + item.size,
  };
}

function boundsIntersect(a: Bounds, b: Bounds) {
  return a.col1 < b.col2 && a.col2 > b.col1 && a.row1 < b.row2 && a.row2 > b.row1;
}

function boundsFromCells(a: CellPoint, b: CellPoint): Bounds {
  return {
    row1: Math.min(a.row, b.row),
    col1: Math.min(a.col, b.col),
    row2: Math.max(a.row, b.row) + 1,
    col2: Math.max(a.col, b.col) + 1,
  };
}

function resizedBounds(start: Bounds, corner: Corner, cell: CellPoint): Bounds {
  if (corner === "se") {
    return {
      ...start,
      row2: Math.max(start.row1 + 1, cell.row + 1),
      col2: Math.max(start.col1 + 1, cell.col + 1),
    };
  }

  if (corner === "nw") {
    return {
      ...start,
      row1: Math.min(start.row2 - 1, cell.row),
      col1: Math.min(start.col2 - 1, cell.col),
    };
  }

  if (corner === "ne") {
    return {
      ...start,
      row1: Math.min(start.row2 - 1, cell.row),
      col2: Math.max(start.col1 + 1, cell.col + 1),
    };
  }

  return {
    ...start,
    row2: Math.max(start.row1 + 1, cell.row + 1),
    col1: Math.min(start.col2 - 1, cell.col),
  };
}

function boundsOfItems(items: Item[]): Bounds | null {
  if (items.length === 0) return null;
  return {
    row1: Math.min(...items.map((item) => item.row)),
    col1: Math.min(...items.map((item) => item.col)),
    row2: Math.max(...items.map((item) => item.row + item.size)),
    col2: Math.max(...items.map((item) => item.col + item.size)),
  };
}

function resizeItems(items: Item[], from: Bounds, to: Bounds) {
  const fromWidth = Math.max(1, from.col2 - from.col1);
  const fromHeight = Math.max(1, from.row2 - from.row1);
  const toWidth = Math.max(1, to.col2 - to.col1);
  const toHeight = Math.max(1, to.row2 - to.row1);
  const scaleX = toWidth / fromWidth;
  const scaleY = toHeight / fromHeight;
  const sizeScale = Math.max(1 / Math.max(...items.map((item) => item.size)), Math.min(scaleX, scaleY));

  return items.map((item) => ({
    ...item,
    row: to.row1 + Math.round((item.row - from.row1) * scaleY),
    col: to.col1 + Math.round((item.col - from.col1) * scaleX),
    size: Math.max(1, Math.round(item.size * sizeScale)),
  }));
}

function rotateItems(items: Item[], bounds: Bounds, rotation: Rotation) {
  const width = bounds.col2 - bounds.col1;
  const height = bounds.row2 - bounds.row1;

  return items.map((item) => {
    const relRow = item.row - bounds.row1;
    const relCol = item.col - bounds.col1;
    const nextRotation = snapRotation(item.rotation + rotation);

    if (rotation === 90) {
      return {
        ...item,
        row: bounds.row1 + relCol,
        col: bounds.col1 + height - relRow - item.size,
        rotation: nextRotation,
      };
    }

    if (rotation === 180) {
      return {
        ...item,
        row: bounds.row1 + height - relRow - item.size,
        col: bounds.col1 + width - relCol - item.size,
        rotation: nextRotation,
      };
    }

    if (rotation === 270) {
      return {
        ...item,
        row: bounds.row1 + width - relCol - item.size,
        col: bounds.col1 + relRow,
        rotation: nextRotation,
      };
    }

    return item;
  });
}

function shapePath(shape: Shape, rotation: Rotation, x: number, y: number, size: number) {
  const r = size / 2;
  const cx = x + r;
  const cy = y + r;

  if (shape === "square") return `M ${x} ${y} H ${x + size} V ${y + size} H ${x} Z`;
  if (shape === "circle") {
    return `M ${cx} ${y} A ${r} ${r} 0 1 1 ${cx} ${y + size} A ${r} ${r} 0 1 1 ${cx} ${y} Z`;
  }
  if (shape === "triangle") {
    const points: Record<Rotation, string> = {
      0: `${x} ${y} ${x + size} ${y} ${x} ${y + size}`,
      90: `${x + size} ${y} ${x + size} ${y + size} ${x} ${y}`,
      180: `${x + size} ${y + size} ${x} ${y + size} ${x + size} ${y}`,
      270: `${x} ${y + size} ${x} ${y} ${x + size} ${y + size}`,
    };
    return `M ${points[rotation]} Z`;
  }

  if (shape === "halfDisk") {
    const disks: Record<Rotation, string> = {
      0: `M ${x} ${y + size} H ${x + size} A ${r} ${r} 0 0 0 ${x} ${y + size} Z`,
      90: `M ${x} ${y} V ${y + size} A ${r} ${r} 0 0 0 ${x} ${y} Z`,
      180: `M ${x + size} ${y} H ${x} A ${r} ${r} 0 0 0 ${x + size} ${y} Z`,
      270: `M ${x + size} ${y + size} V ${y} A ${r} ${r} 0 0 0 ${x + size} ${y + size} Z`,
    };
    return disks[rotation];
  }

  const arcs: Record<Rotation, string> = {
    0: `M ${x} ${y} H ${x + size} A ${size} ${size} 0 0 1 ${x} ${y + size} Z`,
    90: `M ${x + size} ${y} V ${y + size} A ${size} ${size} 0 0 1 ${x} ${y} Z`,
    180: `M ${x + size} ${y + size} H ${x} A ${size} ${size} 0 0 1 ${x + size} ${y} Z`,
    270: `M ${x} ${y + size} V ${y} A ${size} ${size} 0 0 1 ${x + size} ${y + size} Z`,
  };
  return arcs[rotation];
}

function mergePaths(paths: string[], width: number, height: number) {
  if (paths.length === 0) return "";

  const scope = new paper.PaperScope();
  scope.setup(new scope.Size(width, height));

  try {
    const paperPaths = paths.map((path) => new scope.Path(path));
    const merged = paperPaths
      .slice(1)
      .reduce<paper.PathItem>((result, path) => result.unite(path, { insert: false }), paperPaths[0]);
    const pathData = "pathData" in merged ? String(merged.pathData) : paths.join(" ");

    paperPaths.forEach((path) => path.remove());
    merged.remove();
    return pathData;
  } finally {
    scope.project?.remove();
  }
}

function exportSvg(items: Item[]) {
  const bounds = boundsOfItems(items);
  if (!bounds) return null;

  const width = (bounds.col2 - bounds.col1) * CELL;
  const height = (bounds.row2 - bounds.row1) * CELL;
  const paths = items.map((item) => {
    const x = (item.col - bounds.col1) * CELL;
    const y = (item.row - bounds.row1) * CELL;
    return shapePath(item.shape, item.rotation, x, y, item.size * CELL);
  });
  const path = mergePaths(paths, width, height);

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><path d="${path}" fill="#111111" fill-rule="nonzero"/></svg>`,
    width,
    height,
  };
}

function App() {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const spacePressedRef = useRef(false);
  const initialState = useMemo(loadPersistedState, []);
  const [history, setHistory] = useState<HistoryState>({
    past: [],
    present: initialState.items,
    future: [],
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedCell, setSelectedCell] = useState<CellPoint | null>(initialState.selectedCell);
  const [clipboard, setClipboard] = useState<CopiedItem[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [viewport, setViewport] = useState({ width: 1200, height: 800 });
  const [zoom, setZoom] = useState(initialState.zoom);
  const [pan, setPan] = useState<PixelPoint>(initialState.pan);
  const [showPreview, setShowPreview] = useState(true);
  const [darkMode, setDarkMode] = useState(initialState.darkMode);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>("svg");
  const items = history.present;

  const origin = useMemo(
    () => ({ x: Math.round(viewport.width / 2 + pan.x), y: Math.round(viewport.height / 2 + pan.y) }),
    [viewport, pan],
  );
  const selected = useMemo(
    () => items.filter((item) => selectedIds.includes(item.id)),
    [items, selectedIds],
  );
  const selectedBounds = boundsOfItems(selected);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  function setDocumentItems(updater: Item[] | ((current: Item[]) => Item[]), trackHistory = true) {
    setHistory((current) => {
      const next = typeof updater === "function" ? updater(current.present) : updater;
      if (JSON.stringify(next) === JSON.stringify(current.present)) return current;

      return {
        past: trackHistory ? [...current.past, current.present] : current.past,
        present: next,
        future: trackHistory ? [] : current.future,
      };
    });
  }

  function undo() {
    setHistory((current) => {
      const previous = current.past[current.past.length - 1];
      if (!previous) return current;
      setSelectedIds([]);
      setSelectedCell(null);
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
      };
    });
  }

  function redo() {
    setHistory((current) => {
      const next = current.future[0];
      if (!next) return current;
      setSelectedIds([]);
      setSelectedCell(null);
      return {
        past: [...current.past, current.present],
        present: next,
        future: current.future.slice(1),
      };
    });
  }

  function setClampedZoom(nextZoom: number) {
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(nextZoom.toFixed(2)))));
  }

  function screenForCell(cell: CellPoint) {
    return {
      x: origin.x + cell.col * CELL * zoom,
      y: origin.y + cell.row * CELL * zoom,
    };
  }

  function cellFromEvent(event: PointerEvent | React.PointerEvent) {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      col: Math.floor((event.clientX - rect.left - origin.x) / (CELL * zoom)),
      row: Math.floor((event.clientY - rect.top - origin.y) / (CELL * zoom)),
    };
  }

  function centerCellInView() {
    return {
      col: Math.floor((viewport.width / 2 - origin.x) / (CELL * zoom)),
      row: Math.floor((viewport.height / 2 - origin.y) / (CELL * zoom)),
    };
  }

  function itemAt(cell: CellPoint) {
    return [...items]
      .reverse()
      .find((item) => boundsIntersect(itemBounds(item), { ...cell, row1: cell.row, col1: cell.col, row2: cell.row + 1, col2: cell.col + 1 }));
  }

  function commitItems(nextItems: Item[], replacingIds: string[] = [], trackHistory = true) {
    setDocumentItems((current) => [
      ...current.filter((item) => !replacingIds.includes(item.id)),
      ...nextItems,
    ], trackHistory);
  }

  function addHistoryStep(beforeItems: Item[]) {
    setHistory((current) => {
      if (JSON.stringify(beforeItems) === JSON.stringify(current.present)) return current;
      return {
        past: [...current.past, beforeItems],
        present: current.present,
        future: [],
      };
    });
  }

  function placementCell() {
    if (selectedBounds) return { row: selectedBounds.row1, col: selectedBounds.col1 };
    if (selectedCell) return selectedCell;
    return centerCellInView();
  }

  function itemsFromPreset(preset: Preset) {
    const bounds = boundsOfItems(preset.items as Item[]);
    if (!bounds) return [];
    const center = centerCellInView();
    const startRow = center.row - Math.floor((bounds.row2 - bounds.row1) / 2);
    const startCol = center.col - Math.floor((bounds.col2 - bounds.col1) / 2);
    return preset.items.map((item) => ({
      ...item,
      id: id(),
      row: startRow + item.row,
      col: startCol + item.col,
    }));
  }

  function applyPreset(presetIndex: number) {
    const preset = presets[presetIndex];
    if (!preset) return;
    const nextItems = itemsFromPreset(preset);
    setDocumentItems(nextItems);
    setSelectedIds(nextItems.map((item) => item.id));
    setSelectedCell(null);
  }

  function addShape(shape: Shape) {
    const cell = placementCell();
    const item = { id: id(), shape, row: cell.row, col: cell.col, size: 1, rotation: 0 as Rotation };
    commitItems([item]);
    setSelectedIds([item.id]);
    setSelectedCell(cell);
  }

  function startBoardPointer(event: React.PointerEvent<HTMLDivElement>) {
    const cell = cellFromEvent(event);
    if (!cell) return;
    const hit = itemAt(cell);

    if (spacePressedRef.current) {
      setDrag({
        kind: "pan",
        startX: event.clientX,
        startY: event.clientY,
        startPan: pan,
        moved: false,
        hitId: hit?.id ?? null,
      });
      return;
    }

    if (hit) {
      if (event.metaKey) {
        setSelectedIds((current) =>
          current.includes(hit.id) ? current.filter((id) => id !== hit.id) : [...current, hit.id],
        );
        setSelectedCell({ row: hit.row, col: hit.col });
        return;
      }

      const ids = selectedIds.includes(hit.id) ? selectedIds : [hit.id];
      const moving = items
        .filter((item) => ids.includes(item.id))
        .map((item) => ({ id: item.id, row: item.row, col: item.col }));

      setSelectedIds(ids);
      setSelectedCell({ row: hit.row, col: hit.col });
      setDrag({
        kind: "move",
        ids,
        beforeItems: items,
        startCell: cell,
        lastDelta: { row: 0, col: 0 },
        started: moving,
        moved: false,
        startX: event.clientX,
        startY: event.clientY,
      });
      return;
    }

    setSelectedIds([]);
    setSelectedCell(cell);
    setDrag({ kind: "select", start: cell, cell });
  }

  function startResize(corner: Corner, event: React.PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (selected.length === 0 || !selectedBounds) return;
    setDrag({
      kind: "resize",
      ids: selected.map((item) => item.id),
      beforeItems: items,
      corner,
      started: selected,
      startBounds: selectedBounds,
      visual: selectedBounds,
    });
  }

  function startRotate(event: React.PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (selected.length === 0 || !selectedBounds) return;
    setDrag({
      kind: "rotate",
      ids: selected.map((item) => item.id),
      beforeItems: items,
      started: selected,
      startBounds: selectedBounds,
      visualRotation: selected.length === 1 ? selected[0].rotation : 0,
    });
  }

  function pasteAt(cell: CellPoint) {
    if (clipboard.length === 0) return;
    const pasted = clipboard.map((copy) => ({
      id: id(),
      shape: copy.shape,
      rotation: copy.rotation,
      size: copy.size,
      row: cell.row + copy.rowOffset,
      col: cell.col + copy.colOffset,
    }));
    commitItems(pasted);
    setSelectedIds(pasted.map((item) => item.id));
    setSelectedCell(cell);
  }

  function copySelectionToClipboard() {
    if (selected.length === 0) return false;
    const bounds = boundsOfItems(selected)!;
    setClipboard(
      selected.map(({ id: _id, row, col, ...item }) => ({
        ...item,
        rowOffset: row - bounds.row1,
        colOffset: col - bounds.col1,
      })),
    );
    return true;
  }

  useEffect(() => {
    const update = () =>
      setViewport({
        width: boardRef.current?.clientWidth ?? window.innerWidth,
        height: boardRef.current?.clientHeight ?? window.innerHeight,
      });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        items,
        selectedCell,
        zoom,
        pan,
        darkMode,
      } satisfies PersistedState),
    );
  }, [items, selectedCell, zoom, pan, darkMode]);

  useEffect(() => {
    const nextHash = urlHashFromItems(items);
    const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [items]);

  useEffect(() => {
    function onHashChange() {
      const hashItems = itemsFromUrlHash();
      if (!hashItems) return;
      setHistory({ past: [], present: hashItems, future: [] });
      setSelectedIds([]);
      setSelectedCell(null);
    }

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    function onWheel(event: WheelEvent) {
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      setClampedZoom(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    }

    board.addEventListener("wheel", onWheel, { passive: false });
    return () => board.removeEventListener("wheel", onWheel);
  }, [zoom]);

  useEffect(() => {
    if (!drag) return;
    const activeDrag = drag;

    function onMove(event: PointerEvent) {
      const cell = cellFromEvent(event);
      setDrag((current) => {
        if (!current) return current;

        if (current.kind === "pan") {
          const dx = event.clientX - current.startX;
          const dy = event.clientY - current.startY;
          const moved = current.moved || Math.hypot(dx, dy) > DRAG_THRESHOLD;
          setPan({ x: current.startPan.x + dx, y: current.startPan.y + dy });
          return { ...current, moved };
        }

        if (current.kind === "select" && cell) {
          return { ...current, cell };
        }

        if (current.kind === "move" && cell) {
          const delta = {
            row: cell.row - current.startCell.row,
            col: cell.col - current.startCell.col,
          };
          const moved =
            current.moved ||
            Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >
              DRAG_THRESHOLD;

          if (delta.row !== current.lastDelta.row || delta.col !== current.lastDelta.col) {
            const movedItems = current.started
              .map((start) => {
                const item = itemById.get(start.id);
                return item ? { ...item, row: start.row + delta.row, col: start.col + delta.col } : null;
              })
              .filter((item): item is Item => item !== null);
            commitItems(movedItems, current.ids, false);
          }

          return { ...current, lastDelta: delta, moved };
        }

        if (current.kind === "resize" && cell) {
          const nextBounds = resizedBounds(current.startBounds, current.corner, cell);
          const nextItems = resizeItems(current.started, current.startBounds, nextBounds);
          commitItems(nextItems, current.ids, false);
          return { ...current, visual: nextBounds };
        }

        if (current.kind === "rotate") {
          const rect = boardRef.current?.getBoundingClientRect();
          if (!rect) return current;
          const bounds = current.startBounds;
          const centerX = rect.left + origin.x + ((bounds.col1 + bounds.col2) * CELL * zoom) / 2;
          const centerY = rect.top + origin.y + ((bounds.row1 + bounds.row2) * CELL * zoom) / 2;
          const visualRotation =
            (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) / Math.PI + 90;
          const rotation = snapRotation(visualRotation);
          const nextItems =
            current.started.length === 1
              ? [{ ...current.started[0], rotation }]
              : rotateItems(current.started, current.startBounds, rotation);
          commitItems(nextItems, current.ids, false);
          return { ...current, visualRotation };
        }

        return current;
      });
    }

    function onUp(event: PointerEvent) {
      const finalDrag = activeDrag;
      const cell = cellFromEvent(event);
      if (finalDrag.kind === "select") {
        const bounds = boundsFromCells(finalDrag.start, cell ?? finalDrag.cell);
        const selectedNow = items.filter((item) => boundsIntersect(itemBounds(item), bounds));
        setSelectedIds(selectedNow.map((item) => item.id));
        setSelectedCell({ row: bounds.row1, col: bounds.col1 });
      }

      if (
        finalDrag.kind === "move" ||
        finalDrag.kind === "resize" ||
        finalDrag.kind === "rotate"
      ) {
        addHistoryStep(finalDrag.beforeItems);
      }

      setDrag(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, itemById, items, origin]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;

      if (event.code === "Space") {
        event.preventDefault();
        spacePressedRef.current = true;
        setIsSpacePressed(true);
      }

      if (event.metaKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (event.metaKey && event.key === "=") {
        event.preventDefault();
        setClampedZoom(zoom + ZOOM_STEP);
        return;
      }

      if (event.metaKey && event.key === "-") {
        event.preventDefault();
        setClampedZoom(zoom - ZOOM_STEP);
        return;
      }

      if (event.metaKey && event.key === "0") {
        event.preventDefault();
        setClampedZoom(1);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        setDocumentItems((current) => current.filter((item) => !selectedIds.includes(item.id)));
        setSelectedIds([]);
        setSelectedCell(null);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedIds([]);
        setSelectedCell(null);
        return;
      }

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        if (selectedIds.length === 0) return;
        event.preventDefault();
        const delta = {
          ArrowUp: { row: -1, col: 0 },
          ArrowDown: { row: 1, col: 0 },
          ArrowLeft: { row: 0, col: -1 },
          ArrowRight: { row: 0, col: 1 },
        }[event.key]!;
        const moved = items
          .filter((item) => selectedIds.includes(item.id))
          .map((item) => ({ ...item, row: item.row + delta.row, col: item.col + delta.col }));
        commitItems(moved, selectedIds);
        return;
      }

      if (event.metaKey && event.key.toLowerCase() === "c") {
        if (!copySelectionToClipboard()) return;
        event.preventDefault();
        return;
      }

      if (event.metaKey && event.key.toLowerCase() === "x") {
        if (!copySelectionToClipboard()) return;
        event.preventDefault();
        setDocumentItems((current) => current.filter((item) => !selectedIds.includes(item.id)));
        setSelectedIds([]);
        setSelectedCell(null);
        return;
      }

      if (event.metaKey && event.key.toLowerCase() === "v") {
        event.preventDefault();
        pasteAt(selectedBounds ? { row: selectedBounds.row1, col: selectedBounds.col1 } : selectedCell ?? centerCellInView());
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") {
        spacePressedRef.current = false;
        setIsSpacePressed(false);
      }
    }

    function onBlur() {
      spacePressedRef.current = false;
      setIsSpacePressed(false);
    }

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [items, selected, selectedBounds, selectedCell, selectedIds, clipboard, zoom]);

  function triggerDownload(url: string, filename: string) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function downloadSvg(exported: NonNullable<ReturnType<typeof exportSvg>>) {
    const url = URL.createObjectURL(new Blob([exported.svg], { type: "image/svg+xml" }));
    triggerDownload(url, "gridlogo.svg");
    URL.revokeObjectURL(url);
  }

  function downloadPng(exported: NonNullable<ReturnType<typeof exportSvg>>) {
    const image = new Image();
    const svgUrl = URL.createObjectURL(new Blob([exported.svg], { type: "image/svg+xml" }));

    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = exported.width;
      canvas.height = exported.height;
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(svgUrl);
        return;
      }

      context.clearRect(0, 0, exported.width, exported.height);
      context.drawImage(image, 0, 0);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(svgUrl);
        if (!blob) return;
        const pngUrl = URL.createObjectURL(blob);
        triggerDownload(pngUrl, "gridlogo.png");
        URL.revokeObjectURL(pngUrl);
      }, "image/png");
    };

    image.onerror = () => URL.revokeObjectURL(svgUrl);
    image.src = svgUrl;
  }

  function download() {
    const exported = exportSvg(items);
    if (!exported) return;
    if (downloadFormat === "png") {
      downloadPng(exported);
      return;
    }
    downloadSvg(exported);
  }

  function resetCanvas() {
    setDocumentItems([]);
    setSelectedIds([]);
    setSelectedCell(null);
  }

  const dragSelection = drag?.kind === "select" ? boundsFromCells(drag.start, drag.cell) : null;
  const previewBounds = boundsOfItems(items);
  const shapeFill = darkMode ? "#f8fafc" : "#111111";
  const ghostButtonClass = `grid h-7 w-7 place-items-center rounded-md text-blue-500 ${
    darkMode ? "hover:bg-blue-950/70" : "hover:bg-blue-50"
  }`;
  const disabledGhostButtonClass = `${ghostButtonClass} disabled:opacity-35`;
  const activeGhostButtonClass = `${ghostButtonClass} ${darkMode ? "bg-blue-950/70" : "bg-blue-50"}`;
  const zoomLabelClass = `h-7 min-w-12 rounded-md px-1 text-xs text-blue-500 ${
    darkMode ? "hover:bg-blue-950/70" : "hover:bg-blue-50"
  }`;
  const selectClass = `h-7 w-36 rounded-md border px-2 text-xs text-blue-500 outline-none ${
    darkMode ? "border-blue-950 bg-neutral-950 hover:bg-blue-950/70" : "border-blue-100 bg-white hover:bg-blue-50"
  }`;

  return (
    <main className={`h-screen overflow-hidden pt-11 ${darkMode ? "bg-neutral-950 text-neutral-100" : "bg-blue-50 text-neutral-950"}`}>
      <header className={`fixed inset-x-0 top-0 z-20 flex h-11 items-center gap-1 border-b px-2 ${darkMode ? "border-blue-950 bg-neutral-950/95" : "border-blue-100 bg-white/95"}`}>
        <div className="flex items-center gap-1">
          <h1 className="mr-1 text-sm font-semibold text-blue-500">GridLogo</h1>
          <div className={`h-6 w-px ${darkMode ? "bg-blue-950" : "bg-blue-100"}`} />
          {shapes.map((shape) => (
            <button
              key={shape}
              aria-label={shape}
              className={ghostButtonClass}
              onClick={() => addShape(shape)}
            >
              <svg viewBox="0 0 48 48" className="h-5 w-5">
                <path d={shapePath(shape, 0, 0, 0, 48)} fill="currentColor" />
              </svg>
            </button>
          ))}
          <select
            className={selectClass}
            aria-label="Logo presets"
            defaultValue=""
            onChange={(event) => {
              applyPreset(Number(event.target.value));
              event.currentTarget.value = "";
            }}
          >
            <option value="" disabled>
              Presets
            </option>
            {presets.map((preset, index) => (
              <option key={preset.name} value={index}>
                {preset.name}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            className={disabledGhostButtonClass}
            aria-label="Undo"
            title="Undo"
            disabled={history.past.length === 0}
            onClick={undo}
          >
            <Undo2 size={16} />
          </button>
          <button
            className={disabledGhostButtonClass}
            aria-label="Redo"
            title="Redo"
            disabled={history.future.length === 0}
            onClick={redo}
          >
            <Redo2 size={16} />
          </button>
          <button
            className={disabledGhostButtonClass}
            aria-label="Reset"
            title="Reset"
            onClick={resetCanvas}
          >
            <Trash2 size={16} />
          </button>
          <div className={`mx-1 h-6 w-px ${darkMode ? "bg-blue-950" : "bg-blue-100"}`} />
          <button
            className={ghostButtonClass}
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => setClampedZoom(zoom - ZOOM_STEP)}
          >
            <Minus size={16} />
          </button>
          <button
            className={zoomLabelClass}
            title="Reset zoom"
            onClick={() => setClampedZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            className={ghostButtonClass}
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => setClampedZoom(zoom + ZOOM_STEP)}
          >
            <Plus size={16} />
          </button>
          <button
            className={showPreview ? activeGhostButtonClass : ghostButtonClass}
            aria-label="Toggle preview"
            title="Toggle preview"
            onClick={() => setShowPreview((current) => !current)}
          >
            <Eye size={16} />
          </button>
          <select
            className={`h-7 w-16 rounded-md border px-2 text-xs text-blue-500 outline-none ${
              darkMode ? "border-blue-950 bg-neutral-950 hover:bg-blue-950/70" : "border-blue-100 bg-white hover:bg-blue-50"
            }`}
            aria-label="Download format"
            title="Download format"
            value={downloadFormat}
            onChange={(event) => setDownloadFormat(event.target.value as DownloadFormat)}
          >
            <option value="svg">SVG</option>
            <option value="png">PNG</option>
          </select>
          <button
            className="flex h-7 items-center gap-1 rounded-md bg-blue-500 px-2 text-xs font-medium text-white hover:bg-blue-500/90 disabled:opacity-50"
            aria-label="Download"
            title="Download"
            disabled={items.length === 0}
            onClick={download}
          >
            <Download size={16} />
            Download
          </button>
          <div className={`mx-1 h-6 w-px ${darkMode ? "bg-blue-950" : "bg-blue-100"}`} />
          <button
            className={ghostButtonClass}
            aria-label="Toggle dark mode"
            title="Toggle dark mode"
            onClick={() => setDarkMode((current) => !current)}
          >
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      <div
        ref={boardRef}
        className={`relative h-full w-full overflow-hidden ${
          drag?.kind === "pan" ? "cursor-grabbing" : isSpacePressed ? "cursor-grab" : "cursor-default"
        }`}
        style={{
          backgroundImage:
            darkMode
              ? "linear-gradient(rgba(59,130,246,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.18) 1px, transparent 1px)"
              : "linear-gradient(#dbeafe 1px, transparent 1px), linear-gradient(90deg, #dbeafe 1px, transparent 1px)",
          backgroundSize: `${CELL * zoom}px ${CELL * zoom}px`,
          backgroundPosition: `${origin.x}px ${origin.y}px`,
        }}
        onPointerDown={startBoardPointer}
      >
        <svg className="absolute inset-0 h-full w-full" width={viewport.width} height={viewport.height}>
          {items.map((item) => {
            const pos = screenForCell(item);
            return (
              <path
                key={item.id}
                d={shapePath(item.shape, item.rotation, pos.x, pos.y, item.size * CELL * zoom)}
                fill={shapeFill}
                pointerEvents="none"
              />
            );
          })}
        </svg>

        {selectedIds.length === 0 && selectedCell && (
          <SelectionRect bounds={{ row1: selectedCell.row, col1: selectedCell.col, row2: selectedCell.row + 1, col2: selectedCell.col + 1 }} origin={origin} zoom={zoom} />
        )}
        {dragSelection && <SelectionRect bounds={dragSelection} origin={origin} zoom={zoom} />}
        {selectedBounds && <SelectionRect bounds={selectedBounds} origin={origin} zoom={zoom} selected />}
        {selectedBounds && (
          <Controls
            bounds={drag?.kind === "resize" ? drag.visual : selectedBounds}
            origin={origin}
            zoom={zoom}
            darkMode={darkMode}
            visualRotation={drag?.kind === "rotate" ? drag.visualRotation : selected.length === 1 ? selected[0].rotation : 0}
            onResize={startResize}
            onRotate={startRotate}
          />
        )}
      </div>
      {showPreview && previewBounds && (
        <div className={`fixed bottom-4 right-4 z-20 flex h-52 w-52 items-center justify-center rounded-md border p-3 shadow-sm ${
          darkMode ? "border-blue-950 bg-neutral-950/95" : "border-blue-100 bg-white/95"
        }`}>
          <svg
            className="max-h-full max-w-full"
            viewBox={`0 0 ${(previewBounds.col2 - previewBounds.col1) * CELL} ${(previewBounds.row2 - previewBounds.row1) * CELL}`}
          >
            <path
              d={items
                .map((item) =>
                  shapePath(
                  item.shape,
                  item.rotation,
                  (item.col - previewBounds.col1) * CELL,
                  (item.row - previewBounds.row1) * CELL,
                  item.size * CELL,
                  ),
                )
                .join(" ")}
              fill={shapeFill}
            />
          </svg>
        </div>
      )}
    </main>
  );
}

function SelectionRect({
  bounds,
  origin,
  zoom,
  selected = false,
}: {
  bounds: Bounds;
  origin: { x: number; y: number };
  zoom: number;
  selected?: boolean;
}) {
  return (
    <div
      className={`pointer-events-none absolute border-2 border-dashed ${
        selected ? "border-blue-500" : "border-blue-500"
      }`}
      style={{
        left: origin.x + bounds.col1 * CELL * zoom,
        top: origin.y + bounds.row1 * CELL * zoom,
        width: (bounds.col2 - bounds.col1) * CELL * zoom,
        height: (bounds.row2 - bounds.row1) * CELL * zoom,
      }}
    />
  );
}

function Controls({
  bounds,
  origin,
  zoom,
  darkMode,
  visualRotation,
  onResize,
  onRotate,
}: {
  bounds: Bounds;
  origin: { x: number; y: number };
  zoom: number;
  darkMode: boolean;
  visualRotation: number;
  onResize: (corner: Corner, event: React.PointerEvent<HTMLDivElement>) => void;
  onRotate: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const left = origin.x + bounds.col1 * CELL * zoom;
  const top = origin.y + bounds.row1 * CELL * zoom;
  const width = (bounds.col2 - bounds.col1) * CELL * zoom;
  const height = (bounds.row2 - bounds.row1) * CELL * zoom;
  const handleFill = darkMode ? "bg-neutral-950" : "bg-blue-50";
  const handleBase = `absolute h-3 w-3 border-2 border-blue-500 ${handleFill}`;

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left,
        top,
        width,
        height,
        transform: `rotate(${visualRotation}deg)`,
      }}
    >
      <div
        className={`${handleBase} pointer-events-auto cursor-nwse-resize`}
        style={{ left: -HANDLE / 2, top: -HANDLE / 2 }}
        onPointerDown={(event) => onResize("nw", event)}
      />
      <div
        className={`${handleBase} pointer-events-auto cursor-nesw-resize`}
        style={{ right: -HANDLE / 2, top: -HANDLE / 2 }}
        onPointerDown={(event) => onResize("ne", event)}
      />
      <div
        className={`${handleBase} pointer-events-auto cursor-nwse-resize`}
        style={{ right: -HANDLE / 2, bottom: -HANDLE / 2 }}
        onPointerDown={(event) => onResize("se", event)}
      />
      <div
        className={`${handleBase} pointer-events-auto cursor-nesw-resize`}
        style={{ left: -HANDLE / 2, bottom: -HANDLE / 2 }}
        onPointerDown={(event) => onResize("sw", event)}
      />
      <div
        className={`pointer-events-auto absolute left-1/2 h-4 w-4 -translate-x-1/2 cursor-grab rounded-full border-2 border-blue-500 ${handleFill}`}
        style={{ top: -ROTATE_OFFSET }}
        onPointerDown={onRotate}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
