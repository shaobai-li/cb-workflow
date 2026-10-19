"use strict";

/* 7SK 数据仪表盘前端：表格视图 + PDB 三维视图，数据来自本地 server.py。 */

const state = {
  files: [],
  indexEntries: [],
  dataDir: "",
  fileSignature: "",
  statsSignature: "",
  selected: null,
  csv: null,
  csvFile: null,
  aln: null,
  alnFile: null,
  cols: null,
  expanded: new Set(),
  pdb: null,
  pdbFile: null,
  viewer: null,
  model: null,
  hiddenChains: new Set(),
  rep: "cartoon",
  spinning: false,
  toastTimer: null,
  firstFilesLoad: true,
};

const $ = (sel, root = document) => root.querySelector(sel);

const FILE_ICON = { structure: "◈", table: "▦", alignment: "≡", text: "▤", other: "▪" };
const FILE_KIND = { structure: "结构", table: "数据表", alignment: "比对", text: "文本", other: "文件" };
const PROTEINS = ["CCNT1", "CDK9", "MEPCE", "LARP7", "HEXIM1"];

/* ---------- 工具函数 ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fmtNumber(n) {
  return Number.isFinite(n) ? new Intl.NumberFormat("zh-CN").format(n) : "—";
}

function fmtDate(ts) {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(ts * 1000));
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { toast.hidden = true; }, 2800);
}

async function api(url) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

async function copyText(text) {
  const value = String(text ?? "");
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  showToast("已复制到剪贴板");
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function seriesColor(slot) {
  return slot === null || slot === undefined
    ? cssVar("--series-other")
    : cssVar(`--series-${Math.min(slot + 1, 8)}`);
}

function setLive(ok) {
  const status = $("#live-status");
  status.classList.toggle("is-live", ok);
  status.classList.toggle("is-down", !ok);
  $("#live-text").textContent = ok ? "实时 · 每 5 秒检查" : "连接断开，正在重试…";
}

/* ---------- 主题 ---------- */

