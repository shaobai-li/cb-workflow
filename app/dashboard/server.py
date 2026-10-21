#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""7SK 数据仪表盘本地服务。

直接读取 workspace/data 目录，新文件或修改后的文件无需重启服务即可看到。

用法:
    python server.py                 # 默认端口 8765，自动打开浏览器
    python server.py --port 9000     # 指定端口
    python server.py --no-browser    # 不自动打开浏览器
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import threading
import time
import webbrowser
from collections import Counter, OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = (APP_DIR.parent.parent / "data").resolve()
HOST = "127.0.0.1"

TYPE_BY_SUFFIX = {
    ".pdb": "structure",
    ".ent": "structure",
    ".cif": "structure",
    ".mmcif": "structure",
    ".csv": "table",
    ".sto": "alignment",
    ".stk": "alignment",
    ".cm": "text",
    ".md": "text",
    ".txt": "text",
    ".json": "text",
}

STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/vendor/3dmol.min.js": ("vendor/3dmol.min.js", "text/javascript; charset=utf-8"),
}

NUCLEIC_RESIDUES = {
    "A", "U", "G", "C", "I", "T",
    "DA", "DT", "DG", "DC", "DU",
    "RA", "RU", "RG", "RC",
}

# 对已知结构的链注释；未收录的文件自动按链 ID / 核酸类型识别。
KNOWN_CHAINS = {
    "7SK_holo-2_20241129_job7027.pdb": {
        "K": ("7SK", "7SK RNA"),
        "A": ("CDK9", "CDK9 · 链 A"),
        "D": ("CDK9", "CDK9 · 链 D"),
        "B": ("CCNT1", "CCNT1 · 链 B"),
        "E": ("CCNT1", "CCNT1 · 链 E"),
        "C": ("HEXIM1", "HEXIM1 · 链 C"),
        "F": ("HEXIM1", "HEXIM1 · 链 F"),
        "G": ("MEPCE", "MEPCE · 链 G"),
        "H": ("LARP7", "LARP7 · 链 H"),
    },
}
KNOWN_COMPONENT_ORDER = ["7SK", "CCNT1", "CDK9", "HEXIM1", "MEPCE", "LARP7"]

INDEX_RE = re.compile(r"^\s*[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*(?:[—–-]\s*)?(.*)$")

_parse_cache: dict[str, tuple[tuple, dict]] = {}
_cache_lock = threading.Lock()


def _cached(kind: str, path: Path, builder):
    st = path.stat()
    sig = (str(path), st.st_mtime_ns, st.st_size)
    with _cache_lock:
        hit = _parse_cache.get(kind + ":" + path.name + ":" + str(path.parent))
        if hit and hit[0] == sig:
            return hit[1]
    value = builder(path)
    with _cache_lock:
        _parse_cache[kind + ":" + path.name + ":" + str(path.parent)] = (sig, value)
    return value


def file_type(path: Path) -> str:
    return TYPE_BY_SUFFIX.get(path.suffix.lower(), "other")


def scan_files() -> dict:
    files = []
    if DATA_DIR.is_dir():
        for p in sorted(DATA_DIR.iterdir(), key=lambda x: x.name.lower()):
            if not p.is_file() or p.name.startswith("."):
                continue
            if p.name == "index.md":
                continue
            st = p.stat()
            files.append({
                "name": p.name,
                "type": file_type(p),
                "format": p.suffix.lower().lstrip("."),
                "size": st.st_size,
                "mtime": int(st.st_mtime),
            })
    return {"dataDir": str(DATA_DIR), "files": files}


def parse_index() -> dict:
    path = DATA_DIR / "index.md"
    entries = []
    if path.is_file():
        text = path.read_text(encoding="utf-8", errors="replace")
        for line in text.splitlines():
            m = INDEX_RE.match(line)
            if not m:
                continue
            label, href, desc = m.group(1).strip(), m.group(2).strip(), m.group(3).strip()
            target = unquote(href).split("#", 1)[0]
            target_path = (DATA_DIR / target).resolve()
            exists = target_path.is_file() and target_path.parent == DATA_DIR
            entries.append({
                "label": label,
                "href": href,
                "description": desc,
                "file": target_path.name if exists else None,
                "exists": exists,
            })
    return {"entries": entries}


