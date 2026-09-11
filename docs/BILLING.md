# AI 订阅与用量

BYOK 与平台订阅采用明确来源，调用失败不会自动切换。平台订阅的内部额度单位为 Token，输入与输出均按 1 Token 扣除；这不是模型服务商成本报价。发起请求前按上下文字节数加最大输出量保守预占，成功后按服务商 usage 结算；缺失 usage 时使用保守估算并标记 estimated。

## Stripe 可选接入

配置 `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`（均支持 `_FILE`）、`STRIPE_PRICE_ID`、`SUBSCRIPTION_CREDITS`，并先配置平台 AI 服务。Stripe Price 必须为固定数量 1 的周期订阅。金额和周期以 Stripe Checkout 为准。

在 Stripe 为 `https://你的域名/api/billing/webhook` 添加端点，API 版本设为 **2025-02-24.acacia**，订阅 `checkout.session.completed` 与 `invoice.paid`。Webhook 使用原始请求体校验 HMAC 和 5 分钟时效。账单周期到账根据唯一 invoice ID 幂等发放额度，事件乱序会要求重试。

开启 Stripe Customer Portal，让用户管理支付方式及取消订阅。取消后不再发放下期额度，已有额度保留。仅支持一个配置套餐；升级补差、退款自动回收、按模型不同倍率计费尚需后续实现，不能在未实现前向用户承诺。

只有用户点击“前往订阅”才创建托管支付会话；平台不处理银行卡信息。

## 管理员发放额度

自行部署可不启用 Stripe，由管理员使用 `POST /api/billing/credit` 发放额度。需要 `Authorization: Bearer <BILLING_ADMIN_TOKEN>`，令牌至少 32 字符。

请求：`{"id":"唯一外部订单号","userId":"账号 ID","amount":100000}`。相同 ID 与相同内容重复请求不重复发放；相同 ID 不同内容返回 409。此接口应通过网络策略限制管理员来源，令牌不得放到前端。

管理员发放适合自部署或接入其他支付系统，不能替代完整的线上支付验证。

Docker Compose 可使用已提供的覆盖文件：创建 `secrets/stripe_key` 与 `secrets/stripe_webhook`，在 `.env` 设置 Price ID 与每期额度，然后运行 `docker compose -f compose.yaml -f deploy/compose.stripe.yaml up -d --build`。Stripe 模式须额外验证真实测试环境的 Checkout、续费、取消和 Webhook 重试，再启用实盘密钥。

API 协议参考：[OpenAI-compatible Chat Completions 请求与 usage 字段](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。默认不固定任何模型名称或价格；模型由账号或部署管理员配置。