function effectiveTheme() {
  const attr = document.documentElement.dataset.theme;
  if (attr === "dark" || attr === "light") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function updateThemeIcon() {
  $("#theme-icon").textContent = effectiveTheme() === "dark" ? "☀" : "☾";
  $("#theme-toggle").setAttribute("aria-label", effectiveTheme() === "dark" ? "切换到浅色主题" : "切换到深色主题");
}

function initTheme() {
  const saved = localStorage.getItem("7sk-theme");
  if (saved === "dark" || saved === "light") document.documentElement.dataset.theme = saved;
  updateThemeIcon();
}

function toggleTheme() {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("7sk-theme", next);
  updateThemeIcon();
  updateViewerTheme();
}

/* ---------- 文件与索引 ---------- */

async function loadFiles() {
  try {
    const data = await api("/api/files");
    setLive(true);
    state.dataDir = data.dataDir;

    const previous = new Set(state.files.map((f) => f.name));
    const sig = data.files.map((f) => `${f.name}:${f.mtime}:${f.size}`).join("|");
    const changed = sig !== state.fileSignature;
    state.fileSignature = sig;
    state.files = data.files;

    if (!state.firstFilesLoad && changed) {
      const added = state.files.filter((f) => !previous.has(f.name)).map((f) => f.name);
      if (added.length) showToast(`发现新文件：${added.join("、")}`);
    }
    state.firstFilesLoad = false;

    $("#data-dir").textContent = state.dataDir || "—";
    $("#file-count").textContent = `${state.files.length}`;

    renderFileList();
    renderWelcomeCards();
    updateStaleNotices();

    if (changed || state.statsSignature !== sig) {
      state.statsSignature = sig;
      loadWelcomeStats();
    }
  } catch (err) {
    setLive(false);
    console.error(err);
  }
}

async function loadIndex() {
  try {
    const data = await api("/api/index");
    state.indexEntries = data.entries || [];
    renderIndexList();
    renderWelcomeCards();
  } catch (err) {
    console.error(err);
    $("#index-list").replaceChildren(el("p", "side-empty", "index.md 读取失败"));
  }
}

function indexEntryFor(name) {
  return state.indexEntries.find((entry) => entry.file === name) || null;
}

function renderIndexList() {
  const list = $("#index-list");
  list.replaceChildren();
  $("#index-count").textContent = `${state.indexEntries.length}`;

  if (!state.indexEntries.length) {
    list.append(el("p", "side-empty", "index.md 中暂无条目"));
    return;
  }

  for (const entry of state.indexEntries) {
    const item = el("button", "file-item" + (entry.exists ? "" : " is-missing"));
    item.type = "button";
    item.title = entry.exists ? `打开 ${entry.file}` : "对应文件不存在";

    const icon = el("span", "file-icon", "▤");
    icon.setAttribute("aria-hidden", "true");
    const body = el("span", "file-body");
    body.append(el("span", "file-name", entry.label));
    if (entry.description) body.append(el("span", "file-desc", entry.description));
    body.append(el("span", "file-meta", entry.exists ? "在 data 目录中" : "文件缺失"));
    item.append(icon, body);

    item.addEventListener("click", () => {
      if (!entry.exists) {
        showToast("索引指向的文件不在 data 目录中", true);
        return;
      }
      const file = state.files.find((f) => f.name === entry.file);
      if (file) openFile(file);
      else showToast("文件尚未被扫描到，请稍后重试", true);
    });
    list.append(item);
  }
}

function renderFileList() {
  const list = $("#file-list");
  list.replaceChildren();
  if (!state.files.length) {
    list.append(el("p", "side-empty", "data 目录中暂无文件"));
    return;
  }

  for (const file of state.files) {
    const entry = indexEntryFor(file.name);
    const item = el("button", "file-item" + (state.selected?.name === file.name ? " is-active" : ""));
    item.type = "button";
    item.dataset.name = file.name;

    const icon = el("span", "file-icon", FILE_ICON[file.type] || "▪");
    icon.setAttribute("aria-hidden", "true");

    const body = el("span", "file-body");
    body.append(el("span", "file-name", file.name));
    body.append(el("span", "file-meta", `${FILE_KIND[file.type] || "文件"} · ${fmtBytes(file.size)} · ${fmtDate(file.mtime)}`));
    if (entry?.description) body.append(el("span", "file-desc", entry.description));

    item.append(icon, body);
    item.addEventListener("click", () => openFile(file));
    list.append(item);
  }
}

function renderWelcomeCards() {
  const grid = $("#welcome-cards");
  grid.replaceChildren();

  const cards = [];
  const seen = new Set();
  for (const entry of state.indexEntries) {
    if (entry.exists && !seen.has(entry.file)) {
      seen.add(entry.file);
      cards.push({ file: entry.file, description: entry.description, label: entry.label });
    }
  }
  for (const file of state.files) {
    if (!seen.has(file.name)) {
      seen.add(file.name);
      cards.push({ file: file.name, description: indexEntryFor(file.name)?.description || "", label: file.name });
    }
  }

  if (!cards.length) {
    grid.append(el("p", "side-empty", "data 目录中暂无可用文件。"));
    return;
  }

  for (const card of cards) {
    const file = state.files.find((f) => f.name === card.file);
    if (!file) continue;

    const node = el("article", "file-card");
    node.append(el("h3", null, card.label));
    if (card.description) node.append(el("p", "desc", card.description));

    const meta = el("p", "meta");
    meta.textContent = `${FILE_KIND[file.type] || "文件"} · ${fmtBytes(file.size)} · 更新于 ${fmtDate(file.mtime)}`;
    node.append(meta);

    const foot = el("div", "card-foot");
    const open = el("button", "btn btn-small", file.type === "structure" ? "查看结构" : "打开数据");
    open.type = "button";
    open.addEventListener("click", () => openFile(file));
    foot.append(open, el("span", "meta", file.name));
    node.append(foot);
    grid.append(node);
  }
}

async function loadWelcomeStats() {
  $("#stat-files").textContent = String(state.files.length);

  const csvFile = state.files.find((f) => f.type === "table");
  if (csvFile) {
    try {
      const data = await api(`/api/csv/${encodeURIComponent(csvFile.name)}`);
      $("#stat-species").textContent = String(data.rows.length);
    } catch {
      $("#stat-species").textContent = "—";
    }
  } else {
    $("#stat-species").textContent = "—";
  }

  const pdbFile = state.files.find((f) => f.type === "structure");
  if (pdbFile) {
    try {
      const meta = await api(`/api/pdb/${encodeURIComponent(pdbFile.name)}`);
      $("#stat-chains").textContent = String(meta.chains.length);
      $("#stat-atoms").textContent = fmtNumber(meta.atoms);
      $("#stat-chains-note").textContent = pdbFile.name;
      $("#stat-atoms-note").textContent = pdbFile.name;
    } catch {
      $("#stat-chains").textContent = "—";
      $("#stat-atoms").textContent = "—";
    }
  } else {
    $("#stat-chains").textContent = "—";
    $("#stat-atoms").textContent = "—";
  }
}

function updateStaleNotices() {
  const check = (file, loaded) => {
    const current = state.files.find((f) => f.name === file?.name);
    return Boolean(loaded && current && current.mtime !== loaded.mtime);
  };
  $("#table-stale").hidden = !check(state.csvFile, state.csv);
  $("#alignment-stale").hidden = !check(state.alnFile, state.aln);
  $("#pdb-stale").hidden = !check(state.pdbFile, state.pdb);
}

/* ---------- 视图切换 ---------- */

function showView(name) {
  if (name !== "pdb") stopSpin();
  $("#welcome").hidden = name !== "welcome";
  $("#table-view").hidden = name !== "table";
  $("#alignment-view").hidden = name !== "alignment";
  $("#pdb-view").hidden = name !== "pdb";
}

function openFile(file) {
  state.selected = file;
  renderFileList();
  history.replaceState(null, "", `#${encodeURIComponent(file.name)}`);
  if (file.type === "table") {
    openTable(file);
  } else if (file.type === "structure") {
    openPdb(file);
  } else if (file.type === "alignment") {
    openAlignment(file);
  } else {
    showToast("该文件类型暂不支持预览", true);
  }
}

/* ---------- CSV 表格视图 ---------- */

function colIndex(header, names) {
  for (const name of names) {
    const i = header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

async function openTable(file) {
  showView("table");
  $("#table-title").textContent = file.name;
  $("#table-meta").textContent = "正在读取…";
  $("#data-table").replaceChildren();
  $("#table-stale").hidden = true;
  state.expanded.clear();

  try {
    const data = await api(`/api/csv/${encodeURIComponent(file.name)}`);
    state.csv = data;
    state.csvFile = file;

    const header = data.header;
    const cols = {
      category: colIndex(header, ["分类", "category"]),
      species: colIndex(header, ["species", "物种", "学名"]),
      abbr: colIndex(header, ["abbr", "缩写"]),
      cn: colIndex(header, ["中文", "中文名", "name_cn"]),
      length: colIndex(header, ["7sk_seqlength", "seqlength", "length", "序列长度"]),
      seq: colIndex(header, ["7sk_sequence", "sequence", "seq", "序列"]),
      proteins: PROTEINS.map((name) => ({ name, idx: colIndex(header, [name]) })).filter((p) => p.idx >= 0),
    };
    state.cols = cols;

    $("#table-meta").textContent =
      `${data.rows.length} 行 × ${header.length} 列 · 更新于 ${fmtDate(data.mtime)} · ${fmtBytes(data.size)}`;

    buildCategoryFilter(data, cols);
    resetTableFilters();
    renderTable();
    updateStaleNotices();
  } catch (err) {
    $("#table-meta").textContent = `读取失败：${err.message}`;
    showToast(err.message, true);
    console.error(err);
  }
}

function buildCategoryFilter(data, cols) {
  const select = $("#table-category");
  select.replaceChildren();
  const wrap = select.closest(".filter");
  const hasCategory = cols.category >= 0;
  wrap.hidden = !hasCategory;
  if (!hasCategory) return;

  select.append(new Option("全部分类", ""));
  const values = [];
  for (const row of data.rows) {
    const value = (row[cols.category] || "").trim();
    if (value && !values.includes(value)) values.push(value);
  }
  for (const value of values) select.append(new Option(value, value));
}

function resetTableFilters() {
  $("#table-search").value = "";
  $("#table-category").value = "";
  $("#table-sort").value = "original";
}

function filteredRows() {
  if (!state.csv) return [];
  const cols = state.cols;
  const query = $("#table-search").value.trim().toLowerCase();
  const category = $("#table-category").value;
  const sort = $("#table-sort").value;

  let rows = state.csv.rows.map((row, i) => ({ row, i }));

  if (query) {
    rows = rows.filter(({ row }) =>
      row.some((cell) => String(cell).toLowerCase().includes(query))
    );
  }
  if (category && cols.category >= 0) {
    rows = rows.filter(({ row }) => (row[cols.category] || "").trim() === category);
  }

  if (sort === "length-desc" || sort === "length-asc") {
    const idx = cols.length;
    if (idx >= 0) {
      rows.sort((a, b) => {
        const av = Number(a.row[idx]) || 0;
        const bv = Number(b.row[idx]) || 0;
        return sort === "length-desc" ? bv - av : av - bv;
      });
    }
  } else if (sort === "species-asc") {
    const idx = cols.species >= 0 ? cols.species : 0;
    rows.sort((a, b) => String(a.row[idx]).trim().localeCompare(String(b.row[idx]).trim(), "en"));
  }

  return rows;
}

function renderTable() {
  const table = $("#data-table");
  table.replaceChildren();
  if (!state.csv) return;

  const cols = state.cols;
  const specific = cols.species >= 0 && cols.length >= 0 && cols.seq >= 0;
  const rows = filteredRows();

  $("#table-result-count").textContent = `显示 ${rows.length} / ${state.csv.rows.length} 行`;

  const caption = el("caption", "visually-hidden", `${state.csvFile?.name || ""} 数据表`);
  caption.id = "table-caption";
  table.append(caption);

  const thead = el("thead");
  const headRow = el("tr");
  const headerNames = specific
    ? ["分类", "物种", "缩写", "7SK 长度", "7SK 序列", ...cols.proteins.map((p) => p.name)]
    : state.csv.header;
  for (const name of headerNames) headRow.append(el("th", null, name || "—"));
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");

  if (!rows.length) {
    const tr = el("tr");
    const td = el("td", "empty-cell", "没有匹配的行");
    td.colSpan = headerNames.length;
    tr.append(td);
    tbody.append(tr);
    table.append(tbody);
    return;
  }

  const maxLength = specific
    ? Math.max(1, ...state.csv.rows.map((row) => Number(row[cols.length]) || 0))
    : 1;

  for (const { row, i } of rows) {
    const tr = el("tr");
    const key = String(i);
    const open = state.expanded.has(key);
    if (open) tr.classList.add("is-open");

    if (specific) {
      const cn = cols.cn >= 0 ? (row[cols.cn] || "").trim() : "";
      const latin = (row[cols.species] || "").trim();
      const isHuman = latin.toLowerCase().includes("homo sapiens") || cn === "人";
      if (isHuman) tr.classList.add("row-emph");

      const catTd = el("td");
      const cat = cols.category >= 0 ? (row[cols.category] || "").trim() : "";
      if (cat) catTd.append(el("span", "tag", cat));
      tr.append(catTd);

      const speciesTd = el("td", "species-cell");
      if (cn) speciesTd.append(el("span", "cn", cn));
      if (latin) speciesTd.append(el("span", "latin", latin));
      tr.append(speciesTd);

      tr.append(el("td", "abbr-cell", (row[cols.abbr] || "").trim() || "—"));

      const length = Number(row[cols.length]) || 0;
      const lenTd = el("td");
      const lenWrap = el("span", "len-cell");
      lenWrap.append(el("span", "len-value", fmtNumber(length)));
      const track = el("span", "len-track");
      const bar = el("span", "len-bar");
      bar.style.width = length > 0 ? `${Math.max(4, (length / maxLength) * 100)}%` : "0";
      track.append(bar);
      lenWrap.append(track);
      lenTd.append(lenWrap);
      tr.append(lenTd);

      const seq = String(row[cols.seq] || "");
      const seqTd = el("td", "seq-cell");
      const preview = seq.length > 44 ? `${seq.slice(0, 44)}…` : seq || "—";
      seqTd.append(el("span", "seq-preview", preview));
      if (seq) {
        const toggle = el("button", "seq-toggle", open ? "收起" : "展开序列");
        toggle.type = "button";
        toggle.dataset.expand = key;
        toggle.setAttribute("aria-expanded", String(open));
        seqTd.append(toggle);
      }
      tr.append(seqTd);

      for (const protein of cols.proteins) {
        const td = el("td", "acc-cell");
        const acc = (row[protein.idx] || "").trim();
        if (acc) {
          const link = el("a", "acc-link", acc);
          link.href = `https://www.ncbi.nlm.nih.gov/protein/${encodeURIComponent(acc)}`;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.title = `在 NCBI 查看 ${protein.name} ${acc}`;
          td.append(link);
        } else {
          td.append(el("span", "acc-empty", "—"));
        }
        tr.append(td);
      }

      tbody.append(tr);
      if (open) tbody.append(buildDetailRow(row, cols, headerNames.length));
    } else {
      for (const cell of row) {
        const td = el("td", "generic-cell");
        const text = String(cell ?? "");
        td.textContent = text.length > 140 ? `${text.slice(0, 140)}…` : text;
        if (text.length > 140) td.title = text;
        tr.append(td);
      }
      tbody.append(tr);
    }
  }

  table.append(tbody);
}

function buildDetailRow(row, cols, colSpan) {
  const tr = el("tr", "detail-row");
  const td = el("td");
  td.colSpan = colSpan;

  const inner = el("div", "detail-inner");

  const seq = String(row[cols.seq] || "");
  const seqBlock = el("div", "detail-block");
  seqBlock.append(el("h4", null, "7SK 序列（5′→3′）"));
  const pre = el("pre", "seq-full", seq || "（无序列）");
  seqBlock.append(pre);
  if (seq) {
    const actions = el("div", "detail-actions");
    const copy = el("button", "btn btn-small", "复制序列");
    copy.type = "button";
    copy.addEventListener("click", () => copyText(seq));
    actions.append(copy);
    seqBlock.append(actions);
  }

  const proteinBlock = el("div", "detail-block");
  proteinBlock.append(el("h4", null, "蛋白登录号（NCBI Protein）"));
  const list = el("div", "protein-list");
  const accessions = [];

  for (const protein of cols.proteins) {
    const acc = (row[protein.idx] || "").trim();
    if (acc) accessions.push(`${protein.name}: ${acc}`);
    const item = el("div", "protein-row");
    const left = el("span");
    left.append(el("span", "protein-name", protein.name));
    left.append(document.createTextNode("  "));
    left.append(el("span", "protein-acc", acc || "—"));
    item.append(left);
    if (acc) {
      const copyBtn = el("button", "btn btn-small", "复制");
      copyBtn.type = "button";
      copyBtn.addEventListener("click", () => copyText(acc));
      item.append(copyBtn);
    }
    list.append(item);
  }
  proteinBlock.append(list);

  if (accessions.length) {
    const actions = el("div", "detail-actions");
    const copyAll = el("button", "btn btn-small", "复制全部登录号");
    copyAll.type = "button";
    copyAll.addEventListener("click", () => copyText(accessions.join("\n")));
    actions.append(copyAll);
    proteinBlock.append(actions);
  }

  inner.append(seqBlock, proteinBlock);
  td.append(inner);
  tr.append(td);
  return tr;
}

/* ---------- Stockholm 比对视图 ---------- */

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

async function openAlignment(file) {
  showView("alignment");
  $("#alignment-title").textContent = file.name;
  $("#alignment-meta").textContent = "正在读取…";
  $("#alignment-info").textContent = "把鼠标移到某一列。";
  $("#alignment-table").replaceChildren();
  $("#alignment-stale").hidden = true;

  try {
    const data = await api(`/api/sto/${encodeURIComponent(file.name)}`);
    state.aln = data;
    state.alnFile = file;

    const title = data.title && data.title !== file.name ? `${data.title} · ${file.name}` : file.name;
    $("#alignment-title").textContent = title;
    $("#alignment-meta").textContent =
      `${data.nseq} 条序列 × ${data.alnlen} 列 · ${data.npairs} 个配对 · ` +
      `${data.ncons} 个共识列 · 更新于 ${fmtDate(data.mtime)} · ${fmtBytes(data.size)}`;
    renderAlignment(data);
    updateStaleNotices();
  } catch (err) {
    $("#alignment-meta").textContent = `读取失败：${err.message}`;
    showToast(err.message, true);
    console.error(err);
  }
}

function renderAlignment(data) {
  const table = $("#alignment-table");
  const partner = data.partner;
  const counts = data.counts;
  const chunks = [];

  chunks.push(`<caption class="visually-hidden">${esc(data.filename)} 序列比对</caption>`);
  chunks.push("<thead><tr>");
  chunks.push('<th class="aln-name aln-coord"></th>');
  for (let i = 0; i < data.alnlen; i += 1) {
    const label = (i + 1) % 20 === 0 ? String(i + 1) : "";
    chunks.push(`<th class="aln-coord" data-col="${i + 1}">${label}</th>`);
  }
  chunks.push("</tr><tr>");
  chunks.push('<th class="aln-name">结构</th>');
  for (let i = 0; i < data.alnlen; i += 1) {
    const ch = data.ss[i] || "-";
    const cls = "aln-ss" + (partner[i] ? " paired" : "") + (".,_-~:".includes(ch) ? " soft" : "");
    chunks.push(`<td class="${cls}" data-col="${i + 1}" title="列 ${i + 1}">${esc(ch)}</td>`);
  }
  chunks.push("</tr><tr>");
  chunks.push('<th class="aln-name">RF</th>');
  for (let i = 0; i < data.alnlen; i += 1) {
    const ch = data.rf[i] || ".";
    const cls = "aln-rf" + (ch === ch.toLowerCase() ? " soft" : "");
    const shown = ch === "." || ch === "~" ? "·" : esc(ch);
    chunks.push(`<td class="${cls}" data-col="${i + 1}">${shown}</td>`);
  }
  chunks.push("</tr></thead><tbody>");

  for (const row of data.sequences) {
    const short = String(row.name).split("/")[0];
    chunks.push("<tr>");
    chunks.push(`<th class="aln-name" title="${esc(row.name)}">${esc(short)}</th>`);
    for (let i = 0; i < data.alnlen; i += 1) {
      const raw = row.seq[i] || "-";
      const up = raw.toUpperCase();
      if ("ACGU".includes(up)) {
        chunks.push(`<td class="aln-base aln-b-${up}" data-col="${i + 1}">${up}</td>`);
      } else {
        chunks.push(`<td class="aln-base aln-gap" data-col="${i + 1}">–</td>`);
      }
    }
    chunks.push("</tr>");
  }
  chunks.push("</tbody>");
  table.innerHTML = chunks.join("");

  $("#alignment-note").textContent =
    `结构行来自 Stockholm 文件的 SS_cons；配对只解析成对括号。` +
    `表格横向滚动可查看全部 ${data.alnlen} 列；${data.ncons} 个共识列，其余为插入列。`;

  // 默认高亮一个两侧都有变化、且在首屏内的配对。
  const variety = (cnt) => ["A", "C", "G", "U"].filter((b) => cnt[b] > 0).length;
  const visible = (p, i) => {
    const span = p - (i + 1);
    return p > 0 && p <= 90 && span >= 2 && span <= 30;
  };
  let first = partner.findIndex((p, i) =>
    visible(p, i) && variety(counts[i]) >= 2 && variety(counts[p - 1]) >= 2);
  if (first < 0) first = partner.findIndex((p, i) => visible(p, i));
  if (first >= 0) showAlignmentColumn(first + 1);
}

function showAlignmentColumn(col) {
  const data = state.aln;
  if (!data) return;
  const table = $("#alignment-table");
  table.querySelectorAll(".aln-hl").forEach((node) => node.classList.remove("aln-hl"));

  const partner = data.partner[col - 1] || 0;
  const cols = partner ? [col, partner] : [col];
  for (const c of cols) {
    table.querySelectorAll(`[data-col="${c}"]`).forEach((node) => node.classList.add("aln-hl"));
  }

  const countsText = (cnt) => {
    const parts = ["A", "C", "G", "U"].filter((b) => cnt[b]).map((b) => `${b} ${cnt[b]}`);
    if (cnt.gap) parts.push(`缺口 ${cnt.gap}`);
    return parts.join(" · ") || "—";
  };
  let text = `<b>列 ${col}</b>`;
  text += partner ? ` ↔ 列 <b>${partner}</b>` : " · 未配对";
  text += ` · 本列：${countsText(data.counts[col - 1])}`;
  if (partner) text += ` · 配对列：${countsText(data.counts[partner - 1])}`;
  $("#alignment-info").innerHTML = text;
}

/* ---------- PDB 三维视图 ---------- */

async function openPdb(file) {
  showView("pdb");
  $("#pdb-title").textContent = file.name;
  $("#pdb-meta").textContent = "正在读取…";
  $("#pdb-error").hidden = true;
  $("#pdb-loading").hidden = false;
  $("#pdb-stale").hidden = true;

  if (typeof window.$3Dmol === "undefined") {
    $("#pdb-loading").hidden = true;
    $("#pdb-error").hidden = false;
    $("#pdb-error").textContent = "3Dmol.js 未能加载，请确认 vendor/3dmol.min.js 存在。";
    return;
  }

  try {
    const meta = await api(`/api/pdb/${encodeURIComponent(file.name)}`);
    state.pdb = meta;
    state.pdbFile = file;
    state.hiddenChains.clear();

    const counts = meta.chains
      .map((c) => `${c.component}${c.kind === "rna" ? " RNA" : ""}`)
      .join("、");
    $("#pdb-meta").textContent =
      `${meta.chains.length} 条链 · ${fmtNumber(meta.totalResidues)} 个残基 · ${fmtNumber(meta.atoms)} 个原子 · ` +
      `${fmtBytes(meta.size)} · 更新于 ${fmtDate(meta.mtime)}`;
    $("#pdb-chain-count").textContent = `${meta.chains.length} 条链`;

    const note = indexEntryFor(file.name)?.description;
    $("#pdb-legend-note").textContent = note
      ? `${note}。按组分着色，同一组分的多个拷贝共享颜色。`
      : "按组分着色，同一组分的多个拷贝共享颜色。勾选左侧链可单独查看。";

    renderPdbLegend(meta);
    ensureViewer();
    state.viewer.resize();
    await loadModel(file);
    updateStaleNotices();
  } catch (err) {
    $("#pdb-loading").hidden = true;
    $("#pdb-error").hidden = false;
    $("#pdb-error").textContent = `结构读取失败：${err.message}`;
    showToast(err.message, true);
  }
}

function renderPdbLegend(meta) {
  const list = $("#pdb-legend-list");
  list.replaceChildren();

  for (const chain of meta.chains) {
    const label = el("label", "legend-item");
    label.dataset.chain = chain.id;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !state.hiddenChains.has(chain.id);
    checkbox.setAttribute("aria-label", `显示 ${chain.component} 链 ${chain.id}`);

    const swatch = el("span", "legend-swatch");
    swatch.style.background = seriesColor(chain.slot);
    swatch.setAttribute("aria-hidden", "true");

    const text = el("span", "legend-text");
    text.append(el("span", "legend-name", `${chain.component} · 链 ${chain.id}`));
    const unit = chain.kind === "rna" ? "nt" : "残基";
    text.append(el("span", "legend-meta", `${chain.range} · ${fmtNumber(chain.residues)} ${unit}`));

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.hiddenChains.delete(chain.id);
      else state.hiddenChains.add(chain.id);
      label.classList.toggle("is-hidden", !checkbox.checked);
      applyModelStyle();
    });

    label.append(checkbox, swatch, text);
    if (state.hiddenChains.has(chain.id)) label.classList.add("is-hidden");
    list.append(label);
  }
}

function ensureViewer() {
  if (state.viewer) return;
  const container = $("#pdb-canvas");
  state.viewer = window.$3Dmol.createViewer(container, {
    backgroundColor: cssVar("--surface"),
    antialias: true,
  });
}

async function loadModel(file) {
  const res = await fetch(`/data/${encodeURIComponent(file.name)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`结构文件请求失败 (${res.status})`);
  const pdbText = await res.text();

  const fmt = file.format === "cif" || file.format === "mmcif" ? "cif" : "pdb";
  const viewer = state.viewer;
  viewer.removeAllModels();
  state.model = viewer.addModel(pdbText, fmt);
  applyModelStyle();
  viewer.zoomTo();
  viewer.render();
  $("#pdb-loading").hidden = true;
}

function repSpec(rep) {
  if (rep === "stick") return { stick: { radius: 0.16 } };
  if (rep === "sphere") return { sphere: { scale: 0.3 } };
  return { cartoon: {} };
}

function applyModelStyle() {
  if (!state.viewer || !state.model || !state.pdb) return;
  const viewer = state.viewer;
  const base = repSpec(state.rep);

  viewer.setStyle({}, {});
  for (const chain of state.pdb.chains) {
    const visible = !state.hiddenChains.has(chain.id);
    if (!visible) {
      viewer.setStyle({ chain: chain.id }, {});
      continue;
    }
    const color = seriesColor(chain.slot);
    const style = structuredClone(base);
    if (style.cartoon) {
      style.cartoon.color = color;
      if (chain.kind === "rna") {
        style.stick = { color, radius: 0.12 };
      }
    } else if (style.stick) {
      style.stick.color = color;
    } else if (style.sphere) {
      style.sphere.color = color;
    }
    viewer.setStyle({ chain: chain.id }, style);
  }
  viewer.render();
}

function updateViewerTheme() {
  if (!state.viewer) return;
  const background = cssVar("--surface");
  state.viewer.setBackgroundColor(background);
  applyModelStyle();
}

function resetView() {
  if (!state.viewer) return;
  state.viewer.zoomTo();
  state.viewer.render();
}

function toggleSpin() {
  if (!state.viewer) return;
  state.spinning = !state.spinning;
  if (state.spinning) state.viewer.spin("y", 1);
  else state.viewer.spin(false);
  const btn = $("#pdb-spin");
  btn.textContent = state.spinning ? "停止旋转" : "旋转";
  btn.setAttribute("aria-pressed", String(state.spinning));
}

function stopSpin() {
  if (!state.spinning || !state.viewer) return;
  state.spinning = false;
  state.viewer.spin(false);
  const btn = $("#pdb-spin");
  btn.textContent = "旋转";
  btn.setAttribute("aria-pressed", "false");
}

function saveScreenshot() {
  if (!state.viewer) return;
  const uri = state.viewer.pngURI();
  const a = document.createElement("a");
  const base = (state.pdbFile?.name || "structure").replace(/\.(pdb|ent|cif|mmcif)$/i, "");
  a.href = uri;
  a.download = `${base}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast("图片已保存");
}

/* ---------- 启动 ---------- */

function bindEvents() {
  $("#theme-toggle").addEventListener("click", toggleTheme);

  $("#table-search").addEventListener("input", renderTable);
  $("#table-category").addEventListener("change", renderTable);
  $("#table-sort").addEventListener("change", renderTable);
  $("#table-reset").addEventListener("click", () => {
    resetTableFilters();
    renderTable();
  });

  $("#data-table").addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-expand]");
    if (!toggle) return;
    const key = toggle.dataset.expand;
    if (state.expanded.has(key)) state.expanded.delete(key);
    else state.expanded.add(key);
    renderTable();
  });

  $("#table-reload").addEventListener("click", () => state.selected && openTable(state.selected));
  $("#table-stale-reload").addEventListener("click", () => state.selected && openTable(state.selected));
  $("#alignment-reload").addEventListener("click", () => state.selected && openAlignment(state.selected));
  $("#alignment-stale-reload").addEventListener("click", () => state.selected && openAlignment(state.selected));
  $("#pdb-reload").addEventListener("click", () => state.selected && openPdb(state.selected));
  $("#pdb-stale-reload").addEventListener("click", () => state.selected && openPdb(state.selected));

  $("#alignment-table").addEventListener("mouseover", (event) => {
    const cell = event.target.closest("[data-col]");
    if (cell) showAlignmentColumn(Number(cell.dataset.col));
  });

  $("#pdb-rep").addEventListener("change", (event) => {
    state.rep = event.target.value;
    applyModelStyle();
  });
  $("#pdb-spin").addEventListener("click", toggleSpin);
  $("#pdb-reset").addEventListener("click", resetView);
  $("#pdb-shot").addEventListener("click", saveScreenshot);

  window.addEventListener("hashchange", handleHash);
  window.addEventListener("resize", () => {
    if (state.viewer) state.viewer.resize();
  });
}

function handleHash() {
  const name = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  if (!name) return;
  const file = state.files.find((f) => f.name === name);
  if (file && state.selected?.name !== name) openFile(file);
}

async function init() {
  initTheme();
  bindEvents();
  await Promise.all([loadFiles(), loadIndex()]);
  handleHash();
  setInterval(() => {
    loadFiles();
    loadIndex();
  }, 5000);
}

document.addEventListener("DOMContentLoaded", init);
