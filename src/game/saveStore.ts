import { CAMPAIGN_LEVELS, CONFIG, RawLevel } from '../wx-data/gameData';
import { VolumeTier } from './juiceEngine';

export interface RunSnapshot {
  levelId: string;
  board: ({ t: 's' | 'c' | 't' | 'a'; k: number } | null)[][];
  inv: { s: number; c: number; t: number; a: number };
  undoUsed: number;
  elapsedSec: number;
  updatedAt: number;
}

export interface RefactoredSaveState {
  version: number;
  coins: number;
  energy: number;
  energyUpdatedAt: number;
  stars: Record<string, number>;
  bestSec: Record<string, number>;
  activeRun: string | null;
  runs: Record<string, RunSnapshot>;
  signDay: string;
  dailyCompletedDay: string;
  achClaimed: Record<string, boolean>;
  favorites: string[];
  threeStarStreak: number;
  stat: { clear: number; par: number; amp: number };
  settings: {
    sound: boolean;
    music: boolean;
    volumeTier: VolumeTier;
    highContrast: boolean;
    reduceMotion: boolean;
    flowMs: 30 | 60 | 120;
  };
}

export interface VictorySnapshot {
  levelId: string;
  levelTitle: string;
  stars: number;
  clearSec: number;
  bestSec: number;
  usedPipes: number;
  parPipes: number;
  rewardCoins: number;
  baseRewardCoins: number;
  streakBonusCoins: number;
  threeStarStreak: number;
  streakMaster: boolean;
  goals: { ok: boolean; text: string }[];
}

export const STREAK_MASTER_TARGET = 3;
export const STREAK_MASTER_BONUS_COINS = 50;

export interface StreakEvaluationResult {
  threeStarStreak: number;
  streakMaster: boolean;
  streakBonusCoins: number;
  totalRewardCoins: number;
}

/**
 * Calculates the optimal target clear time (in seconds) for a level based on its par pipe count.
 */
export function getLevelOptimalTimeSec(lv: Pick<RawLevel, 'par'>): number {
  return Math.max(3, lv.par * 3);
}

/**
 * Calculates the player's clear-time efficiency percentage relative to the level's optimal clear time.
 * Returns 0 if the level has not been completed yet, or an integer in [1, 100] when bestSec > 0.
 */
export function getLevelTimeEfficiencyPct(
  lv: Pick<RawLevel, 'par'>,
  bestSec?: number,
): number {
  if (typeof bestSec !== 'number' || !Number.isFinite(bestSec) || bestSec <= 0) {
    return 0;
  }
  const optimalSec = getLevelOptimalTimeSec(lv);
  const rawPct = Math.round((optimalSec / bestSec) * 100);
  return Math.max(1, Math.min(100, rawPct));
}

/**
 * Evaluates whether the player has achieved a 3-star rating across 3 consecutive levels,
 * awarding the "连胜大师" (Win Streak Master) badge and +50 bonus coins.
 */
export function evaluateThreeStarStreak(
  earnedStars: number,
  prevStreak: number,
  baseRewardCoins: number,
  mode: 'campaign' | 'daily' | 'seed',
  levelId: string,
  prevStarsMap: Record<string, number>,
): StreakEvaluationResult {
  if (earnedStars < 3) {
    return {
      threeStarStreak: 0,
      streakMaster: false,
      streakBonusCoins: 0,
      totalRewardCoins: baseRewardCoins,
    };
  }

  const runStreak = Math.max(1, (prevStreak || 0) + 1);
  let campaignContiguous = 0;

  if (mode === 'campaign') {
    const idx = CAMPAIGN_LEVELS.findIndex((l) => l.id === levelId);
    if (idx >= 0) {
      const nextStarsMap: Record<string, number> = {
        ...prevStarsMap,
        [levelId]: Math.max(prevStarsMap[levelId] || 0, earnedStars),
      };
      let left = idx;
      while (
        left - 1 >= 0 &&
        (nextStarsMap[CAMPAIGN_LEVELS[left - 1].id] || 0) >= 3
      ) {
        left--;
      }
      let right = idx;
      while (
        right + 1 < CAMPAIGN_LEVELS.length &&
        (nextStarsMap[CAMPAIGN_LEVELS[right + 1].id] || 0) >= 3
      ) {
        right++;
      }
      campaignContiguous = right - left + 1;
    }
  }

  const threeStarStreak = Math.max(runStreak, campaignContiguous);
  const streakMaster = threeStarStreak >= STREAK_MASTER_TARGET;
  const streakBonusCoins = streakMaster ? STREAK_MASTER_BONUS_COINS : 0;

  return {
    threeStarStreak,
    streakMaster,
    streakBonusCoins,
    totalRewardCoins: baseRewardCoins + streakBonusCoins,
  };
}