def _read_pdb_meta(path: Path) -> dict:
    chains: "OrderedDict[str, dict]" = OrderedDict()
    atoms_total = 0
    with path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith(("ATOM  ", "HETATM")) and len(line) >= 27:
                ch = line[21].strip() or "?"
                resn = line[17:20].strip()
                resi = line[22:27].strip()
                if ch not in chains:
                    chains[ch] = {
                        "id": ch,
                        "atoms": 0,
                        "residues": OrderedDict(),
                        "het": set(),
                        "nuc": 0,
                    }
                c = chains[ch]
                c["atoms"] += 1
                atoms_total += 1
                if resi not in c["residues"]:
                    c["residues"][resi] = resn
                    if resn in NUCLEIC_RESIDUES:
                        c["nuc"] += 1
                if line.startswith("HETATM"):
                    c["het"].add(resn)

    known = KNOWN_CHAINS.get(path.name, {})
    chain_list = []
    for ch, c in chains.items():
        n_res = len(c["residues"])
        kind = "rna" if n_res and c["nuc"] / n_res > 0.5 else "protein"
        component, label = known.get(
            ch,
            (
                ("RNA" if kind == "rna" else "链 " + ch),
                ("RNA · 链 " + ch if kind == "rna" else "链 " + ch),
            ),
        )
        res_keys = list(c["residues"].keys())
        chain_list.append({
            "id": ch,
            "component": component,
            "label": label,
            "kind": kind,
            "residues": n_res,
            "atoms": c["atoms"],
            "first": res_keys[0],
            "last": res_keys[-1],
            "range": res_keys[0] + "–" + res_keys[-1] if res_keys else "",
            "het": sorted(c["het"]),
        })

    # 颜色槽位：已收录结构按固定组分顺序；其余按出现顺序，最多 8 类，超出折叠为“其他”。
    if known:
        order = [name for name in KNOWN_COMPONENT_ORDER if any(c["component"] == name for c in chain_list)]
        order += [c["component"] for c in chain_list if c["component"] not in order]
    else:
        order = []
        for c in chain_list:
            if c["component"] not in order:
                order.append(c["component"])

    components = []
    for name in order:
        comp_chains = [c["id"] for c in chain_list if c["component"] == name]
        slot = order.index(name)
        components.append({
            "name": name,
            "slot": slot if slot < 8 else None,
            "chains": comp_chains,
        })
    comp_by_name = {comp["name"]: comp for comp in components}
    for c in chain_list:
        c["slot"] = comp_by_name[c["component"]]["slot"]

    st = path.stat()
    return {
        "filename": path.name,
        "size": st.st_size,
        "mtime": int(st.st_mtime),
        "atoms": atoms_total,
        "chains": chain_list,
        "components": components,
        "totalResidues": sum(c["residues"] for c in chain_list),
    }


def read_pdb_meta(path: Path) -> dict:
    return _cached("pdb", path, _read_pdb_meta)


def _read_csv(path: Path) -> dict:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    header = rows[0] if rows else []
    width = len(header)
    body = []
    for row in rows[1:]:
        if len(row) < width:
            row = row + [""] * (width - len(row))
        elif len(row) > width:
            row = row[:width]
        if any(cell.strip() for cell in row):
            body.append(row)
    st = path.stat()
    return {
        "filename": path.name,
        "header": header,
        "rows": body,
        "size": st.st_size,
        "mtime": int(st.st_mtime),
    }


def read_csv_data(path: Path) -> dict:
    return _cached("csv", path, _read_csv)


def _read_sto(path: Path) -> dict:
    seqs: "OrderedDict[str, list[str]]" = OrderedDict()
    ss_parts: list[str] = []
    rf_parts: list[str] = []
    gf: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.rstrip()
        if line.startswith("#=GF"):
            parts = line.split(None, 2)
            if len(parts) == 3:
                gf.setdefault(parts[1], parts[2].strip())
        elif line.startswith("#=GC SS_cons"):
            parts = line.split(None, 2)
            if len(parts) == 3:
                ss_parts.append(parts[2].strip())
        elif line.startswith("#=GC RF"):
            parts = line.split(None, 2)
            if len(parts) == 3:
                rf_parts.append(parts[2].strip())
        elif line and not line.startswith(("#", "//")):
            parts = line.split()
            if len(parts) >= 2:
                seqs.setdefault(parts[0], []).append(parts[1])

    joined = {k: "".join(v) for k, v in seqs.items()}
    aln_len = len(next(iter(joined.values()))) if joined else 0
    ss = ("".join(ss_parts) + "-" * aln_len)[:aln_len]
    rf = ("".join(rf_parts) + "." * aln_len)[:aln_len]

    partner = [0] * aln_len
    stacks: dict[str, list[int]] = {k: [] for k in "<([{"}
    closers = {">": "<", ")": "(", "]": "[", "}": "{"}
    for i, ch in enumerate(ss):
        if ch in stacks:
            stacks[ch].append(i)
        elif ch in closers:
            stack = stacks[closers[ch]]
            if stack:
                j = stack.pop()
                partner[i], partner[j] = j + 1, i + 1

    counts = []
    for i in range(aln_len):
        c = Counter(s[i].upper() if i < len(s) else "-" for s in joined.values())
        counts.append({
            "A": c.get("A", 0), "C": c.get("C", 0),
            "G": c.get("G", 0), "U": c.get("U", 0),
            "gap": c.get("-", 0) + c.get(".", 0),
        })

    st = path.stat()
    return {
        "filename": path.name,
        "title": gf.get("DE") or path.name,
        "accession": gf.get("AC", ""),
        "size": st.st_size,
        "mtime": int(st.st_mtime),
        "nseq": len(joined),
        "alnlen": aln_len,
        "npairs": sum(1 for p in partner if p) // 2,
        "ncons": sum(1 for ch in rf if ch not in ".~"),
        "sequences": [{"name": k, "seq": v} for k, v in joined.items()],
        "ss": ss,
        "rf": rf,
        "partner": partner,
        "counts": counts,
    }


