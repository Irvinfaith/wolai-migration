/* Core: wolai HTML export -> Obsidian vault files. DOM-agnostic (DOMParser injected). */
import { strFromU8, type Unzipped } from "fflate";
import { ImportCancelledError, readZipSync } from "./archive";
import { databaseSourceIds, readBaseConfig, type DatabaseSource, type DatabaseSupplement } from "./database-supplement";

export interface ConvertOptions {
  targetRoot?: string;
  isTargetOccupied?: (path: string) => boolean;
  importIcons?: boolean;
  demoteH1?: boolean;
  databaseSupplement?: DatabaseSupplement;
  parseHTML: (html: string) => any;
  onProgress?: (p: { phase: string; current: number; total: number; message?: string }) => void;
  isCancelled?: () => boolean;
}

export interface ConvertedFile {
  path: string;
  data: string | Uint8Array;
}

export interface ConvertedIndex {
  version: 1;
  roots: string[];
  sourceSnapshot: string;
  blockPaths: Record<string, string>;
  nodes: Record<string, any>;
}

export interface ConvertStats {
  pages: number;
  blocks: number;
  assets: number;
  dbPlaceholders: number;
  databases: number;
  records: number;
  recordLinks: number;
  cachedCovers: number;
  externalLinks: number;
  emittedIds: number;
  droppedIds: number;
  fences: { columns: number; table: number; styled: number };
}

export interface ConvertResult {
  files: ConvertedFile[];
  index: ConvertedIndex;
  stats: ConvertStats;
  warnings: string[];
  rootTitle: string;
  rootPath: string;
}

// ---------------------------------------------------------------- helpers

const PUA = /[\uE000-\uF8FF]/g;

