export const monitoringMessages: Record<string, { en: string; ja: string }> = {
  概览: {
    en: "Overview",
    ja: "概要",
  },
  历史: {
    en: "History",
    ja: "履歴",
  },
  事件: {
    en: "Events",
    ja: "イベント",
  },
  探针设置: {
    en: "Agent settings",
    ja: "エージェント設定",
  },
  暂无数据: {
    en: "No data",
    ja: "データなし",
  },
  "撤销接入并卸载远端探针？卸载失败时仍会阻止上报。": {
    en: "Revoke access and uninstall the remote agent? Reports remain blocked if uninstall fails.",
    ja: "接続を無効化してリモートエージェントを削除しますか？削除に失敗しても報告は拒否されます。",
  },
  "任务已提交，离开页面后会继续执行。": {
    en: "Task submitted. It continues after you leave this page.",
    ja: "タスクを送信しました。このページを離れても続行します。",
  },
  "监控设置已保存。": {
    en: "Monitoring settings saved.",
    ja: "監視設定を保存しました。",
  },
  返回主机: {
    en: "Back to hosts",
    ja: "ホストに戻る",
  },
  持续监控: {
    en: "Continuous monitoring",
    ja: "継続監視",
  },
  刷新: {
    en: "Refresh",
    ja: "更新",
  },
  监控导航: {
    en: "Monitoring navigation",
    ja: "監視ナビゲーション",
  },
  "加载中…": {
    en: "Loading…",
    ja: "読み込み中…",
  },
  "当前显示最后一次数据；探针离线不代表主机宕机，SSH 可达性需单独确认。": {
    en: "Showing the last report. An offline agent does not establish host downtime; check SSH separately.",
    ja: "最後の報告を表示しています。エージェントの切断はホストの停止を意味しません。SSH は別途確認してください。",
  },
  "尚未收到探针数据。主机已保存，可在探针设置中安装。": {
    en: "No agent report yet. Your host is saved; install from Agent settings.",
    ja: "まだ報告がありません。ホストは保存済みです。エージェント設定からインストールできます。",
  },
  "{0} 核": {
    en: "{0} cores",
    ja: "{0} コア",
  },
  接收速率: {
    en: "Receive rate",
    ja: "受信速度",
  },
  发送速率: {
    en: "Send rate",
    ja: "送信速度",
  },
  资源趋势: {
    en: "Resource history",
    ja: "リソースの推移",
  },
  系统信息: {
    en: "System information",
    ja: "システム情報",
  },
  系统: {
    en: "System",
    ja: "システム",
  },
  内核: {
    en: "Kernel",
    ja: "カーネル",
  },
  架构: {
    en: "Architecture",
    ja: "アーキテクチャ",
  },
  运行时间: {
    en: "Uptime",
    ja: "稼働時間",
  },
  "{0} 天": {
    en: "{0} days",
    ja: "{0} 日",
  },
  探针版本: {
    en: "Agent version",
    ja: "エージェントバージョン",
  },
  "进程 / TCP / UDP": {
    en: "Processes / TCP / UDP",
    ja: "プロセス / TCP / UDP",
  },
  最后上报: {
    en: "Last report",
    ja: "最終報告",
  },
  "逐核 CPU": {
    en: "CPU by core",
    ja: "コア別 CPU",
  },
  磁盘容量: {
    en: "Disk capacity",
    ja: "ディスク容量",
  },
  挂载点: {
    en: "Mount point",
    ja: "マウント先",
  },
  已用: {
    en: "Used",
    ja: "使用済み",
  },
  可用: {
    en: "Available",
    ja: "利用可能",
  },
  总量: {
    en: "Total",
    ja: "合計",
  },
  占用: {
    en: "Usage",
    ja: "使用量",
  },
  "磁盘 I/O": {
    en: "Disk I/O",
    ja: "ディスク I/O",
  },
  设备: {
    en: "Device",
    ja: "デバイス",
  },
  "读取 / 秒": {
    en: "Read / second",
    ja: "読み取り / 秒",
  },
  "写入 / 秒": {
    en: "Write / second",
    ja: "書き込み / 秒",
  },
  使用率: {
    en: "Utilization",
    ja: "使用率",
  },
  显存: {
    en: "VRAM",
    ja: "GPU メモリ",
  },
  温度: {
    en: "Temperature",
    ja: "温度",
  },
  统计接口汇总: {
    en: "Selected interfaces",
    ja: "集計対象インターフェース",
  },
  "请选择统计网卡；虚拟网桥与 veth 合计可能重复统计。": {
    en: "Choose interfaces to count. Adding bridges and veth can double-count traffic.",
    ja: "集計対象を選択してください。ブリッジと veth の合計は二重集計になる場合があります。",
  },
  "今日接收 / 发送": {
    en: "Today · received / sent",
    ja: "今日 · 受信 / 送信",
  },
  "账期接收 / 发送": {
    en: "Billing period · received / sent",
    ja: "請求期間 · 受信 / 送信",
  },
  当前网卡账期峰值: {
    en: "Interface peaks this period",
    ja: "期間内のインターフェースピーク",
  },
  账期配额: {
    en: "Period quota",
    ja: "期間内の上限",
  },
  未设置: {
    en: "Not set",
    ja: "未設定",
  },
  网络速率: {
    en: "Network rate",
    ja: "ネットワーク速度",
  },
  接收: {
    en: "Receive",
    ja: "受信",
  },
  发送: {
    en: "Send",
    ja: "送信",
  },
  "曲线使用单调平滑，提示值来自原始聚合；缺报时段不连线。": {
    en: "Curves preserve direction without overshoot. Tooltips show stored aggregates; missing reports leave gaps.",
    ja: "過度な補間のない曲線です。ツールチップは保存された集計値を表示し、報告のない期間は接続しません。",
  },
  接口错误与丢弃: {
    en: "Interface errors and drops",
    ja: "インターフェースのエラーと破棄",
  },
  接口: {
    en: "Interface",
    ja: "インターフェース",
  },
  网络质量: {
    en: "Network quality",
    ja: "ネットワーク品質",
  },
  "在下方添加目标，从这台主机发起探测。": {
    en: "Add a target below to probe it from this host.",
    ja: "下に対象を追加すると、このホストから疎通を確認します。",
  },
  平均延迟: {
    en: "Average latency",
    ja: "平均遅延",
  },
  丢包率: {
    en: "Packet loss",
    ja: "パケット損失率",
  },
  探测失败率: {
    en: "Check failure rate",
    ja: "チェック失敗率",
  },
  可用率: {
    en: "Availability",
    ja: "可用率",
  },
  "探测次数 / 无法执行": {
    en: "Checks / unavailable",
    ja: "チェック数 / 実行不可",
  },
  探测目标: {
    en: "Check targets",
    ja: "チェック対象",
  },
  "ICMP 需要系统权限；TCP/HTTP 的失败比例标为探测失败率。": {
    en: "ICMP needs system permission. TCP/HTTP failures are labeled check failure rate.",
    ja: "ICMP にはシステム権限が必要です。TCP/HTTP の失敗割合はチェック失敗率として表示します。",
  },
  目标名称: {
    en: "Target name",
    ja: "対象名",
  },
  探测方式: {
    en: "Check type",
    ja: "チェック方式",
  },
  删除目标: {
    en: "Remove target",
    ja: "対象を削除",
  },
  目标地址: {
    en: "Target address",
    ja: "対象アドレス",
  },
  "间隔（秒）": {
    en: "Interval (seconds)",
    ja: "間隔（秒）",
  },
  "超时（毫秒）": {
    en: "Timeout (milliseconds)",
    ja: "タイムアウト（ミリ秒）",
  },
  添加目标: {
    en: "Add target",
    ja: "対象を追加",
  },
  保存探测设置: {
    en: "Save check settings",
    ja: "チェック設定を保存",
  },
  历史指标: {
    en: "History metric",
    ja: "履歴の指標",
  },
  时间: {
    en: "Time",
    ja: "時刻",
  },
  平均值: {
    en: "Average",
    ja: "平均",
  },
  样本数: {
    en: "Samples",
    ja: "サンプル数",
  },
  监控事件: {
    en: "Monitoring events",
    ja: "監視イベント",
  },
  暂无事件: {
    en: "No events",
    ja: "イベントなし",
  },
  观测值: {
    en: "Observed value",
    ja: "観測値",
  },
  "Webhook 投递": {
    en: "Webhook deliveries",
    ja: "Webhook 配信",
  },
  状态: {
    en: "Status",
    ja: "状態",
  },
  尝试次数: {
    en: "Attempts",
    ja: "試行回数",
  },
  说明: {
    en: "Details",
    ja: "詳細",
  },
  探针管理: {
    en: "Agent management",
    ja: "エージェント管理",
  },
  "首次收到有效上报后才会标记为安装成功。任务独立于当前页面。": {
    en: "Installation succeeds after the first valid report. Tasks continue independently of this page.",
    ja: "最初の有効な報告でインストール完了となります。タスクはページとは独立して実行されます。",
  },
  "允许使用已配置的免密 sudo 安装系统服务": {
    en: "Allow configured passwordless sudo to install a system service",
    ja: "設定済みのパスワード不要 sudo によるサービスのインストールを許可",
  },
  "安装 / 重试": {
    en: "Install / retry",
    ja: "インストール / 再試行",
  },
  "新凭证将在探针确认后替换旧凭证。": {
    en: "The new credential replaces the old one after the agent confirms it.",
    ja: "エージェントの確認後、新しい資格情報に切り替わります。",
  },
  "撤销探针接入？远端程序会保留，但不能继续上报。": {
    en: "Revoke agent access? The remote program remains installed and cannot report.",
    ja: "接続を無効化しますか？リモートのプログラムは残りますが報告できなくなります。",
  },
  撤销接入: {
    en: "Revoke access",
    ja: "接続を無効化",
  },
  进度: {
    en: "Progress",
    ja: "進捗",
  },
  安装探针: {
    en: "Install agent",
    ja: "エージェントをインストール",
  },
  "下载十分钟有效的私有配置文件，与安装脚本放在同一目录。凭证不会出现在安装命令中。":
    {
      en: "Download the private config, valid for ten minutes, and place it beside the installer. Credentials stay out of commands.",
      ja: "10 分間有効な非公開設定をダウンロードし、インストーラーと同じ場所に置きます。コマンドに資格情報は含まれません。",
    },
  下载私有配置: {
    en: "Download private config",
    ja: "非公開設定をダウンロード",
  },
  "在目标主机的私有目录中放入 config.json，然后执行：": {
    en: "Place config.json in a private directory on the target host, then run:",
    ja: "対象ホストの非公開ディレクトリに config.json を置き、次を実行してください：",
  },
  采集与流量账期: {
    en: "Collection and billing period",
    ja: "収集と通信量の集計期間",
  },
  账期时区: {
    en: "Billing timezone",
    ja: "集計期間のタイムゾーン",
  },
  "账期配额（GiB，0 为不限）": {
    en: "Period quota (GiB, 0 for unlimited)",
    ja: "期間の上限（GiB、0 は無制限）",
  },
  "统计网卡（逗号分隔，留空使用默认路由接口）": {
    en: "Count interfaces (comma separated; blank uses default routes)",
    ja: "集計対象（カンマ区切り、空欄は既定ルート）",
  },
  排除网卡: {
    en: "Exclude interfaces",
    ja: "除外インターフェース",
  },
  "挂载点（逗号分隔，留空自动去重）": {
    en: "Mounts (comma separated; blank deduplicates automatically)",
    ja: "マウント先（カンマ区切り、空欄は自動で重複を除外）",
  },
  排除挂载点: {
    en: "Exclude mounts",
    ja: "除外マウント先",
  },
  "采集 GPU 指标": {
    en: "Collect GPU metrics",
    ja: "GPU 指標を収集",
  },
  保存监控设置: {
    en: "Save monitoring settings",
    ja: "監視設定を保存",
  },
  "告警规则已保存。": {
    en: "Alert rules saved.",
    ja: "アラートルールを保存しました。",
  },
  启用告警: {
    en: "Enable alerts",
    ja: "アラートを有効化",
  },
  "资源阈值设为 0 表示关闭；流量告警使用上方账期配额。": {
    en: "Set resource thresholds to 0 to disable. Traffic alerts use the period quota above.",
    ja: "リソースの閾値は 0 で無効です。通信量アラートは上記の期間上限を使います。",
  },
  "持续时间（秒）": {
    en: "Sustained duration (seconds)",
    ja: "継続時間（秒）",
  },
  "恢复确认（秒）": {
    en: "Recovery confirmation (seconds)",
    ja: "復旧確認（秒）",
  },
  "冷却时间（秒）": {
    en: "Cooldown (seconds)",
    ja: "クールダウン（秒）",
  },
  "恢复阈值差（百分点）": {
    en: "Recovery margin (percentage points)",
    ja: "復旧閾値との差（ポイント）",
  },
  维护静默至: {
    en: "Mute for maintenance until",
    ja: "メンテナンス通知停止の終了時刻",
  },
  "清除 Webhook": {
    en: "Clear webhook",
    ja: "Webhook を削除",
  },
  主机重启: {
    en: "Host restarted",
    ja: "ホスト再起動",
  },
  探针重启: {
    en: "Agent restarted",
    ja: "エージェント再起動",
  },
  计数器重置: {
    en: "Counter reset",
    ja: "カウンターリセット",
  },
  采集中断: {
    en: "Collection interrupted",
    ja: "収集中断",
  },
  探针恢复: {
    en: "Agent recovered",
    ja: "エージェント復旧",
  },
  "CPU 超过阈值": {
    en: "CPU above threshold",
    ja: "CPU 閾値超過",
  },
  "CPU 恢复": {
    en: "CPU recovered",
    ja: "CPU 復旧",
  },
  内存超过阈值: {
    en: "Memory above threshold",
    ja: "メモリ閾値超過",
  },
  内存恢复: {
    en: "Memory recovered",
    ja: "メモリ復旧",
  },
  流量达到配额: {
    en: "Traffic quota reached",
    ja: "通信量上限に到達",
  },
  流量配额恢复: {
    en: "Traffic quota recovered",
    ja: "通信量上限から復旧",
  },
  磁盘恢复: {
    en: "Disk recovered",
    ja: "ディスク復旧",
  },
  磁盘超过阈值: {
    en: "Disk above threshold",
    ja: "ディスク閾値超過",
  },
  未启用: {
    en: "Disabled",
    ja: "未有効化",
  },
  安装中: {
    en: "Installing",
    ja: "インストール中",
  },
  等待上报: {
    en: "Awaiting report",
    ja: "報告待ち",
  },
  已暂停: {
    en: "Paused",
    ja: "一時停止",
  },
  正在建立采样基线: {
    en: "Establishing baseline",
    ja: "基準値を取得中",
  },
  不支持: {
    en: "Unsupported",
    ja: "非対応",
  },
  无权限: {
    en: "Permission unavailable",
    ja: "権限なし",
  },
  已投递: {
    en: "Delivered",
    ja: "配信済み",
  },
  信任并继续: {
    en: "Trust and continue",
    ja: "信頼して続行",
  },
  自动安装: {
    en: "Automatic install",
    ja: "自動インストール",
  },
  保存并安装探针: {
    en: "Save and install agent",
    ja: "保存してエージェントをインストール",
  },
  "主机已保存，探针配置失败：{0}": {
    en: "Host saved; agent setup failed: {0}",
    ja: "ホストは保存されました。エージェント設定に失敗：{0}",
  },
  探针数据: {
    en: "Agent data",
    ja: "エージェントデータ",
  },
  "SSH 临时采集": {
    en: "Temporary SSH metrics",
    ja: "SSH による一時収集",
  },
  "探针暂无新数据，当前使用 SSH 临时采集。": {
    en: "No fresh agent data; using temporary SSH metrics.",
    ja: "新しい報告がないため、SSH の一時データを表示しています。",
  },
};
