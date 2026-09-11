# API 与协议

所有业务资源由服务端根据登录会话查验账号所属关系。登录 Cookie：`remoter_session`（HttpOnly、SameSite=Strict，HTTPS 为 Secure）。除支付 Webhook 和管理员额度接口外，写操作必须包含与 PUBLIC_ORIGIN 完全一致的 Origin。

错误响应：`{"error":"说明"}`，HTTP 400 参数错误、401 未登录、403 来源/权限拒绝、404 资源不可见、409 冲突、429 限流、502 上游失败。

## 账号与主机

| 方法 | 路径 | 内容 |
|---|---|---|
| GET | /api/bootstrap | 注册与平台 AI 可用性 |
| POST | /api/register、/api/login | email、password |
| GET | /api/me | 当前账号 ID 与邮箱 |
| POST | /api/logout | 撤销当前会话并关闭其连接 |
| GET / POST | /api/hosts | 主机列表 / 创建 |
| PUT / DELETE | /api/hosts/{id} | 更新 / 删除，关闭旧连接 |
| POST | /api/hosts/{id}/probe | 无凭据探测指纹 |
| POST | /api/hosts/{id}/trust | fingerprint、previous，重探测后条件更新 |
| POST | /api/hosts/{id}/connect | 可选 credential 临时凭据，返回连接 ID |
| DELETE | /api/connections/{id} | 关闭该连接 |

主机对象：id、name、address、port、username、group、note、authType（password/key）、hasCredential、fingerprint。写入可带 credential={password,privateKey,passphrase} 或 clearCredential。查询接口永远不返回 credential。

## 终端和监控

`WS /api/connections/{id}/terminal`：服务端发 binary 终端字节；客户端发 JSON `{"type":"input","data":"..."}` 或 `{"type":"resize","cols":120,"rows":30}`。同一连接只允许一个终端；同一主机可创建多个连接。普通 Tab 与历史快捷键由远端 Shell 处理。

`WS /api/connections/{id}/metrics`：每秒 JSON 快照，包括 CPU、内存、Swap、负载、网卡累计字节、磁盘容量、uptime。CPU 首个样本为 null；客户端通过累计字节差值计算网速，缺失数据不补零。同账号同主机共享采集，磁盘每 30 次采样刷新。

## 文件

| 方法 | 连接路径后缀 | 内容 |
|---|---|---|
| GET | /files?path= | 绝对路径列表，空值为 home |
| POST | /files | operation=create/mkdir/rename/delete/chmod，path、target、permissions |
| GET | /download?path= | 流式附件 |
| POST | /upload?path=&overwrite=false | 请求体为原始文件字节，Content-Length 或 X-Upload-Size 声明准确大小，上限 2 GB |
| GET | /text?path= | UTF-8 文本与内容版本哈希，上限 1 MB |
| PUT | /text | path、content、version，冲突 409 |

仅空目录可删除。编辑器拒绝符号链接，需明确打开实际目标。上传默认不覆盖，覆盖与文本保存使用 POSIX 原子重命名扩展；远端不支持时返回错误，不降级成不安全覆盖。

下载通过同源 Service Worker 和有背压的 ReadableStream 交给浏览器，不整份载入内存。服务 worker 只处理中转下载路径，不缓存 API 或凭据。关闭页面会中止传输。

## AI 与订阅

- GET/PUT `/api/ai/settings`：source（byok/subscription）、baseUrl、model、completionModel、hasKey；写入 APIKey 使用 apiKey，删除使用 clearKey。密钥不回显。
- GET `/api/ai/usage`：余额、最近调用、Token 和结算状态。
- POST `/api/ai/chat`：messages、context；Accept=text/event-stream 获取 status/content/done/error SSE，否则 JSON。
- GET/POST `/api/ai/tasks`：历史 / 生成方案，输入 hostId、request、可选 parentId。
- POST `/api/ai/tasks/{id}/execute`：connectionId、planHash、confirmHost；非固定只读诊断命令还要求 confirmName。返回 step/output/status/summary/done/error SSE。
- POST `/api/ai/tasks/{id}/cancel`，DELETE `/api/ai/tasks/{id}`。
- GET `/api/billing/config`，POST `/api/billing/checkout`、`/api/billing/portal`。
- POST `/api/billing/webhook`：Stripe HMAC 签名。
- POST `/api/billing/credit`：管理员 Bearer 令牌，参见 BILLING.md。

运维执行是单次授权，不会自动执行模型后续建议；执行后生成结果分析，会再产生一次 AI 用量。结果分析失败时保留命令结果并显示错误。
