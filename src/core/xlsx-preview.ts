import { strFromU8 } from "fflate";
import { readZipSync, WORKBOOK_ZIP_LIMITS } from "./archive";

const relationshipNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const maxPreviewColumns = 64;

interface PreviewRow {
  number: number;
  cells: Map<number, string>;
}

export interface PreviewSheet {
  columns: number;
  truncatedColumns: boolean;
  rows: PreviewRow[];
}

function elements(root: Document | Element, name: string): Element[] {
  return Array.from(root.querySelectorAll("*")).filter((element) => element.localName === name);
}

function columnNumber(label: string): number {
  let column = 0;
  for (const letter of label) column = column * 26 + letter.charCodeAt(0) - 64;
  return column;
}

export function columnLabel(column: number): string {
  let label = "";
  for (; column > 0; column = Math.floor((column - 1) / 26)) {
    label = String.fromCharCode(65 + (column - 1) % 26) + label;
  }
  return label;
}

function targetPath(target: string): string {
  const parts: string[] = [];
  for (const segment of (target.startsWith("/") ? target : `xl/${target}`).split("/")) {
    if (segment === "..") parts.pop();
    else if (segment && segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

export function openWorkbook(bytes: Uint8Array, parseXml: (xml: string) => Document) {
  const archive = readZipSync(bytes, WORKBOOK_ZIP_LIMITS, ({ name }) =>
    /^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name));
  const readXml = (path: string): Document => {
    const data = archive[path];
    if (!data) throw new Error("找不到工作簿中的表格内容");
    const doc = parseXml(strFromU8(data));
    if (elements(doc, "parsererror").length) throw new Error("工作表 XML 无法读取");
    return doc;
  };
  const relationships = new Map(elements(readXml("xl/_rels/workbook.xml.rels"), "Relationship")
    .filter((link) => link.getAttribute("Type")?.endsWith("/worksheet") && link.getAttribute("TargetMode") !== "External")
    .map((link) => [link.getAttribute("Id"), targetPath(link.getAttribute("Target") ?? "")]));
  const sheets = elements(readXml("xl/workbook.xml"), "sheet").flatMap((sheet) => {
    const id = sheet.getAttributeNS(relationshipNamespace, "id") || sheet.getAttribute("r:id");
    const path = relationships.get(id);
    return path ? [{ name: sheet.getAttribute("name") || "工作表", path }] : [];
  });
  if (!sheets.length) throw new Error("工作簿没有可预览的工作表");
  const richText = (element: Element) => elements(element, "t")
    .filter((text) => text.parentElement?.localName !== "rPh")
    .map((text) => text.textContent ?? "").join("");
  const shared = archive["xl/sharedStrings.xml"]
    ? elements(readXml("xl/sharedStrings.xml"), "si").map(richText) : [];
  const cache = new Map<string, PreviewSheet>();
  return {
    sheets: sheets.map(({ name }) => name),
    readSheet(index: number, columnLimit = maxPreviewColumns): PreviewSheet {
      const key = `${index}:${columnLimit}`;
      const previous = cache.get(key);
      if (previous) return previous;
      const sheet = sheets[index];
      if (!sheet) throw new Error("工作表不存在");
      let columns = 0;
      let truncatedColumns = false;
      const rows = elements(readXml(sheet.path), "row").map((row, position) => {
        const cells = new Map<number, string>();
        let nextColumn = 1;
        for (const cell of Array.from(row.children)) {
          if (cell.localName !== "c") continue;
          const label = (cell.getAttribute("r") ?? "").match(/^([A-Z]{1,3})\d+$/)?.[1];
          const column = label ? columnNumber(label) : nextColumn;
          nextColumn = column + 1;
          const type = cell.getAttribute("t");
          const raw = elements(cell, "v")[0]?.textContent ?? "";
          const value = type === "s" && raw ? shared[Number(raw)] ?? ""
            : type === "inlineStr" ? richText(cell)
            : type === "b" && raw ? (raw === "1" ? "TRUE" : "FALSE") : raw;
          if (!value) continue;
          if (column > columnLimit) {
            truncatedColumns = true;
            continue;
          }
          cells.set(column, value);
          columns = Math.max(columns, column);
        }
        return { number: Number(row.getAttribute("r")) || position + 1, cells };
      }).filter(({ cells }) => cells.size);
      const result = { rows, columns, truncatedColumns };
      cache.set(key, result);
      return result;
    },
  };
}
