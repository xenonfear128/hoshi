# Hoshi 跨平台开发交接

快照日期：2026-09-11。接收方先阅读本文，再阅读 README.md。

## 普通标签与网络排版（2026-09-11）

- 用户偏好：会话名称、文件名等标签保持普通样式；玻璃按钮效果仅用于明确的操作按钮。保留标签点击行为、选中状态和键盘焦点。
- `hoshi.css` 移除上述名称按钮的玻璃高光、阴影和按压回弹；侧栏上传/下载固定两行，标签与速率不拆行。
- 已在原服务器仅更新 app，生产构建通过；公网 healthz 正常。最新资源为 `index-CKaD9Pu_.js` / `index-aSgXwUtw.css`。
- 使用公网实际构建配合模拟 API/SSH 数据，检查 1280×640、1024×768、390×740 的亮暗主题，侧栏完整可见；桌面悬停与键盘焦点检查通过。不代表真实 SSH 验收。
- 回退镜像 `hoshi-app:before-flat-labels-20260911`；数据库、密钥与代理保留。工作区及服务器仍无 Git 历史，未同步 GitHub。

## 圆角修复部署（2026-09-11）

- `web/src/hoshi.css`：文件面板 16px 圆角、传输卡片 12px 圆角与 12px 内边距，卡片间距 8px。
- 已部署到现有 `/opt/hoshi`，仅重建和更新 app；数据库、主密钥、代理容器及配置保留。
- TypeScript/Vite 生产构建成功；本地组件模拟检查覆盖桌面、手机及横屏、亮暗主题、WebGL 与降级模式，共 12 组通过。未重新执行真实 SSH 或全量集成测试。
- 源站与公网 healthz 正常；公网首页引用 `index-CFNaf4Xd.js` / `index-CyP3_hHZ.css`，已核对公开 CSS 的圆角规则。
- 回退镜像：`hoshi-app:before-rounded-panels-20260911`。本地与服务器均无 `.git`，无分支或提交 SHA，尚未同步 GitHub。

## 同步仓库

目标：https://github.com/xenonfear128/hoshi

导出时本工作区没有可用 Git 历史，也没有 GitHub 认证。远端访问要求认证，因此未核实仓库是否为空，未推送，也未改动任何远端提交。本 ZIP 是当前文件快照，不包含 Git 历史或认证信息。

在新平台为该仓库授权后，先克隆、查看分支和提交。若已有代码，将本快照在独立迁移分支中比较、合并，避免直接覆盖。若是空仓库，可解压后初始化 Git，再添加上述 origin 并提交推送。不要强制推送或建立互相无关的两个 main 分支。

之后两个平台都以同一 origin 为准：开始工作先查看 git status，再 fetch，干净分支使用 pull --ff-only；并行任务使用各自分支，通过 PR 合并。每次交接记录分支名、提交 SHA、验证结果及是否部署；不能用聊天中的“已完成”代替 Git 提交。GitHub 合并和生产部署是两个独立动作。

## 当前产品状态

- React 19 + TypeScript + Vite，Go 1.26.8，PostgreSQL 17。Node 推荐 22。
- SSH/SFTP、AI 运维与补全、BYOK/订阅、可选主机探针。功能/API 与探针设计见 docs 下现有文档；设计说明不等于所有功能已完整验收。
- 三语品牌：中文「星」、日文「Hoshi」、英文「Stellar」，界面每次仅展示一种；网页标题为「星 SSH / Hoshi SSH / Stellar SSH」。
- 全站 13 处原生下拉框已换为 Select.tsx 自定义 combobox/listbox，使用 Popover 顶层避免被父容器裁切，支持键盘与触屏。
- 字体为 Geist Sans、Noto Sans SC/JP、JetBrains Mono。WOFF2 Unicode 分片和许可证位于 web/public/fonts；fonts.css 最后加载以覆盖旧字体规则。
- 工作台侧栏紧凑展示；已检查 1280×640、1280×720、1366×768、1024×768、1920×1080、390×740、390×844，无纵向溢出。
- 玻璃渲染读取四角半径，修复会话栏上圆下直与统一半径遮罩错位的问题；边缘改为解析计算，移除重复 CSS 边框，接缝处降低高光。未重新引入旧的 >—< 中轴纹理。
- 最近字体和玻璃修改已部署到生产入口域名（见 DEPLOYMENT-HOSHI.md，已去敏）。上线时资源为 index-DGv2nD7b.js / index-DNadxqgY.css；今后重新构建会改变哈希。

