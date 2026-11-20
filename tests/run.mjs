import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { DOMParser } from 'linkedom';
import { convertExport, ImportCancelledError, writeConverted } from '../dist/importer.mjs';
import { columnLabel, openWorkbook } from '../dist/xlsx-preview.mjs';
import { readDatabaseSupplement } from '../dist/database-supplement.mjs';
import { readZip, readZipSync } from '../dist/archive.mjs';
import { restrictIndexToImports } from '../dist/import-index.mjs';

const parseHTML = (html) => new DOMParser().parseFromString(html, 'text/html');
const parseXml = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
const fixture = zipSync({
  'export/专题.html': strToU8(`<!DOCTYPE html><html><body>
    <header><div class="banner"><span class="icon" data-symbol="🏠"></span><div class="image" style="background-image:url('media/封面.png')"></div></div></header>
    <article><div class="wolai-sub-page" id="childid"><a href="专题/子页面.html">子页面</a></div></article>
  </body></html>`),
  'export/专题/子页面.html': strToU8('<html><body><article><p id="textid">子页面正文</p></article></body></html>'),
  'export/media/封面.png': new Uint8Array([1, 2, 3]),
});

function memoryVault() {
  const entries = new Map();
  let timestamp = 0;
  const parentOf = (path) => entries.get(path.slice(0, path.lastIndexOf('/')));
  const add = (path, values) => {
    assert(!entries.has(path));
    const entry = { path, ...values };
    entries.set(path, entry);
    parentOf(path)?.children.push(entry);
    return entry;
  };
  return {
    entries,
    getAbstractFileByPath: (path) => entries.get(path) ?? null,
    async createFolder(path) { return add(path, { children: [] }); },
    async create(path, data) { return add(path, { data, stat: { mtime: ++timestamp } }); },
    async createBinary(path, data) { return this.create(path, data); },
    async delete(entry) {
      assert(!entry.children?.length);
      entries.delete(entry.path);
      const parent = parentOf(entry.path);
      if (parent) parent.children.splice(parent.children.indexOf(entry), 1);
    },
  };
}

test('restores the hierarchy, local cover and per-import report', () => {
  const result = convertExport(fixture, { parseHTML, targetRoot: '归档' });
  const root = result.index.nodes[result.rootPath];
  assert.equal(result.stats.pages, 2);
  assert.equal(root.icon.emoji, '🏠');
  assert.equal(root.cover, '归档/media/封面.png');
  assert.equal(root.children.length, 1);
  assert.equal(result.index.nodes[root.children[0]].title, '子页面');
  assert.equal(result.index.blockPaths.textid, root.children[0]);
  assert(result.files.some(({ path }) => path === root.cover));
  assert(result.files.some(({ path }) => path === '归档/_wolai/迁移报告.md'));
  assert(result.files.every(({ path }) => path.startsWith('归档/')));
  assert.throws(() => convertExport(fixture, { parseHTML, targetRoot: '.obsidian' }), /不能以点号开头/);
});

