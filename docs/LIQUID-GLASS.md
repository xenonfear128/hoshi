# 液态玻璃与移动端重构

采用用户指定的 https://github.com/martin65536/liquid-glass-webgl ，固定上游版本 `b4e0a6910443cea7cdd4b1bfcf7b2394e0a15e48`。上游采用 Apache-2.0；原始距离场模块保留在 `web/src/glass/vendor/sdf.ts`，许可证和来源说明随静态构建发布到 `/licenses/`。

## 接入方式

上游演示使用一个 Canvas 绘制整个应用。Remoter 复用其 GLSL 距离场与法线、circleMap 透镜折射算法，适配到 React DOM 表面；着色器还执行背景模糊、三通道色散、表面染色和方向性边缘高光。没有引入演示项目的 Next.js、数据库或完整 Canvas 控件系统。

一个共享离屏 WebGL 上下文绘制材质，再复制到各面板的装饰 Canvas。DOM 保留文字、表单、焦点、选择和点击，玻璃不会截获输入。背景是应用生成的静态渐变与轨道纹理，不截屏终端、不捕获凭据或远端文件内容。玻璃表面按 DOM 顺序写入累积场景纹理，后面的玻璃可以折射前面已经合成的玻璃；终端正文和文件内容仍保持 DOM 实体渲染。

阅读打磨后，WebGL 仅覆盖登录卡片、主导航、命令助手、弹窗及手机底部导航。主机卡片、AI 入口、会话栏、监控、历史/需求表单采用稳定表面、薄边和较少阴影，避免多个层级同时强调高光。终端正文和文件列表保持稳定实底。

## 性能与回退

- 按尺寸、位置、主题变化重绘；没有永久动画循环。静止界面不持续发出 WebGL 绘制调用。
- 只绘制视口内表面；滚动合并到 80 ms 后重绘；隐藏标签页暂停绘制。
- 桌面 DPR 上限 1.5，窄屏上限 1.25；单个材质绘制最大边不超过 2048 像素。
- WebGL 初始化失败或上下文丢失回退到 CSS 半透明/模糊面板，功能保持可用；重新加载页面可重新尝试 WebGL。
- 强制高对比度使用系统实底与描边；减少动态效果偏好关闭 CSS 过渡。
- 页面没有引入外部 CDN、远端壁纸、遥测或新的网络权限；生产 CSP 不放宽。

## 手机交互

750 px 以下及短屏横向窗口采用底部主导航。连接页使用“终端 / 监控 / 文件”切换，保持当前 SSH 会话。手机不显示双终端分屏，同时仍可切换多个会话标签。

终端增加 Ctrl 锁定（下一个英文字母转换为控制字符）、Esc、Tab、四向键和 Ctrl+C。视口高度跟随 VisualViewport，兼顾屏幕旋转与软键盘；保留安全区域。命令助手在终端内使用紧凑浮层。

手机文件列表改为卡片式分行布局，完整名称可换行，权限、修改时间直接展示；下载、移动、路径复制和删除集中在每行“更多操作”中，无需横向滚动即可访问。上传、文本编辑、传输中心和设置弹窗均适配触屏。

## 验证与复现

`web/e2e/glass.spec.ts` 使用明确的演示数据，验证 360/390/768/1512 px 的首页、弹窗、AI、终端、监控及文件布局，检查真正的 WebGL 输出像素、无 WebGL 回退、上下文丢失、减少动态效果、旋转和 Ctrl 输入。

`web/e2e/mobile.spec.ts` 使用 Chromium 手机设备仿真、触屏及真实 SSH/SFTP，验证命令、监控、上传、编辑、流式下载内容校验、权限入口、删除、退出断连。`workspace.spec.ts` 保留桌面真实连接及账号隔离回归。

