# 贡献指南

欢迎提交能用最小导出样例复现的导入问题，以及对解析、显示和跨平台体验的改进。

## 本地开发

开发和 CI 使用 Node.js 22。

```sh
npm ci
npm run check
npm test
npm run build
```

`npm run build` 生成 `main.js`。把它和 `manifest.json`、`styles.css` 一起复制到独立的 Obsidian 测试库，在阅读视图核对导入结果。

- `src/main.ts` 协调解压、转换、写入和结果展示。
- `src/import-modal.ts` 提供文件选择、拖放、进度和取消操作。
- `src/core/` 处理 ZIP 校验、页面转换、索引和 Excel 预览，可在 Node.js 环境运行测试。
- `src/renderer.js` 在 Obsidian 中呈现迁移后的页面和交互。

## 复现和测试

测试默认使用代码生成的小型 ZIP。Git 默认忽略 ZIP 文件。真实导出请放在 `tests/local/` 或仓库之外，再显式指定文件。

```sh
WOLAI_ZIP="tests/local/example.zip" npm test
```

提交 Issue 前，请用非敏感内容重建问题。贴出小段原始 HTML、生成内容和预期结果，比整份笔记导出更容易核对。在解析改动的测试里描述输入和预期输出，并注明验证过的系统和 Obsidian 版本。

## 制作可选的 Bases 补充包

本地已经有 wolai-local 旧库时，可以用 Python 3.9 或更新版本创建补充包。

```sh
python3 tools/package_bases.py "/path/to/export.zip" "/path/to/old-vault" "/path/to/bases.zip"
```

## 发布

本地开发和测试沿用当前版本号。正式发布更新时，同步 `manifest.json`、`versions.json`、`package.json`、锁文件和更新日志。发布前运行 `npm run check`、`npm test` 和 `npm run package`。CI 在 Linux、macOS 和 Windows 运行构建与测试。

初始化 GitHub 仓库后，开启私密漏洞报告，以便 `SECURITY.md` 指向的渠道可以接收报告。 [GitHub 配置说明](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)

推送与 `manifest.json` 版本**完全一致**的标签会触发 Release 工作流，首发标签为 `0.1.0`。工作流核对版本和兼容表，运行测试，发布三个独立安装文件和便携 ZIP。首次上架在 [Obsidian Community](https://community.obsidian.md/) 提交仓库。 [官方发布文档](https://docs.obsidian.md/plugins/releasing/submit-plugin)
