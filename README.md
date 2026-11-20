# Wolai Migration

**从 wolai 无痛迁移到 Obsidian。拖入从 wolai 导出的 ZIP 包，笔记就能接着用。**

wolai 和 Obsidian 的页面组织方式不同，搬家时最费工的是重搭页面树、重新排版、找回图片和接好链接。Wolai Migration 会把原来的子页面层级、分栏、折叠和表格转换成适合 Obsidian 阅读的结构，让图片、附件和可解析的内链一起迁过去。

[下载安装包](../../releases/latest) · [三步迁移](#三步迁移) · [查看迁移范围](#会迁移什么) · [English summary](#english-summary)

## 三步迁移

在 Obsidian [安装插件](#安装)后，用原始 HTML ZIP 开始迁移。

1. 在 wolai 中选择「导出 → HTML」，保存生成的 ZIP。
2. 在 Obsidian 命令面板运行「导入 wolai HTML ZIP」，或点击左侧的下载图标。
3. 拖入 ZIP 或点击选择文件。插件立即开始导入，完成后自动打开根页面。

每次迁移会按根页面名称新建一个目录。遇到同名目录时会自动编号。打开根页面后，可在阅读视图查看原来的布局，在 `_wolai/迁移报告.md` 查看导入数量和无法转换的引用。

## 安装

当前版本支持 **Obsidian 桌面版 1.15.1 或更高**。

1. 在 [GitHub Releases](../../releases/latest) 下载 `wolai-migration-版本号.zip`。
2. 把解压出来的 `wolai-migration` 文件夹放到笔记库的 `.obsidian/plugins/` 目录。
3. 在 Obsidian 的「设置 → 第三方插件」里启用 **Wolai Migration**。

也可以下载单独的 `main.js`、`manifest.json` 和 `styles.css`，放入 `.obsidian/plugins/wolai-migration/`。

## 会迁移什么

| 内容 | 导入结果 |
| --- | --- |
| 页面、标题、列表、待办、引用 | Markdown 笔记，保留可识别的顺序和层级 |
| 页面卡片、分栏、折叠、普通表格 | 在阅读视图中呈现，包括表格合并单元格和图片位置 |
| 图片、视频、文档和 Excel | 保存 ZIP 中提供的附件，Excel 可在阅读视图预览 |
| 页面和块引用 | 导出包里有目标时生成 Obsidian 内链。目标缺失时保留 wolai 原地址，并列在迁移报告里 |
| 多维表格 | HTML 只包含原表链接时保留入口。另选含记录的补充包，可生成原生 Bases |

<details>
<summary>如何导入多维表格到原生 Bases？</summary>

在命令面板执行「导入 wolai HTML ZIP 和数据库补充包」，依次选择原始 HTML ZIP 和补充包。要查看生成的 `.base` 文件，请在 Obsidian 启用 **Bases** 核心插件。

如果你以前用 wolai-local 保存过数据库，可以按 [贡献指南](CONTRIBUTING.md#制作可选的-bases-补充包) 生成本地补充包。它只提供匹配的数据库、记录、记录附件和封面。补充包可能包含私人笔记，请保存在本机。

</details>

<details>
<summary>导入大文件、取消与重试</summary>

ZIP 上限为 768 MiB，解压总量上限为 1 GiB，单个条目上限为 256 MiB，最多 20,000 个条目。遇到超限可在 wolai 里按子页面分批导出。

取消或写入失败时，插件会尝试清理本次创建的文件，并提示仍需检查的项目。重新选择 ZIP 即可重试。

</details>

## 隐私与反馈

插件在本机处理选中的 ZIP，结果写入当前笔记库。页面导航和 Wolai 阅读样式只应用于插件管理的导入批次。外链图片与封面可以向导出文件记载的地址发起请求，点击保留的网页链接也会打开对应站点。

遇到问题可提交 [Issue](../../issues/new/choose)。请附插件版本、Obsidian 版本、操作步骤和已脱敏的最小样例。安全问题使用[私密报告渠道](SECURITY.md)。

欢迎查看 [贡献指南](CONTRIBUTING.md) 和 [更新日志](CHANGELOG.md)。

## English summary

Move your Wolai notes to Obsidian in one step after export. The importer preserves local pages, attachments, and resolvable links.

### Installation

On Obsidian Desktop 1.15.1 or later, download the installation ZIP from [GitHub Releases](../../releases/latest). Extract the `wolai-migration` folder into `.obsidian/plugins/` inside your vault, then enable **Wolai Migration** in **Settings → Community plugins**.

### Usage

Export your notes from Wolai as HTML. In Obsidian, choose **导入 wolai HTML ZIP** in the command palette or click the download icon, then drop or select the export ZIP. Import starts immediately. See `_wolai/迁移报告.md` in the new folder for the migration report.

A Wolai link keeps its original address when the export does not contain the target. Native Bases require an explicitly selected database supplement.

Build and test locally with `npm ci`, `npm test`, and `npm run build`. See [Contributing](CONTRIBUTING.md) for fixtures and releases.

## 许可证

[MIT](LICENSE)。第三方组件归属见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