export interface LevelDifficultyMeta {
  tier: '简单' | '标准' | '挑战' | '大师';
  hasAmplifier: boolean;
  varietyCount: number;
  score: number;
  colorClass: string;
}

export function getLevelDifficultyMeta(lv: RawLevel): LevelDifficultyMeta {
  const sCount = lv.inv.s || 0;
  const cCount = lv.inv.c || 0;
  const tCount = lv.inv.t || 0;
  const aCount = lv.inv.a || 0;
  const hasAmplifier = aCount > 0;
  const varietyCount = [sCount, cCount, tCount, aCount].filter((n) => n > 0).length;

  // Dynamic score combining par step count and pipe complexity (tee splitters & range amplifiers)
  const score =
    lv.par +
    varietyCount * 1.4 +
    (tCount > 0 ? 2.5 + tCount * 0.8 : 0) +
    (hasAmplifier ? 4.5 + aCount * 1.2 : 0) +
    (typeof lv.range === 'number' ? 1.5 : 0);

  let tier: '简单' | '标准' | '挑战' | '大师';
  let colorClass: string;

  if (score <= 6.5) {
    tier = '简单';
    colorClass = 'border-emerald-500/40 bg-emerald-950/60 text-emerald-300';
  } else if (score <= 10.5) {
    tier = '标准';
    colorClass = 'border-cyan-500/40 bg-cyan-950/60 text-cyan-300';
  } else if (score <= 14.5) {
    tier = '挑战';
    colorClass = 'border-amber-400/55 bg-amber-950/65 text-amber-300';
  } else {
    tier = '大师';
    colorClass = 'border-rose-400/65 bg-rose-950/70 text-rose-300';
  }

  return {
    tier,
    hasAmplifier,
    varietyCount,
    score: Math.round(score * 10) / 10,
    colorClass,
  };
}

export type LevelSortMode = 'default' | 'difficulty' | 'fastest';

/**
 * Sorts a slice of levels by:
 * - 'default': original campaign order
 * - 'difficulty': difficulty index score descending (hardest / amplifier levels first)
 * - 'fastest': completed levels sorted by fastest clear time (bestSec ascending), followed by uncompleted levels
 */
export function sortLevelsForDisplay(
  levels: RawLevel[],
  sortBy: LevelSortMode,
  bestSecMap: Record<string, number>,
): RawLevel[] {
  const indexed = levels.map((lv, idx) => ({ lv, idx }));
  if (sortBy === 'default') {
    return indexed.map((item) => item.lv);
  }
  if (sortBy === 'difficulty') {
    indexed.sort((a, b) => {
      const diff =
        getLevelDifficultyMeta(b.lv).score - getLevelDifficultyMeta(a.lv).score;
      return diff !== 0 ? diff : a.idx - b.idx;
    });
    return indexed.map((item) => item.lv);
  }
  if (sortBy === 'fastest') {
    indexed.sort((a, b) => {
      const ta = bestSecMap[a.lv.id];
      const tb = bestSecMap[b.lv.id];
      const hasA = typeof ta === 'number' && Number.isFinite(ta) && ta > 0;
      const hasB = typeof tb === 'number' && Number.isFinite(tb) && tb > 0;
      if (hasA && hasB) {
        return ta !== tb ? ta - tb : a.idx - b.idx;
      }
      if (hasA) return -1;
      if (hasB) return 1;
      return a.idx - b.idx;
    });
    return indexed.map((item) => item.lv);
  }
  return indexed.map((item) => item.lv);
}

export interface StreakCountdownHint {
  headline: string;
  detail: string;
  nextBonusCoins: number;
  progressPct: number;
}

/**
 * Builds the temporary Win Streak Countdown prompt displayed above the VictorySnapshot modal.
 */
