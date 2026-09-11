export const errors: Record<string, Record<"zh-CN" | "en" | "ja", string>> = {
  "agent release artifacts are unavailable": {
    "zh-CN": "探针发布文件不可用",
    en: "agent release artifacts are unavailable",
    ja: "エージェントのリリースファイルを利用できません",
  },
  "agent artifact unavailable": {
    "zh-CN": "探针文件不可用",
    en: "agent artifact unavailable",
    ja: "エージェントファイルを利用できません",
  },
  "agent binding not found": {
    "zh-CN": "未找到探针绑定",
    en: "agent binding not found",
    ja: "エージェントの関連付けが見つかりません",
  },
  "revoke the existing credential before rebinding": {
    "zh-CN": "重新绑定前请先撤销现有凭据",
    en: "revoke the existing credential before rebinding",
    ja: "再関連付けの前に既存の資格情報を無効化してください",
  },
  "a registered agent is required for upgrade": {
    "zh-CN": "升级需要已有注册探针",
    en: "a registered agent is required for upgrade",
    ja: "更新には登録済みエージェントが必要です",
  },
  "another agent operation is in progress": {
    "zh-CN": "已有其他探针操作正在进行",
    en: "another agent operation is in progress",
    ja: "別のエージェント操作が進行中です",
  },
  "agent installation requires a public HTTPS origin": {
    "zh-CN": "探针安装需要公开 HTTPS 地址",
    en: "agent installation requires a public HTTPS origin",
    ja: "エージェントのインストールには公開 HTTPS URL が必要です",
  },
  "automatic installation requires Linux and systemd; use manual installation":
    {
      "zh-CN": "自动安装需要 Linux 和 systemd，请改用手动安装",
      en: "automatic installation requires Linux and systemd; use manual installation",
      ja: "自動インストールには Linux と systemd が必要です。手動インストールを使用してください",
    },
  "automatic installation supports amd64 and arm64": {
    "zh-CN": "自动安装支持 amd64 和 arm64",
    en: "automatic installation supports amd64 and arm64",
    ja: "自動インストールは amd64 と arm64 に対応しています",
  },
  "passwordless sudo unavailable; use manual installation": {
    "zh-CN": "免密 sudo 不可用，请改用手动安装",
    en: "passwordless sudo unavailable; use manual installation",
    ja: "パスワードなしの sudo を利用できません。手動インストールを使用してください",
  },
  "public monitoring HTTPS endpoint unreachable from target": {
    "zh-CN": "目标主机无法访问公开监控 HTTPS 地址",
    en: "public monitoring HTTPS endpoint unreachable from target",
    ja: "対象ホストから公開監視 HTTPS URL に接続できません",
  },
  "SFTP is unavailable": {
    "zh-CN": "SFTP 不可用",
    en: "SFTP is unavailable",
    ja: "SFTP を利用できません",
  },
  "remote service operation failed; inspect existing installation and systemd status before retry":
    {
      "zh-CN": "远程服务操作失败，请检查已有安装和 systemd 状态后重试",
      en: "remote service operation failed; inspect existing installation and systemd status before retry",
      ja: "リモートサービス操作に失敗しました。既存のインストールと systemd の状態を確認して再試行してください",
    },
  "no authenticated report within five minutes; inspect service and endpoint connectivity":
    {
      "zh-CN": "五分钟内未收到认证上报，请检查服务和端点连通性",
      en: "no authenticated report within five minutes; inspect service and endpoint connectivity",
      ja: "5 分以内に認証済みレポートがありません。サービスとエンドポイントの接続を確認してください",
    },
  "server restarted during remote operation; inspect agent before retry": {
    "zh-CN": "服务器在远程操作期间重启，请检查探针后重试",
    en: "server restarted during remote operation; inspect agent before retry",
    ja: "リモート操作中にサーバーが再起動しました。エージェントを確認して再試行してください",
  },
  "monitoring dimension limit reached": {
    "zh-CN": "监控维度数量已达到上限",
    en: "monitoring dimension limit reached",
    ja: "監視ディメンション数の上限に達しました",
  },
  "invalid email or password": {
    "zh-CN": "邮箱或密码不正确",
    en: "invalid email or password",
    ja: "メールアドレスまたはパスワードが正しくありません",
  },
  "valid email and password of 12–256 characters required": {
    "zh-CN": "请输入有效邮箱与 12–256 字符的密码",
    en: "valid email and password of 12–256 characters required",
    ja: "有効なメールアドレスと 12～256 文字のパスワードを入力してください",
  },
  "invalid credentials": {
    "zh-CN": "认证信息无效",
    en: "invalid credentials",
    ja: "認証情報が無効です",
  },
  "registration is disabled": {
    "zh-CN": "当前已关闭注册",
    en: "registration is disabled",
    ja: "現在、新規登録は無効です",
  },
  "email already registered": {
    "zh-CN": "此邮箱已注册",
    en: "email already registered",
    ja: "このメールアドレスは登録済みです",
  },
  "authentication busy; retry shortly": {
    "zh-CN": "认证服务繁忙，请稍后重试",
    en: "authentication busy; retry shortly",
    ja: "認証サービスが混雑しています。少し待って再試行してください",
  },
  "too many attempts": {
    "zh-CN": "尝试次数过多，请稍后重试",
    en: "too many attempts",
    ja: "試行回数が多すぎます。時間をおいて再試行してください",
  },
  "try again later": {
    "zh-CN": "请稍后重试",
    en: "try again later",
    ja: "時間をおいて再試行してください",
  },
  "login required": {
    "zh-CN": "请先登录",
    en: "login required",
    ja: "ログインしてください",
  },
  "session expired": {
    "zh-CN": "登录已过期，请重新登录",
    en: "session expired",
    ja: "セッションの有効期限が切れました。再ログインしてください",
  },
  unauthorized: {
    "zh-CN": "未授权，请重新登录",
    en: "unauthorized",
    ja: "認証されていません。再ログインしてください",
  },
  "invalid origin": {
    "zh-CN": "请求来源无效，请检查部署地址",
    en: "invalid origin",
    ja: "リクエスト元が無効です。公開 URL の設定を確認してください",
  },
  "invalid request origin": {
    "zh-CN": "请求来源无效，请检查部署地址",
    en: "invalid request origin",
    ja: "リクエスト元が無効です。公開 URL の設定を確認してください",
  },
  "invalid request body": {
    "zh-CN": "请求内容无效",
    en: "invalid request body",
    ja: "リクエスト内容が無効です",
  },
  "unexpected body content": {
    "zh-CN": "请求包含不支持的内容",
    en: "unexpected body content",
    ja: "リクエストに未対応の内容が含まれています",
  },
  "database unavailable": {
    "zh-CN": "数据库暂时不可用",
    en: "database unavailable",
    ja: "データベースを一時的に利用できません",
  },
  "storage operation failed": {
    "zh-CN": "存储操作失败",
    en: "storage operation failed",
    ja: "保存処理に失敗しました",
  },
  "not found": {
    "zh-CN": "内容不存在或无权访问",
    en: "not found",
    ja: "対象が見つからないか、アクセス権がありません",
  },
  "invalid host configuration": {
    "zh-CN": "主机配置无效，请检查地址、端口和用户名",
    en: "invalid host configuration",
    ja: "ホスト設定が無効です。アドレス、ポート、ユーザー名を確認してください",
  },
  "host not found": {
    "zh-CN": "主机不存在或无权访问",
    en: "host not found",
    ja: "ホストが見つからないか、アクセス権がありません",
  },
  "invalid private key or passphrase": {
    "zh-CN": "私钥或私钥口令不正确",
    en: "invalid private key or passphrase",
    ja: "秘密鍵またはパスフレーズが正しくありません",
  },
  "password required": {
    "zh-CN": "请输入 SSH 密码",
    en: "password required",
    ja: "SSH パスワードを入力してください",
  },
  "SSH connection or authentication failed": {
    "zh-CN": "SSH 连接或认证失败",
    en: "SSH connection or authentication failed",
    ja: "SSH 接続または認証に失敗しました",
  },
  "too many probes": {
    "zh-CN": "指纹探测过于频繁，请稍后重试",
    en: "too many probes",
    ja: "フィンガープリントの確認が頻繁すぎます。後で再試行してください",
  },
  "fingerprint changed; verify again": {
    "zh-CN": "指纹已变化，请重新核对",
    en: "fingerprint changed; verify again",
    ja: "フィンガープリントが変更されました。再確認してください",
  },
  "host changed; verify again": {
    "zh-CN": "主机配置已变化，请重新核对",
    en: "host changed; verify again",
    ja: "ホスト設定が変更されました。再確認してください",
  },
  "too many connections": {
    "zh-CN": "连接请求过多，请稍后重试",
    en: "too many connections",
    ja: "接続リクエストが多すぎます。後で再試行してください",
  },
  "verify host fingerprint first": {
    "zh-CN": "请先核对并信任主机指纹",
    en: "verify host fingerprint first",
    ja: "ホストのフィンガープリントを確認し、信頼してください",
  },
  "maximum 12 active connections": {
    "zh-CN": "最多允许 12 个活动连接",
    en: "maximum 12 active connections",
    ja: "アクティブな接続は最大 12 件です",
  },
  "host fingerprint changed; connection blocked": {
    "zh-CN": "主机指纹已变化，连接已阻止",
    en: "host fingerprint changed; connection blocked",
    ja: "ホストのフィンガープリントが変更されたため、接続をブロックしました",
  },
  "SFTP subsystem unavailable": {
    "zh-CN": "SFTP 子系统不可用",
    en: "SFTP subsystem unavailable",
    ja: "SFTP サブシステムを利用できません",
  },
  "connection capacity reached": {
    "zh-CN": "连接数量已达到上限",
    en: "connection capacity reached",
    ja: "接続数が上限に達しました",
  },
  "connection not found": {
    "zh-CN": "连接不存在或已关闭",
    en: "connection not found",
    ja: "接続が見つからないか、既に閉じられています",
  },
  "terminal already open": {
    "zh-CN": "此连接已打开终端",
    en: "terminal already open",
    ja: "この接続のターミナルは既に開いています",
  },
  "cannot open terminal": {
    "zh-CN": "无法打开终端",
    en: "cannot open terminal",
    ja: "ターミナルを開けません",
  },
  "PTY unavailable": {
    "zh-CN": "无法分配伪终端",
    en: "PTY unavailable",
    ja: "疑似端末を割り当てられません",
  },
  "shell unavailable": {
    "zh-CN": "远端 Shell 不可用",
    en: "shell unavailable",
    ja: "リモート Shell を利用できません",
  },
  "absolute path required": {
    "zh-CN": "请输入绝对路径",
    en: "absolute path required",
    ja: "絶対パスを入力してください",
  },
  "invalid path": {
    "zh-CN": "路径无效",
    en: "invalid path",
    ja: "パスが無効です",
  },
  "invalid target": {
    "zh-CN": "目标路径无效",
    en: "invalid target",
    ja: "移動先のパスが無効です",
  },
  "invalid text file": {
    "zh-CN": "文件不是有效的 UTF-8 文本或超过大小限制",
    en: "invalid text file",
    ja: "ファイルが有効な UTF-8 テキストではないか、サイズ制限を超えています",
  },
  "permissions must be 0000–0777": {
    "zh-CN": "权限必须在 0000–0777 范围内",
    en: "permissions must be 0000–0777",
    ja: "権限は 0000～0777 の範囲で指定してください",
  },
  "regular file required": {
    "zh-CN": "只能操作普通文件",
    en: "regular file required",
    ja: "通常のファイルのみ操作できます",
  },
  "cannot create upload; check permissions": {
    "zh-CN": "无法创建上传文件，请检查权限",
    en: "cannot create upload; check permissions",
    ja: "アップロード先を作成できません。権限を確認してください",
  },
  "cannot write file": {
    "zh-CN": "无法写入文件，请检查权限",
    en: "cannot write file",
    ja: "ファイルを書き込めません。権限を確認してください",
  },
  "file unavailable": {
    "zh-CN": "文件不可用或无权访问",
    en: "file unavailable",
    ja: "ファイルを利用できないか、アクセス権がありません",
  },
  "destination exists or atomic rename unsupported": {
    "zh-CN": "目标已存在，或服务器不支持原子重命名",
    en: "destination exists or atomic rename unsupported",
    ja: "移動先が既に存在するか、サーバーがアトミックな名前変更に対応していません",
  },
  "file changed remotely; reload before saving": {
    "zh-CN": "远端文件已修改，请重新加载后保存",
    en: "file changed remotely; reload before saving",
    ja: "リモートファイルが変更されました。再読み込みしてから保存してください",
  },
  "file operation failed; check permissions, conflicts or nonempty directory": {
    "zh-CN": "文件操作失败，请检查权限、名称冲突或目录是否为空",
    en: "file operation failed; check permissions, conflicts or nonempty directory",
    ja: "ファイル操作に失敗しました。権限、名前の競合、ディレクトリが空かを確認してください",
  },
  "upload interrupted or exceeds 2 GB": {
    "zh-CN": "上传已中断或超过 2 GB 限制",
    en: "upload interrupted or exceeds 2 GB",
    ja: "アップロードが中断されたか、2 GB の制限を超えました",
  },
  "upload exceeds 2 GB": {
    "zh-CN": "上传文件超过 2 GB 限制",
    en: "upload exceeds 2 GB",
    ja: "アップロードファイルが 2 GB の制限を超えています",
  },
  "upload size is required": {
    "zh-CN": "缺少上传文件大小",
    en: "upload size is required",
    ja: "アップロードファイルのサイズが必要です",
  },
  "invalid declared upload size": {
    "zh-CN": "上传文件大小声明无效",
    en: "invalid declared upload size",
    ja: "指定されたアップロードサイズが無効です",
  },
  "cannot list directory; check permissions": {
    "zh-CN": "无法读取目录，请检查权限",
    en: "cannot list directory; check permissions",
    ja: "ディレクトリを読み込めません。権限を確認してください",
  },
  "cannot resolve home directory": {
    "zh-CN": "无法读取远端主目录",
    en: "cannot resolve home directory",
    ja: "リモートのホームディレクトリを取得できません",
  },
  "atomic save unsupported or permission denied": {
    "zh-CN": "服务器不支持原子保存，或没有写入权限",
    en: "atomic save unsupported or permission denied",
    ja: "サーバーがアトミック保存に対応していないか、書き込み権限がありません",
  },
  "write failed": {
    "zh-CN": "写入失败",
    en: "write failed",
    ja: "書き込みに失敗しました",
  },
  "configure an AI provider and model first": {
    "zh-CN": "请先配置 AI 服务与模型",
    en: "configure an AI provider and model first",
    ja: "先に AI サービスとモデルを設定してください",
  },
  "AI rate limit reached": {
    "zh-CN": "AI 请求频率达到上限，请稍后重试",
    en: "AI rate limit reached",
    ja: "AI のリクエスト上限に達しました。後で再試行してください",
  },
  "AI context too large": {
    "zh-CN": "AI 上下文超出大小限制",
    en: "AI context too large",
    ja: "AI コンテキストがサイズ制限を超えています",
  },
  "insufficient subscription credits": {
    "zh-CN": "订阅额度不足",
    en: "insufficient subscription credits",
    ja: "契約の利用枠が不足しています",
  },
  "AI base URL must be HTTPS without credentials, query or fragment": {
    "zh-CN": "AI 地址必须使用 HTTPS，且不能包含认证信息、查询参数或片段",
    en: "AI base URL must be HTTPS without credentials, query or fragment",
    ja: "AI URL は HTTPS を使用し、認証情報・クエリ・フラグメントを含めないでください",
  },
  "invalid AI source": {
    "zh-CN": "AI 服务来源无效",
    en: "invalid AI source",
    ja: "AI サービスの提供元が無効です",
  },
  "AI settings too large": {
    "zh-CN": "AI 设置内容过大",
    en: "AI settings too large",
    ja: "AI 設定のサイズが大きすぎます",
  },
  "AI redirects are disabled": {
    "zh-CN": "AI 服务重定向已被阻止",
    en: "AI redirects are disabled",
    ja: "AI サービスのリダイレクトはブロックされています",
  },
  "AI provider connection failed": {
    "zh-CN": "无法连接 AI 服务",
    en: "AI provider connection failed",
    ja: "AI サービスに接続できません",
  },
  "AI stream interrupted": {
    "zh-CN": "AI 响应流已中断",
    en: "AI stream interrupted",
    ja: "AI の応答ストリームが中断されました",
  },
  "invalid AI response": {
    "zh-CN": "AI 服务返回了无效响应",
    en: "invalid AI response",
    ja: "AI サービスの応答が無効です",
  },
  "invalid AI stream": {
    "zh-CN": "AI 响应流无效",
    en: "invalid AI stream",
    ja: "AI の応答ストリームが無効です",
  },
  "AI provider stream error": {
    "zh-CN": "AI 服务响应流出错",
    en: "AI provider stream error",
    ja: "AI サービスの応答ストリームでエラーが発生しました",
  },
  "AI output exceeds limit": {
    "zh-CN": "AI 输出超出限制",
    en: "AI output exceeds limit",
    ja: "AI 出力が上限を超えています",
  },
  "AI stream read failed": {
    "zh-CN": "无法读取 AI 响应流",
    en: "AI stream read failed",
    ja: "AI の応答ストリームを読み取れません",
  },
  "subscriptions unavailable on this deployment": {
    "zh-CN": "此部署尚未开放订阅",
    en: "subscriptions unavailable on this deployment",
    ja: "この環境ではサブスクリプションを利用できません",
  },
  "subscriptions unavailable": {
    "zh-CN": "订阅服务暂时不可用",
    en: "subscriptions unavailable",
    ja: "サブスクリプションサービスを一時的に利用できません",
  },
  "manage your current subscription in the billing portal": {
    "zh-CN": "请在账单门户管理现有订阅",
    en: "manage your current subscription in the billing portal",
    ja: "請求ポータルで現在の契約を管理してください",
  },
  "contact billing support before subscribing again": {
    "zh-CN": "重新订阅前请联系账单支持",
    en: "contact billing support before subscribing again",
    ja: "再契約する前に請求サポートにお問い合わせください",
  },
  "billing account not found": {
    "zh-CN": "未找到订阅账户",
    en: "billing account not found",
    ja: "請求アカウントが見つかりません",
  },
  "invalid billing response": {
    "zh-CN": "账单服务响应无效",
    en: "invalid billing response",
    ja: "請求サービスの応答が無効です",
  },
  "invalid checkout URL": {
    "zh-CN": "支付跳转地址无效",
    en: "invalid checkout URL",
    ja: "決済先 URL が無効です",
  },
  "invalid portal URL": {
    "zh-CN": "账单门户地址无效",
    en: "invalid portal URL",
    ja: "請求ポータルの URL が無効です",
  },
  "invalid subscription response": {
    "zh-CN": "订阅服务响应无效",
    en: "invalid subscription response",
    ja: "契約サービスの応答が無効です",
  },
};