def read_sto_data(path: Path) -> dict:
    return _cached("sto", path, _read_sto)


def safe_data_file(name: str) -> Path | None:
    try:
        p = (DATA_DIR / unquote(name)).resolve()
    except OSError:
        return None
    if p.parent != DATA_DIR or not p.is_file():
        return None
    return p


class DashboardHandler(BaseHTTPRequestHandler):
    server_version = "7SKDashboard/1.0"

    def do_GET(self) -> None:  # noqa: N802 (stdlib naming)
        parsed = urlparse(self.path)
        path = parsed.path

        if path in STATIC_FILES:
            rel, ctype = STATIC_FILES[path]
            self._send_file(APP_DIR / rel, ctype)
            return

        if path == "/api/files":
            self._send_json(scan_files())
            return

        if path == "/api/index":
            self._send_json(parse_index())
            return

        if path.startswith("/api/csv/"):
            target = safe_data_file(path[len("/api/csv/"):])
            if not target or file_type(target) != "table":
                self._send_json({"error": "CSV 文件不存在"}, 404)
                return
            self._send_json(read_csv_data(target))
            return

        if path.startswith("/api/sto/"):
            target = safe_data_file(path[len("/api/sto/"):])
            if not target or file_type(target) != "alignment":
                self._send_json({"error": "比对文件不存在"}, 404)
                return
            self._send_json(read_sto_data(target))
            return

        if path.startswith("/api/pdb/"):
            target = safe_data_file(path[len("/api/pdb/"):])
            if not target or file_type(target) != "structure":
                self._send_json({"error": "结构文件不存在"}, 404)
                return
            self._send_json(read_pdb_meta(target))
            return

        if path.startswith("/data/"):
            target = safe_data_file(path[len("/data/"):])
            if not target:
                self._send_json({"error": "文件不存在"}, 404)
                return
            ctype = (
                "application/json; charset=utf-8"
                if target.suffix.lower() == ".json"
                else {
                    "structure": "chemical/x-pdb; charset=utf-8",
                    "table": "text/csv; charset=utf-8",
                    "alignment": "text/plain; charset=utf-8",
                    "text": "text/plain; charset=utf-8",
                }.get(file_type(target), "application/octet-stream")
            )
            self._send_file(target, ctype)
            return

        self._send_json({"error": "Not found"}, 404)

    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, ctype: str) -> None:
        try:
            data = path.read_bytes()
        except OSError:
            self._send_json({"error": "文件读取失败"}, 500)
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt: str, *args) -> None:
        # 只记录错误，轮询请求不刷屏。
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


def make_server(port: int) -> ThreadingHTTPServer:
    for candidate in range(port, port + 20):
        try:
            return ThreadingHTTPServer((HOST, candidate), DashboardHandler)
        except OSError:
            continue
    raise SystemExit(f"端口 {port}–{port + 19} 均被占用，请用 --port 指定其它端口。")


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="7SK 数据仪表盘本地服务")
    parser.add_argument("--port", type=int, default=8765, help="监听端口（默认 8765）")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    args = parser.parse_args()

    if not DATA_DIR.is_dir():
        raise SystemExit(f"数据目录不存在: {DATA_DIR}")

    httpd = make_server(args.port)
    url = f"http://{HOST}:{httpd.server_address[1]}/"
    print("7SK 数据仪表盘已启动")
    print(f"  地址: {url}")
    print(f"  数据: {DATA_DIR}")
    print("  按 Ctrl+C 停止\n")

    if not args.no_browser:
        threading.Thread(target=lambda: (time.sleep(0.6), webbrowser.open(url)), daemon=True).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