```sh
# 先启动应用（生产构建）及隔离 SSH fixture
PLAYWRIGHT_BROWSERS_PATH=/path/to/browsers E2E_ORIGIN=http://localhost:8080 \
TEST_SSH_KEY=/path/to/test-key npm --prefix web run test:e2e -- glass.spec.ts workspace.spec.ts
# 在隔离测试环境重启应用，再运行手机测试（累计测试账号会触及生产注册限流）
PLAYWRIGHT_BROWSERS_PATH=/path/to/browsers E2E_ORIGIN=http://localhost:8080 \
TEST_SSH_KEY=/path/to/test-key npm --prefix web run test:e2e -- mobile.spec.ts
```

测试截图位于 `design/glass-*.png`；带示例主机名称的截图来自 UI fixture，`glass-phone-real-ssh.png` 来自真实 SSH。设备仿真不能替代真实 iOS/Android 硬件与软键盘验收。

## 2026-09 材质升级

### 中轴亮带修复

旧 shader 把高光权重设为在面板内部接近 1，直接照亮距离场中轴的法线跳变，形成 `>—<` 纹理。修复后方向性高光、折射和色差只存在于窄倒角区域；主体使用加权模糊与均匀染色。法线与裁剪均读取同一 G2 距离场，取消未定义的反向 smoothstep。同时统一 FBO 纹理方向、使用预乘 alpha 合成，并在每个重绘帧清空旧的累积玻璃结果。

`web/e2e/glass-optics.spec.ts` 用均匀背景检查长条和卡片内部没有中轴明暗跳变，并检查相同场景重绘无颜色漂移。该测试需通过 Vite 运行，以加载真实 renderer 模块。它验证渲染正确性，不代表与 iOS 系统材质完全一致。

当前 Hoshi 的 DOM-backed WebGL surface 已加入一批来自上游实现的核心材质行为：连续曲率 SDF 轮廓、局部多 tap 背景采样、三通道色差折射、Fresnel/方向性边缘高光、内侧阴影，以及按导航栏、面板、弹窗和 AI 表面分级的材质参数。DOM 文本、输入和可访问性仍由 HTML 保持。

当前实现采用混合架构：共享背景先进入累积 FBO，每个 surface 从当前累积纹理取样，在自身局部画布完成折射、模糊和边缘材质，再以 alpha 合成回累积纹理，保证玻璃叠加顺序正确；连续曲率 mask 使用上游 G2 Bezier 路径生成的双通道覆盖/SDF 纹理。完整的 DOM 场景光栅化仍不适合直接纳入，因为这会捕获终端文本和凭据，后续可为明确允许的非敏感背景增加独立 scene pass。

## 2026-09 Surface 推广

液态玻璃已从入口组件推广到工作区外围，统一由 `LiquidGlass.tsx` 的 surface registry 管理：

| 材质级别 | 模块 | 强度 |
|---|---|---:|
| `nav` | 顶部导航、移动底部导航 | 0.15 |
| `modal` | 登录框、弹窗 | 0.82 |
| `assistant` | 命令助手、AI 请求 | 0.62 |
| `surface` | 主机卡片、AI 入口 | 0.42 |
| `panel` | 监控、文件区域、任务历史 | 0.30 |
| `tabs` | 会话标签、移动工作区切换 | 0.24 |
| `control` | 终端快捷键、传输任务行 | 0.22 |

所有可见 surface 都使用同一套 G2 mask、局部模糊、折射、色差和边缘高光。指针按下时只对当前 surface 提高材质强度并轻微压缩，释放后恢复；不启用持续动画循环。

终端正文、xterm canvas、文件表格、CodeMirror 编辑区和凭据输入仍保持实底 DOM 渲染，避免玻璃层降低内容可读性或捕获敏感信息。

验收覆盖：`glass.spec.ts` 的 360/390/768/1512 px 页面、WebGL 回退、上下文丢失、旋转；`glass-optics.spec.ts` 的均匀背景中轴亮带检查；`language-panel.spec.ts` 的移动端浮层和键盘交互。新增 surface 必须满足无横向溢出、无旧帧残留和中心区域无明暗跳变。
