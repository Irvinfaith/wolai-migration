import { Notice, parseYaml, stringifyYaml } from "obsidian";
import { checkZipSize, ImportCancelledError, readZip } from "./core/archive";
import { readDatabaseSupplement } from "./core/database-supplement";
import { convertPreparedArchive, listDatabaseReferences, prepareArchive, writeConverted, type ConvertResult } from "./core/importer";
import type { ConvertedIndex } from "./core/import-index";
import { createTabularSupplement } from "./core/tabular-supplement";
import { ImportModal, type ImportMode, type ImportRequest, type ImportProgress } from "./import-modal";
import { RendererPlugin } from "./renderer";

export default class WolaiMigrationPlugin extends RendererPlugin {
  importModal?: ImportModal;

  async onload() {
    await super.onload();
    this.addRibbonIcon("download", "导入 wolai ZIP", () => this.openImport());
    this.addCommand({
      id: "import-wolai-html",
      name: "导入 wolai HTML ZIP",
      callback: () => this.openImport(),
    });
    this.addCommand({
      id: "import-with-bases",
      name: "导入 wolai HTML ZIP 和数据库补充包",
      callback: () => this.openImport("supplement"),
    });
    this.addCommand({
      id: "import-with-table-files",
      name: "导入 wolai HTML ZIP 和 CSV / Excel 表格",
      callback: () => this.openImport("tables"),
    });
  }

  onunload() {
    this.importModal?.close();
    super.onunload();
  }

  openImport(mode: ImportMode = "archive") {
    if (this.activeImport) {
      new Notice("正在导入，请等待本次导入结束");
      return;
    }
    this.importModal?.close();
    const modal = new ImportModal(this.app, mode, (request, update) => this.importZip(request, update), () => {
      if (this.importModal === modal) this.importModal = undefined;
    });
    this.importModal = modal;
    modal.open();
  }

  private async importZip(request: ImportRequest, update: (progress: ImportProgress) => void) {
    if (this.activeImport) throw new Error("已有导入正在进行");
    this.activeImport = request.signal;
    const checkCancelled = () => {
      if (request.signal.aborted) throw new ImportCancelledError();
    };
    try {
      checkZipSize(request.archive.size);
      if (request.supplement) checkZipSize(request.supplement.size);
      update({ label: "正在读取 ZIP…", value: 5 });
      const bytes = new Uint8Array(await request.archive.arrayBuffer());
      checkCancelled();
      update({ label: "正在解压 ZIP…", value: 15 });
      const archive = await readZip(bytes, request.signal);
      let databaseSupplement = request.supplement
        ? readDatabaseSupplement(new Uint8Array(await request.supplement.arrayBuffer()), parseYaml, stringifyYaml)
        : undefined;
      checkCancelled();
      update({ label: "正在解析页面…", value: 30 });
      const isCancelled = () => request.signal.aborted;
      const prepared = prepareArchive(archive, {
        parseHTML: (html) => new DOMParser().parseFromString(html, "text/html"),
        isCancelled,
      });
      if (request.selectTableFiles) {
        const references = listDatabaseReferences(prepared, isCancelled);
        const assignments = await request.selectTableFiles(references);
        checkCancelled();
        if (assignments.length) databaseSupplement = createTabularSupplement(assignments, references, parseYaml, stringifyYaml);
        update({ label: "正在转换页面和已选表格…", value: 35 });
      }
      const vault = this.app.vault;
      const existingNames = new Set(vault.getRoot().children.map((file) => file.name.normalize("NFC").toLowerCase()));
      const result = convertPreparedArchive(prepared, {
        databaseSupplement,
        isTargetOccupied: (path) => existingNames.has(path.normalize("NFC").toLowerCase()),
        isCancelled,
      });
      await this.writeImport(result, request.signal, update);
    } finally {
      this.activeImport = undefined;
    }
  }

  private async writeImport(result: ConvertResult, signal: AbortSignal, update: (progress: ImportProgress) => void) {
    const rootFolder = result.rootPath.split("/")[0];
    await writeConverted(this.app.vault, result.files, {
      exclusiveRoot: rootFolder,
      isCancelled: () => signal.aborted,
      yieldToUI: () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)),
      onProgress: (done, total) => {
        if (done === 1 || done === total || done % 10 === 0) {
          update({ label: `正在写入 ${done} / ${total} 个文件…`, value: 40 + done / total * 55 });
        }
      },
      commit: async () => {
        update({ label: "正在保存页面导航…", value: 98, committing: true });
        const previous = this.data;
        const index: ConvertedIndex = {
          ...result.index,
          roots: [...new Set([...(previous?.roots ?? []), ...result.index.roots])],
          nodes: { ...previous?.nodes, ...result.index.nodes },
          blockPaths: { ...previous?.blockPaths, ...result.index.blockPaths },
        };
        await this.saveData(index);
        this.data = index;
      },
    });

    this.error = null;
    try {
      await this.reveal();
      this.expandRoot(result.rootPath);
      await this.open(result.rootPath, undefined);
      this.refreshViews();
    } catch (error) {
      console.error("[wolai-migration] 无法打开导入结果", error);
    }
    const references = result.stats.externalLinks ? ` · ${result.stats.externalLinks} 处原链接，见迁移报告` : "";
    const tables = result.stats.databases ? ` · ${result.stats.databases} 张表、${result.stats.records} 条记录` : "";
    new Notice(`已导入 ${result.stats.pages} 篇页面到「${rootFolder}」${tables}${references}`, 8000);
  }
}
