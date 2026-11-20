import { ImportCancelledError } from "./core/archive";
import type { DatabaseReference } from "./core/database-supplement";
import { checkTabularBatch, checkTabularFileSize, openTabularFile, type TabularAssignment, type TabularFile } from "./core/tabular-supplement";

export async function pickTableFiles(panel: HTMLElement, references: DatabaseReference[], signal: AbortSignal): Promise<TabularAssignment[]> {
  if (signal.aborted) throw new ImportCancelledError();
  return await new Promise((resolve, reject) => {
    const cancel = () => reject(new ImportCancelledError());
    signal.addEventListener("abort", cancel, { once: true });
    const finish = (assignments: TabularAssignment[]) => {
      signal.removeEventListener("abort", cancel);
      resolve(assignments);
    };
    const assignments = new Map<string, TabularAssignment>();
    panel.createDiv({ text: references.length
      ? "给 ZIP 中的多维表格入口选择对应的 CSV 或 Excel 文件。"
      : "这份 ZIP 里没有识别到可补充的多维表格入口。" });
    const fields = panel.createDiv({ cls: "wolai-table-picker-fields" });
    const list = panel.createEl("ul", { cls: "wolai-table-picker-list" });
    const actions = panel.createDiv({ cls: "wolai-import-buttons" });
    const start = actions.createEl("button", { type: "button", text: "开始导入", cls: "mod-cta" });
    const skip = actions.createEl("button", { type: "button", text: "只导入页面" });
    start.hidden = true;
    start.onclick = () => finish([...assignments.values()]);
    skip.onclick = () => finish([]);
    if (!references.length) { skip.focus(); return; }

    const select = fields.createEl("label", { text: "要补充的多维表格" }).createEl("select");
    const sourceUrl = fields.createEl("a");
    const file = fields.createEl("label", { text: "选择 CSV 或 Excel 文件" }).createEl("input", { type: "file" });
    file.accept = ".csv,.xlsx";
    const sheetLabel = fields.createEl("label", { text: "Excel 工作表" });
    const sheet = sheetLabel.createEl("select");
    sheetLabel.hidden = true;
    const title = fields.createEl("label", { text: "导入后的表格名称" }).createEl("input", { type: "text" });
    title.maxLength = 120;
    const status = fields.createDiv({ cls: "wolai-import-status", attr: { role: "status" } });
    const add = fields.createEl("button", { type: "button", text: "添加表格" });
    add.disabled = true;
    const byId = new Map(references.map((reference) => [reference.id, reference]));
    let selectedFile: TabularFile | undefined;

    function showSource() {
      const source = byId.get(select.value);
      sourceUrl.setText(source?.url ?? "");
      sourceUrl.href = source?.url ?? "";
      sourceUrl.target = "_blank";
      sourceUrl.rel = "noopener noreferrer";
      sourceUrl.hidden = !source;
    }

    function showAssignments() {
      list.empty();
      for (const [id, assignment] of assignments) {
        const item = list.createEl("li");
        item.createSpan({ text: `${assignment.title} · ${assignment.source.pageTitle} · ${assignment.fileName} · ${assignment.rows.length - 1} 条` });
        const remove = item.createEl("button", { type: "button", text: "移除", attr: { "aria-label": `移除 ${assignment.title}` } });
        remove.onclick = () => {
          assignments.delete(id);
          showAssignments();
          select.focus();
        };
      }
      start.hidden = !assignments.size;
      skip.hidden = !!assignments.size;
      const previous = select.value;
      select.empty();
      for (const source of references) {
        if (!assignments.has(source.id)) select.createEl("option", { value: source.id, text: `${source.pageTitle} · ${source.id.slice(-8)}` });
      }
      if (byId.has(previous) && !assignments.has(previous)) select.value = previous;
      fields.hidden = assignments.size === references.length;
      showSource();
    }

    function suggestTitle() {
      if (selectedFile) title.value = selectedFile.sheets[Number(sheet.value)] ?? selectedFile.name.replace(/\.(?:csv|xlsx)$/i, "");
    }

    function resetFile() {
      selectedFile = undefined;
      file.value = "";
      title.value = "";
      sheet.empty();
      sheetLabel.hidden = true;
      add.disabled = true;
    }

    select.onchange = showSource;
    sheet.onchange = suggestTitle;
    file.onchange = async () => {
      const selected = file.files?.[0];
      resetFile();
      if (!selected) return;
      status.setText(`正在读取 ${selected.name}…`);
      file.disabled = true;
      try {
        checkTabularFileSize(selected.size);
        const bytes = new Uint8Array(await selected.arrayBuffer());
        if (signal.aborted) return;
        selectedFile = openTabularFile(selected.name, bytes, (xml) => new DOMParser().parseFromString(xml, "application/xml"));
        selectedFile.sheets.forEach((name, index) => sheet.createEl("option", { value: String(index), text: name }));
        sheetLabel.hidden = !selectedFile.sheets.length;
        suggestTitle();
        status.setText(`已选择 ${selected.name}`);
        add.disabled = false;
      } catch (error) {
        status.setText(error instanceof Error ? error.message : String(error));
      } finally {
        file.disabled = false;
      }
    };
    add.onclick = () => {
      const source = byId.get(select.value);
      if (!source || !selectedFile) return;
      try {
        const assignment = { source, title: title.value.trim() || "数据表格", fileName: selectedFile.name,
          rows: selectedFile.readSheet(Number(sheet.value)) };
        checkTabularBatch([...assignments.values(), assignment]);
        assignments.set(source.id, assignment);
        resetFile();
        status.empty();
        showAssignments();
        start.focus();
      } catch (error) {
        status.setText(error instanceof Error ? error.message : String(error));
      }
    };
    showAssignments();
    select.focus();
  });
}
