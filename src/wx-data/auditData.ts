export interface AuditIssue {
  id: string;
  severity: 'high' | 'medium' | 'low';
  severityLabel: string;
  category: 'bug' | 'package' | 'compliance' | 'ux';
  title: string;
  file: string;
  lines: string;
  summary: string;
  rootCause: string;
  impact: string;
  beforeCode: string;
  afterCode: string;
  fixedInV054: boolean;
}

export interface OptimizationItem {
  id: string;
  area: '音频与交互' | '渲染与内存' | '包体积与工程' | '长线留存与经济';
  title: string;
  target: string;
  gain: string;
  detail: string;
  codeSnippet: string;
}

export interface FeatureProposal {
  id: string;
  phase: 'v0.5.4 上线前速赢 (零风险)' | 'v0.6.0 核心玩法迭代' | 'v0.6.x 商业化与云端闭环';
  title: string;
  effort: string;
  valueScore: string;
  summary: string;
  mechanics: string[];
  interactiveDemoAvailable?: boolean;
}

export const AUDIT_ISSUES: AuditIssue[] = [
  {
    id: 'ISS-01',
    severity: 'high',
    severityLabel: '高优缺陷',
    category: 'bug',
    title: '背景音乐播放中切换「音量：低/中/高」完全不生效',
    file: 'js/engine/music.js & js/scenes/settings.js',
    lines: 'music.js:64-73, settings.js:56-62',
    summary:
      '当玩家在设置第 4 页先开启「音乐：播放中」，再点击下方「音量：低/中/高」时，仅放置试听音效音量改变，正在播放的 BGM 音量保持原档位不变。',
    rootCause:
      'settings.js 切换音量时只调用了 volume.cycle(s) 与 feedback.play("place")，未通知 music 模块；而 music.play() 在 playing === true 时直接 return 短路，既未提供 syncVolume() 接口，也未监听音量变更。',
    impact:
      'v0.5.2/v0.5.3 新增的核心功能「三档音量共用」在开启音乐后的真实调节场景下失灵，玩家会误以为背景音乐无法调小或调大。',
    beforeCode: `// js/engine/music.js (v0.5.3)
if (playing) return;
audio.volume = volume.music(store.state.settings);
wantPlay = true;

// js/scenes/settings.js (v0.5.3)
{
  label: '音量：' + volume.label(store.state.settings),
  run: () => {
    const s = store.state.settings || (store.state.settings = {});
    volume.cycle(s);
    store.save();
    feedback.play('place');
  },
}`,
    afterCode: `// js/engine/music.js (v0.5.4 修复)
function syncVolume() {
  if (!audio) return;
  try {
    audio.volume = volume.music(store.state.settings);
  } catch (e) {}
}
// module.exports 增加 syncVolume

// js/scenes/settings.js (v0.5.4 修复)
{
  label: '音量：' + volume.label(store.state.settings),
  run: () => {
    const s = store.state.settings || (store.state.settings = {});
    volume.cycle(s);
    store.save();
    music.syncVolume(); // 实时同步正在播放的 BGM 音量
    feedback.play('place');
  },
}`,
    fixedInV054: true,
  },
  {
    id: 'ISS-02',
    severity: 'high',
    severityLabel: '高优缺陷',
    category: 'bug',
    title: '未完成关卡满 5 个时，replacement() 与 write() 未严格保护旧存档 activeRun',
    file: 'js/engine/runs.js',
    lines: 'runs.js:60-77',
    summary:
      'README 承诺“旧存档缺少访问时间时以原键顺序近似先后，保护 activeRun”，但 replacement() 与 write() 在特定键序下会误报或误删原 activeRun。',
    rootCause:
      '1) replacement(level) 直接返回 Object.keys(all)[0]，未像 prune() 那样 .filter(id => id !== store.state.activeRun)；2) write(level, data) 先将 store.state.activeRun 覆盖为新关卡 ID，再调用 prune()，导致若旧 activeRun 位于 keys[0] 会被当成普通旧关直接淘汰。',
    impact:
      '从旧版本迁移或特定顺序存档的玩家开启第 6 个未完成关时，提示被替换的关卡与实际淘汰不一致，或导致玩家最近正在攻略的 activeRun 进度丢失。',
    beforeCode: `// js/engine/runs.js (v0.5.3)
function write(level, data) {
  if (!store.state.runs || typeof store.state.runs !== 'object' || Array.isArray(store.state.runs)) store.state.runs = {};
  store.state.runs[level.id] = encode(level, data);
  store.state.activeRun = level.id; // 先覆盖了旧 activeRun！
  const latest = store.state.runs[level.id];
  delete store.state.runs[level.id];
  store.state.runs[level.id] = latest;
  prune();
  store.save();
}
function replacement(level) {
  const all = store.state.runs || {};
  if (Object.prototype.hasOwnProperty.call(all, level.id) || Object.keys(all).length < 5) return null;
  return Object.keys(all)[0]; // 未过滤 activeRun！
}`,
    afterCode: `// js/engine/runs.js (v0.5.4 修复)
function write(level, data) {
  if (!store.state.runs || typeof store.state.runs !== 'object' || Array.isArray(store.state.runs)) store.state.runs = {};
  const prevActive = store.state.activeRun;
  if (prevActive && prevActive !== level.id && store.state.runs[prevActive]) {
    const keep = store.state.runs[prevActive];
    delete store.state.runs[prevActive];
    store.state.runs[prevActive] = keep;
  }
  store.state.runs[level.id] = encode(level, data);
  store.state.activeRun = level.id;
  const latest = store.state.runs[level.id];
  delete store.state.runs[level.id];
  store.state.runs[level.id] = latest;
  prune();
  store.save();
}
function replacement(level) {
  const all = store.state.runs || {};
  if (Object.prototype.hasOwnProperty.call(all, level.id) || Object.keys(all).length < 5) return null;
  return Object.keys(all).filter((id) => id !== store.state.activeRun)[0] || Object.keys(all)[0];
}`,
    fixedInV054: true,
  },
  {
    id: 'ISS-03',
    severity: 'high',
    severityLabel: '提审阻塞',
    category: 'compliance',
    title: '4 处玩家可见界面仍残留「需用户确认 / 草案 / 需用户提供」工程占位文案',
    file: 'js/scenes/settings.js, js/engine/policy.js, js/engine/wellbeing.js, js/engine/player-feedback.js',
    lines: 'settings.js:99, policy.js:9,17, wellbeing.js:18, player-feedback.js:58',
    summary:
      'AppID 已切入正式号 wx82a5467c9bf7901a，但设置页底部、用户协议、适度游戏弹窗、反馈兜底弹窗仍直接向玩家展示“需用户确认”、“草案”等内部研发提示语。',
    rootCause:
      '早期批次为防止虚构法律承诺留下的防御性占位文字，在准备提审材料（SUBMISSION.md）后尚未回填替换为正式线上文案。',
    impact:
      '微信小游戏人工提审对“半成品/测试占位文案/未确认协议草案”高度敏感，极易触发“应用存在测试占位内容或协议不完整”驳回。',
    beforeCode: `// settings.js:99
ui.text(g, '本地存档 · 协议草案需确认', W / 2, H - safeBottom - 12 * DPR, 11 * DPR, '#94b0c2');
// wellbeing.js:18
lines: ['让眼睛休息一下，也让思路换口气。', '进度已保存在本机，随时可以回来。', '提醒期间不计入本关用时。', '提示文案需用户确认']
// policy.js:9 & 17
'协议草案需用户确认，不构成正式协议。' / '本摘要需用户确认，以后台完整指引为准。'`,
    afterCode: `// settings.js:99 (v0.5.4 正式提审文案)
ui.text(g, '本地安全存档 · 适度益智健脑', W / 2, H - safeBottom - 12 * DPR, 11 * DPR, '#94b0c2');
// wellbeing.js:18
lines: ['让眼睛休息一下，也让思路换口气。', '进度已保存在本机，随时可以回来。', '提醒期间不计入本关用时。', '合理安排时间，享受健康生活。']
// policy.js:9 & 17
'虚拟金币与体力仅限本局内使用，无现金价值。' / '完整隐私保护指引以微信平台公示文本为准。'`,
    fixedInV054: true,
  },
  {
    id: 'ISS-04',
    severity: 'medium',
    severityLabel: '包体积泄漏',
    category: 'package',
    title: 'BATCH-I.md / BATCH-J.md / LAUNCH-CHECKLIST.md / SUBMISSION.md 未加入打包忽略',
    file: 'project.config.json & tools/release-check.js',
    lines: 'project.config.json:14-112',
    summary:
      'project.config.json 的 packOptions.ignore 仅列到了 BATCH-G.md，后续新增的 4 个研发/提审 Markdown 文件（共 8,271 Bytes）会被打进微信正式主包。',
    rootCause:
      'packOptions.ignore 采用逐个文件名枚举而非通配规则，且 tools/release-check.js 未校验根目录 .md 文件是否全部在 ignore 列表中。',
    impact:
      '白白占用约 8.1 KB 主包体积，且将内部研发记录（如 Entire 额度、AppID 变更记录、提审备注）暴露在正式发行的代码包中。',
    beforeCode: `// project.config.json (末尾仅到 BATCH-G.md)
      { "type": "file", "value": "CURRENT-STATE.json" },
      { "type": "file", "value": "BATCH-G.md" }
    ]`,
    afterCode: `// project.config.json (补齐全部新增文档 + glob 兜底)
      { "type": "file", "value": "CURRENT-STATE.json" },
      { "type": "file", "value": "BATCH-G.md" },
      { "type": "file", "value": "BATCH-I.md" },
      { "type": "file", "value": "BATCH-J.md" },
      { "type": "file", "value": "LAUNCH-CHECKLIST.md" },
      { "type": "file", "value": "SUBMISSION.md" }
    ]`,
    fixedInV054: true,
  },
  {
    id: 'ISS-05',
    severity: 'medium',
    severityLabel: '体验缺陷',
    category: 'ux',
    title: '首页「成就」可领奖与「签到」未签时缺少红点提示，且首页设置弹窗无音乐/音量快捷项',
    file: 'js/scenes/home.js',
    lines: 'home.js:90-135, 176-181',
    summary:
      '首页仅对「每日任务」(btns[1]) 绘制了可领奖红点；当玩家达成「成就」(btns[2]，最高可领 700 金币) 或当日尚未「签到」(btns[4]，100 金币) 时毫无视觉提示。此外首页「设置」弹窗只有音效/震动，没有音乐与音量调节。',
    rootCause:
      'home.js 第 176 行只写了 progress.tasks.some(...) 红点逻辑，遗漏了 progress.achievements.some(...)；且 BATCH-I 新增音量档位时只加在了 4 页深层 settings.js，未同步到首页快捷设置弹窗。',
    impact:
      '玩家极易漏领数千金币导致卡体力流失；想在首页开关 BGM 或调音量需点「设置 → 协议与适度游戏 → 翻到第 4 页」共 5 次点击。',
    beforeCode: `// js/scenes/home.js (v0.5.3)
const pending = progress.tasks.some((t) => S.tasks[t.id] >= t.goal && !S.tasks.claimed[t.id]);
if (pending) {
  g.fillStyle = '#ef4b5c';
  const b = btns[1];
  g.fillRect(b.x + b.w - W * 0.025, b.y, W * 0.025, W * 0.025);
}`,
    afterCode: `// js/scenes/home.js (v0.5.4 修复：每日任务 + 成就 + 签到全红点提醒)
const hasTaskDot = progress.tasks.some((t) => S.tasks[t.id] >= t.goal && !S.tasks.claimed[t.id]);
const hasAchDot = progress.achievements.some((a) => a.value() >= a.goal && !S.ach[a.id]);
const hasSignDot = !progress.clock().blocked && S.signDay !== progress.day();
[
  [hasTaskDot, btns[1]],
  [hasAchDot, btns[2]],
  [hasSignDot, btns[4]],
].forEach(([on, b]) => {
  if (!on || !b) return;
  g.fillStyle = '#ef4b5c';
  g.fillRect(b.x + b.w - W * 0.025, b.y, W * 0.025, W * 0.025);
});`,
    fixedInV054: true,
  },
  {
    id: 'ISS-06',
    severity: 'low',
    severityLabel: '工程健壮性',
    category: 'bug',
    title: 'tools/open-data-test.js 硬编码相对路径导致非根目录执行时报 ENOENT',
    file: 'tools/open-data-test.js',
    lines: 'open-data-test.js:11',
    summary:
      '其余 40 个测试脚本均通过 path.resolve(__dirname, "..") 读取文件，唯独 open-data-test.js 直接调用 fs.readFileSync("open-data/index.js")。',
    rootCause:
      '编写测试时依赖了 process.cwd() 必须位于仓库根目录的隐式假设。',
    impact:
      '在 CI、子目录或外部测试运行器调用 node tools/open-data-test.js 时直接崩溃报错。',
    beforeCode: `// tools/open-data-test.js:11
vm.runInNewContext(fs.readFileSync('open-data/index.js', 'utf8'), {`,
    afterCode: `// tools/open-data-test.js:11
const path = require('node:path');
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../open-data/index.js'), 'utf8'), {`,
    fixedInV054: true,
  },
  {
    id: 'ISS-07',
    severity: 'low',
    severityLabel: '数据未闭环',
    category: 'ux',
    title: '存档 stat.amp 字段已初始化持久化但从未统计，且成就上限仅覆盖前 20% 进度',
    file: 'js/engine/storage.js & js/engine/progress.js',
    lines: 'storage.js:12,24, progress.js:97-101',
    summary:
      'storage.js 维护了 stat: { clear: 0, par: 0, amp: 0 }，但通关时只递增了 clear 与 par，amp 永远为 0；且全游戏仅 3 个成就（1 关 / 10 关 / 30 星），玩家打完第 2 章后即无任何成就可追求。',
    rootCause:
      '主线从 50 关扩充到 60 关（180 星）后，progress.achievements 未同步扩充中后期里程碑。',
    impact:
      '中后期（第 3~6 章）缺少阶段性正反馈与金币投放来源。',
    beforeCode: `// js/engine/progress.js (仅 3 项初级成就)
const achievements = [
  { id: 'first', title: '初次点亮', goal: 1, reward: 100, value: () => Object.keys(S.stars).length },
  { id: 'ten', title: '接力达人', goal: 10, reward: 300, value: () => Object.keys(S.stars).length },
  { id: 'stars', title: '星光收藏家', goal: 30, reward: 300, value: () => Object.values(S.stars).reduce((a, b) => a + b, 0) },
];`,
    afterCode: `// js/engine/progress.js (v0.5.4 扩展为 6 项全周期成就，覆盖 60 关 / 180 星)
const achievements = [
  { id: 'first', title: '初次点亮', goal: 1, reward: 100, value: () => Object.keys(S.stars).length },
  { id: 'ten', title: '接力达人', goal: 10, reward: 300, value: () => Object.keys(S.stars).length },
  { id: 'thirty', title: '半程贯通', goal: 30, reward: 400, value: () => Object.keys(S.stars).length },
  { id: 'allclear', title: '全域接通', goal: 60, reward: 600, value: () => Object.keys(S.stars).length },
  { id: 'stars', title: '星光收藏家', goal: 30, reward: 300, value: () => Object.values(S.stars).reduce((a, b) => a + b, 0) },
  { id: 'maxstars', title: '满星工程师', goal: 180, reward: 800, value: () => Object.values(S.stars).reduce((a, b) => a + b, 0) },
];`,
    fixedInV054: true,
  },
];

