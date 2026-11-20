import { unzip, unzipSync, type UnzipFileInfo, type Unzipped } from "fflate";

const MIB = 1024 * 1024;

export interface ZipLimits {
  compressed: number;
  expanded: number;
  entry: number;
  entries: number;
}

export const IMPORT_ZIP_LIMITS: ZipLimits = {
  compressed: 768 * MIB,
  expanded: 1024 * MIB,
  entry: 256 * MIB,
  entries: 20_000,
};

export const WORKBOOK_ZIP_LIMITS: ZipLimits = {
  compressed: 64 * MIB,
  expanded: 128 * MIB,
  entry: 32 * MIB,
  entries: 4_000,
};

export class ImportCancelledError extends Error {
  constructor() {
    super("已取消导入");
    this.name = "ImportCancelledError";
  }
}

export function checkZipSize(size: number, limits = IMPORT_ZIP_LIMITS): void {
  if (size > limits.compressed) throw new Error(`ZIP 超过 ${limits.compressed / MIB} MiB 上限`);
  if (size < 22) throw new Error("ZIP 内容不完整");
}

function validateDirectory(bytes: Uint8Array, limits: ZipLimits, include: (entry: UnzipFileInfo) => boolean) {
  checkZipSize(bytes.byteLength, limits);
  const names = new Set<string>();
  let entries = 0;
  let expanded = 0;

  // Inspect the central directory before any member is inflated or a worker is started.
  unzipSync(bytes, { filter: (entry) => {
    if (++entries > limits.entries) throw new Error(`ZIP 超过 ${limits.entries} 个条目的上限`);
    const { name, originalSize, size, compression } = entry;
    const segments = name.replace(/\/$/, "").split("/");
    // Reject control characters before an archive path reaches the vault.
    if (!name || name.includes("\\") || /[\0-\x1f]/.test(name) ||
      /^[a-z]:/i.test(name) || segments.some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error("ZIP 包含不安全的文件路径");
    }
    if (!include(entry) || name.endsWith("/")) return false;
    if (names.has(name) || ["__proto__", "prototype", "constructor"].includes(name)) throw new Error("ZIP 包含重复或无效的文件名");
    if (compression !== 0 && compression !== 8) throw new Error("ZIP 使用了不支持的压缩方式");
    if (compression === 0 && size !== originalSize) throw new Error("ZIP 条目大小无效");
    if (originalSize > limits.entry) throw new Error(`ZIP 中单个文件超过 ${limits.entry / MIB} MiB`);
    expanded += originalSize;
    if (expanded > limits.expanded) throw new Error(`ZIP 解压内容超过 ${limits.expanded / MIB} MiB`);
    names.add(name);
    return false;
  } });
  return { filter: ({ name }: UnzipFileInfo) => names.has(name) };
}

export function readZipSync(bytes: Uint8Array, limits = IMPORT_ZIP_LIMITS, include: (entry: UnzipFileInfo) => boolean = () => true): Unzipped {
  return unzipSync(bytes, validateDirectory(bytes, limits, include));
}

export async function readZip(bytes: Uint8Array, signal: AbortSignal): Promise<Unzipped> {
  if (signal.aborted) throw new ImportCancelledError();
  const options = validateDirectory(bytes, IMPORT_ZIP_LIMITS, () => true);
  return new Promise((resolve, reject) => {
    const cancel = () => {
      terminate();
      reject(new ImportCancelledError());
    };
    const terminate = unzip(bytes, options, (error, files) => {
      signal.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve(files);
    });
    signal.addEventListener("abort", cancel, { once: true });
  });
}
