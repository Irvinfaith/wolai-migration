import type { ConvertedIndex } from "./importer";

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
    path, { ...node, children: (node.children ?? []).filter((child: string) => kept.has(child)) },
  ]));
  const blockPaths = Object.fromEntries(Object.entries(index.blockPaths ?? {}).filter(([, path]) => kept.has(path)));
  return { ...index, roots, nodes, blockPaths };
}