export function getNextStreakCountdownHint(
  snap: Pick<VictorySnapshot, 'threeStarStreak' | 'streakMaster' | 'stars'>,
  countdownSec: number,
  maxCountdownSec = 15,
): StreakCountdownHint {
  const clampedSec = Math.max(0, Math.min(maxCountdownSec, countdownSec));
  const progressPct = Math.max(
    6,
    Math.round((clampedSec / Math.max(1, maxCountdownSec)) * 100),
  );
  const nextStreak = snap.threeStarStreak + 1;

  if (snap.streakMaster || snap.threeStarStreak >= STREAK_MASTER_TARGET) {
    return {
      headline: `连胜狂热倒计时 ${clampedSec}s`,
      detail: `下一关再次 3 星通关，达成 ${nextStreak} 连满星将继续获得额外 +${STREAK_MASTER_BONUS_COINS} 金币连胜奖励！`,
      nextBonusCoins: STREAK_MASTER_BONUS_COINS,
      progressPct,
    };
  }

  if (snap.threeStarStreak === STREAK_MASTER_TARGET - 1) {
    return {
      headline: `连胜决胜倒计时 ${clampedSec}s`,
      detail: `已达成 ${snap.threeStarStreak}/${STREAK_MASTER_TARGET} 连满星！下一关再次 3 星通关立即解锁【连胜大师】额外 +${STREAK_MASTER_BONUS_COINS} 金币奖励！`,
      nextBonusCoins: STREAK_MASTER_BONUS_COINS,
      progressPct,
    };
  }

  if (snap.threeStarStreak > 0) {
    const remain = STREAK_MASTER_TARGET - snap.threeStarStreak;
    return {
      headline: `连胜冲刺倒计时 ${clampedSec}s`,
      detail: `当前 ${snap.threeStarStreak}/${STREAK_MASTER_TARGET} 连满星，下一关再次 3 星通关（再赢 ${remain} 关）即可领 +${STREAK_MASTER_BONUS_COINS} 金币连胜奖励！`,
      nextBonusCoins: STREAK_MASTER_BONUS_COINS,
      progressPct,
    };
  }

  return {
    headline: `连胜挑战倒计时 ${clampedSec}s`,
    detail: `下一关若达成 3 星通关将开启满星连胜，连续 ${STREAK_MASTER_TARGET} 关 3 星额外奖励 +${STREAK_MASTER_BONUS_COINS} 金币！`,
    nextBonusCoins: STREAK_MASTER_BONUS_COINS,
    progressPct,
  };
}

const STORAGE_KEY = 'sr_refactored_save_v060';

export function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function createDefaultSave(): RefactoredSaveState {
  return {
    version: 2,
    coins: 200,
    energy: CONFIG.MAXE,
    energyUpdatedAt: Date.now(),
    stars: {},
    bestSec: {},
    activeRun: null,
    runs: {},
    signDay: '',
    dailyCompletedDay: '',
    achClaimed: {},
    favorites: [],
    threeStarStreak: 0,
    stat: { clear: 0, par: 0, amp: 0 },
    settings: {
      sound: true,
      music: false,
      volumeTier: 'mid',
      highContrast: false,
      reduceMotion: false,
      flowMs: 60,
    },
  };
}

export function loadSaveState(): RefactoredSaveState {
  const base = createDefaultSave();
  if (typeof window === 'undefined') return base;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return base;
    return {
      ...base,
      ...parsed,
      stars: parsed.stars && typeof parsed.stars === 'object' ? parsed.stars : {},
      bestSec:
        parsed.bestSec && typeof parsed.bestSec === 'object'
          ? parsed.bestSec
          : {},
      runs: parsed.runs && typeof parsed.runs === 'object' ? parsed.runs : {},
      achClaimed:
        parsed.achClaimed && typeof parsed.achClaimed === 'object'
          ? parsed.achClaimed
          : {},
      favorites: Array.isArray(parsed.favorites)
        ? parsed.favorites.filter((x: unknown) => typeof x === 'string')
        : [],
      threeStarStreak:
        typeof parsed.threeStarStreak === 'number' &&
        Number.isFinite(parsed.threeStarStreak)
          ? Math.max(0, Math.floor(parsed.threeStarStreak))
          : 0,
      stat: { ...base.stat, ...(parsed.stat || {}) },
      settings: { ...base.settings, ...(parsed.settings || {}) },
    };
  } catch {
    return base;
  }
}