## 线上部署与数据边界

源站地址与入口域名不在版本管理中，项目目录 /opt/hoshi，Compose 项目 hoshi，CDN HTTPS 回源端口 8443。实际值请从部署方另行获取；模板见 DEPLOYMENT-HOSHI.md。

本 ZIP 不包含生产数据库、.env、SSH 登录密码、secrets/ 或主密钥，也不是生产数据备份。继续开发只需本源码；如另迁生产数据，数据库和原 master_key 必须分别安全迁移，不可重置密钥。开发测试应使用独立数据库和新生成的开发凭据。

生产主机上的 Compose/Caddy 配置可能不同于源码模板，部署前核对并保留远端配置、secrets 和命名卷。用户未要求迁移生产服务器或停止当前服务。

此前曾定位到 CDN 对 WebSocket 升级请求返回空白 403，而直连源站进入应用。源码的 Origin 校验修复已部署；不能仅凭首页/healthz 就宣称用户终端恢复。用户尚未明确确认所有真实连接问题已解决，后续需按实际 CDN 和已登录终端链路验证。

## 开发和验证

按 README.md 启动数据库、后端和前端。Vite /api 代理到 localhost:8080；后端 PUBLIC_ORIGIN 应与浏览器访问入口一致。AI 订阅服务仍需独立配置，不能凭界面存在判断平台订阅已开通。

```sh
npm --prefix web ci
npm --prefix web run build
npm --prefix web test
go test -race ./...
go vet ./...
```

Go 集成测试必须显式提供隔离的 TEST_DATABASE_URL 和所需 SSH fixture，否则相关测试可能跳过，不能称为全通过。参见 .github/workflows/ci.yml 和 README.md。

浏览器的 fixture 类测试使用模拟 API/SSH 数据，仅验证 UI。以下检查中的 font-rim/glass-optics 通过 Vite 导入源码，不能直接对生产静态站运行完整集合：

```sh
npm --prefix web run dev
# 另一个终端
cd web
npx playwright install chromium webkit
E2E_ORIGIN=http://localhost:5173 npx playwright test sidebar-fit.spec.ts select.spec.ts font-rim.spec.ts glass-optics.spec.ts
```

最近已验证：前端构建、10 个单元测试、上述针对性 UI/渲染检查及 WebKit 字体/边缘检查；并进行了公网页面字体加载和侧栏检查。旧 ui-actions 测试曾存在浏览器崩溃/定位器失败，全量浏览器套件未被宣称全部通过。本次迁移仅将截图输出改为 Playwright 的 testInfo.outputPath，避免依赖旧平台 /tmp 或 /data 路径。

## 打包与用户偏好

保留业务源码、测试源码、依赖锁文件、CI、文档、字体/图标和设计源文件；排除 node_modules、dist、编译缓存、测试输出、截图、旧备份与平台私有目录。测试源码属于继续开发所需内容，测试运行产物不属于源码。

设计文档中的旧截图链接属于历史记录；截图未纳入迁移包。界面现状以源码和重新运行的截图为准。设计概念 HTML、其字体和许可证仍保留。

维护三语、网页主题一致性、密码显示切换、键盘弹出时背景连续性；不要为消除滚动简单裁切内容。备份以源码为主。用户偏好完成已授权工作后直接验证和交付，避免重复询问已授权的常规操作。

重新导出：python3 scripts/export_workspace.py。输出在 exports/，默认不纳入 Git。
