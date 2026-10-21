# 7SK 数据仪表盘

一个本地网页，聚焦展示人源 7SK/P-TEFb/HEXIM 复合物的三维结构，并把五个人源蛋白的 Pfam 结构域映射到结构上。

## 功能

- **视图导航**：左侧一行一个入口——结构、物种对照表、7SK 序列比对；点击通过 URL hash 路由到对应视图。打开页面时默认加载结构。
- **整体结构 panel**：Cartoon / Stick / Sphere 三种表示；按组分着色；逐链显示/隐藏；旋转、重置视角、保存 PNG。
- **Pfam panel**：五个蛋白（CCNT1、CDK9、MEPCE、LARP7、HEXIM1）的全长线性域轨道和域列表。
  - 点击域色块或列表行，在 3D 结构中高亮该域，其余区域变淡。
  - “按 Pfam 着色”把结构切换为按域着色，域外残基显示为灰色；RNA 保持组分色。
  - 轨道下方细条表示 PDB 中已建模的区段，列表同时给出域坐标和建模覆盖率。
- **实时刷新**：页面每 5 秒检查一次 `data/` 目录，文件变化会显示提示。
- **明暗主题**：结构、轨道和域颜色都适配明暗两套主题。

## Pfam 数据

Pfam 注释来自 InterPro REST API，整理在 `data/human_pfam_domains.json`，包含：

- 五个蛋白的 UniProt / RefSeq 登录号和全长；
- Pfam 域 ID、英文名、中文名、起止坐标；
- 每个蛋白在 PDB 中的链及实际已建模区段；
- 每个域的建模覆盖率。

域坐标使用全长 1-based 编号，与 RefSeq 和当前 PDB 的残基编号一致，可直接用于 3D 选择。

当前数据对应结构：`7SK_holo-2_20241129_job7027.pdb`。如果打开其它结构，Pfam panel 会提示数据不匹配；需要为对应结构重新生成 JSON。

注意：`data/` 目录按仓库约定不纳入 Git，`human_pfam_domains.json` 需要本地生成或手动放置；缺失时 Pfam panel 会显示提示。

## 启动

双击 `start.bat`，或在本目录运行：

```bat
python server.py
```

默认监听 `http://127.0.0.1:8765/` 并自动打开浏览器。可选参数：

```bat
python server.py --port 9000     # 指定端口
python server.py --no-browser    # 不自动打开浏览器
```

按 `Ctrl+C` 停止服务。

## 依赖

- Python 3.8+（只用标准库，无需安装任何包）
- 3Dmol.js 已放在 `vendor/3dmol.min.js`，可离线使用
- 服务只监听 `127.0.0.1`，仅本机可访问

## 文件结构

```
dashboard/
├── index.html       页面结构
├── app.js           Pfam 面板、三维视图与轮询逻辑
├── style.css        样式与明暗主题
├── server.py        本地 HTTP 服务与数据读取接口
├── start.bat        Windows 启动脚本
├── vendor/
│   └── 3dmol.min.js
└── README.md
```

## 说明

- 左侧导航按视图类型生成：结构、物种对照表、7SK 序列比对，每项一行。如果 `data/` 中没有对应类型的文件，该项会自动隐藏。
- 也可以通过 `#文件名` 直接打开指定文件（例如 `#7SK_species_ortholog_table_20260909.csv`），导航会同步高亮当前视图。