test('preserves original heading levels and progress, and replaces only matched external covers', () => {
  const original = zipSync({
    'Root123/版式.html': strToU8(`<html><body class="small-font"><header><div class="image has" style="background-position-y: 32%; background-image: url('https://example.com/cover')"></div></header>
      <article><h1 id="section">正文标题</h1>
      <details><summary><div class="marker"></div><h1>折叠标题</h1></summary><p>内容</p></details>
      <details><summary><h4>下级标题</h4></summary><p>内容</p></details>
      <div class="wolai-block wolai-progress" id="bar"><progress value="3" max="5"></progress></div></article></body></html>`),
  });
  const supplement = readDatabaseSupplement(zipSync({
    'wolai-bases.json': strToU8(JSON.stringify({ version: 1, databases: [], covers: [{ id: 'Root123', path: '旧库/封面.jpg' }] })),
    'vault/旧库/封面.jpg': Uint8Array.of(1, 2, 3),
  }), JSON.parse, JSON.stringify);
  const without = convertExport(original, { parseHTML });
  const withCover = convertExport(original, { parseHTML, databaseSupplement: supplement });
  const root = withCover.index.nodes[withCover.rootPath];
  const markdown = withCover.files.find(({ path }) => path === withCover.rootPath).data;
  assert.match(markdown, /^# 正文标题 \^w-section$/m);
  assert.match(markdown, /"title":"# 折叠标题"/);
  assert.match(markdown, /"title":"#### 下级标题"/);
  assert.match(markdown, /```wolai-progress\n\{"value":3,"max":5\}/);
  assert.equal(without.index.nodes[without.rootPath].cover, 'https://example.com/cover');
  assert.equal(root.settings.cover_position, '32%');
  assert.equal(root.settings.wolai_export_layout, true);
  assert.equal(root.settings.is_small_text, true);
  assert.equal(root.cover, '版式/_wolai/cover-Root123.jpg');
  assert.deepEqual(withCover.files.find(({ path }) => path === root.cover).data, Uint8Array.of(1, 2, 3));
  assert.equal(withCover.stats.cachedCovers, 1);
  const demoted = convertExport(original, { parseHTML, demoteH1: true });
  const demotedMarkdown = demoted.files.find(({ path }) => path === demoted.rootPath).data;
  assert.match(demotedMarkdown, /^## 正文标题/m);
  assert.match(demotedMarkdown, /"title":"## 折叠标题"/);
});

test('keeps numbered-list child blocks, image placement and rich table cells', () => {
  const bytes = zipSync({
    'export/排版.html': strToU8(`<html><article>
      <ol start="9"><li><span>第一项</span><ul><li><span>子项</span></li></ul>
        <div class="wolai-block"><figure class="wolai-center" style="width: 213.333px"><img src="media/图.png"><figcaption><b>图注</b></figcaption></figure></div>
      </li><li><span>第二项</span><ol><li><a href="https://example.com">参考</a></li></ol></li></ol>
      <details open><summary><span>检查</span></summary><div class="wolai-block"><figure class="wolai-right" style="width: 45%"><img src="media/图.png"></figure></div></details>
      <div class="wolai-simple-table"><table><thead><tr><th colspan="2" style="width: 240px; text-align: center">表头</th></tr></thead>
      <tbody><tr><th scope="row">类型</th><td><p>一行</p><ul><li>事项</li></ul></td></tr></tbody></table></div>
      <div class="wolai-text"><div><span><a href="https://www.wolai.com/Abc123">无标题数据表格</a></span></div></div>
    </article></html>`),
    'export/media/图.png': new Uint8Array([1, 2, 3]),
  });
  const result = convertExport(bytes, { parseHTML });
  const { data } = result.files.find(({ path }) => path === result.rootPath);
  assert.match(data, /^9\. 第一项\n {3}- 子项$/m);
  assert.match(data, /^ {3}```wolai-image$/m);
  assert.match(data, /^10\. 第二项\n {4}1\. \[参考\]\(https:\/\/example\.com\)$/m);
  const image = JSON.parse(data.match(/```wolai-image\n +([^\n]+)\n/)[1]);
  assert.deepEqual(image, { markdown: '![[排版/media/图.png]]', caption: '**图注**', align: 'center', width: '213.333px' });
  const fold = JSON.parse(data.match(/```wolai-toggle\n([^\n]+)\n/)[1]);
  assert.equal(fold.open, true);
  assert.match(fold.markdown, /"align":"right","width":"45%"/);
  const table = JSON.parse(data.match(/```wolai-table\n([^\n]+)\n/)[1]);
  assert.deepEqual(table.rows[0][0], { markdown: '表头', header: 'col', width: 240, align: 'center', colspan: 2 });
  assert.equal(table.rows[1][0].header, 'row');
  assert.equal(table.rows[1][1].markdown, '一行\n\n- 事项');
  assert.match(data, /```wolai-table-source\n\{"url":"https:\/\/www\.wolai\.com\/Abc123"\}/);
});

test('reads Excel sheet names, cached results and sparse column addresses', () => {
  const bytes = zipSync({
    'xl/workbook.xml': strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="明细" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/sharedStrings.xml': strToU8('<sst><si><r><t>金额</t></r><r><t>合计</t></r></si></sst>'),
    'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="4"><c r="B4" t="s"><v>0</v></c><c r="D4"><f>3+4</f><v>7</v></c><c r="BA4" t="inlineStr"><is><t>备考</t></is></c><c r="ZZ4"><v>15</v></c></row></sheetData></worksheet>'),
  });
  const workbook = openWorkbook(bytes, parseXml);
  assert.deepEqual(workbook.sheets, ['明细']);
  const sheet = workbook.readSheet(0);
  assert.equal(sheet.columns, 53);
  assert.equal(sheet.truncatedColumns, true);
  assert.equal(sheet.rows[0].number, 4);
  assert.equal(sheet.rows[0].cells.get(2), '金额合计');
  assert.equal(sheet.rows[0].cells.get(4), '7');
  assert.equal(sheet.rows[0].cells.get(53), '备考');
  assert.equal(columnLabel(53), 'BA');
});

test('restores a native Base, scoped views, linked record notes and their attachments by source ID', () => {
  const original = zipSync({
    'export/采购.html': strToU8(`<article>
      <ul><li>一盏<a href="https://www.wolai.com/Row123#Row123">台灯</a></li></ul>
      <div class="wolai-text"><div><a href="https://www.wolai.com/Table123#Row123">看这条记录</a></div></div>
      <details><summary>备选</summary><p><a href="https://www.wolai.com/Row123">备用台灯</a></p></details>
      <p><a href="https://www.wolai.com/MissingRow#MissingRow">旧记录</a></p>
      <div class="wolai-block wolai-text" id="Table123"><div><a href="https://www.wolai.com/Table123">无标题数据表格</a></div></div>
      <div class="wolai-text"><div>另一处引用 <a href="https://www.wolai.com/Table123">查看清单</a></div></div>
      <div class="wolai-text"><div><a href="https://www.wolai.com/Unknown123">无标题数据表格</a></div></div>
    </article>`),
  });
  const title = '采购清单';
  const path = '旧采购/清单.base';
  const record = { path: '旧采购/records/台灯.md', title: '台灯', sourceId: 'Row123' };
  const picture = '旧采购/图片/台灯.png';
  const views = [{ type: 'table', name: '清单', order: ['note.金额'], sort: [{ property: 'note.金额', direction: 'DESC' }] }];
  const source = { id: 'Table123', title, path, schema: [{ name: '名称', type: 'primary' }], records: [record], attachments: [picture] };
  const supplement = readDatabaseSupplement(zipSync({
    'wolai-bases.json': strToU8(JSON.stringify({ version: 1, databases: [source] })),
    [`vault/${path}`]: strToU8(JSON.stringify({ views })),
    [`vault/${record.path}`]: strToU8(`---\n{"_wolai_database":"Table123","金额":18}\n---\n\n# 台灯\n\n![[${picture}]]\n`),
    [`vault/${picture}`]: Uint8Array.of(1, 2, 3),
  }), JSON.parse, JSON.stringify);
  const result = convertExport(original, { parseHTML, targetRoot: '验收', databaseSupplement: supplement });
  const files = new Map(result.files.map(({ path, data }) => [path, data]));
  const table = [...files.keys()].find((name) => name.endsWith('.base'));
  const node = result.index.nodes[table];
  const config = JSON.parse(files.get(table));
  assert.equal(result.stats.databases, 1);
  assert.equal(result.stats.records, 1);
  assert.equal(result.stats.recordLinks, 3);
  assert.equal(result.stats.dbPlaceholders, 1);
  assert.deepEqual(config.views, views);
  assert(config.filters.and.includes(`file.inFolder("${node.recordsFolder}")`));
  assert(result.index.nodes[result.rootPath].children.includes(table));
  assert(files.get(result.rootPath).includes(`![[${table}]]`));
  assert(files.get(result.rootPath).includes(`[[${table}|采购清单]]`));
  assert(files.get(result.rootPath).includes('wolai-table-source'));
  assert.equal(node.type, 'database');
  assert.equal(node.children.length, 1);
  assert.equal(result.index.nodes[node.children[0]].databasePath, table);
  const recordPath = node.children[0].slice(0, -3);
  const body = files.get(result.rootPath);
  for (const label of ['台灯', '看这条记录', '备用台灯']) {
    assert(body.includes(`[[${recordPath}|${label}]]`));
  }
  assert(!body.includes(`![[${recordPath}`));
  assert(!body.includes('https://www.wolai.com/Row123'));
  assert.match(body, /\[旧记录\]\(https:\/\/www\.wolai\.com\/MissingRow#MissingRow\)/);
  assert.match(files.get(node.children[0]), /"金额":18/);
  const attachment = [...files.keys()].find((name) => name.endsWith('/台灯.png'));
  assert(files.get(node.children[0]).includes(`![[${attachment}]]`));
});

test('leaves out-of-export references external, even when a different local page has the same title', () => {
  const todo = 'https://www.wolai.com/ExternalTodo#ExternalTodo';
  const absentBlock = 'https://www.wolai.com/InterviewId/#MissingBlock';
  const droppedBlock = 'https://www.wolai.com/InterviewId/#EmptyBlock';
  const zip = zipSync({
    'RootId/计划.html': strToU8(`<article>
      <p><a class="wolai-bi-link" href="${todo}"><span class="embed-page">todo</span></a>，<a href="${todo}">todo</a></p>
      <p><a href="https://wolai.com/InterviewId">同包面试</a> <a href="https://www.wolai.com/InterviewId/#InterviewBlock">段落</a>
      <a href="${absentBlock}">缺失段落</a> <a href="${droppedBlock}">已丢弃的空块</a></p>
      <p id="LocalBlock">同页目标</p><p><a href="#LocalBlock">同页引用</a></p>
      <div class="wolai-sub-page" id="InterviewId"><a href="计划/面试.html">面试</a></div>
      <div class="wolai-sub-page" id="OtherTodo"><a href="计划/todo.html">todo</a></div>
    </article>`),
    'RootId/计划/面试.html': strToU8('<article><p id="InterviewBlock">目标段落</p><div class="wolai-block" id="EmptyBlock"></div></article>'),
    'RootId/计划/todo.html': strToU8('<article><p>另一篇同名笔记</p></article>'),
  });
  const result = convertExport(zip, { parseHTML });
  const files = new Map(result.files.map(({ path, data }) => [path, data]));
  const body = files.get(result.rootPath);
  const report = files.get('计划/_wolai/迁移报告.md');
  assert.equal(result.stats.externalLinks, 4);
  assert.equal(result.stats.pages, 3);
  assert(![...files.keys()].some((path) => path.includes('/引用页面/')));
  assert.equal(result.index.blockPaths.EmptyBlock, undefined);
  assert.equal(result.index.blockPaths.InterviewBlock, '计划/计划/面试.md');
  assert.equal(body.split(`[todo](${todo})`).length - 1, 2);
  assert(body.includes('[[计划/计划/面试|同包面试]]'));
  assert(body.includes('[[计划/计划/面试#^w-InterviewBlock|段落]]'));
  assert(body.includes('[[计划/计划#^w-LocalBlock|同页引用]]'));
  assert(body.includes(`[缺失段落](${absentBlock})`));
  assert(body.includes(`[已丢弃的空块](${droppedBlock})`));
  assert(report.includes(`todo · 页面或记录未随导出提供 · <${todo}>（2 处）`));
  assert(report.includes(`缺失段落 · 目标块未生成可跳转的锚点 · <${absentBlock}>`));
});

test('restores row-only references from a selected supplement and ignores ordinary page payloads', () => {
  const zip = zipSync({
    'RootId/计划.html': strToU8('<article><p><a href="https://www.wolai.com/RecordId#RecordId">记录</a>、<a href="https://www.wolai.com/PageId#PageId">包外页面</a></p></article>'),
  });
  const record = 'vaultname/record.md';
  const table = 'vaultname/entries.base';
  const supplement = readDatabaseSupplement(zipSync({
    'wolai-bases.json': strToU8(JSON.stringify({
      version: 1,
      databases: [{ id: 'TableId', title: '数据表', path: table, schema: [], records: [{ path: record, title: '记录', sourceId: 'RecordId' }], attachments: [] }],
      referencedPages: [{ sourceId: 'PageId', path: 'vaultname/page.md' }],
    })),
    [`vault/${record}`]: strToU8('---\n{"_wolai_database":"TableId"}\n---\n# 记录'),
    [`vault/${table}`]: strToU8('{"views":[{"type":"table","name":"数据表"}]}'),
    'vault/vaultname/page.md': strToU8('# 不在 HTML ZIP 的页面'),
  }), JSON.parse, JSON.stringify);
  const result = convertExport(zip, { parseHTML, databaseSupplement: supplement });
  const body = result.files.find((file) => file.path === result.rootPath).data;
  const recordNode = Object.values(result.index.nodes).find((node) => node.type === 'record');
  assert.equal(result.stats.recordLinks, 1);
  assert.equal(result.stats.pages, 1);
  assert.equal(result.stats.externalLinks, 1);
  assert(body.includes(`[[${recordNode.path.slice(0, -3)}|记录]]`));
  assert(body.includes('[包外页面](https://www.wolai.com/PageId#PageId)'));
  assert(!result.files.some((file) => file.path.endsWith('/page.md')));
});

test('automatically picks an unused folder and reserves it before writing', async () => {
  const vault = memoryVault();
  await vault.createFolder('专题');
  await vault.createFolder('专题 (2)');
  const result = convertExport(fixture, { parseHTML, isTargetOccupied: (path) => vault.entries.has(path) });
  assert.equal(result.rootPath, '专题 (3)/专题.md');
  const root = '专题 (3)';
  await vault.createFolder(root);
  await assert.rejects(writeConverted(vault, result.files, { exclusiveRoot: root }), /导入目录已被占用/);
  assert.deepEqual([...vault.entries.keys()], ['专题', '专题 (2)', root]);
});

test('limits ZIP expansion before extraction and respects cancellation', async () => {
  const smallLimits = { compressed: 1024, expanded: 90, entry: 70, entries: 6 };
  const archive = zipSync({ 'first.txt': new Uint8Array(64), 'second.txt': new Uint8Array(64) });
  assert.throws(() => readZipSync(archive, smallLimits), /解压内容超过/);
  assert.deepEqual(Object.keys(readZipSync(archive, smallLimits, ({ name }) => name === 'first.txt')), ['first.txt']);
  const controller = new AbortController();
  const reading = readZip(archive, controller.signal);
  controller.abort();
  await assert.rejects(reading, { name: 'ImportCancelledError' });
  const extracted = await readZip(archive, new AbortController().signal);
  assert.deepEqual(Object.keys(extracted).sort(), ['first.txt', 'second.txt']);
});

test('keeps only verified import folders when reading an index from an older plugin', () => {
  const result = convertExport(fixture, { parseHTML });
  const original = result.index;
  const plain = '既有/笔记.md';
  const historical = '归档/迁移/root.md';
  const sibling = '归档/手写.md';
  const index = {
    ...original,
    roots: [...original.roots, plain, historical, sibling],
    nodes: {
      ...original.nodes,
      [plain]: { path: plain, title: '笔记', type: 'page', children: [] },
      [historical]: { path: historical, type: 'page', title: 'root', children: [sibling],
        sourceId: 'HistoricalId', sourceUrl: 'https://www.wolai.com/HistoricalId' },
      [sibling]: { path: sibling, title: '手写', type: 'page', children: [] },
    },
    blockPaths: { ...original.blockPaths, unrelated: plain },
  };
  const scoped = restrictIndexToImports(index);
  assert.deepEqual(scoped.roots, [result.rootPath, historical]);
  assert(!scoped.nodes[plain] && !scoped.nodes[sibling]);
  assert.deepEqual(scoped.nodes[historical].children, []);
  assert.deepEqual(scoped.blockPaths, original.blockPaths);
});

test('cancellation rolls back this import and allows a same-folder retry', async () => {
  const vault = memoryVault();
  await vault.create('已有笔记.md', '保留');
  await vault.createFolder('专题');
  const result = convertExport(fixture, { parseHTML });
  let cancelled = false;
  await assert.rejects(writeConverted(vault, result.files, {
    isCancelled: () => cancelled,
    onProgress: (done) => { cancelled = done === 2; },
    commit: async () => assert.fail('cancelled imports must not commit their index'),
  }), ImportCancelledError);
  assert.deepEqual([...vault.entries.keys()], ['已有笔记.md', '专题']);
  assert.equal(vault.entries.get('已有笔记.md').data, '保留');
  let committed = false;
  await writeConverted(vault, result.files, { commit: async () => { committed = true; } });
  assert(committed);
  assert(result.files.every(({ path }) => vault.entries.has(path)));
});

test('a write conflict or failed index commit leaves prior content intact', async () => {
  const vault = memoryVault();
  const original = await vault.create('已有.md', '原内容');
  const files = [
    { path: '新目录/新笔记.md', data: '新内容' },
    { path: '已有.md', data: '不能覆盖' },
  ];
  await assert.rejects(writeConverted(vault, files), /文件已存在/);
  await assert.rejects(writeConverted(vault, files.slice(0, 1), {
    commit: async () => { throw new Error('索引保存失败'); },
  }), /索引保存失败/);
  assert.deepEqual([...vault.entries.values()], [original]);
  assert.equal(original.data, '原内容');
});

test('checks conversion and link targets in a real export when supplied', { skip: !process.env.WOLAI_ZIP }, () => {
  const result = convertExport(readFileSync(process.env.WOLAI_ZIP), { parseHTML });
  const paths = new Set(result.files.map(({ path }) => path));
  assert(result.stats.pages > 0);
  assert(paths.has(result.rootPath));
  assert.equal(paths.size, result.files.length);
  for (const node of Object.values(result.index.nodes)) {
    assert(paths.has(node.path));
    assert(node.children.every((child) => paths.has(child)));
    if (node.cover && !/^https?:\/\//i.test(node.cover)) assert(paths.has(node.cover));
  }
  for (const { data } of result.files) {
    if (typeof data !== 'string') continue;
    for (const [, target] of data.matchAll(/\[\[([^\]#|]+)(?:[^\]]*)\]\]/g)) {
      if (!target.includes('/')) continue; // Exclude illustrative wiki syntax in the report.
      assert(paths.has(target) || paths.has(`${target}.md`), `Unresolved wiki link: ${target}`);
    }
  }
  for (const { path, data } of result.files) {
    if (!/\.xlsx$/i.test(path) || typeof data === 'string') continue;
    const workbook = openWorkbook(data, parseXml);
    const sheets = workbook.sheets.map((_name, index) => workbook.readSheet(index));
    assert(sheets.some((sheet) => sheet.rows.length > 0));
    console.log(`Workbook: ${sheets.length} sheets, ${sheets.reduce((total, sheet) => total + sheet.rows.length, 0)} rows with values`);
  }
  if (process.env.WOLAI_PY_VAULT) checkReference(result, process.env.WOLAI_PY_VAULT);
  console.log(`Real export: ${result.stats.pages} pages, ${result.stats.assets} assets, ${result.files.length} output files`);
});

function checkReference(result, reference) {
  const files = new Map(result.files.map(({ path, data }) => [path, data]));
  const pages = readdirSync(reference, { recursive: true, withFileTypes: false })
    .filter((path) => path.endsWith('.md') && !path.startsWith('.obsidian/') && !path.startsWith('_wolai/'));
  assert(pages.length > 0);
  function normalizeFences(text) {
    return text.replace(/```wolai-([a-z]+)\n([\s\S]*?)\n```/g, (fence, kind, body) => {
      try {
        const value = JSON.parse(body, (key, item) => key === 'markdown' && typeof item === 'string' ? normalizeFences(item) : item);
        return `\`\`\`wolai-${kind}\n${JSON.stringify(value)}\n\`\`\``;
      } catch {
        return fence;
      }
    });
  }
  for (const path of pages) {
    assert.equal(typeof files.get(path), 'string', `Reference page missing: ${path}`);
    assert.equal(normalizeFences(files.get(path)), normalizeFences(readFileSync(join(reference, path), 'utf8')), path);
  }
}
