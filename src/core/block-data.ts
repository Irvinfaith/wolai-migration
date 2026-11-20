import { isArray, isRecord, isString } from "./validation";

interface MarkdownBlock {
  markdown: string;
}

interface ColumnBlock extends MarkdownBlock {
  weight: number;
}

interface ToggleBlock extends MarkdownBlock {
  title: string;
  open?: unknown;
}

interface StyledBlock extends MarkdownBlock {
  classes: string[];
}

interface ImageBlock extends MarkdownBlock {
  caption: string;
  align: "left" | "center" | "right";
  width?: string;
}

interface ProgressBlock {
  value: number;
  max: number;
}

export interface TableCell extends MarkdownBlock {
  classes?: string[];
  header?: boolean | "row" | "col";
  width?: number;
  align?: "left" | "center" | "right" | "justify";
  colspan?: number;
  rowspan?: number;
}

export interface TemplateBlock {
  name: string;
  template?: string;
  body?: string;
  mode?: "page" | "inline";
  containerBlockId?: string;
  addPosition?: "bottom" | "top";
  sourceId?: string;
}

export function readBlockObject(source: string, message: string): Record<string, unknown> {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function hasMarkdown(value: unknown): value is Record<string, unknown> & MarkdownBlock {
  return isRecord(value) && isString(value.markdown);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isStyleClass(value: unknown): value is string {
  return isString(value) && /^wolai-export-[a-z0-9_-]+$/.test(value);
}

export function readColumns(source: string): ColumnBlock[] {
  const value: unknown = JSON.parse(source);
  const isColumn = (column: unknown): column is ColumnBlock =>
    hasMarkdown(column) && isPositiveNumber(column.weight);
  if (!isArray(value) || !value.every(isColumn)) throw new Error("分栏数据无效");
  return value;
}

export function readToggle(source: string): ToggleBlock {
  const value = readBlockObject(source, "折叠内容无效");
  if (!hasMarkdown(value) || !isString(value.title)) throw new Error("折叠内容无效");
  return { ...value, title: value.title };
}

export function readStyled(source: string): StyledBlock {
  const value = readBlockObject(source, "段落样式无效");
  if (!hasMarkdown(value) || !isArray(value.classes) || !value.classes.every(isStyleClass)) {
    throw new Error("段落样式无效");
  }
  return { ...value, classes: value.classes };
}

export function readImage(source: string): ImageBlock {
  const value = readBlockObject(source, "图片版式无效");
  const { align, caption, width } = value;
  if (!hasMarkdown(value) || !isString(caption) || (align !== "left" && align !== "center" && align !== "right")
    || (width !== undefined && (!isString(width) || !/^\d+(?:\.\d+)?(?:px|%)$/.test(width)))) {
    throw new Error("图片版式无效");
  }
  return { markdown: value.markdown, caption, align, width: isString(width) ? width : undefined };
}

export function readProgress(source: string): ProgressBlock {
  const { value, max } = readBlockObject(source, "无效的进度值");
  if (!isPositiveNumber(max) || typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
    throw new Error("无效的进度值");
  }
  return { value, max };
}

function isTableCell(cell: unknown): cell is TableCell {
  if (!hasMarkdown(cell)) return false;
  const { classes, header, width, align, colspan, rowspan } = cell;
  return (classes === undefined || (isArray(classes) && classes.every(isStyleClass)))
    && (header === undefined || typeof header === "boolean" || header === "row" || header === "col")
    && (width === undefined || isPositiveNumber(width))
    && (align === undefined || align === "left" || align === "center" || align === "right" || align === "justify")
    && (colspan === undefined || typeof colspan === "number")
    && (rowspan === undefined || typeof rowspan === "number");
}

export function readTable(source: string): { rows: TableCell[][] } {
  const value = readBlockObject(source, "表格定义无效");
  const isRow = (row: unknown): row is TableCell[] => isArray(row) && row.every(isTableCell);
  if (!isArray(value.rows) || !value.rows.every(isRow)) throw new Error("表格单元格无效");
  return { ...value, rows: value.rows };
}

export function readDatabaseForm(source: string) {
  const { base, form, defaultView } = readBlockObject(source, "表格定义无效");
  if (!isString(base) || !isRecord(form) || !isString(form.name) || !isArray(form.fields)
    || !form.fields.every(isString)) throw new Error("表单定义无效");
  return { base, form: { name: form.name, fields: form.fields }, defaultView: defaultView === "table" ? "table" as const : "form" as const };
}

export function readTemplate(source: string): TemplateBlock {
  const value = readBlockObject(source, "模板定义无效");
  if (!isTemplate(value)) throw new Error("模板定义无效");
  return value;
}

function isTemplate(value: Record<string, unknown>): value is Record<string, unknown> & TemplateBlock {
  const { name, template, body, mode, addPosition, containerBlockId, sourceId } = value;
  return isString(name) && (isString(template) || isString(body))
    && (template === undefined || isString(template)) && (body === undefined || isString(body))
    && (mode === undefined || mode === "page" || mode === "inline")
    && (addPosition === undefined || addPosition === "bottom" || addPosition === "top")
    && (containerBlockId === undefined || isString(containerBlockId)) && (sourceId === undefined || isString(sourceId));
}