function posixNormalize(p: string): string {
  const out: string[] = [];
  for (const seg of String(p || "").replace(/\\/g, "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") { out.pop(); continue; }
    out.push(seg);
  }
  return out.join("/");
}
function posixDir(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}
function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}
function stripExt(p: string): string {
  return p.replace(/\.[^./]+$/, "");
}
function decodeUri(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}
function safeFileName(s: string): string {
  const name = String(s || "").replace(/[\\/:*?"<>|#^\[\]\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ").trim().replace(/[ .]+$/, "") || "未命名";
  // Legacy Windows device names are reserved even with an extension.
  return /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name) ? "_" + name : name;
}
function safeLabel(s: string): string {
  return String(s || "").replace(/\|/g, "｜").replace(/\]/g, "］").replace(/\[/g, "［").replace(/#/g, "＃").trim();
}
function htmlEscape(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function classes(el: any): string[] {
  return el && el.classList ? Array.from(el.classList) as string[] : [];
}
function hasClass(el: any, c: string): boolean {
  return !!(el && el.classList && el.classList.contains(c));
}
function tagName(el: any): string {
  return (el && el.tagName ? String(el.tagName) : "").toLowerCase();
}
function children(el: any): any[] {
  return el ? Array.from(el.children || []) : [];
}
function textOf(el: any): string {
  return el ? String(el.textContent || "") : "";
}
function attr(el: any, name: string): string | null {
  return el && el.getAttribute ? el.getAttribute(name) : null;
}
function find(el: any, selector: string): any | null {
  return el && el.querySelector ? el.querySelector(selector) : null;
}
function findAll(el: any, selector: string): any[] {
  return el && el.querySelectorAll ? Array.from(el.querySelectorAll(selector)) : [];
}

function cssClasses(cls: string[]): string[] {
  const out: string[] = [];
  for (const c of cls) {
    if (c.startsWith("bg-")) out.push("wolai-export-" + c);
    else if (["gray", "red", "orange", "yellow", "green", "blue", "purple", "pink", "brown"].includes(c)) {
      out.push("wolai-export-" + c);
    }
  }
  return out;
}

function fence(kind: string, obj: any): string {
  return "```wolai-" + kind + "\n" + JSON.stringify(obj) + "\n```";
}

function joinBlocks(blocks: (string | null | undefined)[]): string {
  return blocks.filter((b) => b && String(b).trim()).map((b) => String(b).replace(/\s+$/, "")).join("\n\n");
}

function indent(text: string, n: number): string {
  const pad = " ".repeat(n);
  return String(text).split("\n").map((line) => (line.trim() ? pad + line : "")).join("\n");
}

function listChildren(markdown: string, marker: string): string {
  if (!markdown) return "";
  const separator = /^(?:[-*+] |\d+\. )/.test(markdown) ? "\n" : "\n\n";
  return separator + indent(markdown, marker.length);
}

function splitSpace(inner: string): [string, string, string] {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  if (!m) return ["", inner, ""];
  return [m[1], m[2], m[3]];
}
function wrapMd(inner: string, mark: string): string {
  const [lead, core, trail] = splitSpace(inner);
  if (!core.trim()) return inner;
  return lead + mark.replace("%s", core) + trail;
}
function wrapHtml(inner: string, tag: string): string {
  const [lead, core, trail] = splitSpace(inner);
  if (!core.trim()) return inner;
  return lead + "<" + tag + ">" + core + "</" + tag + ">" + trail;
}

function escText(s: string, mode: "md" | "html", table = false): string {
  s = String(s || "").replace(PUA, "").replace(/\r/g, "");
  if (mode === "html") return htmlEscape(s).replace(/\n/g, "<br>");
  s = s.replace(/\n/g, "<br>");
  s = s.replace(/\\/g, "\\\\").replace(/\*/g, "\\*").replace(/_/g, "\\_");
  s = s.replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/`/g, "\\`");
  if (table) s = s.replace(/\|/g, "\\|");
  return s;
}

function cleanInline(s: string): string {
  s = String(s || "").trim();
  s = s.replace(/^(?:<br>\s*)+/, "").replace(/(?:\s*<br>)+$/, "");
  s = s.replace(/([^\s\[（(：:，,。.!?！？;；"“”>])(!?\[\[)/g, "$1 $2");
  return s.trim();
}

function parseStyle(style: string | null, key: string): string | null {
  if (!style) return null;
  const m = new RegExp("(?:^|;)\\s*" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:\\s*([^;]+)").exec(style);
  return m ? m[1].trim() : null;
}
function parseWidth(style: string | null): number | null {
  const v = parseStyle(style, "width");
  if (!v) return null;
  const m = /^([0-9.]+)\s*px$/.exec(v);
  const width = m ? Number(m[1]) : NaN;
  return Number.isFinite(width) && width > 0 ? width : null;
}

function positiveInteger(value: string | null): number | undefined {
  const number = Number(value);
  return /^[0-9]+$/.test(value ?? "") && Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

// ---------------------------------------------------------------- model

interface Page {
  rel: string;
  key: string;
  title: string;
  fileName: string;
  doc: any;
  article: any;
  children: string[];
  parent: string | null;
  icon: any;
  cover: string | null;
  settings: any;
  vaultDir: string;
  vaultPath: string;
  sourceId: string | null;
}

interface Ctx {
  pages: Record<string, Page>;
  pageid: Record<string, string>;
  block2page: Record<string, string>;
  options: ConvertOptions;
  databases: Map<string, ImportedDatabase>;
  recordsBySource: Map<string, ImportedRecord | null>;
  requestedAnchors: Set<string>;
  nativeAnchors?: Set<string>;
  unresolvedLinks: Map<string, UnresolvedLink>;
  warnings: string[];
  stats: ConvertStats;
}

interface ImportedDatabase {
  source: DatabaseSource;
  owner: Page;
  path: string;
  recordsFolder: string;
}

interface ImportedRecord {
  path: string;
  databaseId: string;
}

interface UnresolvedLink {
  page: Page;
  href: string;
  label: string;
  reason: "target" | "block" | "database";
  count: number;
}

function findDatabase(url: string, databases: Map<string, ImportedDatabase>): ImportedDatabase | undefined {
  const [id, fragment] = databaseSourceIds(url);
  return databases.get(fragment || id);
}

function findRecordPath(url: string, records: Ctx["recordsBySource"]): string | undefined {
  const [id, fragment] = databaseSourceIds(url);
  const direct = records.get(id);
  if (direct && (!fragment || fragment === id)) return direct.path;
  const nested = records.get(fragment);
  if (nested && nested.databaseId === id) return nested.path;
}

export function assetPath(src: string, page: Page): string | null {
  if (!src || /^(?:https?:|data:)/i.test(src)) return null;
  const name = basename(decodeUri(String(src).split("?")[0]));
  if (!name) return null;
  return page.vaultDir + "/media/" + name;
}

// ---------------------------------------------------------------- inline

function noteUnresolvedLink(ctx: Ctx, page: Page, href: string, label: string, reason: UnresolvedLink["reason"]) {
  const key = JSON.stringify([page.rel, href, label, reason]);
  const current = ctx.unresolvedLinks.get(key);
  if (current) current.count++;
  else ctx.unresolvedLinks.set(key, { page, href, label, reason, count: 1 });
}

function canLinkBlock(ctx: Ctx, id: string, rel: string): boolean {
  if (ctx.block2page[id] !== rel) return false;
  ctx.requestedAnchors.add(id);
  return !ctx.nativeAnchors || ctx.nativeAnchors.has(id);
}

function nativeBlockIds(markdown: string): string[] {
  const ids: string[] = [];
  let fence: string | undefined;
  for (const line of markdown.split("\n")) {
    const delimiter = line.match(/^\s*(\x60{3,}|~{3,})(.*)$/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1].startsWith(fence) && !delimiter[2].trim()) fence = undefined;
      continue;
    }
    if (fence) continue;
    const block = line.match(/(?:^|[ \t])\^w-([a-z0-9-]+)\s*$/i);
    if (block) ids.push(block[1]);
  }
  return ids;
}

function linkMd(href: string, label: string, ctx: Ctx, page: Page, mode: "md" | "html", curBlock: string | null): string {
  if (!href) return label;
  if (href.startsWith("#")) {
    const anchor = decodeUri(href.slice(1));
    if (canLinkBlock(ctx, anchor, page.rel)) return `[[${stripExt(page.vaultPath)}#^w-${anchor}|${label}]]`;
    if (anchor) noteUnresolvedLink(ctx, page, href, label, "block");
    return label;
  }
  const recordPath = findRecordPath(href, ctx.recordsBySource);
  if (recordPath) {
    ctx.stats.recordLinks++;
    return `[[${stripExt(recordPath)}|${label || stripExt(basename(recordPath))}]]`;
  }
  const database = findDatabase(href, ctx.databases);
  if (database) return `[[${database.path}|${safeLabel(database.source.title)}]]`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^(https?|mailto):/i.test(href)) return label;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    const [pid, bid] = databaseSourceIds(href);
    if (pid) {
      const databaseSource = label === "无标题数据表格" || (!bid && pid === curBlock);
      const pageRel = ctx.pageid[pid];
      const blockRel = ctx.block2page[pid];
      const target = pageRel || blockRel;
      const anchor = bid && bid !== pid ? bid : pageRel ? undefined : pid;
      if (!databaseSource && target && (!anchor || canLinkBlock(ctx, anchor, target))) {
        const path = stripExt(ctx.pages[target].vaultPath);
        return `[[${path}${anchor ? "#^w-" + anchor : ""}|${label}]]`;
      }
      const reason = databaseSource ? "database" : target && anchor ? "block" : "target";
      if (databaseSource) ctx.stats.dbPlaceholders++;
      ctx.stats.externalLinks++;
      noteUnresolvedLink(ctx, page, href, label, reason);
    }
    return mode === "md" ? "[" + label + "](" + href + ")" : '<a href="' + htmlEscape(href) + '">' + label + "</a>";
  }
  const rawDecoded = decodeUri(href);
  let raw = rawDecoded, frag: string | null = null;
  if (raw.includes("#")) {
    const idx = raw.indexOf("#");
    frag = raw.slice(idx + 1);
    raw = raw.slice(0, idx);
  }
  const target = posixNormalize(posixDir(page.rel) + "/" + raw);
  const p = ctx.pages[target];
  if (p) {
    if (!frag || canLinkBlock(ctx, frag, target)) {
      const path = stripExt(p.vaultPath);
      return `[[${path}${frag ? "#^w-" + frag : ""}|${label}]]`;
    }
    noteUnresolvedLink(ctx, page, href, label, "block");
  } else if (/\.html?$/i.test(raw)) {
    noteUnresolvedLink(ctx, page, href, label, "target");
  }
  return label;
}

function inline(el: any, ctx: Ctx, page: Page, mode: "md" | "html" = "md", table = false, curBlock: string | null = null): string {
  const out: string[] = [];
  for (const node of Array.from(el.childNodes || []) as any[]) {
    if (node.nodeType === 3) {
      out.push(escText(node.nodeValue || "", mode, table));
      continue;
    }
    if (node.nodeType !== 1) continue;
    const tag = tagName(node);
    const cls = classes(node);
    if (tag === "span") {
      if (cls.includes("jill")) { out.push(" "); continue; }
      if (cls.includes("file-size")) continue;
      const styled = cssClasses(cls);
      if (styled.length) {
        const inner = inline(node, ctx, page, "html", table, curBlock);
        if (!inner.replace(/<[^>]+>/g, "").trim()) continue;
        out.push('<span class="' + styled.join(" ") + '">' + inner + "</span>");
      } else {
        out.push(inline(node, ctx, page, mode, table, curBlock));
      }
    } else if (tag === "b" || tag === "strong") {
      const inner = inline(node, ctx, page, mode, table, curBlock);
      out.push(mode === "html" ? wrapHtml(inner, "strong") : wrapMd(inner, "**%s**"));
    } else if (tag === "i" || tag === "em") {
      const inner = inline(node, ctx, page, mode, table, curBlock);
      out.push(mode === "html" ? wrapHtml(inner, "em") : wrapMd(inner, "*%s*"));
    } else if (tag === "u") {
      out.push("<u>" + inline(node, ctx, page, "html", table, curBlock) + "</u>");
    } else if (tag === "s" || tag === "del") {
      const inner = inline(node, ctx, page, mode, table, curBlock);
      out.push(mode === "html" ? wrapHtml(inner, "del") : wrapMd(inner, "~~%s~~"));
    } else if (tag === "code") {
      const inner = textOf(node);
      out.push(mode === "html" ? "<code>" + htmlEscape(inner) + "</code>" : "`" + inner + "`");
    } else if (tag === "br") {
      out.push("<br>");
    } else if (tag === "img") {
      const src = attr(node, "src") || "";
      if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^(https?|data):/i.test(src)) continue;
      const ap = assetPath(src, page);
      if (ap) out.push("![[" + ap + "]]");
      else if (mode === "html") out.push('<img src="' + htmlEscape(src) + '">');
      else out.push("![](" + src + ")");
    } else if (tag === "a") {
      const href = attr(node, "href") || "";
      const label = safeLabel(inline(node, ctx, page, "md", table, curBlock));
      const res = linkMd(href, label, ctx, page, mode, curBlock);
      if (res.startsWith("[[") && out.length && out[out.length - 1] && !/\s$/.test(out[out.length - 1])) out.push(" ");
      out.push(res);
    } else {
      out.push(inline(node, ctx, page, mode, table, curBlock));
    }
  }
  return out.join("").replace(/[ \t]{2,}/g, " ");
}

// ---------------------------------------------------------------- blocks

function withId(text: string, el: any, inlineId = false): string {
  const bid = attr(el, "id");
  if (!bid) return text;
  return inlineId ? text + " ^w-" + bid : text + "\n\n^w-" + bid;
}

function convertBlocks(container: any, ctx: Ctx, page: Page, skip?: any): string {
  const out: (string | null)[] = [];
  for (const c of children(container)) {
    if (skip && c === skip) continue;
    out.push(convertBlock(c, ctx, page));
  }
  return joinBlocks(out);
}

function convertTableCell(cell: any, ctx: Ctx, page: Page, blockId: string | null): string {
  const parts: (string | null)[] = [];
  let inlineRun = cell.cloneNode(false);
  const flush = () => {
    parts.push(cleanInline(inline(inlineRun, ctx, page, "md", false, blockId)));
    inlineRun = cell.cloneNode(false);
  };
  for (const child of Array.from(cell.childNodes ?? []) as any[]) {
    const isBlock = child.nodeType === 1 && (hasClass(child, "wolai-block")
      || ["p", "ul", "ol", "figure", "table", "details", "pre", "blockquote"].includes(tagName(child)));
    if (isBlock) {
      flush();
      parts.push(convertBlock(child, ctx, page));
    } else inlineRun.appendChild(child.cloneNode(true));
  }
  flush();
  return joinBlocks(parts);
}

function headingLevel(tag: string, demoteH1: boolean): number {
  if (!/^h[1-6]$/.test(tag)) return 0;
  const level = Number(tag[1]);
  return level === 1 && demoteH1 ? 2 : level;
}

function convertBlock(el: any, ctx: Ctx, page: Page): string | null {
  const cls = classes(el);
  const tag = tagName(el);
  const bid = attr(el, "id");

  const level = headingLevel(tag, ctx.options.demoteH1 === true);
  if (level) {
    const text = inline(el, ctx, page, "md", false, bid);
    if (!text.trim()) return null;
    const styled = cssClasses(cls);
    if (styled.length) {
      ctx.stats.fences.styled++;
      return withId(fence("styled", { markdown: "#".repeat(level) + " " + text, classes: styled }), el);
    }
    return withId("#".repeat(level) + " " + text, el, true);
  }

  if (cls.includes("wolai-sub-page")) {
    const a = find(el, "a");
    const href = a ? attr(a, "href") : null;
    const span = a ? find(a, "span") : null;
    const label = safeLabel(span ? textOf(span) : (a ? textOf(a) : ""));
    const raw = href ? decodeUri(String(href).split("#")[0]) : "";
    const target = raw ? posixNormalize(posixDir(page.rel) + "/" + raw) : null;
    const p = target ? ctx.pages[target] : null;
    let text: string;
    if (p) text = "[[" + p.vaultPath.replace(/\.md$/, "") + "|" + (label || p.title) + "]]";
    else { text = label; ctx.warnings.push("子页面链接目标缺失: " + raw); }
    const styled = cssClasses(cls);
    if (styled.length) {
      ctx.stats.fences.styled++;
      return withId(fence("styled", { markdown: text, classes: styled }), el);
    }
    return withId(text, el);
  }

  if (cls.includes("wolai-file-block")) {
    const a = find(el, "a");
    const href = a ? attr(a, "href") : "";
    const nameEl = a ? find(a, "span") : null;
    const name = safeLabel(nameEl ? textOf(nameEl) : (a ? textOf(a) : ""));
    const ap = href ? assetPath(href, page) : null;
    if (ap && /\.xlsx$/i.test(ap)) {
      return withId(fence("workbook", { path: ap, name: name || basename(ap) }), el);
    }
    return withId(ap ? "[[" + ap + "|" + name + "]]" : name, el);
  }

  if (cls.includes("wolai-task-block")) {
    const checked = cls.includes("checked");
    const wrapper = children(el).find((c) => hasClass(c, "wrapper")) || null;
    const text = wrapper ? inline(wrapper, ctx, page, "md", false, bid) : "";
    const kids = children(el).filter((c) => c !== wrapper && !hasClass(c, "marker") && tagName(c) !== "input");
    let line = "- [" + (checked ? "x" : " ") + "] " + cleanInline(text);
    if (bid) line += " ^w-" + bid;
    const sub = joinBlocks(kids.map((c) => convertBlock(c, ctx, page)));
    return line + listChildren(sub, "- ");
  }

  if (cls.includes("wolai-simple-table") || tag === "table") {
    const table = tag === "table" ? el : find(el, "table");
    if (!table) return null;
    const rows: any[][] = [];
    for (const tr of findAll(table, "tr")) {
      if (tr.closest("table") !== table) continue;
      const row: any[] = [];
      for (const cell of children(tr)) {
        if (!["th", "td"].includes(tagName(cell))) continue;
        const markdown = convertTableCell(cell, ctx, page, bid);
        const item: any = { markdown };
        if (tagName(cell) === "th") item.header = tagName(tr.parentElement) === "thead" || attr(cell, "scope") !== "row" ? "col" : "row";
        const ccls = cssClasses(classes(cell));
        if (ccls.length) item.classes = ccls;
        const style = attr(cell, "style");
        const width = parseWidth(style) ?? positiveInteger(attr(cell, "width"));
        if (width) item.width = width;
        const align = parseStyle(style, "text-align") ?? attr(cell, "align");
        if (align && ["left", "center", "right", "justify"].includes(align)) item.align = align;
        const colspan = positiveInteger(attr(cell, "colspan"));
        const rowspan = positiveInteger(attr(cell, "rowspan"));
        if (colspan && colspan > 1) item.colspan = colspan;
        if (rowspan && rowspan > 1) item.rowspan = rowspan;
        row.push(item);
      }
      if (row.length) rows.push(row);
    }
    if (!rows.length) return null;
    ctx.stats.fences.table++;
    return withId(fence("table", { rows }), el);
  }

  if (cls.includes("wolai-progress")) {
    const prog = find(el, "progress");
    const maximum = Number(attr(prog, "max"));
    const max = Number.isFinite(maximum) && maximum > 0 ? maximum : 100;
    const measured = Number(attr(prog, "value"));
    const value = Number.isFinite(measured) ? Math.max(0, Math.min(measured, max)) : 0;
    return withId(fence("progress", { value, max }), el);
  }

  if (cls.includes("wolai-row")) {
    const cols = children(el).filter((c) => hasClass(c, "wolai-col"));
    if (!cols.length) return convertBlocks(el, ctx, page);
    if (cols.length === 1) return withId(convertBlocks(cols[0], ctx, page), el);
    const items = cols.map((col) => {
      let weight = Number(parseStyle(attr(col, "style"), "flex-grow"));
      if (!Number.isFinite(weight) || weight <= 0) weight = 1;
      return { weight, markdown: convertBlocks(col, ctx, page) };
    });
    ctx.stats.fences.columns++;
    return withId(fence("columns", items), el);
  }

  if (tag === "details") {
    const summary = children(el).find((c) => tagName(c) === "summary") || null;
    const title = summary ? inline(summary, ctx, page, "md").replace(/<br>/g, " ").trim() : "";
    const summaryHeading = summary && children(summary).find((child) => /^h[1-6]$/.test(tagName(child)));
    const summaryLevel = headingLevel(tagName(summaryHeading), ctx.options.demoteH1 === true);
    return withId(fence("toggle", {
      title: title && summaryLevel ? "#".repeat(summaryLevel) + " " + title : title || "折叠块",
      markdown: convertBlocks(el, ctx, page, summary || undefined),
      open: el.hasAttribute("open"),
    }), el);
  }

  if (tag === "ul" || tag === "ol") return convertList(el, ctx, page);

  if (tag === "blockquote") {
    const text = cleanInline(inline(el, ctx, page, "md", false, bid));
    if (!text) return null;
    return withId("> " + text, el, true);
  }

  if (tag === "hr") return "---";

  if (tag === "figure" || (tag === "div" && find(el, "figure") && cls.includes("wolai-block") && !cls.includes("wolai-text"))) {
    return convertImage(el, ctx, page);
  }

  if (cls.includes("wolai-text")) {
    const inner = find(el, "div") || el;
    const anchors = findAll(inner, "a");
    if (anchors.length === 1 && textOf(inner).trim() === textOf(anchors[0]).trim()) {
      const url = attr(anchors[0], "href") ?? "";
      const database = findRecordPath(url, ctx.recordsBySource) ? undefined : findDatabase(url, ctx.databases);
      if (database) return withId(`![[${database.path}]]`, el);
      if (textOf(inner).trim() === "无标题数据表格" && databaseSourceIds(url).length) {
        ctx.stats.dbPlaceholders++;
        ctx.stats.externalLinks++;
        noteUnresolvedLink(ctx, page, url, "无标题数据表格", "database");
        return withId(fence("table-source", { url }), el);
      }
    }
    let text = cleanInline(inline(inner, ctx, page, "md", false, bid));
    if (!text) return null;
    if (text.startsWith("#")) text = "\\" + text;
    const styled = cssClasses(cls);
    if (styled.length) {
      ctx.stats.fences.styled++;
      return withId(fence("styled", { markdown: text, classes: styled }), el);
    }
    return withId(text, el, true);
  }

  if (cls.includes("wolai-block")) {
    const text = cleanInline(inline(el, ctx, page, "md", false, bid));
    if (text) return withId(text, el, true);
    return null;
  }

  const text = cleanInline(inline(el, ctx, page, "md", false, bid));
  return text ? withId(text, el, true) : null;
}

function findReferencedDatabases(pages: Record<string, Page>, supplement?: DatabaseSupplement): Map<string, ImportedDatabase> {
  const databases = new Map<string, ImportedDatabase>();
  if (!supplement) return databases;
  const rowOwners = new Map<string, DatabaseSource | null>();
  for (const source of supplement.databases.values()) {
    for (const record of source.records) {
      if (record.sourceId) rowOwners.set(record.sourceId, rowOwners.has(record.sourceId) ? null : source);
    }
  }
  const rowReferences = new Map<DatabaseSource, Page>();
  const register = (source: DatabaseSource, owner: Page) => {
    const folder = `${owner.vaultDir}/_databases/${source.id}`;
    databases.set(source.id, {
      source, owner,
      path: `${folder}/${safeFileName(source.title)}.base`,
      recordsFolder: `${folder}/records`,
    });
  };
  for (const page of Object.values(pages)) {
    for (const anchor of findAll(page.article, "a[href]")) {
      const ids = databaseSourceIds(attr(anchor, "href") ?? "");
      if (!ids.length) continue;
      const [id, fragment] = ids;
      const nested = rowOwners.get(fragment);
      const rowOwner = rowOwners.get(id) || (nested?.id === id ? nested : undefined);
      if (rowOwner) {
        if (!rowReferences.has(rowOwner)) rowReferences.set(rowOwner, page);
        continue;
      }
      const source = ids.map((sourceId) => supplement.databases.get(sourceId)).find(Boolean);
      if (source && !databases.has(source.id)) register(source, page);
    }
  }
  for (const [source, owner] of rowReferences) {
    if (!databases.has(source.id)) register(source, owner);
  }
  return databases;
}

function writeDatabaseFiles(ctx: Ctx, index: ConvertedIndex, output: Map<string, ConvertedFile["data"]>) {
  const supplement = ctx.options.databaseSupplement;
  if (!supplement) return;
  const sharedLinks = new Map<string, string>();
  const uniquePath = (folder: string, name: string, used: Set<string>) => {
    const extension = name.slice(stripExt(name).length);
    const stem = safeFileName(stripExt(name)).replace(/^\.+/, "") || "未命名";
    let path = `${folder}/${stem}${extension}`;
    for (let i = 2; used.has(path.normalize("NFC").toLowerCase()); i++) path = `${folder}/${stem} ${i}${extension}`;
    used.add(path.normalize("NFC").toLowerCase());
    return path;
  };
  const bundles = [...ctx.databases.values()].map((database) => {
    const links = new Map<string, string>();
    const used = new Set<string>();
    for (const record of database.source.records) {
      const path = uniquePath(database.recordsFolder, basename(record.path), used);
      sharedLinks.set(record.path, path);
      sharedLinks.set(stripExt(record.path), stripExt(path));
    }
    for (const sourcePath of database.source.attachments) {
      links.set(sourcePath, uniquePath(`${posixDir(database.path)}/assets`, basename(sourcePath), used));
    }
    sharedLinks.set(database.source.path, database.path);
    return { database, links };
  });

  for (const { database, links } of bundles) {
    const { source, owner, path, recordsFolder } = database;
    const recordPaths: string[] = [];
    output.set(path, readBaseConfig(source, supplement, recordsFolder));
    for (const record of source.records) {
      const destination = sharedLinks.get(record.path);
      const markdown = strFromU8(supplement.files[`vault/${record.path}`]);
      const yaml = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1];
      const properties = yaml ? supplement.parseYaml(yaml) as Record<string, unknown> : null;
      if (properties?._wolai_database !== source.id) throw new Error(`数据库记录归属无法核验：${source.title} / ${record.title}`);
      const rebased = markdown.replace(/(\[\[)([^\]\n|#]+)(?=[\]|#])/g, (whole, open, link) => {
        const local = links.get(link) ?? sharedLinks.get(link);
        return local ? open + local : whole;
      });
      output.set(destination, rebased);
      recordPaths.push(destination);
      if (record.sourceId) {
        const match = ctx.recordsBySource.has(record.sourceId) ? null : { path: destination, databaseId: source.id };
        ctx.recordsBySource.set(record.sourceId, match);
      }
      index.nodes[destination] = { path: destination, title: record.title, sourceId: record.sourceId, type: "record", databasePath: path, children: [] };
    }
    for (const [original, destination] of links) output.set(destination, supplement.files[`vault/${original}`]);
    index.nodes[path] = {
      path, title: source.title, type: "database", children: recordPaths, recordsFolder,
      sourceId: source.id, sourceUrl: `https://www.wolai.com/${source.id}`, schema: source.schema,
    };
    index.nodes[owner.vaultPath].children.push(path);
    ctx.stats.databases++;
    ctx.stats.records += recordPaths.length;
    ctx.stats.assets += links.size;
  }
}

function convertList(el: any, ctx: Ctx, page: Page): string {
  const ordered = tagName(el) === "ol";
  const lines: string[] = [];
  let number = positiveInteger(attr(el, "start")) ?? 1;
  for (const li of children(el)) {
    if (tagName(li) !== "li") continue;
    const bid = attr(li, "id");
    const lead = li.cloneNode(false);
    const blocks: string[] = [];
    for (const c of Array.from(li.childNodes || []) as any[]) {
      if (c.nodeType === 3) {
        const text = String(c.nodeValue ?? "");
        if (text.trim() || (text && !/[\r\n]/.test(text))) lead.appendChild(c.cloneNode(true));
        continue;
      }
      if (c.nodeType !== 1) continue;
      const t = tagName(c);
      if (["span", "b", "i", "em", "strong", "u", "s", "del", "code", "br", "a", "img"].includes(t)) {
        lead.appendChild(c.cloneNode(true));
      } else if (t === "div" && hasClass(c, "marker")) {
        continue;
      } else {
        const b = convertBlock(c, ctx, page);
        if (b) blocks.push(b);
      }
    }
    const text = cleanInline(inline(lead, ctx, page, "md", false, bid));
    number = positiveInteger(attr(li, "value")) ?? number;
    const marker = ordered ? `${number++}. ` : "- ";
    let line = marker + text;
    if (bid) line += " ^w-" + bid;
    lines.push(line + listChildren(joinBlocks(blocks), marker));
  }
  return lines.join("\n");
}

function convertImage(el: any, ctx: Ctx, page: Page): string | null {
  const fig = tagName(el) === "figure" ? el : find(el, "figure");
  const img = fig ? find(fig, "img") : null;
  if (!img) return null;
  const src = attr(img, "src") || "";
  if (!src || (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^(?:https?:|data:image\/)/i.test(src))) return null;
  const ap = assetPath(src, page);
  const markdown = ap ? `![[${ap}]]` : `![](<${src.replace(/>/g, "%3E")}>)`;
  const caption = find(fig, "figcaption");
  const align = ["left", "center", "right"].find((position) => hasClass(fig, `wolai-${position}`)) ?? "left";
  const rawWidth = parseStyle(attr(fig, "style"), "width");
  const width = rawWidth?.match(/^(\d+(?:\.\d+)?)\s*(px|%)$/i);
  const size = width && Number.isFinite(Number(width[1])) && Number(width[1]) > 0 ? `${Number(width[1])}${width[2].toLowerCase()}` : undefined;
  return withId(fence("image", {
    markdown,
    caption: caption ? cleanInline(inline(caption, ctx, page)) : "",
    align,
    width: size,
  }), el);
}

// ---------------------------------------------------------------- pages

function loadPages(files: Record<string, Uint8Array>, htmlKeys: string[], rootKey: string, parseHTML: (s: string) => any): Record<string, Page> {
  const pages: Record<string, Page> = {};
  const decoder = new TextDecoder("utf-8");
  for (const key of htmlKeys) {
    if (!key.startsWith(rootKey + "/")) continue;
    const rel = posixNormalize(key.slice(rootKey.length));
    const html = decoder.decode(files[key]);
    const doc = parseHTML(html);
    const titleEl = find(doc, ".main-title");
    const title = (titleEl ? attr(titleEl, "data-title") : null) || stripExt(basename(key));
    const article = find(doc, "article");
    if (!article) continue;
    pages[rel] = {
      rel, key, title, fileName: basename(key), doc, article,
      children: [], parent: null, icon: null, cover: null, settings: {},
      vaultDir: "", vaultPath: "", sourceId: null,
    };
  }
  return pages;
}

function setupPages(pages: Record<string, Page>, rootRel: string): { pageid: Record<string, string> } {
  const pageid: Record<string, string> = {};
  for (const rel of Object.keys(pages)) {
    const p = pages[rel];
    for (const sp of findAll(p.article, ".wolai-sub-page")) {
      const a = find(sp, "a");
      const href = a ? attr(a, "href") : null;
      if (!href) continue;
      const target = posixNormalize(posixDir(rel) + "/" + decodeUri(String(href).split("#")[0]));
      const q = pages[target];
      if (!q) continue;
      const id = attr(sp, "id");
      if (id) pageid[id] = target;
      if (!q.parent) q.parent = rel;
      if (!p.children.includes(target)) p.children.push(target);
      if (!q.sourceId) q.sourceId = id;
    }
  }
  return { pageid };
}

function pageMeta(p: Page, importIcons: boolean) {
  const body = find(p.doc, "body");
  const bcls = body ? classes(body) : [];
  p.settings = {
    is_full_width: bcls.includes("full-width"),
    is_small_text: bcls.includes("small-font"),
    has_floating_catalog: false,
    wolai_export_layout: true,
  };
  const header = find(p.doc, "header");
  if (!header) return;
  if (importIcons) {
    const iconEl = find(header, ".banner .icon");
    const symbol = iconEl ? attr(iconEl, "data-symbol") : null;
    if (symbol) p.icon = { type: "emoji", emoji: symbol };
    const coverEl = find(header, ".image");
    if (coverEl) {
      const style = attr(coverEl, "style") || "";
      const vertical = parseStyle(style, "background-position-y");
      if (vertical && /^\d{1,3}(?:\.\d+)?%$/.test(vertical) && Number.parseFloat(vertical) <= 100) {
        p.settings.cover_position = vertical;
      }
      const m = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/.exec(style);
      if (m) {
        const cover = (m[1] ?? m[2] ?? m[3]).trim().replace(/&amp;/g, "&");
        if (/^https?:\/\//i.test(cover)) p.cover = cover;
        else if (!/^[a-z][a-z0-9+.-]*:/i.test(cover)) p.cover = assetPath(cover, p);
      }
    }
  }
}

function assignVaultPaths(pages: Record<string, Page>, rootRel: string, targetRoot: string) {
  const pathKey = (path: string) => path.normalize("NFC").toLowerCase();
  const used = new Set([pathKey(`${targetRoot}/_wolai`)]);
  const directories = new Map<string, string>([["", targetRoot]]);
  const assignDirectory = (rel: string): string => {
    const previous = directories.get(rel);
    if (previous) return previous;
    const parent = assignDirectory(posixDir(rel));
    const name = safeFileName(basename(rel));
    let path = `${parent}/${name}`;
    for (let suffix = 2; used.has(pathKey(path)); suffix++) path = `${parent}/${name} (${suffix})`;
    used.add(pathKey(path));
    directories.set(rel, path);
    return path;
  };
  for (const page of Object.values(pages)) assignDirectory(posixDir(page.rel));
  for (const rel of Object.keys(pages)) {
    const p = pages[rel];
    const folder = rel === rootRel ? targetRoot : assignDirectory(posixDir(rel));
    p.vaultDir = folder;
    const base = safeFileName(p.title);
    let candidate = folder + "/" + base + ".md";
    for (let i = 2; used.has(pathKey(candidate)); i++) candidate = folder + "/" + base + " " + i + ".md";
    used.add(pathKey(candidate));
    p.vaultPath = candidate;
  }
}

function buildIndex(pages: Record<string, Page>, rootRel: string): ConvertedIndex {
  const nodes: Record<string, any> = {};
  for (const rel of Object.keys(pages)) {
    const p = pages[rel];
    const node: any = {
      path: p.vaultPath,
      title: p.title,
      type: "page",
      children: p.children.map((c) => pages[c].vaultPath),
      settings: p.settings,
    };
    if (p.icon) node.icon = p.icon;
    if (p.cover) node.cover = p.cover;
    if (p.sourceId) {
      node.sourceId = p.sourceId;
      node.sourceUrl = "https://www.wolai.com/" + p.sourceId;
    }
    nodes[p.vaultPath] = node;
  }
  return {
    version: 1,
    roots: [pages[rootRel].vaultPath],
    sourceSnapshot: new Date().toISOString().slice(0, 10),
    blockPaths: {},
    nodes,
  };
}

// ---------------------------------------------------------------- main

export function convertExport(zip: Uint8Array, options: ConvertOptions): ConvertResult {
  options.onProgress?.({ phase: "unzip", current: 0, total: 1, message: "解压" });
  return convertArchive(readZipSync(zip), options);
}

export function convertArchive(raw: Unzipped, options: ConvertOptions): ConvertResult {
  const supplement = options.databaseSupplement;
  const files: Record<string, Uint8Array> = {};
  for (const k of Object.keys(raw)) {
    const key = posixNormalize(k);
    if (!key) continue;
    if (k.endsWith("/")) continue;
    files[key] = raw[k];
  }

  const htmlKeys = Object.keys(files).filter((k) => k.toLowerCase().endsWith(".html")
    && !k.startsWith("__MACOSX/") && !k.split("/").some((seg) => seg.startsWith(".")));
  if (!htmlKeys.length) throw new Error("zip 里没有找到 HTML 页面");
  const tops = Array.from(new Set(htmlKeys.map((k) => k.split("/")[0])));
  let rootKey = tops.find((t) => Object.keys(files).some((k) => k.startsWith(t + "/css/"))) || tops[0];
  if (tops.length === 1) rootKey = tops[0];

  const pages = loadPages(files, htmlKeys, rootKey, options.parseHTML);
  const rootRel = Object.keys(pages).find((r) => !r.includes("/"));
  if (!rootRel) throw new Error("没有找到根页面 HTML");
  const rootTitle = pages[rootRel].title;
  const preferredFolder = safeFileName(options.targetRoot || rootTitle);
  if (options.targetRoot && preferredFolder.startsWith(".")) throw new Error("目标目录不能以点号开头");
  const folderName = preferredFolder.replace(/^\.+/, "") || "未命名";
  let targetRoot = folderName;
  for (let suffix = 2; options.isTargetOccupied?.(targetRoot); suffix++) targetRoot = `${folderName} (${suffix})`;
  pages[rootRel].sourceId = basename(rootKey);

  options.onProgress && options.onProgress({ phase: "tree", current: 0, total: 1, message: "构建页面树" });
  const { pageid } = setupPages(pages, rootRel);
  pageid[basename(rootKey)] = rootRel;
  assignVaultPaths(pages, rootRel, targetRoot);
  const databases = findReferencedDatabases(pages, supplement);

  const block2page: Record<string, string> = Object.create(null);
  for (const rel of Object.keys(pages)) {
    for (const el of findAll(pages[rel].article, "[id]")) {
      const id = attr(el, "id");
      if (/^[a-z0-9-]+$/i.test(id ?? "")) block2page[id] = Object.hasOwn(block2page, id) && block2page[id] !== rel ? null : rel;
    }
  }

  const stats: ConvertStats = {
    pages: Object.keys(pages).length,
    blocks: Object.keys(block2page).length,
    assets: 0,
    dbPlaceholders: 0,
    databases: 0,
    records: 0,
    recordLinks: 0,
    cachedCovers: 0,
    externalLinks: 0,
    emittedIds: 0,
    droppedIds: 0,
    fences: { columns: 0, table: 0, styled: 0 },
  };
  const ctx: Ctx = { pages, pageid, block2page, options, databases, recordsBySource: new Map(),
    requestedAnchors: new Set(), unresolvedLinks: new Map(), warnings: [], stats };
  if (supplement && !databases.size && !Object.values(pages).some((page) => page.sourceId && supplement.covers.has(page.sourceId))) {
    throw new Error("补充包中的表格与页面 ID 与这份 HTML 导出没有匹配项");
  }

  const cachedCovers = new Map<string, Uint8Array>();
  const rels = Object.keys(pages);
  for (const rel of rels) {
    if (options.isCancelled?.()) throw new ImportCancelledError();
    const p = pages[rel];
    pageMeta(p, options.importIcons !== false);
    if (p.cover && /^https?:\/\//i.test(p.cover) && p.sourceId && supplement?.covers.has(p.sourceId)) {
      const source = supplement.covers.get(p.sourceId);
      const extension = source.slice(stripExt(source).length).toLowerCase();
      p.cover = `${p.vaultDir}/_wolai/cover-${p.sourceId}${extension}`;
      cachedCovers.set(p.cover, supplement.files[`vault/${source}`]);
    }
  }

  const index = buildIndex(pages, rootRel);
  // Assign actual record destinations before converting references in the page body.
  const out = new Map<string, ConvertedFile["data"]>();
  writeDatabaseFiles(ctx, index, out);
  const renderPages = () => {
    const emitted = new Set<string>();
    const native = new Set<string>();
    for (const [i, rel] of rels.entries()) {
      if (options.isCancelled?.()) throw new ImportCancelledError();
      const p = pages[rel];
      options.onProgress?.({ phase: "convert", current: i, total: rels.length, message: p.title });
      const markdown = "# " + p.title + "\n\n" + convertBlocks(p.article, ctx, p) + "\n";
      out.set(p.vaultPath, markdown);
      for (const m of markdown.matchAll(/\^w-([A-Za-z0-9-]+)/g)) emitted.add(m[1]);
      for (const id of nativeBlockIds(markdown)) if (block2page[id] === rel) native.add(id);
    }
    return { emitted, native };
  };
  let rendered = renderPages();
  // A source ID inside a dropped block or a rendered code fence is not an Obsidian jump target.
  if ([...ctx.requestedAnchors].some((id) => !rendered.native.has(id))) {
    ctx.nativeAnchors = rendered.native;
    ctx.unresolvedLinks.clear();
    ctx.warnings.length = 0;
    stats.dbPlaceholders = 0;
    stats.recordLinks = 0;
    stats.externalLinks = 0;
    stats.fences = { columns: 0, table: 0, styled: 0 };
    rendered = renderPages();
  }
  for (const id of rendered.native) index.blockPaths[id] = pages[block2page[id]].vaultPath;
  stats.emittedIds = rendered.emitted.size;
  stats.droppedIds = Object.keys(block2page).filter((id) => !rendered.emitted.has(id)).length;

  // files: media
  for (const rel of rels) {
    const p = pages[rel];
    const prefix = posixDir(p.key) + "/media/";
    for (const key of Object.keys(files)) {
      if (!key.startsWith(prefix)) continue;
      const name = key.slice(prefix.length);
      if (!name || name.includes("/")) continue;
      out.set(p.vaultDir + "/media/" + name, files[key]);
      stats.assets++;
    }
  }

  for (const [path, data] of cachedCovers) out.set(path, data);
  stats.cachedCovers = cachedCovers.size;
  stats.assets += stats.cachedCovers;

  // report + guide
  const report: string[] = [];
  report.push("# Wolai 导入报告\n");
  report.push("- 页面：" + stats.pages + " 个");
  report.push("- 资源：" + stats.assets + " 个");
  if (stats.databases) report.push(`- 原生 Bases：${stats.databases} 张，记录笔记 ${stats.records} 篇（来自所选的数据补充包）`);
  if (stats.recordLinks) report.push(`- 已转为 Obsidian 内链的数据库记录引用：${stats.recordLinks} 处`);
  if (stats.cachedCovers) report.push(`- 本地封面：${stats.cachedCovers} 张（按源页面 ID 恢复）`);
  report.push("- 数据块：" + stats.blocks + " 个（含嵌套）");
  report.push("- 已写出块 ID：" + stats.emittedIds + " 个；空块/分栏容器未写出：" + stats.droppedIds + " 个");
  report.push("- 多维表格来源链接：" + stats.dbPlaceholders + " 处（HTML 未提供数据库记录或视图时，保留原表链接；独立 Excel 附件可在笔记内预览）");
  report.push("- 仍指向 wolai 的外部链接：" + stats.externalLinks + " 处");
  report.push("");
  report.push("## 处理规则\n");
  report.push("- 页面标题 → H1；正文原有 H1 " + (options.demoteH1 === true ? "降为 H2" : "保留") + "。");
  report.push("- 分栏 → `wolai-columns`；表格 → `wolai-table`；彩色块 → `wolai-styled`。");
  report.push("- 折叠块保留展开状态及内容层级，图片保留对齐、宽度和图注。原始附件在各自 `media/`。");
  report.push("");
  if (ctx.unresolvedLinks.size) {
    const descriptions: Record<UnresolvedLink["reason"], string> = {
      target: "页面或记录未随导出提供",
      block: "目标块未生成可跳转的锚点",
      database: "导出未包含数据库记录或视图",
    };
    report.push("## 未能转为内链的引用\n");
    for (const { page, href, label, reason, count } of ctx.unresolvedLinks.values()) {
      const sourcePage = `[[${stripExt(page.vaultPath)}|${safeLabel(page.title)}]]`;
      const original = /^https?:\/\//i.test(href) ? `<${href}>` : `<code>${htmlEscape(href)}</code>`;
      report.push(`- ${sourcePage} · ${safeLabel(label) || "未命名引用"} · ${descriptions[reason]} · ${original}${count > 1 ? `（${count} 处）` : ""}`);
    }
    report.push("");
  }
  report.push("## 页面列表\n");
  for (const rel of rels) report.push("- [[" + pages[rel].vaultPath.replace(/\.md$/, "") + "|" + safeLabel(pages[rel].title) + "]]");
  if (ctx.warnings.length) {
    report.push("\n## 警告\n");
    for (const w of ctx.warnings) report.push("- " + w);
  }
  const reportFolder = `${targetRoot}/_wolai`;
  out.set(`${reportFolder}/迁移报告.md`, report.join("\n") + "\n");
  out.set(`${reportFolder}/说明.md`, [
    "# 如何查看导入结果",
    "",
    `从 Obsidian 左侧「页面」视图展开 **${rootTitle}**。正文和附件也可以从文件列表打开。`,
    "",
    `迁移细节见 [[${reportFolder}/迁移报告|导入报告]]。`,
  ].join("\n") + "\n");

  const fileList: ConvertedFile[] = [];
  for (const [path, data] of out) fileList.push({ path, data });

  return {
    files: fileList,
    index,
    stats,
    warnings: ctx.warnings,
    rootTitle,
    rootPath: pages[rootRel].vaultPath,
  };
}


// ---------------------------------------------------------------- writing

export { ImportCancelledError } from "./archive";

interface VaultEntry {
  path: string;
  children?: VaultEntry[];
  stat?: { mtime: number };
}

export interface VaultLike {
  getAbstractFileByPath(path: string): VaultEntry | null;
  createFolder(path: string): Promise<VaultEntry>;
  create(path: string, data: string): Promise<VaultEntry>;
  createBinary(path: string, data: ArrayBuffer): Promise<VaultEntry>;
  delete(entry: VaultEntry): Promise<void>;
}

export async function writeConverted(
  vault: VaultLike,
  files: ConvertedFile[],
  opts: {
    onProgress?: (done: number, total: number) => void;
    isCancelled?: () => boolean;
    commit?: () => Promise<void>;
    exclusiveRoot?: string;
  } = {},
): Promise<void> {
  const created: { entry: VaultEntry; path: string; mtime?: number }[] = [];
  const remember = (entry: VaultEntry) => created.push({ entry, path: entry.path, mtime: entry.stat?.mtime });
  const checkCancelled = () => {
    if (opts.isCancelled?.()) throw new ImportCancelledError();
  };
  const ensureFolder = async (folder: string) => {
    let cur = "";
    for (const part of folder.split("/")) {
      cur = cur ? cur + "/" + part : part;
      const existing = vault.getAbstractFileByPath(cur);
      if (!existing) remember(await vault.createFolder(cur));
      else if (!Array.isArray(existing.children)) throw new Error("路径已存在且不是文件夹：" + cur);
    }
  };
  try {
    checkCancelled();
    if (opts.exclusiveRoot) {
      if (vault.getAbstractFileByPath(opts.exclusiveRoot)) throw new Error("导入目录已被占用，请重新选择 ZIP");
      remember(await vault.createFolder(opts.exclusiveRoot));
    }
    let done = 0;
    for (const { path, data } of files) {
      checkCancelled();
      const folder = posixDir(path);
      if (folder) await ensureFolder(folder);
      if (vault.getAbstractFileByPath(path)) throw new Error("文件已存在：" + path);
      if (typeof data === "string") remember(await vault.create(path, data));
      else {
        const wholeBuffer = data.buffer instanceof ArrayBuffer && data.byteOffset === 0 && data.byteLength === data.buffer.byteLength;
        const buffer = wholeBuffer ? data.buffer as ArrayBuffer : new Uint8Array(data).buffer;
        remember(await vault.createBinary(path, buffer));
      }
      done++;
      opts.onProgress?.(done, files.length);
      if (done % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    checkCancelled();
    await opts.commit?.();
  } catch (error) {
    const retained: string[] = [];
    for (const { entry, path, mtime } of created.reverse()) {
      const current = vault.getAbstractFileByPath(path);
      if (!current) continue;
      if (current === entry && current.stat?.mtime === mtime && !current.children?.length) {
        try {
          await vault.delete(entry);
          continue;
        } catch (cleanupError) {
          console.error("[wolai-migration] 导入回滚失败", path, cleanupError);
        }
      }
      retained.push(path);
    }
    if (retained.length) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}。以下导入项目已保留，请检查后再重试：${retained.slice(0, 3).join("、")}`, { cause: error });
    }
    throw error;
  }
}