export function persistSaveState(state: RefactoredSaveState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

export interface AchievementDef {
  id: string;
  title: string;
  desc: string;
  goal: number;
  reward: number;
  progress: (s: RefactoredSaveState) => number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first',
    title: '初次点亮',
    desc: '完成任意 1 个主线关卡',
    goal: 1,
    reward: 100,
    progress: (s) => Object.keys(s.stars).length,
  },
  {
    id: 'ten',
    title: '接力达人',
    desc: '累计接通 10 个主线关卡',
    goal: 10,
    reward: 300,
    progress: (s) => Object.keys(s.stars).length,
  },
  {
    id: 'thirty',
    title: '半程贯通',
    desc: '累计接通 30 个主线关卡',
    goal: 30,
    reward: 400,
    progress: (s) => Object.keys(s.stars).length,
  },
  {
    id: 'allclear',
    title: '全域接通',
    desc: '通关全部 60 个主线关卡',
    goal: 60,
    reward: 600,
    progress: (s) => Object.keys(s.stars).length,
  },
  {
    id: 'stars30',
    title: '星光收藏家',
    desc: '累计获得 30 颗主线星章',
    goal: 30,
    reward: 300,
    progress: (s) => Object.values(s.stars).reduce((a, b) => a + b, 0),
  },
  {
    id: 'stars180',
    title: '满星工程师',
    desc: '集齐全部 180 颗主线星章',
    goal: 180,
    reward: 800,
    progress: (s) => Object.values(s.stars).reduce((a, b) => a + b, 0),
  },
];

export function isLevelUnlocked(
  levelIndex: number,
  stars: Record<string, number>,
): boolean {
  if (levelIndex <= 0) return true;
  const prev = CAMPAIGN_LEVELS[levelIndex - 1];
  return !!(prev && (stars[prev.id] || 0) > 0);
}

export function findNextRecommendedLevelIndex(
  stars: Record<string, number>,
  activeRun: string | null,
): number {
  if (activeRun) {
    const idx = CAMPAIGN_LEVELS.findIndex((l) => l.id === activeRun);
    if (idx >= 0) return idx;
  }
  const firstUncleared = CAMPAIGN_LEVELS.findIndex(
    (l) => !(stars[l.id] && stars[l.id] > 0),
  );
  return firstUncleared >= 0 ? firstUncleared : 0;
}

export function getChapterSummary(stars: Record<string, number>) {
  return CONFIG.CHAPTERS.map((name, chIdx) => {
    const slice = CAMPAIGN_LEVELS.slice(chIdx * 10, chIdx * 10 + 10);
    const cleared = slice.filter((l) => (stars[l.id] || 0) > 0).length;
    const totalStars = slice.reduce((acc, l) => acc + (stars[l.id] || 0), 0);
    const unlocked =
      chIdx === 0 ||
      (stars[CAMPAIGN_LEVELS[chIdx * 10 - 1].id] || 0) > 0;
    return {
      index: chIdx,
      name,
      cleared,
      totalStars,
      unlocked,
      restored: cleared === 10,
    };
  });
}

export interface LevelDetailSummary {
  levelId: string;
  chapterIndex: number;
  chapterName: string;
  difficulty: LevelDifficultyMeta;
  difficultyDesc: string;
  pipeTags: { key: 's' | 'c' | 't' | 'a'; label: string; count: number }[];
  chapterStats: {
    chapterName: string;
    clearedCount: number;
    totalLevels: number;
    clearedPct: number;
    earnedStars: number;
    maxStars: number;
    perfectThreeStarCount: number;
    avgClearSec: number | null;
  };
}

/**
 * Computes the detailed difficulty description ("难度描述") and chapter completion
 * statistics ("本章通关统计") for a selected level in the Level Select right-side detail panel.
 */
