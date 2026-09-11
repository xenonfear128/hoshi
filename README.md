# Hoshi · 星 · Stellar

跨平台迁移与当前状态见 [开发交接](docs/HANDOFF.md)。同步仓库：[xenonfear128/hoshi](https://github.com/xenonfear128/hoshi)。

连接每一颗星。SSH、SFTP、Linux 资源监控与 AI 运维的 Web 工作台。React + TypeScript + Go + PostgreSQL。

[桌面界面](design/ui-refinement/1512-light-en-home.png) · [手机界面](design/ui-refinement/390-dark-zh-CN-home.png) · [UI 改进验收](design/UI-REFINEMENT.md)

支持中文、日本語、English，项目名随当前语言分别显示「星」「Hoshi」「Stellar」，每次只显示一个名称。语言选择自动保存，切换不重建 SSH 会话。见 [三语界面规范](docs/I18N.md)。

品牌与视觉规范见 [Hoshi 设计语言](docs/BRAND.md)。现有部署目录、Go 模块名及内部服务标识暂保留 `remoter`，兼容已有数据、脚本和配置。

前端已接入 WebGL 液态玻璃，并适配手机终端、监控和文件操作。[接入说明与移动端验证](docs/LIQUID-GLASS.md)。

第一版提供真实 SSH/SFTP、每秒资源监控、亮暗主题、AI 命令助手与运维任务，以及 BYOK/订阅能力。[功能范围](docs/IMPLEMENTATION.md) · [验证证据与边界](docs/VERIFICATION.md) · [API](docs/API.md) · [运维](docs/OPERATIONS.md) · [订阅配置](docs/BILLING.md)。

## 本地开发

需要 Go 1.26.8+、Node 20.19+/22 和 PostgreSQL 17。推荐桌面版 Chrome/Edge/Firefox/Safari 最新稳定版及 HTTPS。

```sh
npm --prefix web ci
npm --prefix web run build
export DATABASE_URL='postgres://user:password@localhost:5432/remoter?sslmode=disable'
export MASTER_KEY="$(openssl rand -base64 32)"
export PUBLIC_ORIGIN=http://localhost:8080
export ALLOW_REGISTRATION=true
go run -buildvcs=false ./cmd/remoter
```

浏览器访问 http://localhost:8080。开发热更新可运行 `npm --prefix web run dev`，并将后端 `PUBLIC_ORIGIN` 改为实际 Vite 地址，例如 `http://localhost:5173`。不要在每次重启时重新生成 MASTER_KEY，否则既有加密数据无法解密。

默认不允许 SSH 访问回环、链路本地和元数据地址；测试本机 SSH 时显式设置 `SSH_ALLOWED_CIDRS=127.0.0.1/32`。允许普通私网 SSH。AI HTTPS 自定义地址默认禁止所有私网，必要时用 `AI_ALLOWED_CIDRS` 显式放行。

## Docker 部署

1. 复制 `.env.example` 为 `.env`，设置域名、随机数据库密码（建议十六进制）及注册策略。
2. 创建独立秘密文件：

```sh
mkdir -p secrets
chmod 700 secrets
openssl rand -base64 32 > secrets/master_key
openssl rand -hex 32 > secrets/billing_token
: > secrets/subscription_key
chmod 444 secrets/*
```

3. 首次部署可临时设置 `ALLOW_REGISTRATION=true` 创建账号，随后关闭公开注册。
4. `docker compose up -d --build`。Caddy 自动签发 HTTPS；数据库与应用端口不暴露到宿主机。
5. `secrets` 父目录保持 0700，阻止其他宿主用户访问；秘密文件设为 0444，使 Docker 映射后非 root 应用可读。`.env` 设为 0600。也可改用外部秘密管理服务。

订阅 AI 需要配置平台 API URL、模型和 `secrets/subscription_key`。BYOK 用户在界面配置自己的 API Key，不依赖平台 Key。

## 测试

```sh
go test ./...
npm --prefix web run build
npm --prefix web test
```

真实 SSH 集成测试需要一个仅本机监听、允许测试密钥认证并启用 SFTP 的 OpenSSH 实例：

```sh
TEST_DATABASE_URL='postgres://...' TEST_SSH_KEY=/absolute/path/to/test-key go test -race -v ./internal/app
```

当前测试固定使用 `root@127.0.0.1:22222`，仅用于隔离的测试容器或环境，勿将生产 SSH 私钥用于测试。测试会创建并删除自己的账号与临时文件。

## 安全与操作边界

- 登录 Cookie 为 HttpOnly、SameSite=Strict；HTTPS 下启用 Secure。写请求必须匹配 PUBLIC_ORIGIN。
- 主机元数据、SSH 凭据、BYOK 配置和任务内容使用 AES-256-GCM，并通过 AAD 绑定账号及资源。密码用 Argon2id 哈希。
- 密码、私钥、口令不发给 AI；用户主动提供的内容会进行启发式脱敏，仍应自行核对。
- 文件权限以 SSH 用户为准。删除目录仅支持空目录；文本编辑限 1 MB UTF-8，上传限 2 GB。
- SSH 重连创建新终端。长期任务请使用远端 tmux。浏览器关闭可能中止文件传输。
- AI 方案须确认后执行，命令独立运行，遇失败停止。取消仅尝试中断当前命令，不承诺撤销远端变更。
- 首版只支持单个应用实例，不提供跨实例 SSH 会话迁移。


浏览器回归（先运行应用及本机 SSH fixture）：

```sh
cd web
npx playwright install --with-deps chromium
TEST_SSH_KEY=/absolute/test/key npm run test:e2e
```

默认测试目标为 http://localhost:8080，可用 E2E_ORIGIN 指定其他测试地址。实际亮暗界面截图位于 design/verified-workspace-light.png 和 design/verified-workspace-dark.png。
