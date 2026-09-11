# Hoshi 生产部署

部署日期：2026-09-10。

> 本文为去敏模板。以下占位符需替换为实际值：`203.0.113.10`（源站 IP，示例使用 RFC 5737 文档专用地址）、`ssh.example.com`（浏览器入口域名）、`admin@ssh.example.com`（初始账号）。真实的源站地址、入口域名与账号不出现在版本管理中。

- 浏览器入口：`https://ssh.example.com`
- CDN HTTPS 回源：`https://203.0.113.10:8443`
- 服务器目录：`/opt/hoshi`，Compose 项目名：`hoshi`
- Caddy 使用内部 CA 签发证书，覆盖域名和 IP；无 SNI 的连接默认使用 IP 证书。
- 应用与 PostgreSQL 不向宿主机发布端口。现有服务器服务保持原配置。

## CDN 设置

设置 HTTPS 回源、端口 8443，回源 Host/SNI 推荐 `ssh.example.com`。需信任内部 CA 或关闭回源证书验证；浏览器侧仍使用 CDN 的有效证书。开启 WebSocket，不缓存 `/api/*`、`/healthz` 和登录态响应。浏览器必须使用上述域名，应用严格校验 Origin。

## 运维

服务器部署使用根目录的独立 `compose.yaml`：

```sh
cd /opt/hoshi
docker compose -p hoshi ps
docker compose -p hoshi logs --tail 100 app proxy
docker compose -p hoshi up -d
curl -k https://203.0.113.10:8443/healthz
```

本地部署模板使用 `docker compose --env-file .env -p hoshi -f deploy/compose.ip.yaml`，构建路径和 secrets 路径相对该配置文件解析。不要与根目录 compose 文件叠加使用。

环境配置保存在服务器 `.env`（0600），加密主密钥位于 `secrets/master_key`。不要重新生成现有主密钥；数据库与密钥必须分别安全备份。容器更新保留命名卷；不要执行 `down -v`。

```sh
cd /opt/hoshi
umask 077
docker compose -p hoshi exec -T db pg_dump -U remoter -Fc remoter > hoshi.dump
```

已创建初始账号 `admin@ssh.example.com` 并验证登录，公开注册保持关闭。当前没有独立的超级用户角色，此账号遵循相同的账号数据隔离规则。BYOK 可自行配置，平台订阅模型服务尚未配置。
