import { strToU8 } from "fflate";
import { databaseSourceIds, type DatabaseReference, type DatabaseSource, type DatabaseSupplement } from "./database-supplement";
import { cleanFileName } from "./file-name";
import { columnLabel, openWorkbook } from "./xlsx-preview";

const maxTableFileSize = 16 * 1024 * 1024;
const maxColumns = 256;
const maxRecords = 10_000;
const maxCells = 500_000;
const rowLinkHeader = "wolai 原记录链接";

export interface TabularFile {
  name: string;
  sheets: string[];
  readSheet: (index: number) => string[][];
}

export interface TabularAssignment {
  source: DatabaseReference;
  title: string;
  fileName: string;
  rows: string[][];
}

export function checkTabularFileSize(size: number) {
  if (!size || size > maxTableFileSize) throw new Error("表格文件为空或超过 16 MiB");
}

function validateRowLimits(rows: string[][]) {
  if (rows.length < 2) throw new Error("表格需要一行表头和至少一行记录");
  if (rows.length > maxRecords + 1) throw new Error(`每张表最多导入 ${maxRecords} 行记录`);
  if (rows.reduce((total, row) => total + row.length, 0) > maxCells) throw new Error("表格单元格过多，请分批导入");
}

function decodeCsv(bytes: Uint8Array): string {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error("无法读取 CSV 编码，请另存为 UTF-8 CSV");
  }
}

// Preserve quoted delimiters, escaped quotes, and multiline cells.
function parseCsv(input: string): string[][] {
  const directive = /^sep=([,;\t])\r?\n/i.exec(input);
  const separator = directive?.[1] ?? ",";
  const text = directive ? input.slice(directive[0].length) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let state: "start" | "plain" | "quoted" | "closed" = "start";
  let cells = 0;
  const finishField = () => {
    row.push(field);
    if (row.length > maxColumns) throw new Error(`每张表最多导入 ${maxColumns} 列`);
    field = "";
    state = "start";
  };
  const finishRow = () => {
    finishField();
    if (row.some((value) => value.trim())) {
      cells += row.length;
      if (rows.length > maxRecords || cells > maxCells) throw new Error("CSV 行数或单元格数超过上限，请分批导入");
      rows.push(row);
    }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === "quoted") {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') state = "closed";
      else field += char;
    } else if (char === separator) {
      finishField();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      finishRow();
    } else if (state === "start" && char === '"') {
      state = "quoted";
    } else {
      if (char === '"' || state === "closed") throw new Error("CSV 引号格式有误，请检查原文件");
      state = "plain";
      field += char;
    }
  }
  if (state === "quoted") throw new Error("CSV 有未闭合的引号");
  if (row.length || state !== "start") finishRow();
  validateRowLimits(rows);
  return rows;
}

export function openTabularFile(name: string, bytes: Uint8Array, parseXml: (xml: string) => Document): TabularFile {
  checkTabularFileSize(bytes.length);
  if (/\.csv$/i.test(name)) {
    const rows = parseCsv(decodeCsv(bytes));
    return { name, sheets: [], readSheet: () => rows };
  }
  if (!/\.xlsx$/i.test(name)) throw new Error("请选择 CSV 或 Excel（.xlsx）文件");
  const workbook = openWorkbook(bytes, parseXml);
  return {
    name,
    sheets: workbook.sheets,
    readSheet: (index) => {
      const sheet = workbook.readSheet(index, maxColumns);
      if (sheet.truncatedColumns) throw new Error(`每张表最多导入 ${maxColumns} 列`);
      if (sheet.rows.length > maxRecords + 1 || sheet.rows.length * sheet.columns > maxCells) {
        throw new Error("工作表行数或单元格数超过上限，请分批导入");
      }
      const rows = sheet.rows.map(({ cells }) =>
        Array.from({ length: sheet.columns }, (_, column) => cells.get(column + 1) ?? ""));
      validateRowLimits(rows);
      return rows;
    },
  };
}

