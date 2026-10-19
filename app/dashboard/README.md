# 7SK 数据仪表盘

一个本地网页，实时读取 `workspace/data/` 目录并展示：

- **物种对照表**：搜索、分类筛选、按 7SK 序列长度或物种名排序；长度条形图突出人源；展开行可看完整 7SK 序列、复制序列和 5 个蛋白的 NCBI 登录号。
- **三维结构**：Cartoon / Stick / Sphere 三种表示；按组分着色、逐链显示/隐藏；旋转、重置视角、保存 PNG。
- **文件索引**：读取 `data/index.md`，点击条目直接打开对应数据。
- **实时刷新**：页面每 5 秒检查一次数据目录，新增或修改的文件会自动出现；已打开的文件更新时会提示刷新。

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

## 支持的文件

| 类型 | 扩展名 | 显示方式 |
|------|--------|----------|
| 结构 | `.pdb` `.ent` `.cif` `.mmcif` | 三维视图 |
| 表格 | `.csv` | 数据表（UTF-8 / UTF-8 BOM） |
| 比对 | `.sto` `.stk` | Stockholm 序列比对视图；悬停列高亮配对列 |
| 文本 | `.md` `.txt` `.json` `.cm` | 暂不预览，仅列出 |

已为 `7SK_holo-2_20241129_job7027.pdb` 内置链注释（7SK、CCNT1、CDK9、HEXIM1、MEPCE、LARP7）；其它结构文件会按链 ID 与核酸/蛋白自动识别。

## 文件结构

```
dashboard/
├── index.html       页面结构
├── app.js           表格视图、三维视图与轮询逻辑
├── style.css        样式与明暗主题
├── server.py        本地 HTTP 服务与数据读取接口
├── start.bat        Windows 启动脚本
├── vendor/
│   └── 3dmol.min.js
└── README.md
```
