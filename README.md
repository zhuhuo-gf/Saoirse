# Saoirse Desktop

> Saoirse Desktop 是独立的第三方社区项目，基于 Bigfish 与 DeepSeek Harness 构建。它不是 DeepSeek 官方产品，也未获得 DeepSeek 的赞助或背书。

Saoirse Desktop 把 DeepSeek Harness 的本地后端与 Web UI 装进 Electron 桌面工作台，并加入项目工作区、文件树、项目级 Harness 会话、集成终端、变更与 Git 控制舱、技能管理和 MCP 接入，以及原创蓝发鲸娘“深海导航员”、系统托盘、全局快捷键、桌面萌宠、完成通知和初次使用向导。

## 当前状态

0.4.1 已形成“小 Codex”初版工作流：项目、对话、终端、Diff/检查点、Git、技能、MCP、权限策略与外观 DIY 统一在一个工作台中。默认背景升级为海军风裙装、完整露出腿部与鞋子的鲸灵海底观测站全身构图。正式公开发布前仍需要设置自己的仓库地址、更新清单地址与代码签名证书。

## 视觉方向

- 深海蓝、月光青、珍珠白与少量珊瑚粉
- 原创蓝发鲸娘，而非直接复制 DeepSeek Logo 或官方素材
- 深海观测站主背景，给半透明工作界面保留足够安静空间
- 应用图标使用独立的小鲸尾月环标志

## 桌面能力

| 能力 | 说明 |
|---|---|
| 系统托盘 | 显示或隐藏主窗口，并管理常用设置 |
| 全局快捷键 | `Ctrl+Shift+D` 随时唤起 Saoirse |
| 桌面萌宠 | 可拖动的透明悬浮窗与多状态动画 |
| 完成通知 | 后端空闲后发送系统通知与桌宠提示 |
| 初次航行 | 引导用户获取并配置 DeepSeek API Key |
| 自定义背景 | 支持 JPG、PNG 与 WebP，按真实格式加载 |
| 右键菜单 | Windows 安装版可启用“用 Saoirse 打开” |
| 项目工作区 | 保存最近项目，切换时让 Harness 使用对应项目目录 |
| 项目文件树 | 懒加载浏览项目文件，双击用系统应用打开 |
| 集成终端 | 用户主动输入命令，从当前项目目录运行并实时查看输出 |
| 变更控制 | 自动轮询 Git 变更、查看 Diff、暂存/取消暂存及单文件安全撤销 |
| 本地检查点 | 保存变更文件快照；撤销前自动备份，可从控制舱恢复 |
| Git 工作流 | 查看分支与历史、运行项目验证脚本、提交已暂存文件 |
| 技能管理 | 浏览内置技能，创建、导入、编辑或回收个人 `SKILL.md` |
| MCP 管理 | 接入 stdio / Streamable HTTP 工具服务器，密钥只引用环境变量 |
| 权限策略 | 设置新会话的只读、项目内写入或完全访问默认值 |
| 外观 DIY | 自选 JPG/PNG/WebP 背景，调整适配、位置、遮罩、模糊和界面缩放 |

## 工作原理

```text
Saoirse Electron 主进程
  ├─ 选择空闲的 127.0.0.1 端口
  ├─ 使用当前项目作为 cwd 启动 @deepseek-ai/dsh --profile web
  ├─ 等待本地后端就绪
  ├─ 通过独立 Cordis patch 将启用的 MCP 工具接入 Harness
  └─ 在受隔离的 WebView 中加载 Harness，由本地工作台管理项目、变更与终端
```

集成终端只执行用户在终端栏或“验证命令”按钮中主动触发的命令。Harness 自己负责模型工具权限和敏感调用审批；Saoirse 设置新会话默认权限，不保存“始终允许”绕过项。

Windows 下 Harness 沙盒主要约束文件写入范围，不能完整隔离读取、网络或其他进程。`danger-full-access` 会关闭默认审批，仅应在完全可信的任务中使用。MCP 密钥应保存在操作系统环境变量中；Saoirse 配置文件只记录环境变量名称。

DeepSeek Harness 依赖固定在 `@deepseek-ai/dsh@0.1.0-rc.6`。打包版需要 Node 22 或更高版本，项目默认准备独立 Node 运行时。

## 开发

```bash
npm install
cd dsh-bundle
npm install --omit=dev
cd ..
npm start
```

开发模式可以通过 `DSH_NODE` 指定 Node 22+ 的路径。

## 打包

```bash
node download-node.js
npm run icons
npm run dist:win
```

其他平台分别使用 `npm run dist:mac` 与 `npm run dist:linux`。原生依赖应当在对应目标平台上构建。

## 发布前配置

1. 将 `package.json` 的 `homepage` 改为 Saoirse 自己的仓库地址。
2. 在发布环境中设置 `SAOIRSE_UPDATE_JSON_URL`，否则自动更新检查保持关闭。
3. 配置 Windows/macOS 代码签名。
4. 审核并随安装包附带 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`。

## 许可证与归属

Saoirse 的修改部分使用 MIT 许可证。项目保留 Bigfish 的 MIT 版权声明，并继续遵守 DeepSeek Harness 的 MIT 许可证。完整信息见 [`LICENSE`](LICENSE) 与 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

“DeepSeek”及其相关商标属于其权利人。Saoirse 中的名称仅用于说明兼容关系。
