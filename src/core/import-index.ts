import { isDatabaseField, type DatabaseSource } from "./database-supplement";
import { isArray, isRecord, isString } from "./validation";

export interface PageIcon {
  type?: "emoji" | "image" | "date" | "elapsed";
  emoji?: string;
  path?: string;
  date?: string;
  format?: string;
  unit?: "day" | "month" | "year";
  direction?: "auto" | "since" | "until";
  prefix?: string;
  suffix?: string;
  style?: string;
}

export interface PageSettings {
  is_full_width?: boolean;
  is_small_text?: boolean;
  has_floating_catalog?: boolean;
  wolai_export_layout?: boolean;
  cover_position?: string;
}

export interface IndexNode {
  path: string;
  title: string;
  type: "page" | "database" | "record";
  children: string[];
  sourceId?: string;
  sourceUrl?: string;
  cover?: string;
  icon?: PageIcon;
  settings?: PageSettings;
  databasePath?: string;
  recordsFolder?: string;
  schema?: DatabaseSource["schema"];
  computedView?: string;
  formulaError?: string;
  snapshotColumns?: unknown[];
  dataErrors?: { message: string }[];
}

export interface ConvertedIndex {
  version: 1;
  roots: string[];
  sourceSnapshot?: string;
  blockPaths: Record<string, string>;
  nodes: Record<string, IndexNode>;
}

export function isPageIcon(value: unknown): value is PageIcon {
  if (!isRecord(value)) return false;
  const { type, unit, direction } = value;
  return (type === undefined || type === "emoji" || type === "image" || type === "date" || type === "elapsed")
    && (unit === undefined || unit === "day" || unit === "month" || unit === "year")
    && (direction === undefined || direction === "auto" || direction === "since" || direction === "until")
    && ["emoji", "path", "date", "format", "prefix", "suffix", "style"].every((key) => value[key] === undefined || isString(value[key]));
}

function isPageSettings(value: unknown): value is PageSettings {
  return isRecord(value)
    && ["is_full_width", "is_small_text", "has_floating_catalog", "wolai_export_layout"]
      .every((key) => value[key] === undefined || typeof value[key] === "boolean")
    && (value.cover_position === undefined || isString(value.cover_position));
}

function isIndexNode(value: unknown): value is IndexNode {
  if (!isRecord(value)) return false;
  return isString(value.path) && isString(value.title)
    && (value.type === "page" || value.type === "database" || value.type === "record")
    && isArray(value.children) && value.children.every(isString)
    && ["sourceId", "sourceUrl", "cover", "databasePath", "recordsFolder", "computedView", "formulaError"]
      .every((key) => value[key] === undefined || isString(value[key]))
    && (value.icon === undefined || isPageIcon(value.icon))
    && (value.settings === undefined || isPageSettings(value.settings))
    && (value.schema === undefined || (isArray(value.schema) && value.schema.every(isDatabaseField)))
    && (value.snapshotColumns === undefined || isArray(value.snapshotColumns))
    && (value.dataErrors === undefined || (isArray(value.dataErrors)
      && value.dataErrors.every((issue) => isRecord(issue) && isString(issue.message))));
}

export function readImportIndex(saved: unknown): ConvertedIndex {
  if (saved == null) return { version: 1, roots: [], nodes: {}, blockPaths: {} };
  if (!isRecord(saved) || saved.version !== 1 || !isArray(saved.roots)
    || !saved.roots.every(isString) || !isRecord(saved.nodes)) {
    throw new Error("页面索引缺失或格式错误");
  }
  const nodes = Object.fromEntries(Object.entries(saved.nodes).map(([path, value]) => {
    // Older indexes can omit children or store empty optional metadata as null.
    const node = isRecord(value) ? {
      ...value,
      children: value.children ?? [],
      icon: value.icon ?? undefined,
      cover: value.cover ?? undefined,
      settings: value.settings ?? undefined,
    } : value;
    if (!isIndexNode(node) || node.path !== path) throw new Error(`页面定义不完整：${path}`);
    return [path, node] as const;
  }));
  validateIndexReferences({ nodes, roots: saved.roots });
  const blockPaths = saved.blockPaths ?? {};
  if (!isRecord(blockPaths)) throw new Error("页面块索引格式错误");
  const validBlockPaths = Object.fromEntries(Object.entries(blockPaths).flatMap(([id, path]) =>
    isString(path) ? [[id, path] as const] : []));
  return { ...saved, version: 1, roots: saved.roots, nodes, blockPaths: validBlockPaths,
    sourceSnapshot: isString(saved.sourceSnapshot) ? saved.sourceSnapshot : undefined };
}

export function validateIndexReferences({ nodes, roots }: Pick<ConvertedIndex, "nodes" | "roots">): void {
  for (const node of Object.values(nodes)) {
    for (const child of node.children) {
      if (!Object.hasOwn(nodes, child)) throw new Error(`子页面定义缺失：${child}`);
    }
  }
  for (const root of roots) {
    if (!Object.hasOwn(nodes, root)) throw new Error(`根页面定义缺失：${root}`);
  }
}

// Older releases sometimes persisted unrelated notes discovered by the navigation view.
export function restrictIndexToImports(index: ConvertedIndex): ConvertedIndex {
  const roots = index.roots.filter((path) => {
    const node = index.nodes[path];
    if (!path.includes("/") || node?.type !== "page") return false;
    return node.settings?.wolai_export_layout === true ||
      (typeof node.sourceId === "string" && node.sourceUrl === `https://www.wolai.com/${node.sourceId}`);
  });
  // Each import owns its root note's folder. This also covers moved batches.
  const folders = roots.map((path) => path.slice(0, path.lastIndexOf("/") + 1));
  const entries = Object.entries(index.nodes).filter(([path]) => folders.some((folder) => path.startsWith(folder)));
  const kept = new Set(entries.map(([path]) => path));
  const nodes = Object.fromEntries(entries.map(([path, node]) => [
    path, { ...node, children: node.children.filter((child) => kept.has(child)) },
  ]));
  const blockPaths = Object.fromEntries(Object.entries(index.blockPaths ?? {}).filter(([, path]) => kept.has(path)));
  return { ...index, roots, nodes, blockPaths };
}
