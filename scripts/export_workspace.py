#!/usr/bin/env python3
"""Export a portable source snapshot without credentials or generated output."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
folders = {"cmd", "internal", "web", "docs", "design", "tests", ".github", "scripts"}
files = {"README.md", "AGENTS.md", "Dockerfile", "Makefile", "go.mod", "go.sum", "compose.yaml", ".env.example", ".gitignore", ".dockerignore"}
folders.add("deploy")
excluded = {"node_modules", "dist", "test-results", "playwright-report", "coverage", "__pycache__", ".git", ".work", "bak", "secrets", "exports", ".agents", ".codex", ".build-cache"}
design_source = {".md", ".html", ".css", ".ts", ".tsx", ".js", ".svg", ".otf", ".woff2", ".txt"}
entries = []
for path in sorted(root.rglob("*")):
    rel = path.relative_to(root)
    if path.is_symlink() or not path.is_file():
        continue
    if rel.parts[0] not in folders and str(rel) not in files:
        continue
    if set(rel.parts) & excluded:
        continue
    if path.name.startswith(".env") and str(rel) != ".env.example":
        continue
    if path.suffix.lower() in {".log", ".pyc", ".tsbuildinfo", ".dump", ".pem", ".key"}:
        continue
    if rel.parts[0] == "design" and path.suffix.lower() not in design_source:
        continue
    entries.append((str(rel), path.read_bytes(), path.stat().st_mode))

stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
out = root / "exports"
out.mkdir(exist_ok=True)
archive = out / f"hoshi-workspace-{stamp}.zip"
manifest = {"created_utc": stamp, "repository": "https://github.com/xenonfear128/hoshi", "git_history_included": False,
            "files": [{"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data, _ in entries]}
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name, data, mode in entries:
        info = zipfile.ZipInfo("hoshi/" + name)
        info.create_system = 3
        info.external_attr = (0o100755 if mode & 0o111 else 0o100644) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, data)
    z.writestr("hoshi/SOURCE-MANIFEST.json", json.dumps(manifest, ensure_ascii=False, indent=2))
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None, "ZIP CRC verification failed"
    for item in manifest["files"]:
        assert hashlib.sha256(z.read("hoshi/" + item["path"])).hexdigest() == item["sha256"]
checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix(".zip.sha256").write_text(f"{checksum}  {archive.name}\n")
print(json.dumps({"archive": str(archive), "bytes": archive.stat().st_size, "source_files": len(entries), "sha256": checksum}, indent=2))