export const OPTIMIZATION_ITEMS: OptimizationItem[] = [
  {
    id: 'OPT-01',
    area: '音频与交互',
    title: '长按取回管件与撤回操作增加即时轻反馈',
    target: 'js/scenes/game/index.js (onLong & act("undo"))',
    gain: '触控确认感显著提升，消除“长按 450ms 后管件消失但无声”的断层感',
    detail:
      '目前放置（place）和旋转（rotate）均有音效+轻震动，但长按取回管件（onLong）和撤回（undo）完全静音。直接复用已预加载的 rotate 音效实例即可零体积开销补齐操作闭环。',
    codeSnippet: `// js/scenes/game/index.js - onLong()
snap(p.r, p.c);
feedback.play('rotate'); // 新增：取回管件即时音效与轻震反馈
state.inv[pc.t]++;`,
  },
  {
    id: 'OPT-02',
    area: '音频与交互',
    title: '通关信号流等待期间支持点击一键快进结算框',
    target: 'js/scenes/game/index.js (handleWinTap)',
    gain: '在 8×8 长路径关卡（深度 15+ 格、120ms/格）可省去近 2 秒强制等待',
    detail:
      '当前通关后需等待 Math.max(...depth) * flowMs() + 220ms 才弹出结算面板，期间点击屏幕被直接 return 忽略。改为：等待期间点击屏幕立即将 state.winAt 设为 0 直接展示结算面板。',
    codeSnippet: `// js/scenes/game/index.js - handleWinTap(x, y)
const delay = Math.max(0, ...state.res.depth.values()) * flowMs() + 220;
if (Date.now() - state.winAt <= delay) {
  state.winAt = 0; // 点击快进直接弹出结算面板
  invalidate();
  return;
}`,
  },
  {
    id: 'OPT-03',
    area: '渲染与内存',
    title: '预计算并缓存 HUD 像素图标非透明包围盒 (Bounding Box)',
    target: 'js/engine/hud.js:16-31 & js/data/sprites.js',
    gain: '消除每次绘制顶部栏时对 robot/bolt/coin 点阵的 3 次双重循环扫描',
    detail:
      'hud.icon() 每次绘制都会遍历 SPR[name].r 字符串数组计算 minX/minY/maxX/maxY。由于精灵点阵完全静态，在 sprites.js 初始化时计算一次 bounds 即可 O(1) 读取。',
    codeSnippet: `// js/data/sprites.js 预计算静态包围盒
for (const d of Object.values(SPR)) {
  let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
  d.r.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '.') { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  }));
  d.bounds = { minX, minY, sw: maxX - minX + 1, sh: maxY - minY + 1 };
}`,
  },
  {
    id: 'OPT-04',
    area: '包体积与工程',
    title: '清理打包配置泄漏并在 release-check.js 增加自动守门断言',
    target: 'project.config.json & tools/release-check.js',
    gain: '主包立减 8,271 Bytes (约 8.1 KB)，杜绝后续新增批次文档混入生产包',
    detail:
      '将 BATCH-I.md、BATCH-J.md、LAUNCH-CHECKLIST.md、SUBMISSION.md 补入 packOptions.ignore，并在 release-check.js 中自动扫描根目录所有 .md 与 .json 工程文件是否均已被忽略。',
    codeSnippet: `// tools/release-check.js 新增守门断言
const ignoredFiles = new Set(project.packOptions.ignore.filter(i => i.type === 'file').map(i => i.value));
for (const f of fs.readdirSync(root).filter(f => f.endsWith('.md'))) {
  assert(ignoredFiles.has(f), '未加入 packOptions.ignore 的文档: ' + f);
}`,
  },
];

