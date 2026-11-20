#!/usr/bin/env python3
"""Package the wolai-local databases and covers referenced by a wolai HTML export."""

import argparse
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
from zipfile import ZIP_DEFLATED, ZipFile


SOURCE_URL = re.compile(r"https?://www\.wolai\.com/([a-z0-9]+)/?(?:#([a-z0-9]+))?\Z", re.I)
WIKI_LINK = re.compile(r"\[\[([^\]\n|#]+)(?=[\]|#])")
COVER_TYPES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"}


class SourceLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.page_ids = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "wolai-sub-page" in (attrs.get("class") or "").split() and attrs.get("id"):
            self.page_ids.add(attrs["id"])
        if tag != "a":
            return
        match = SOURCE_URL.fullmatch(attrs.get("href") or "")
        if match:
            self.ids.update(filter(None, match.groups()))


def vault_file(vault, relative):
    parts = relative.split("/")
    if "\\" in relative or any(not part or part.startswith(".") for part in parts):
        raise ValueError(f"不支持的仓库路径：{relative}")
    file = vault.joinpath(*parts).resolve()
    if not file.is_relative_to(vault) or not file.is_file():
        raise ValueError(f"仓库里找不到文件：{relative}")
    return file


def build_supplement(html_export, vault, output):
    vault = vault.resolve()
    index = json.loads((vault / ".obsidian/plugins/wolai-local/data.json").read_text(encoding="utf-8"))
    source_links = SourceLinks()
    with ZipFile(html_export) as original:
        for file in original.namelist():
            if file.lower().endswith(".html") and not file.startswith("__MACOSX/"):
                source_links.feed(original.read(file).decode("utf-8-sig"))
                if "/" in file:
                    source_links.page_ids.add(file.split("/", 1)[0])
    nodes = index["nodes"]
    sources_with_referenced_rows = {
        node["databasePath"] for node in nodes.values()
        if node.get("type") == "record" and node.get("sourceId") in source_links.ids
    }
    manifest = {"version": 1, "databases": [], "covers": []}
    sources = {}
    for node in nodes.values():
        source_id = node.get("sourceId")
        cover_path = node.get("cover")
        if node.get("type") == "page" and source_id in source_links.page_ids and isinstance(cover_path, str):
            cover = (vault / cover_path).resolve()
            if cover.is_relative_to(vault) and cover.suffix.lower() in COVER_TYPES and cover.is_file():
                sources[cover_path] = vault_file(vault, cover_path)
                manifest["covers"].append({"id": source_id, "path": cover_path})
        if node.get("type") != "database":
            continue
        if source_id not in source_links.ids and node["path"] not in sources_with_referenced_rows:
            continue
        if any(table["id"] == source_id for table in manifest["databases"]):
            raise ValueError(f"旧仓库存在重复的表格 ID：{source_id}")
        table = {
            "id": source_id, "title": node["title"], "path": node["path"], "schema": node["schema"],
            "records": [], "attachments": [],
        }
        sources[table["path"]] = vault_file(vault, table["path"])
        attachments = set()
        for record_path in node["children"]:
            record = nodes[record_path]
            if record.get("type") != "record" or record.get("databasePath") != node["path"]:
                raise ValueError(f"旧仓库记录归属不一致：{record_path}")
            file = vault_file(vault, record_path)
            sources[record_path] = file
            fields = {"path": record_path, "title": record["title"]}
            if record.get("sourceId"):
                fields["sourceId"] = record["sourceId"]
            table["records"].append(fields)
            for link in WIKI_LINK.findall(file.read_text(encoding="utf-8")):
                suffix = PurePosixPath(link).suffix.lower()
                if not suffix or suffix in {".base", ".md"}:
                    continue
                candidate = (vault / link).resolve()
                if candidate.is_relative_to(vault) and candidate.is_file():
                    sources[link] = vault_file(vault, link)
                    attachments.add(link)
        table["attachments"] = sorted(attachments)
        manifest["databases"].append(table)
    if not manifest["databases"] and not manifest["covers"]:
        raise ValueError("HTML 导出的表格与页面 ID 在旧仓库没有可补充的数据")
    with ZipFile(output, "x", ZIP_DEFLATED) as package:
        package.writestr("wolai-bases.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        for path, file in sorted(sources.items()):
            package.write(file, f"vault/{path}")
    with ZipFile(output) as package:
        if package.testzip() is not None:
            raise ValueError("生成的补充包校验失败")
    return len(manifest["databases"]), sum(len(table["records"]) for table in manifest["databases"]), len(manifest["covers"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html_export", type=Path)
    parser.add_argument("source_vault", type=Path)
    parser.add_argument("output_zip", type=Path)
    args = parser.parse_args()
    tables, records, covers = build_supplement(args.html_export, args.source_vault, args.output_zip)
    print(f"{tables} 张 Bases，{records} 条记录，{covers} 张缓存封面。已生成 {args.output_zip}")


if __name__ == "__main__":
    main()
