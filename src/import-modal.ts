import { App, Modal, Notice } from "obsidian";
import { ImportCancelledError } from "./core/archive";
import type { DatabaseReference } from "./core/database-supplement";
import type { TabularAssignment } from "./core/tabular-supplement";
import { isDomNode } from "./core/validation";
import { pickTableFiles } from "./table-picker";

export type ImportMode = "archive" | "supplement" | "tables";

export interface ImportRequest {
  archive: File;
  supplement?: File;
  selectTableFiles?: (references: DatabaseReference[]) => Promise<TabularAssignment[]>;
  signal: AbortSignal;
}

export interface ImportProgress {
  label: string;
  value: number;
  committing?: boolean;
}

export class ImportModal extends Modal {
  private archive?: File;
  private operation?: AbortController;
  private committing = false;
  private dropListeners?: AbortController;
  private pickButton!: HTMLButtonElement;
  private pickLabel!: HTMLSpanElement;
  private hint!: HTMLSpanElement;
  private status!: HTMLDivElement;
  private progress!: HTMLProgressElement;
  private cancelButton!: HTMLButtonElement;
  private cancelActions!: HTMLDivElement;

  constructor(
    app: App,
    private readonly mode: ImportMode,
    private readonly importZip: (request: ImportRequest, update: (progress: ImportProgress) => void) => Promise<void>,
    private readonly onDismiss: () => void,
  ) {
    super(app);
  }

  onOpen() {
    this.setTitle("导入 wolai");
    const content = this.contentEl;
    content.addClass("wolai-import-modal");
    const input = content.createEl("input", { type: "file", cls: "wolai-file-input" });
    input.accept = ".zip,application/zip";
    this.pickButton = content.createEl("button", { type: "button", cls: "wolai-dropzone" });
    this.pickLabel = this.pickButton.createSpan({ cls: "wolai-dropzone-title" });
    this.hint = this.pickButton.createSpan({ cls: "wolai-dropzone-sub" });
    this.pickButton.onclick = () => input.click();
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      input.value = "";
      if (files.length) void this.accept(files);
    };

    this.status = content.createDiv({ cls: "wolai-import-status", attr: { role: "status" } });
    this.progress = content.createEl("progress", { cls: "wolai-import-progress", attr: { "aria-label": "导入进度" } });
    this.progress.max = 100;
    this.cancelActions = content.createDiv({ cls: "wolai-import-buttons" });
    this.cancelButton = this.cancelActions.createEl("button", { text: "取消导入", type: "button" });
    this.cancelButton.onclick = () => {
      if (this.committing) return;
      this.operation?.abort();
      this.cancelButton.disabled = true;
      this.status.setText("正在取消…");
    };
    this.resetPicker();
    this.registerDrop();
  }

  onClose() {
    if (!this.committing) this.operation?.abort();
    this.dropListeners?.abort();
    this.contentEl.empty();
    this.onDismiss();
  }

  private resetPicker() {
    this.pickLabel.setText("拖入 ZIP 或选择文件");
    this.hint.setText(this.mode === "archive" ? "wolai → 导出 → HTML · 选择后自动导入" : "先选择 wolai 的 HTML 导出 ZIP");
    this.pickButton.disabled = false;
    this.progress.hidden = true;
    this.cancelActions.hidden = true;
  }

  private registerDrop() {
    const controller = new AbortController();
    this.dropListeners = controller;
    const options = { signal: controller.signal };
    this.modalEl.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = this.operation ? "none" : "copy";
      if (!this.operation) this.pickButton.addClass("is-over");
    }, options);
    this.modalEl.addEventListener("dragleave", (event) => {
      if (!isDomNode(event.relatedTarget) || !this.modalEl.contains(event.relatedTarget)) {
        this.pickButton.removeClass("is-over");
      }
    }, options);
    this.modalEl.addEventListener("drop", (event) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      event.stopPropagation();
      this.pickButton.removeClass("is-over");
      void this.accept(Array.from(event.dataTransfer.files));
    }, options);
  }

  private async accept(files: File[]) {
    if (this.operation) return;
    const [file] = files;
    if (files.length !== 1 || !/\.zip$/i.test(file?.name ?? "")) {
      this.status.setText("请选择一个 ZIP 文件。");
      return;
    }
    if (this.mode === "supplement" && !this.archive) {
      this.archive = file;
      this.pickLabel.setText("拖入或选择数据库补充包 ZIP");
      this.hint.setText(`已选 HTML 导出包 · ${file.name}`);
      this.status.empty();
      return;
    }

    const controller = new AbortController();
    this.operation = controller;
    this.pickButton.disabled = true;
    this.pickLabel.setText((this.archive ?? file).name);
    this.hint.empty();
    this.cancelActions.hidden = false;
    this.cancelButton.disabled = false;
    this.progress.hidden = false;
    this.progress.value = 0;

    try {
      const request: ImportRequest = { archive: this.archive ?? file, supplement: this.archive ? file : undefined, signal: controller.signal };
      if (this.mode === "tables") request.selectTableFiles = (references) => this.selectTables(references, controller.signal);
      await this.importZip(request, (progress) => {
        this.progress.value = progress.value;
        if (!controller.signal.aborted) this.status.setText(progress.label);
        if (progress.committing) {
          this.committing = true;
          this.cancelButton.disabled = true;
        }
      });
      this.close();
    } catch (error) {
      const cancelled = error instanceof ImportCancelledError;
      const message = cancelled ? error.message : `导入失败：${error instanceof Error ? error.message : String(error)}`;
      if (this.contentEl.isConnected) this.status.setText(message);
      else if (!cancelled) new Notice(message, 8000);
    } finally {
      this.operation = undefined;
      this.committing = false;
      this.archive = undefined;
      if (this.contentEl.isConnected) this.resetPicker();
    }
  }

  private async selectTables(references: DatabaseReference[], signal: AbortSignal) {
    this.progress.hidden = true;
    this.pickButton.hidden = true;
    this.status.empty();
    const panel = this.contentEl.createDiv({ cls: "wolai-table-picker" });
    this.cancelActions.before(panel);
    try {
      return await pickTableFiles(panel, references, signal);
    } finally {
      panel.remove();
      this.pickButton.hidden = false;
      this.progress.hidden = false;
    }
  }
}
