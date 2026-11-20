import { strFromU8 } from "fflate";
import { readZipSync } from "./archive";

export interface DatabaseSource {
  id: string;
  title: string;
  path: string;
  schema: { name: string; type: string }[];
  records: { path: string; title: string; sourceId?: string }[];
  attachments: string[];
}

export interface DatabaseSupplement {
  databases: Map<string, DatabaseSource>;
  covers: Map<string, string>;
  files: Record<string, Uint8Array>;
  parseYaml: (text: string) => unknown;
  stringifyYaml: (value: unknown) => string;
}

const manifestPath = "wolai-bases.json";
function isSupplementPath(path: unknown): path is string {
  return typeof path === "string" && !path.includes("\\") && path.split("/").every((part) => part && !part.startsWith("."));
}

export function databaseSourceIds(url: string): string[] {
  const match = /^https?:\/\/(?:www\.)?wolai\.com\/([a-z0-9]+)\/?(?:#([a-z0-9]+))?$/i.exec(url.trim());
  return match ? [match[1], match[2]].filter(Boolean) : [];
}

export function readDatabaseSupplement(
  bytes: Uint8Array,
  parseYaml: DatabaseSupplement["parseYaml"],
  stringifyYaml: DatabaseSupplement["stringifyYaml"],
): DatabaseSupplement {
  const files = readZipSync(bytes, undefined, ({ name }) => name === manifestPath || name.startsWith("vault/"));
  if (!files[manifestPath]) throw new Error("数据库补充包缺少 wolai-bases.json");
  const parsed = JSON.parse(strFromU8(files[manifestPath]));
  if (parsed?.version !== 1 || !Array.isArray(parsed.databases)) throw new Error("不支持此数据库补充包格式");
  const hasFile = (path: unknown) => isSupplementPath(path) && Object.hasOwn(files, `vault/${path}`);
  const databases = new Map<string, DatabaseSource>();
  for (const item of parsed.databases) {
    if (!item || typeof item.id !== "string" || !/^[a-z0-9]+$/i.test(item.id) || databases.has(item.id)
      || typeof item.title !== "string" || !hasFile(item.path) || !item.path.endsWith(".base")
      || !Array.isArray(item.schema) || item.schema.some((field) => typeof field?.name !== "string" || typeof field?.type !== "string")
      || !Array.isArray(item.records) || item.records.some((note) => typeof note?.title !== "string" || !hasFile(note.path) || !note.path.endsWith(".md"))
      || !Array.isArray(item.attachments) || item.attachments.some((path) => !hasFile(path) || /\.(?:md|markdown|base)$/i.test(path))) {
      throw new Error("数据库补充包内容不完整，或包含重复的表格 ID");
    }
    databases.set(item.id, item);
  }
  const covers = new Map<string, string>();
  if (parsed.covers !== undefined) {
    if (!Array.isArray(parsed.covers)) throw new Error("封面补充数据格式无效");
    for (const cover of parsed.covers) {
      if (!cover || typeof cover.id !== "string" || !/^[a-z0-9]+$/i.test(cover.id) || covers.has(cover.id)
        || !hasFile(cover.path) || !/\.(?:png|jpe?g|gif|webp|avif)$/i.test(cover.path)) throw new Error("封面补充文件无效");
      covers.set(cover.id, cover.path);
    }
  }
  return { databases, covers, files, parseYaml, stringifyYaml };
}

export function readBaseConfig(source: DatabaseSource, supplement: DatabaseSupplement, recordsFolder: string) {
  const yaml = strFromU8(supplement.files[`vault/${source.path}`]);
  const data = supplement.parseYaml(yaml) as { filters?: unknown; views?: unknown[] };
  if (!data || !Array.isArray(data.views) || !data.views.length) throw new Error(`缺少可用的 Bases 视图：${source.title}`);
  const filters: unknown[] = [`file.inFolder(${JSON.stringify(recordsFolder)})`, 'file.ext == "md"'];
  if (data.filters) filters.push(data.filters);
  return supplement.stringifyYaml({ ...data, filters: { and: filters } });
}
