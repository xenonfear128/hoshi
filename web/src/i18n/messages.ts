import { monitoringMessages } from "./monitoring";
// Chinese source keys with complete English and Japanese translations.
export const messages: Record<string, { en: string; ja: string }> = {
  ...monitoringMessages,
  探针监控: { en: "Agent monitoring", ja: "エージェント監視" },
  "持续采集资源、网络用量与告警（关闭 SSH 后仍运行）": {
    en: "Keep collecting resources, traffic, and alerts after SSH closes",
    ja: "SSH を閉じてもリソース・通信量・アラートを継続収集",
  },
  采样间隔: { en: "Sampling interval", ja: "サンプリング間隔" },
  账期起始日: { en: "Billing period start", ja: "請求期間の開始日" },
  "保存主机后生成一次性安装凭证；探针不获取 SSH 凭据。": {
    en: "A one-time install credential is generated after saving; the agent never receives SSH credentials.",
    ja: "保存後に使い捨てのインストール資格情報を発行します。SSH 資格情報はエージェントに渡しません。",
  },
  恢复采集: { en: "Resume collection", ja: "収集を再開" },
  暂停采集: { en: "Pause collection", ja: "収集を一時停止" },
  轮换凭证: { en: "Rotate credential", ja: "資格情報をローテーション" },
  手动安装: { en: "Manual install", ja: "手動インストール" },
  "一次性安装凭证，仅显示这一次": {
    en: "One-time installation credential, shown only once",
    ja: "使い捨てのインストール資格情報（一度だけ表示）",
  },
  升级探针: { en: "Upgrade agent", ja: "エージェントを更新" },
  卸载探针: { en: "Uninstall agent", ja: "エージェントをアンインストール" },
  "卸载后远端将停止持续监控，是否继续？": {
    en: "The remote agent will stop monitoring after uninstall. Continue?",
    ja: "アンインストール後、リモート監視が停止します。続行しますか？",
  },
  卸载: { en: "Uninstall", ja: "アンインストール" },
  告警规则: { en: "Alert rules", ja: "アラートルール" },
  "CPU 阈值": { en: "CPU threshold", ja: "CPU 閾値" },
  内存阈值: { en: "Memory threshold", ja: "メモリ閾値" },
  磁盘阈值: { en: "Disk threshold", ja: "ディスク閾値" },
  离线宽限秒数: { en: "Offline grace (seconds)", ja: "オフライン猶予（秒）" },
  保存告警规则: { en: "Save alert rules", ja: "アラートルールを保存" },
  待安装: { en: "Pending installation", ja: "インストール待ち" },
  在线: { en: "Online", ja: "オンライン" },
  数据延迟: { en: "Stale data", ja: "データ遅延" },
  探针离线: { en: "Agent offline", ja: "エージェントオフライン" },
  关闭: {
    en: "Close",
    ja: "閉じる",
  },
  "{0}\n\n{1} ({2}:{3})\n{4}\n\n{5}确认信任此指纹？": {
    en: "{0}\n\n{1} ({2}:{3})\n{4}\n\n{5}Trust this fingerprint?",
    ja: "{0}\n\n{1} ({2}:{3})\n{4}\n\n{5}このフィンガープリントを信頼しますか？",
  },
  "警告：服务器指纹已变化。请通过可信渠道核对！": {
    en: "Warning: the server fingerprint has changed. Verify it through a trusted channel!",
    ja: "警告：サーバーのフィンガープリントが変更されました。信頼できる経路で確認してください。",
  },
  "首次连接，请通过可信渠道核对服务器指纹。": {
    en: "First connection. Verify the server fingerprint through a trusted channel.",
    ja: "初回接続です。信頼できる経路でサーバーのフィンガープリントを確認してください。",
  },
  "原指纹：": {
    en: "Previous fingerprint: ",
    ja: "以前のフィンガープリント：",
  },
  "关闭连接？当前终端及该连接的传输任务将中止，已执行操作不会撤销。": {
    en: "Close this connection? Its terminal and transfers will stop. Completed operations will not be undone.",
    ja: "接続を閉じますか？この接続のターミナルと転送は停止します。実行済みの操作は元に戻りません。",
  },
  "正在连接工作台…": {
    en: "Opening your workspace…",
    ja: "ワークスペースを開いています…",
  },
  "Hoshi 星 Stellar · 主机管理": {
    en: "Stellar · Hosts",
    ja: "Hoshi · ホスト管理",
  },
  传输中心: {
    en: "Transfers",
    ja: "転送センター",
  },
  "AI 服务与订阅": {
    en: "AI & subscription",
    ja: "AI サービス・契約",
  },
  切换主题: {
    en: "Toggle theme",
    ja: "テーマを切り替え",
  },
  设置: {
    en: "Settings",
    ja: "設定",
  },
  主导航: {
    en: "Main navigation",
    ja: "メインナビゲーション",
  },
  "HOSHI / 星 / STELLAR": {
    en: "STELLAR",
    ja: "HOSHI",
  },
  "连接每一颗星。": {
    en: "Connect every star.",
    ja: "すべての星を、つなぐ。",
  },
  "你的主机、文件与下一步操作，在此相连。": {
    en: "Your hosts, files, and next steps. Connected.",
    ja: "ホストも、ファイルも、次の操作も。ここでつながる。",
  },
  添加主机: {
    en: "Add host",
    ja: "ホストを追加",
  },
  "从一句话，到下一步。": {
    en: "From a few words to your next step.",
    ja: "ひとことから、次の一歩へ。",
  },
  "AI 运维 · 选择主机，描述需求，确认后执行": {
    en: "AI operations · Choose a host, describe your goal, then approve execution",
    ja: "AI 運用 · ホストを選び、目的を伝え、確認して実行",
  },
  "BYOK / 订阅": {
    en: "BYOK / Subscription",
    ja: "BYOK / サブスクリプション",
  },
  我的主机: {
    en: "Your hosts",
    ja: "マイホスト",
  },
  "搜索名称、地址或分组": {
    en: "Search name, address, or group",
    ja: "名前・アドレス・グループで検索",
  },
  未分组: {
    en: "Ungrouped",
    ja: "未分類",
  },
  编辑主机: {
    en: "Edit host",
    ja: "ホストを編集",
  },
  暂无备注: {
    en: "No notes",
    ja: "メモなし",
  },
  私钥: {
    en: "Private key",
    ja: "秘密鍵",
  },
  密码: {
    en: "Password",
    ja: "パスワード",
  },
  显示密码: {
    en: "Show password",
    ja: "パスワードを表示",
  },
  隐藏密码: {
    en: "Hide password",
    ja: "パスワードを隠す",
  },
  已加密保存: {
    en: "Encrypted",
    ja: "暗号化済み",
  },
  临时输入: {
    en: "Enter on connect",
    ja: "接続時に入力",
  },
  "连接中…": {
    en: "Connecting…",
    ja: "接続中…",
  },
  连接: {
    en: "Connect",
    ja: "接続",
  },
  添加第一台服务器: {
    en: "Add your first server",
    ja: "最初のサーバーを追加",
  },
  "主机信息与安全凭据加密存储，仅当前账号可访问。": {
    en: "Host details and credentials are encrypted and accessible only to this account.",
    ja: "ホスト情報と認証情報は暗号化され、このアカウントのみがアクセスできます。",
  },
  "账号隔离 · 凭据加密 · SSH 指纹校验": {
    en: "Account isolation · Encrypted credentials · SSH fingerprint verification",
    ja: "アカウント分離 · 認証情報の暗号化 · SSH フィンガープリント確認",
  },
  关闭连接: {
    en: "Close connection",
    ja: "接続を閉じる",
  },
  连接其他主机: {
    en: "Connect another host",
    ja: "別のホストに接続",
  },
  分屏会话: {
    en: "Split session",
    ja: "分割セッション",
  },
  单终端视图: {
    en: "Single terminal",
    ja: "単一ターミナル",
  },
  "分屏 ·": {
    en: "Split ·",
    ja: "分割 ·",
  },
  "正在加载终端…": {
    en: "Loading terminal…",
    ja: "ターミナルを読み込み中…",
  },
  尚未连接主机: {
    en: "No hosts connected",
    ja: "接続中のホストはありません",
  },
  选择主机: {
    en: "Choose a host",
    ja: "ホストを選択",
  },
  "正在加载 AI 运维…": {
    en: "Loading AI operations…",
    ja: "AI 運用を読み込み中…",
  },
  "专注每一步。": {
    en: "Focus on every step.",
    ja: "一歩ずつ、確かに。",
  },
  "SSH · SFTP · 实时监控 · AI 运维": {
    en: "SSH · SFTP · Live monitoring · AI operations",
    ja: "SSH · SFTP · リアルタイム監視 · AI 運用",
  },
  "创建 Hoshi 账号": {
    en: "Create a Stellar account",
    ja: "Hoshi アカウントを作成",
  },
  欢迎回来: {
    en: "Welcome back",
    ja: "おかえりなさい",
  },
  "登录 Hoshi，回到你的主机工作台。": {
    en: "Sign in to Stellar and return to your hosts.",
    ja: "Hoshi にログインして、ホストのワークスペースへ。",
  },
  邮箱: {
    en: "Email",
    ja: "メールアドレス",
  },
  "至少 12 个字符，建议使用密码管理器生成。": {
    en: "At least 12 characters. A password manager is recommended.",
    ja: "12 文字以上。パスワードマネージャーの利用を推奨します。",
  },
  "处理中…": {
    en: "Working…",
    ja: "処理中…",
  },
  创建账号: {
    en: "Create account",
    ja: "アカウントを作成",
  },
  登录工作台: {
    en: "Sign in",
    ja: "ログイン",
  },
  "已有账号？登录": {
    en: "Already have an account? Sign in",
    ja: "アカウントをお持ちですか？ログイン",
  },
  "还没有账号？注册": {
    en: "New here? Create an account",
    ja: "アカウントを作成",
  },
  主机与凭据在服务端加密保存: {
    en: "Hosts and credentials are encrypted on the server",
    ja: "ホスト情報と認証情報はサーバーで暗号化されます",
  },
  主机名称: {
    en: "Host name",
    ja: "ホスト名",
  },
  地址: {
    en: "Address",
    ja: "アドレス",
  },
  端口: {
    en: "Port",
    ja: "ポート",
  },
  用户名: {
    en: "Username",
    ja: "ユーザー名",
  },
  分组: {
    en: "Group",
    ja: "グループ",
  },
  认证方式: {
    en: "Authentication",
    ja: "認証方式",
  },
  "SSH 私钥": {
    en: "SSH private key",
    ja: "SSH 秘密鍵",
  },
  "加密保存凭据（关闭后每次连接临时输入）": {
    en: "Store encrypted credentials (otherwise enter them on each connection)",
    ja: "認証情報を暗号化して保存（オフの場合は接続のたびに入力）",
  },
  "（已配置，留空保留）": {
    en: "(Configured; leave blank to keep)",
    ja: "(設定済み・空欄で維持)",
  },
  私钥口令: {
    en: "Key passphrase",
    ja: "秘密鍵のパスフレーズ",
  },
  备注: {
    en: "Notes",
    ja: "メモ",
  },
  "删除此主机？所有关联连接将关闭，AI 任务记录也会删除。": {
    en: "Delete this host? All associated connections will close and its AI task records will be deleted.",
    ja: "このホストを削除しますか？関連する接続はすべて閉じられ、AI タスクの記録も削除されます。",
  },
  删除: {
    en: "Delete",
    ja: "削除",
  },
  取消: {
    en: "Cancel",
    ja: "キャンセル",
  },
  "保存中…": {
    en: "Saving…",
    ja: "保存中…",
  },
  保存主机: {
    en: "Save host",
    ja: "ホストを保存",
  },
  "自带密钥 BYOK": {
    en: "Bring your own key",
    ja: "自分のキーを使用（BYOK）",
  },
  平台订阅: {
    en: "Platform subscription",
    ja: "プラットフォーム契約",
  },
  "兼容 API 地址": {
    en: "Compatible API URL",
    ja: "互換 API の URL",
  },
  "· 已加密配置": {
    en: "· Encrypted key configured",
    ja: "· 暗号化キー設定済み",
  },
  留空保留原密钥: {
    en: "Leave blank to keep the current key",
    ja: "空欄で現在のキーを維持",
  },
  "输入 API Key": {
    en: "Enter API key",
    ja: "API キーを入力",
  },
  删除已保存密钥: {
    en: "Delete saved key",
    ja: "保存済みキーを削除",
  },
  运维模型: {
    en: "Operations model",
    ja: "運用モデル",
  },
  命令助手模型: {
    en: "Command assistant model",
    ja: "コマンドアシスタントのモデル",
  },
  留空使用运维模型: {
    en: "Leave blank to use the operations model",
    ja: "空欄で運用モデルを使用",
  },
  "可用额度：": {
    en: "Available credits:",
    ja: "利用可能枠：",
  },
  "由平台提供 AI 服务，按请求预占、实际用量结算。": {
    en: "Platform AI reserves credits per request and settles against actual usage.",
    ja: "プラットフォーム AI はリクエストごとに利用枠を確保し、実際の使用量で精算します。",
  },
  "此部署尚未配置平台 AI 服务，请联系管理员。": {
    en: "Platform AI is not configured on this deployment. Contact your administrator.",
    ja: "この環境にはプラットフォーム AI が設定されていません。管理者にお問い合わせください。",
  },
  "不会自动切换到 BYOK 或其他计费来源。": {
    en: "Your source will not automatically switch to BYOK or another billing source.",
    ja: "BYOK や別の課金元に自動で切り替わることはありません。",
  },
  每个订阅周期增加: {
    en: "Each subscription period adds",
    ja: "契約期間ごとに追加：",
  },
  "Token，价格与周期在支付页面确认。": {
    en: "tokens. Confirm the price and period at checkout.",
    ja: "トークン。料金と期間は決済画面で確認してください。",
  },
  管理订阅与账单: {
    en: "Manage subscription & billing",
    ja: "契約と請求を管理",
  },
  前往订阅: {
    en: "Subscribe",
    ja: "契約する",
  },
  "订阅已结束？重新订阅": {
    en: "Subscription ended? Subscribe again",
    ja: "契約が終了しましたか？再契約",
  },
  "仅在你使用 AI 时发送必要上下文。自动脱敏不能识别所有秘密，请审阅输入，勿发送凭据。":
    {
      en: "Only necessary context is sent when you use AI. Automatic redaction cannot detect every secret. Review your input and never send credentials.",
      ja: "AI の使用時のみ必要なコンテキストを送信します。自動マスキングですべての機密情報を検出できるわけではありません。入力内容を確認し、認証情報は送信しないでください。",
    },
  设置已保存: {
    en: "Settings saved",
    ja: "設定を保存しました",
  },
  保存设置: {
    en: "Save settings",
    ja: "設定を保存",
  },
  最近用量: {
    en: "Recent usage",
    ja: "最近の使用量",
  },
  暂无调用记录: {
    en: "No requests yet",
    ja: "呼び出し履歴はありません",
  },
  "临时连接凭据 · ": {
    en: "Temporary credentials · ",
    ja: "一時認証情報 ·",
  },
  "仅用于当前连接，不保存到数据库或浏览器存储。": {
    en: "Used only for this connection; never stored in the database or browser storage.",
    ja: "この接続でのみ使用し、データベースやブラウザーには保存しません。",
  },
  "SSH 密码": {
    en: "SSH password",
    ja: "SSH パスワード",
  },
  暂无传输任务: {
    en: "No transfers yet",
    ja: "転送タスクはありません",
  },
  传输中: {
    en: "Transferring",
    ja: "転送中",
  },
  已完成: {
    en: "Completed",
    ja: "完了",
  },
  失败: {
    en: "Failed",
    ja: "失敗",
  },
  已取消: {
    en: "Cancelled",
    ja: "キャンセル済み",
  },
  重试: {
    en: "Retry",
    ja: "再試行",
  },
  主机管理: {
    en: "Hosts",
    ja: "ホスト管理",
  },
  "AI 运维": {
    en: "AI operations",
    ja: "AI 運用",
  },
  工作台: {
    en: "Workspace",
    ja: "ワークスペース",
  },
  "目标：{0} ({1})\n\n{2}\n\n确认执行以上全部命令？每条命令独立运行，脱敏后的输出将发送给当前 AI 服务生成结果分析并计入用量。停止不会撤销已完成变更。":
    {
      en: "Target: {0} ({1})\n\n{2}\n\nExecute all these commands? Each runs independently. Redacted output will be sent to your selected AI service for analysis and counted toward usage. Stopping does not undo completed changes.",
      ja: "対象：{0} ({1})\n\n{2}\n\nすべてのコマンドを実行しますか？各コマンドは独立して実行されます。マスキング済みの出力は選択した AI サービスに分析のため送信され、使用量に計上されます。停止しても完了した変更は元に戻りません。",
    },
  "包含变更操作。请输入目标主机名称再次确认：": {
    en: "Changes are included. Type the target host name to confirm:",
    ja: "変更操作を含みます。確認のため対象ホスト名を入力してください：",
  },
  执行失败: {
    en: "Execution failed",
    ja: "実行に失敗しました",
  },
  运维记录: {
    en: "Task history",
    ja: "運用履歴",
  },
  "＋新任务": {
    en: "＋ New task",
    ja: "＋ 新規タスク",
  },
  主机: {
    en: "Host",
    ja: "ホスト",
  },
  "任务方案与脱敏后的执行结果会保存在这里。": {
    en: "Plans and redacted execution results are saved here.",
    ja: "実行計画とマスキング済みの実行結果がここに保存されます。",
  },
  "让下一步，更清晰。": {
    en: "Make your next step clearer.",
    ja: "次の一歩を、明確に。",
  },
  "描述运维目标，审阅命令，再决定是否执行。": {
    en: "Describe your goal, review the commands, then decide whether to execute.",
    ja: "運用の目的を伝え、コマンドを確認してから実行を判断します。",
  },
  目标主机: {
    en: "Target host",
    ja: "対象ホスト",
  },
  "AI 目标主机": {
    en: "AI target host",
    ja: "AI 対象ホスト",
  },
  "从一个问题开始。": {
    en: "Start with a question.",
    ja: "ひとつの問いから。",
  },
  "先排查问题，再决定是否变更。": {
    en: "Diagnose first. Decide on changes next.",
    ja: "まず原因を調べ、変更はその後に判断します。",
  },
  排查内存占用过高的原因: {
    en: "Investigate high memory usage",
    ja: "メモリ使用量が高い原因を調査",
  },
  "检查磁盘空间，找出最大的目录": {
    en: "Check disk space and find the largest directories",
    ja: "ディスク容量を確認し、大きなディレクトリを特定",
  },
  "检查 Nginx 配置与服务状态": {
    en: "Check Nginx configuration and service status",
    ja: "Nginx の設定とサービス状態を確認",
  },
  "命令由模型生成，请核对风险与目标。": {
    en: "Commands are model-generated. Verify the risks and target.",
    ja: "コマンドはモデルが生成します。リスクと対象を確認してください。",
  },
  删除记录: {
    en: "Delete record",
    ja: "記録を削除",
  },
  "删除此任务记录？": {
    en: "Delete this task record?",
    ja: "このタスクの記録を削除しますか？",
  },
  诊断: {
    en: "Diagnostic",
    ja: "診断",
  },
  修改: {
    en: "Change",
    ja: "変更",
  },
  高风险: {
    en: "High risk",
    ja: "高リスク",
  },
  结果分析: {
    en: "Result analysis",
    ja: "結果の分析",
  },
  "命令结果已保存，AI 分析未完成：": {
    en: "Command results were saved. AI analysis is incomplete:",
    ja: "コマンド結果は保存されました。AI 分析は未完了です：",
  },
  确认方案并执行: {
    en: "Approve & execute",
    ja: "計画を確認して実行",
  },
  停止执行: {
    en: "Stop execution",
    ja: "実行を停止",
  },
  执行完成: {
    en: "Execution complete",
    ja: "実行完了",
  },
  "停止不会自动撤销已完成的变更。": {
    en: "Stopping will not undo completed changes.",
    ja: "停止しても完了した変更は元に戻りません。",
  },
  运维需求: {
    en: "Operations request",
    ja: "運用リクエスト",
  },
  "描述需求或补充条件，生成新的待确认方案…": {
    en: "Describe your goal or add constraints to generate a new plan for review…",
    ja: "目的や追加条件を入力して、確認用の新しい計画を生成…",
  },
  "生成方案中…": {
    en: "Generating plan…",
    ja: "計画を生成中…",
  },
  生成方案: {
    en: "Generate plan",
    ja: "計画を生成",
  },
  "需求、关联任务上下文及确认执行后的脱敏输出会发送给所选 AI 服务。": {
    en: "Your request, related task context, and redacted execution output will be sent to the selected AI service.",
    ja: "リクエスト、関連タスクのコンテキスト、確認後に実行した結果のマスキング済み出力を、選択した AI サービスに送信します。",
  },
  上传失败: {
    en: "Upload failed",
    ja: "アップロードに失敗しました",
  },
  "{0} 已存在或重命名失败。是否覆盖？": {
    en: "{0} already exists or could not be renamed. Overwrite it?",
    ja: "{0} は既に存在するか、名前を変更できませんでした。上書きしますか？",
  },
  网络错误: {
    en: "Network error",
    ja: "ネットワークエラー",
  },
  文件浏览: {
    en: "Files",
    ja: "ファイル一覧",
  },
  传输任务: {
    en: "Transfer tasks",
    ja: "転送タスク",
  },
  "收起/展开文件面板": {
    en: "Collapse/expand files",
    ja: "ファイルパネルを折りたたむ・展開",
  },
  上级目录: {
    en: "Parent directory",
    ja: "親ディレクトリ",
  },
  刷新目录: {
    en: "Refresh directory",
    ja: "ディレクトリを更新",
  },
  远端路径: {
    en: "Remote path",
    ja: "リモートパス",
  },
  "终端进入此目录（填入后回车执行）": {
    en: "Enter this directory in the terminal (press Enter to run)",
    ja: "ターミナルに移動コマンドを入力（Enter で実行）",
  },
  "→ 终端": {
    en: "→ Terminal",
    ja: "→ ターミナル",
  },
  上传: {
    en: "Upload",
    ja: "アップロード",
  },
  新建目录: {
    en: "New directory",
    ja: "ディレクトリを作成",
  },
  新建目录名称: {
    en: "New directory name",
    ja: "新しいディレクトリ名",
  },
  新建文件: {
    en: "New file",
    ja: "ファイルを作成",
  },
  新建文件名称: {
    en: "New file name",
    ja: "新しいファイル名",
  },
  "＋文件": {
    en: "＋ File",
    ja: "＋ ファイル",
  },
  隐藏文件: {
    en: "Hidden files",
    ja: "隠しファイル",
  },
  文件排序: {
    en: "Sort files",
    ja: "ファイルの並び順",
  },
  名称: {
    en: "Name",
    ja: "名前",
  },
  大小: {
    en: "Size",
    ja: "サイズ",
  },
  修改时间: {
    en: "Modified",
    ja: "更新日時",
  },
  项: {
    en: "items",
    ja: "件",
  },
  下载所选: {
    en: "Download selected",
    ja: "選択項目をダウンロード",
  },
  "删除 {0} 项？目录必须为空，删除不可撤销。": {
    en: "Delete {0} items? Directories must be empty. Deletion cannot be undone.",
    ja: "{0} 件を削除しますか？ディレクトリは空である必要があります。削除は元に戻せません。",
  },
  删除所选: {
    en: "Delete selected",
    ja: "選択項目を削除",
  },
  权限: {
    en: "Permissions",
    ja: "権限",
  },
  操作: {
    en: "Actions",
    ja: "操作",
  },
  "选择 {0}": {
    en: "Select {0}",
    ja: "{0} を選択",
  },
  修改权限: {
    en: "Change permissions",
    ja: "権限を変更",
  },
  "权限（0000–0777）": {
    en: "Permissions (0000–0777)",
    ja: "権限（0000–0777）",
  },
  下载: {
    en: "Download",
    ja: "ダウンロード",
  },
  重命名或移动到绝对路径: {
    en: "Rename or move to an absolute path",
    ja: "名前を変更、または絶対パスに移動",
  },
  移动: {
    en: "Move",
    ja: "移動",
  },
  剪贴板不可用: {
    en: "Clipboard unavailable",
    ja: "クリップボードを使用できません",
  },
  路径: {
    en: "Copy path",
    ja: "パスをコピー",
  },
  "删除 {0}？不可撤销，目录必须为空。": {
    en: "Delete {0}? This cannot be undone. Directories must be empty.",
    ja: "{0} を削除しますか？元に戻せません。ディレクトリは空である必要があります。",
  },
  "正在读取…": {
    en: "Reading…",
    ja: "読み込み中…",
  },
  此目录为空: {
    en: "This directory is empty",
    ja: "このディレクトリは空です",
  },
  下载中: {
    en: "Downloading",
    ja: "ダウンロード中",
  },
  上传中: {
    en: "Uploading",
    ja: "アップロード中",
  },
  "拖入文件或选择上传、下载开始传输。文件以数据流传输，不整份载入内存。": {
    en: "Drop files or choose upload/download to start. Files are streamed without loading the entire file into memory.",
    ja: "ファイルをドロップするか、アップロード・ダウンロードを選択してください。ファイル全体をメモリに読み込まず、ストリームで転送します。",
  },
  个文件正在传输: {
    en: "files transferring",
    ja: "ファイルを転送中",
  },
  "查看任务 →": {
    en: "View tasks →",
    ja: "タスクを表示 →",
  },
  " · 未保存": {
    en: " · Unsaved",
    ja: " · 未保存",
  },
  "放弃未保存的修改？": {
    en: "Discard unsaved changes?",
    ja: "未保存の変更を破棄しますか？",
  },
  "重新加载会丢弃当前修改，继续？": {
    en: "Reloading will discard your changes. Continue?",
    ja: "再読み込みすると現在の変更が失われます。続行しますか？",
  },
  重新加载: {
    en: "Reload",
    ja: "再読み込み",
  },
  保存文件: {
    en: "Save file",
    ja: "ファイルを保存",
  },
  "终端已断开。重连将建立新会话。": {
    en: "Terminal disconnected. Reconnecting creates a new session.",
    ja: "ターミナルが切断されました。再接続すると新しいセッションを開始します。",
  },
  终端连接失败: {
    en: "Terminal connection failed",
    ja: "ターミナル接続に失敗しました",
  },
  "粘贴包含多行，可能执行多个命令。确认粘贴？\n\n{0}": {
    en: "This paste contains multiple lines and may execute several commands. Paste anyway?\n\n{0}",
    ja: "複数行の貼り付けは複数のコマンドを実行する可能性があります。貼り付けますか？\n\n{0}",
  },
  监控连接已断开: {
    en: "Monitoring disconnected",
    ja: "監視接続が切断されました",
  },
  "指令或路径包含控制字符，不能安全填入终端": {
    en: "The command or path contains control characters and cannot be safely inserted",
    ja: "コマンドまたはパスに制御文字が含まれているため、安全に入力できません",
  },
  终端未连接: {
    en: "Terminal not connected",
    ja: "ターミナルが接続されていません",
  },
  连接视图: {
    en: "Connection view",
    ja: "接続ビュー",
  },
  终端: {
    en: "Terminal",
    ja: "ターミナル",
  },
  监控: {
    en: "Monitor",
    ja: "監視",
  },
  文件: {
    en: "Files",
    ja: "ファイル",
  },
  主机概况: {
    en: "Host overview",
    ja: "ホスト概要",
  },
  折叠监控: {
    en: "Collapse monitoring",
    ja: "監視を折りたたむ",
  },
  "运行 {0} 天": {
    en: "Uptime: {0} days",
    ja: "稼働時間：{0} 日",
  },
  等待采集: {
    en: "Waiting for metrics",
    ja: "収集待ち",
  },
  资源监控: {
    en: "Resources",
    ja: "リソース監視",
  },
  每秒采样: {
    en: "1-second sampling",
    ja: "1 秒ごとに計測",
  },
  "CPU / {0} 核": {
    en: "CPU / {0} cores",
    ja: "CPU / {0} コア",
  },
  内存: {
    en: "Memory",
    ja: "メモリ",
  },
  系统负载: {
    en: "System load",
    ja: "システム負荷",
  },
  磁盘: {
    en: "Disk",
    ja: "ディスク",
  },
  磁盘挂载点: {
    en: "Disk mount point",
    ja: "ディスクのマウントポイント",
  },
  "磁盘 {0}": {
    en: "Disk {0}",
    ja: "ディスク {0}",
  },
  网络: {
    en: "Network",
    ja: "ネットワーク",
  },
  网卡: {
    en: "Network interface",
    ja: "ネットワークインターフェース",
  },
  分钟: {
    en: "min",
    ja: "分",
  },
  "网卡累计 ↑": {
    en: "Interface total ↑",
    ja: "インターフェース累計 ↑",
  },
  "网卡累计 ↓": {
    en: "Interface total ↓",
    ja: "インターフェース累計 ↓",
  },
  展开监控: {
    en: "Expand monitoring",
    ja: "監視を展開",
  },
  "SSH 已连接": {
    en: "SSH connected",
    ja: "SSH 接続済み",
  },
  "SSH 未连接": {
    en: "SSH disconnected",
    ja: "SSH 未接続",
  },
  终端主题: {
    en: "Terminal theme",
    ja: "ターミナルのテーマ",
  },
  跟随主题: {
    en: "System theme",
    ja: "テーマに合わせる",
  },
  深色终端: {
    en: "Dark terminal",
    ja: "ダーク",
  },
  亮色终端: {
    en: "Light terminal",
    ja: "ライト",
  },
  终端字号: {
    en: "Terminal font size",
    ja: "ターミナルの文字サイズ",
  },
  搜索终端内容: {
    en: "Search terminal output",
    ja: "ターミナル内を検索",
  },
  搜索: {
    en: "Search",
    ja: "検索",
  },
  清屏: {
    en: "Clear",
    ja: "クリア",
  },
  命令助手: {
    en: "Assistant",
    ja: "コマンド支援",
  },
  重连: {
    en: "Reconnect",
    ja: "再接続",
  },
  终端快捷键: {
    en: "Terminal shortcuts",
    ja: "ターミナルのショートカット",
  },
  调整文件面板高度: {
    en: "Resize file panel",
    ja: "ファイルパネルの高さを変更",
  },
  主机指纹已验证: {
    en: "Host fingerprint verified",
    ja: "ホストのフィンガープリント確認済み",
  },
  文件面板: {
    en: "File panel",
    ja: "ファイルパネル",
  },
  均值: {
    en: "Avg",
    ja: "平均",
  },
  峰值: {
    en: "Peak",
    ja: "ピーク",
  },
  "AI 命令助手": {
    en: "AI command assistant",
    ja: "AI コマンドアシスタント",
  },
  命令辅助模式: {
    en: "Command assistance mode",
    ja: "コマンド支援モード",
  },
  "自然语言 → 单行指令": {
    en: "Natural language → command",
    ja: "自然言語 → 1 行コマンド",
  },
  补全命令前缀: {
    en: "Complete command prefix",
    ja: "コマンドの続きを補完",
  },
  解释或修正命令: {
    en: "Explain or fix a command",
    ja: "コマンドを解説・修正",
  },
  关闭助手: {
    en: "Close assistant",
    ja: "アシスタントを閉じる",
  },
  "请补全下面的命令前缀，输出完整单行命令：\n": {
    en: "Complete this command prefix. Return the full command on one line:\n",
    ja: "次のコマンドの続きを補完し、完全なコマンドを 1 行で出力してください：\n",
  },
  "请解释或修正下面的命令：\n": {
    en: "Explain or fix this command:\n",
    ja: "次のコマンドを解説または修正してください：\n",
  },
  自然语言指令: {
    en: "Natural-language command",
    ja: "自然言語の指示",
  },
  "例如：查找 /var/log 下超过 100 MB 的日志文件": {
    en: "e.g. Find log files larger than 100 MB in /var/log",
    ja: "例：/var/log で 100 MB を超えるログを検索",
  },
  "输入命令前缀，例如 docker logs --": {
    en: "Enter a command prefix, e.g. docker logs --",
    ja: "コマンドの先頭を入力（例：docker logs --）",
  },
  输入需要解释或修正的命令: {
    en: "Enter a command to explain or fix",
    ja: "解説・修正するコマンドを入力",
  },
  生成指令: {
    en: "Generate command",
    ja: "コマンドを生成",
  },
  "选择发送的上下文（默认不读取终端历史）": {
    en: "Choose context to send (terminal history is not read by default)",
    ja: "送信するコンテキストを選択（ターミナル履歴は既定で取得しません）",
  },
  "粘贴需要分析的输出，发送前请确认不含敏感数据": {
    en: "Paste output to analyze. Check for sensitive data before sending.",
    ja: "分析する出力を貼り付けてください。送信前に機密情報がないことを確認してください。",
  },
  "正在生成…": {
    en: "Generating…",
    ja: "生成中…",
  },
  "使用 AI 设置中的来源，接受后填入，不自动执行。": {
    en: "Uses your AI settings. Accept to insert; nothing runs automatically.",
    ja: "AI 設定のサービスを使用します。承認すると入力されます。自動実行はしません。",
  },
  "填入终端 ⇥": {
    en: "Insert into terminal ⇥",
    ja: "ターミナルに入力 ⇥",
  },
  服务器响应无效: {
    en: "Invalid server response",
    ja: "サーバーの応答が無効です",
  },
  请求失败: {
    en: "Request failed",
    ja: "リクエストに失敗しました",
  },
  "AI 请求失败": {
    en: "AI request failed",
    ja: "AI リクエストに失敗しました",
  },
  "AI 响应中断，请重试": {
    en: "AI response interrupted. Please retry.",
    ja: "AI の応答が中断されました。再試行してください。",
  },
  "此浏览器不支持流式下载，请使用浏览器直接下载": {
    en: "Streaming downloads are not supported in this browser. Use direct browser download.",
    ja: "このブラウザーはストリームダウンロードに対応していません。ブラウザーの直接ダウンロードを使用してください。",
  },
  "下载服务启动超时，请刷新页面": {
    en: "Download service timed out. Refresh the page.",
    ja: "ダウンロードサービスの起動がタイムアウトしました。ページを更新してください。",
  },
  下载请求失败: {
    en: "Download request failed",
    ja: "ダウンロードリクエストに失敗しました",
  },
  浏览器未提供下载流: {
    en: "The browser did not provide a download stream",
    ja: "ブラウザーからダウンロードストリームを取得できません",
  },
  下载已取消: {
    en: "Download cancelled",
    ja: "ダウンロードをキャンセルしました",
  },
  浏览器已取消下载: {
    en: "The browser cancelled the download",
    ja: "ブラウザーがダウンロードをキャンセルしました",
  },
  界面语言: {
    en: "Interface language",
    ja: "表示言語",
  },
  私有工作台: {
    en: "Private workspace",
    ja: "プライベートワークスペース",
  },
  "创建 {0} 账号": {
    en: "Create a {0} account",
    ja: "{0} アカウントを作成",
  },
  "登录 {0}，回到你的主机工作台。": {
    en: "Sign in to {0} and return to your hosts.",
    ja: "{0} にログインして、ホストのワークスペースへ。",
  },
  待确认: {
    en: "Awaiting approval",
    ja: "確認待ち",
  },
  执行中: {
    en: "Running",
    ja: "実行中",
  },
  已中断: {
    en: "Interrupted",
    ja: "中断済み",
  },
  已预占: {
    en: "Reserved",
    ja: "確保済み",
  },
  已结算: {
    en: "Settled",
    ja: "精算済み",
  },
  已退回: {
    en: "Refunded",
    ja: "返還済み",
  },
  语言: { en: "Language", ja: "言語" },
  更多操作: { en: "More actions", ja: "その他の操作" },
  紧凑列表: { en: "Compact list", ja: "コンパクト表示" },
  连接信息: { en: "Connection details", ja: "接続情報" },
  安全凭据: { en: "Credentials", ja: "認証情報" },
  复制完整路径: { en: "Copy full path", ja: "フルパスをコピー" },
  输入信息: { en: "Enter details", ja: "情報の入力" },
  确认操作: { en: "Confirm action", ja: "操作の確認" },
  确认: { en: "Confirm", ja: "確認" },
  退出登录: { en: "Sign out", ja: "ログアウト" },
  返回工作台: { en: "Return to workspace", ja: "ワークスペースに戻る" },
  "在连接的文件面板中上传或下载，进度会显示在这里。": {
    en: "Upload or download from a connected host’s file panel to see progress here.",
    ja: "接続したホストのファイルパネルでアップロード・ダウンロードすると、ここに進行状況が表示されます。",
  },
  覆盖: { en: "Overwrite", ja: "上書き" },
  放弃修改: { en: "Discard changes", ja: "変更を破棄" },
  信任并连接: { en: "Trust and connect", ja: "信頼して接続" },
  确认粘贴: { en: "Paste commands", ja: "貼り付けを確認" },
};