export function getLevelDetailSummary(
  lv: RawLevel,
  starsMap: Record<string, number>,
  bestSecMap: Record<string, number>,
): LevelDetailSummary {
  const absIdx = CAMPAIGN_LEVELS.findIndex((item) => item.id === lv.id);
  const chapterIndex = absIdx >= 0 ? Math.floor(absIdx / 10) : 0;
  const chapterName = CONFIG.CHAPTERS[chapterIndex] || '主线区域';
  const difficulty = getLevelDifficultyMeta(lv);

  const pipeTags: { key: 's' | 'c' | 't' | 'a'; label: string; count: number }[] = [
    { key: 's', label: '直线波导', count: lv.inv.s || 0 },
    { key: 'c', label: '弯折波导', count: lv.inv.c || 0 },
    { key: 't', label: '三通分流', count: lv.inv.t || 0 },
    { key: 'a', label: '信号增幅', count: lv.inv.a || 0 },
  ];

  const activePipeSummary = pipeTags
    .filter((p) => p.count > 0)
    .map((p) => `${p.label}×${p.count}`)
    .join(' · ');

  let mechanicNote =
    '专注基础波导回路铺设，规划无冗余的最短导通路径即可达成 3 星评价。';
  if (difficulty.hasAmplifier && (lv.inv.t || 0) > 0) {
    mechanicNote = `高危复合拓扑：含信号距离衰减限制（步程 ${lv.range ?? 4} 格）与多路分流终端，需在分叉前精准部署增幅器中继。`;
  } else if (difficulty.hasAmplifier) {
    mechanicNote = `包含信号衰减机制（步程上限 ${lv.range ?? 4} 格），需在信号耗尽前串联【信号增幅器】恢复满额传输强度。`;
  } else if ((lv.inv.t || 0) > 0) {
    mechanicNote =
      '包含三通分流节点，需同时统筹多路接收塔的相位走向，避免单侧断路。';
  }

  const difficultyDesc = `评级【${difficulty.tier}】（难度指数 ${difficulty.score} · 标准步数 ${lv.par} 步 · 最优目标 ${getLevelOptimalTimeSec(lv)}s）。配给元件：${activePipeSummary || '基础波导'}。${mechanicNote}`;

  const chapterSlice = CAMPAIGN_LEVELS.slice(
    chapterIndex * 10,
    chapterIndex * 10 + 10,
  );
  const totalLevels = chapterSlice.length || 10;
  const clearedCount = chapterSlice.filter(
    (item) => (starsMap[item.id] || 0) > 0,
  ).length;
  const earnedStars = chapterSlice.reduce(
    (sum, item) => sum + (starsMap[item.id] || 0),
    0,
  );
  const perfectThreeStarCount = chapterSlice.filter(
    (item) => (starsMap[item.id] || 0) >= 3,
  ).length;
  const clearedTimes = chapterSlice
    .map((item) => bestSecMap[item.id])
    .filter((sec): sec is number => typeof sec === 'number' && sec > 0);
  const avgClearSec =
    clearedTimes.length > 0
      ? Math.round(
          (clearedTimes.reduce((a, b) => a + b, 0) / clearedTimes.length) * 10,
        ) / 10
      : null;

  return {
    levelId: lv.id,
    chapterIndex,
    chapterName,
    difficulty,
    difficultyDesc,
    pipeTags,
    chapterStats: {
      chapterName,
      clearedCount,
      totalLevels,
      clearedPct: Math.round((clearedCount / totalLevels) * 100),
      earnedStars,
      maxStars: totalLevels * 3,
      perfectThreeStarCount,
      avgClearSec,
    },
  };
}

export interface OfflineSyncStatus {
  isOffline: boolean;
  syncState: 'offline_unsynced' | 'online_synced';
  shortBadgeText: string;
  topBarWarningText: string;
  detailTooltip: string;
}

/**
 * Pure helper computing lightweight offline status indicator copy for the Top Bar
 * and Achievements drawer when the player is offline vs online.
 */
export function getOfflineSyncStatus(
  isOffline: boolean,
  claimedAchievementCount = 0,
): OfflineSyncStatus {
  if (isOffline) {
    return {
      isOffline: true,
      syncState: 'offline_unsynced',
      shortBadgeText: '离线 · 成就未同步',
      topBarWarningText: '离线状态：无法同步成就数据',
      detailTooltip: `当前处于离线状态，无法同步成就数据（本机已记录 ${claimedAchievementCount} 项成就，恢复网络后自动同步）。`,
    };
  }
  return {
    isOffline: false,
    syncState: 'online_synced',
    shortBadgeText: '在线已同步',
    topBarWarningText: '成就云端已同步',
    detailTooltip: `网络正常 · 成就与过关进度已实时同步（已解锁 ${claimedAchievementCount} 项成就）。`,
  };
}