function headersFor(rows: string[][]): string[] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const used = new Set(["tags", "aliases", "cssclasses", "__proto__", "constructor", "prototype"]);
  return Array.from({ length: width }, (_, index) => {
    const header = rows[0][index]?.replace(/\s+/g, " ").trim();
    const name = !header || header.toLowerCase().startsWith("_wolai_") ? `列 ${columnLabel(index + 1)}` : header;
    let key = name;
    for (let suffix = 2; used.has(key.toLowerCase()); suffix++) key = `${name} ${suffix}`;
    used.add(key.toLowerCase());
    return key;
  });
}

function recordId(link: string | undefined, tableId: string): string | undefined {
  const [id, fragment] = databaseSourceIds(link ?? "");
  if (id === tableId) return fragment && fragment !== tableId ? fragment : undefined;
  if (id && (!fragment || fragment === id)) return id;
}

export function checkTabularBatch(assignments: TabularAssignment[]) {
  let records = 0;
  let cells = 0;
  for (const { rows } of assignments) {
    validateRowLimits(rows);
    records += rows.length - 1;
    cells += rows.reduce((total, row) => total + row.length, 0);
  }
  if (records > maxRecords || cells > maxCells) throw new Error(`一批最多导入 ${maxRecords} 行记录和 ${maxCells} 个表格单元格，请拆分批次`);
}

export function createTabularSupplement(
  assignments: TabularAssignment[],
  references: DatabaseReference[],
  parseYaml: DatabaseSupplement["parseYaml"],
  stringifyYaml: DatabaseSupplement["stringifyYaml"],
): DatabaseSupplement {
  checkTabularBatch(assignments);
  const sources = new Set(references.map(({ id }) => id));
  const files: Record<string, Uint8Array> = {};
  const databases = new Map<string, DatabaseSource>();
  for (const { source, title, fileName, rows } of assignments) {
    if (!sources.has(source.id) || databases.has(source.id)) throw new Error("表格来源缺失或已重复选择");
    const headers = headersFor(rows);
    const isLinkHeader = (name: string) => name.trim().toLowerCase() === rowLinkHeader;
    const linkIndex = rows[0].findIndex(isLinkHeader);
    const uniqueLinkColumn = linkIndex !== -1 && !rows[0].slice(linkIndex + 1).some(isLinkHeader);
    const directory = `table/${source.id}`;
    const path = `${directory}/table.base`;
    const records: DatabaseSource["records"] = [];
    const usedPaths = new Set<string>();
    const nextSuffix = new Map<string, number>();
    files[`vault/${path}`] = strToU8(stringifyYaml({
      views: [{ type: "table", name: "表格", order: ["file.name", ...headers.map((header) => `note.${header}`)],
        sort: [{ property: "note._wolai_order", direction: "ASC" }] }],
    }));
    for (const [index, values] of rows.slice(1).entries()) {
      const title = values[0]?.replace(/\s+/g, " ").trim() || `记录 ${index + 1}`;
      const stem = Array.from(cleanFileName(title)).slice(0, 60).join("").replace(/^\.+|[ .]+$/g, "") || `记录 ${index + 1}`;
      const stemKey = stem.normalize("NFC").toLowerCase();
      let name = stem;
      let suffix = nextSuffix.get(stemKey) ?? 2;
      while (usedPaths.has(name.normalize("NFC").toLowerCase())) name = `${stem} ${suffix++}`;
      nextSuffix.set(stemKey, suffix);
      usedPaths.add(name.normalize("NFC").toLowerCase());
      const path = `${directory}/records/${name}.md`;
      const data = Object.fromEntries(headers.map((key, column) => [key, values[column] ?? ""]));
      const sourceId = uniqueLinkColumn ? recordId(values[linkIndex], source.id) : undefined;
      const properties = { ...data, _wolai_database: source.id, _wolai_order: index + 1 };
      files[`vault/${path}`] = strToU8(`---\n${stringifyYaml(properties).trimEnd()}\n---\n`);
      records.push({ path, title, sourceId: sourceId && !sources.has(sourceId) ? sourceId : undefined });
    }
    databases.set(source.id, {
      id: source.id,
      title: Array.from(title.trim()).slice(0, 60).join("") || "数据表格",
      path, records, attachments: [], tableFile: fileName,
      schema: headers.map((name, index) => ({ name, type: index === 0 ? "primary" : "text" })),
    });
  }
  return { databases, covers: new Map(), files, parseYaml, stringifyYaml };
}