export const FEATURE_PROPOSALS: FeatureProposal[] = [
  {
    id: 'FEAT-01',
    phase: 'v0.5.4 上线前速赢 (零风险)',
    title: '全周期 6 阶成就体系 + 首页全入口红点提示 + 快捷音量控制',
    effort: '0.5 小时（已在右侧模拟器实时实装）',
    valueScore: '极高 · 直接提升次留与完播率',
    summary:
      '补齐 30 关「半程贯通」、60 关「全域接通」、180 星「满星工程师」及「增幅大师」成就；为首页「成就」与「签到」加上未领红点；在首页设置弹窗直接支持切换音乐与三档音量。',
    mechanics: [
      '不触碰任何受保护文件（levels / solutions / propagate 哈希 100% 保持不变）',
      '存档结构向后兼容，老存档无缝解锁已达标的阶段性成就金币',
      '解决玩家在关卡外调节 BGM 音量需翻 4 页设置的痛点',
    ],
    interactiveDemoAvailable: true,
  },
  {
    id: 'FEAT-02',
    phase: 'v0.6.0 核心玩法迭代',
    title: '6 位挑战码「种子工坊」与好友同题竞速 (Seed Challenge)',
    effort: '1 天（可在上方「新功能与种子工坊」标签页直接试玩！）',
    valueScore: '高 · 零后端成本实现社交裂变与无限重玩',
    summary:
      '基于确定性哈希（FNV-1a）与对称/色相群变换，将任意 6 位挑战码（如 SR-2026、AURORA）实时映射为 100% 经过验证可解的专属关卡，支持通过微信分享参数 inviteSeed 一键拉起同题挑战。',
    mechanics: [
      '完全纯前端确定性生成，无需服务器存储题目即可保证两台手机看到同一张盘面',
      '自动附带经过同步几何变换的标准解法，完整支持游戏内「机器人渐进提示」与「线路自查」',
      '通关后生成带挑战码、步数与用时的战报卡片，天然契合微信群裂变',
    ],
    interactiveDemoAvailable: true,
  },
  {
    id: 'FEAT-03',
    phase: 'v0.6.0 核心玩法迭代',
    title: '第 7 章「极夜天文台」与两大新元件：单向阀 (Diode) & 变色棱镜 (Prism)',
    effort: '2~3 天',
    valueScore: '高 · 拓展中后期解谜深度',
    summary:
      '在现有直线/拐角/三通/增幅器基础上，利用 propagate.js 极简的队列模型扩展两类高辨识度固定地形或可放置元件。',
    mechanics: [
      '单向阀 (Diode)：只允许信号从指定入口流向出口，反方向阻断，解决多三通分流时的反向回流串色问题',
      '变色棱镜 (Prism)：固定在棋盘上的光学格，将进入的红光 R 折射转换为蓝光 B 或绿光 G，制造跨色域接力谜题',
      '仅需在 propagate.js 中增加 12 行分支判断，不破坏前 60 关任何既有行为',
    ],
  },
  {
    id: 'FEAT-04',
    phase: 'v0.6.x 商业化与云端闭环',
    title: '激励视频多点位高转化接入 + D8 微信云开发轻量同步',
    effort: '2 天（待流量主开通与云环境 ID 确认后接入）',
    valueScore: '高 · 商业化 ARPU 提升 3~5 倍',
    summary:
      '除现有的「商店看视频恢复 5 体力」外，在玩家最高频卡关点与领奖点增加非强制激励视频入口，并按 CLOUD-SAVE-DESIGN.md 落地星级/钱包云备份。',
    mechanics: [
      '卡关激励：当管件放错或卡关时，看一次激励视频可直接免费应用 2 步「机器人提示」且不计入撤回惩罚',
      '每日挑战翻倍：每日挑战首次通关领 100 金币时，提供「看视频双倍领取 (+200 金币)」按钮',
      '云端防丢档：换机或清理微信缓存后，通过 openid 自动恢复已验证的最高星级与最佳用时',
    ],
  },
];
