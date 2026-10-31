import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip,
  Legend,
} from 'recharts';
import {
  CAMPAIGN_LEVELS,
  CAMPAIGN_SOLUTIONS,
  DAILY_LEVELS,
  DAILY_SOLUTIONS,
  CONFIG,
  SPRITES,
  RawLevel,
  SolutionStep,
} from './wx-data/gameData';
import {
  parseLevel,
  propagate,
  portsOf,
  DV,
  diagnose,
  checkRoute,
  nextHint,
  applyHint,
  generateSeedLevel,
  BoardPiece,
  PieceKind,
  PropagationResult,
} from './game/propagateEngine';
import {
  ParticlePool,
  soundFX,
  VOLUME_TIERS,
  VolumeTier,
  getPipePlacementSoundProfile,
  PipePlacementSoundProfile,
  triggerCellHaptic,
  CellHapticProfile,
  SpatialAudioProfile,
} from './game/juiceEngine';
import {
  loadSaveState,
  persistSaveState,
  getTodayKey,
  ACHIEVEMENTS,
  findNextRecommendedLevelIndex,
  getChapterSummary,
  getLevelDifficultyMeta,
  getLevelOptimalTimeSec,
  getLevelTimeEfficiencyPct,
  evaluateThreeStarStreak,
  sortLevelsForDisplay,
  getNextStreakCountdownHint,
  getLevelDetailSummary,
  getOfflineSyncStatus,
  LevelSortMode,
  VictorySnapshot,
  RefactoredSaveState,
} from './game/saveStore';

type GameShellState = 'title' | 'playing' | 'paused' | 'gameover';
type SubDrawer = null | 'levels' | 'seed' | 'achievements';

const PIECE_META: Record<
  PieceKind,
  { key: string; name: string; role: string }
> = {
  s: { key: '1', name: '直线管', role: '横竖直通' },
  c: { key: '2', name: '拐角管', role: '90°转向' },
  t: { key: '3', name: '三通管', role: '一分二路' },
  a: { key: '4', name: '增幅器', role: '恢复射程' },
};

const COLOR_MARKS: Record<string, string> = {
  red: 'R',
  blue: 'B',
  green: 'G',
  yellow: 'Y',
};

function PixelSprite({
  name,
  className = 'h-3.5 w-3.5 shrink-0',
}: {
  name: keyof typeof SPRITES;
  className?: string;
}) {
  const sprite = SPRITES[name] || SPRITES.star;
  const rows = sprite.r.length;
  const cols = sprite.r[0]?.length || 8;
  return (
    <svg
      viewBox={`0 0 ${cols} ${rows}`}
      shapeRendering="crispEdges"
      className={`pixel-art ${className}`}
      aria-hidden="true"
    >
      {sprite.r.map((rowStr, y) =>
        [...rowStr].map((ch, x) => {
          if (ch === '.' || !sprite.p[ch]) return null;
          return (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width={1}
              height={1}
              fill={sprite.p[ch]}
            />
          );
        }),
      )}
    </svg>
  );
}

function PipeSvgIcon({ kind, active }: { kind: PieceKind; active: boolean }) {
  const outer = '#090c16';
  const rail = active ? '#2b3656' : '#3e4d73';
  const trench = '#121829';
  const core = active ? '#ef4b5c' : '#73eff7';
  const hub = active ? '#ffcd75' : '#cbd5e1';
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7 shrink-0"
      aria-hidden="true"
    >
      {kind === 's' && (
        <>
          <rect x="1.5" y="6.5" width="21" height="11" rx="1.5" fill={outer} />
          <rect x="2" y="7.5" width="20" height="9" fill={rail} />
          <rect x="2" y="9" width="20" height="6" fill={trench} />
          <rect x="2" y="10.6" width="20" height="2.8" fill={core} />
          <rect x="2" y="11.4" width="20" height="1.2" fill="#ffffff" fillOpacity="0.75" />
          <rect x="2.5" y="6.5" width="2.2" height="11" fill={hub} />
          <rect x="19.3" y="6.5" width="2.2" height="11" fill={hub} />
          <circle cx="12" cy="12" r="2.6" fill={outer} stroke={hub} strokeWidth="1.2" />
          <circle cx="12" cy="12" r="1.2" fill={core} />
        </>
      )}
      {kind === 'c' && (
        <>
          <rect x="1.5" y="6.5" width="16" height="11" rx="1.5" fill={outer} />
          <rect x="6.5" y="1.5" width="11" height="16" rx="1.5" fill={outer} />
          <rect x="2" y="7.5" width="14.5" height="9" fill={rail} />
          <rect x="7.5" y="2" width="9" height="14.5" fill={rail} />
          <rect x="2" y="9" width="13" height="6" fill={trench} />
          <rect x="9" y="2" width="6" height="13" fill={trench} />
          <path d="M2 12 H12 V2" fill="none" stroke={core} strokeWidth="2.8" strokeLinejoin="round" />
          <path d="M2 12 H12 V2" fill="none" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="1" strokeLinejoin="round" />
          <rect x="2.5" y="6.5" width="2" height="11" fill={hub} />
          <rect x="6.5" y="2.5" width="11" height="2" fill={hub} />
          <rect x="9" y="9" width="6" height="6" rx="1.2" fill={outer} stroke={hub} strokeWidth="1.2" />
          <circle cx="12" cy="12" r="1.4" fill={core} />
        </>
      )}
      {kind === 't' && (
        <>
          <rect x="1.5" y="6.5" width="16" height="11" rx="1.5" fill={outer} />
          <rect x="6.5" y="1.5" width="11" height="21" rx="1.5" fill={outer} />
          <rect x="2" y="7.5" width="14.5" height="9" fill={rail} />
          <rect x="7.5" y="2" width="9" height="20" fill={rail} />
          <rect x="2" y="9" width="13" height="6" fill={trench} />
          <rect x="9" y="2" width="6" height="20" fill={trench} />
          <path d="M2 12 H12 M12 2 V22" fill="none" stroke={core} strokeWidth="2.8" />
          <path d="M2 12 H12 M12 2 V22" fill="none" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="1" />
          <circle cx="12" cy="12" r="3" fill={outer} stroke={hub} strokeWidth="1.2" />
          <circle cx="12" cy="12" r="1.4" fill={core} />
        </>
      )}
      {kind === 'a' && (
        <>
          <rect x="1.5" y="6.5" width="21" height="11" rx="1.5" fill={outer} />
          <rect x="2" y="7.5" width="20" height="9" fill={rail} />
          <rect x="2" y="10.6" width="20" height="2.8" fill="#ffcd75" />
          <polygon
            points="12,3.5 18.5,12 12,20.5 5.5,12"
            fill="#141a2e"
            stroke="#ffcd75"
            strokeWidth="1.6"
          />
          <path d="M12 8.2 V15.8 M8.2 12 H15.8" stroke="#ffcd75" strokeWidth="2" />
        </>
      )}
    </svg>
  );
}

export default function App() {
  // Check ?autostart=1, ?drawer=..., ?demo=1, ?inspect=..., ?win=1, ?offline=1, and ?filter=favorites query params
  const urlParams = useMemo(() => {
    if (typeof window === 'undefined') {
      return {
        autostart: false,
        drawer: null as SubDrawer,
        demo: false,
        win: false,
        offline: false,
        inspect: null as string | null,
        level: null as string | null,
        filter: 'all' as 'all' | 'favorites',
      };
    }
    const params = new URLSearchParams(window.location.search);
    const d = params.get('drawer');
    const drawer: SubDrawer =
      d === 'levels' || d === 'seed' || d === 'achievements' ? d : null;
    const filter: 'all' | 'favorites' =
      params.get('filter') === 'favorites' ? 'favorites' : 'all';
    const win = params.get('win') === '1';
    const offline = params.get('offline') === '1';
    const inspect = params.get('inspect');
    const level = params.get('level');
    return {
      autostart: params.get('autostart') === '1' || drawer !== null || win || Boolean(level),
      drawer,
      demo: params.get('demo') === '1',
      win,
      offline,
      inspect,
      level,
      filter,
    };
  }, []);

  const [save, setSave] = useState<RefactoredSaveState>(() => {
    const base = loadSaveState();
    if (urlParams.demo && Object.keys(base.stars).length === 0) {
      return {
        ...base,
        stars: {
          '1-1': 3,
          '1-2': 3,
          '1-3': 2,
          '1-4': 3,
          '2-1': 3,
          '3-1': 3,
          '4-1': 2,
          '5-1': 3,
        },
        bestSec: {
          '1-1': 9,
          '1-2': 12,
          '1-3': 20,
          '1-4': 15,
          '2-1': 30,
          '3-1': 24,
          '4-1': 32,
          '5-1': 69,
        },
        favorites: ['1-2', '1-4', '4-1', '5-1'],
        threeStarStreak: 2,
        stat: { clear: 8, par: 7, amp: 2 },
      };
    }
    return base;
  });
  const [shellState, setShellState] = useState<GameShellState>(() =>
    urlParams.win ? 'gameover' : urlParams.autostart ? 'playing' : 'title',
  );
  const [subDrawer, setSubDrawer] = useState<SubDrawer>(() => urlParams.drawer);

  // Active level selection state
  const [campaignIdx, setCampaignIdx] = useState<number>(() => {
    if (urlParams.level) {
      const foundIdx = CAMPAIGN_LEVELS.findIndex((lv) => lv.id === urlParams.level);
      if (foundIdx >= 0) return foundIdx;
    }
    return urlParams.demo && !urlParams.drawer
      ? 0
      : findNextRecommendedLevelIndex(save.stars, save.activeRun);
  });
  const [mode, setMode] = useState<'campaign' | 'daily' | 'seed'>('campaign');
  const [seedCodeInput, setSeedCodeInput] = useState<string>('SR-2026');
  const [activeSeedCode, setActiveSeedCode] = useState<string>('SR-2026');
  const [selectedChapter, setSelectedChapter] = useState<number>(0);
  const [levelFilter, setLevelFilter] = useState<'all' | 'favorites'>(
    () => urlParams.filter,
  );
  const [levelSortBy, setLevelSortBy] = useState<LevelSortMode>('default');
  const [inspectedLevelId, setInspectedLevelId] = useState<string | null>(
    () => urlParams.inspect,
  );
  const [streakCountdownSec, setStreakCountdownSec] = useState<number>(15);
  const [rollingRewardCoins, setRollingRewardCoins] = useState<number>(0);
  const [rollingBonusCoins, setRollingBonusCoins] = useState<number>(0);
  const [isCoinRolling, setIsCoinRolling] = useState<boolean>(false);
  const [achTab, setAchTab] = useState<'ach' | 'radar'>('ach');
  const [burstingLevel, setBurstingLevel] = useState<{
    id: string;
    key: number;
  } | null>(null);
  const perfectSelectTimerRef = useRef<number | null>(null);

  // Lightweight Offline Status Detection State & Last Placed Pipe Sound Profile
  const [isOffline, setIsOffline] = useState<boolean>(() => {
    if (urlParams.offline) return true;
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return !navigator.onLine;
    }
    return false;
  });
  const [lastPlacedSound, setLastPlacedSound] =
    useState<PipePlacementSoundProfile | null>(null);
  const [lastHaptic, setLastHaptic] = useState<CellHapticProfile | null>(null);
  const [lastSpatialAudio, setLastSpatialAudio] =
    useState<SpatialAudioProfile | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => {
      if (!urlParams.offline) setIsOffline(false);
    };
    const handleOffline = () => {
      setIsOffline(true);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [urlParams.offline]);

  const toggleFavoriteLevel = useCallback((levelId: string) => {
    setSave((prev) => {
      const exists = prev.favorites.includes(levelId);
      const nextFavs = exists
        ? prev.favorites.filter((id) => id !== levelId)
        : [...prev.favorites, levelId];
      return {
        ...prev,
        favorites: nextFavs,
      };
    });
    soundFX.play('rotate');
  }, []);

  // Compute current level & reference solution
  const dailyData = useMemo(() => {
    const today = getTodayKey();
    let h = 2166136261;
    for (let i = 0; i < today.length; i++) {
      h ^= today.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    const lv = DAILY_LEVELS[h % DAILY_LEVELS.length];
    return { day: today, level: lv, solution: DAILY_SOLUTIONS[lv.id] };
  }, []);

  const seedData = useMemo(
    () => generateSeedLevel(activeSeedCode),
    [activeSeedCode],
  );

  const activeLevel: RawLevel =
    mode === 'daily'
      ? dailyData.level
      : mode === 'seed'
        ? seedData.level
        : CAMPAIGN_LEVELS[campaignIdx] || CAMPAIGN_LEVELS[0];

  const activeSolution: SolutionStep[] | undefined =
    mode === 'daily'
      ? dailyData.solution
      : mode === 'seed'
        ? seedData.solution
        : CAMPAIGN_SOLUTIONS[activeLevel.id];

  const parsed = useMemo(() => parseLevel(activeLevel), [activeLevel]);

  // Board & gameplay state
  const [board, setBoard] = useState<(BoardPiece | null)[][]>(() => {
    const empty = parsed.fix.map((r) => r.map(() => null as BoardPiece | null));
    if (urlParams.autostart && urlParams.demo && !urlParams.drawer) {
      if (empty[1] && empty[1].length > 2) {
        empty[1][1] = { t: 's', k: 1 };
        empty[1][2] = { t: 's', k: 1 };
      }
      if (empty[0] && empty[0].length > 2) {
        empty[0][2] = { t: 's', k: 0 };
      }
    }
    return empty;
  });
  const [inv, setInv] = useState<Record<PieceKind, number>>(() => ({
    ...activeLevel.inv,
  }));
  const [sel, setSel] = useState<PieceKind>('s');
  const [removeMode, setRemoveMode] = useState<boolean>(false);
  const [hist, setHist] = useState<
    { r: number; c: number; p: BoardPiece | null; inv: Record<PieceKind, number> }[]
  >([]);
  const [undoUsed, setUndoUsed] = useState<number>(0);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [checkCells, setCheckCells] = useState<string[]>([]);
  const [hintStep, setHintStep] = useState<{
    r: number;
    c: number;
    stage: 0 | 1;
    raw: ReturnType<typeof nextHint>;
  } | null>(null);
  const [victorySnap, setVictorySnap] = useState<VictorySnapshot | null>(null);
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  // Refs for 60Hz Canvas simulation loop decoupling
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlePoolRef = useRef<ParticlePool>(new ParticlePool());
  const spriteCacheRef = useRef<Record<string, HTMLCanvasElement>>({});
  const boardGeometryRef = useRef({ bx: 0, by: 0, cs: 48, u: 3, R: 5, C: 5 });
  const pointerPosRef = useRef({ x: 0.5, y: 0.5 });
  const hoverCellRef = useRef<{ r: number; c: number } | null>(null);
  const activeAnimCellRef = useRef<{
    r: number;
    c: number;
    kind: 'pop' | 'rotate';
    pipeType: PieceKind;
    startedAt: number;
  } | null>(null);
  const flowStartedAtRef = useRef<number>(Date.now());
  const traumaRef = useRef<number>(0);
  const hitstopRef = useRef<number>(0);
  const playStartTimestampRef = useRef<number | null>(null);
  const accumulatedMsRef = useRef<number>(0);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef<boolean>(false);
  const prevReachedCountRef = useRef<number>(0);

  // Mirror shellState to document.body.dataset.state
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.dataset.state = shellState;
    }
  }, [shellState]);

  // Temporary Win Streak Countdown timer & Coin Settlement number-rolling effect on VictorySnapshot ('gameover') modal
  useEffect(() => {
    if (shellState !== 'gameover' || !victorySnap) return;
    setStreakCountdownSec(15);
    const id = window.setInterval(() => {
      setStreakCountdownSec((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    const targetReward = victorySnap.rewardCoins;
    const targetBonus = victorySnap.streakBonusCoins;
    if (save.settings.reduceMotion || targetReward <= 0) {
      setRollingRewardCoins(targetReward);
      setRollingBonusCoins(targetBonus);
      setIsCoinRolling(false);
      return () => window.clearInterval(id);
    }

    setRollingRewardCoins(0);
    setRollingBonusCoins(0);
    setIsCoinRolling(true);
    const durationMs = 680;
    const startTs = performance.now();
    let rafId = 0;

    const step = (now: number) => {
      const elapsed = Math.max(0, now - startTs);
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setRollingRewardCoins(Math.round(targetReward * eased));
      setRollingBonusCoins(Math.round(targetBonus * eased));
      if (t < 1) {
        rafId = window.requestAnimationFrame(step);
      } else {
        setRollingRewardCoins(targetReward);
        setRollingBonusCoins(targetBonus);
        setIsCoinRolling(false);
      }
    };
    rafId = window.requestAnimationFrame(step);

    return () => {
      window.clearInterval(id);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [shellState, victorySnap, save.settings.reduceMotion]);

  // Persist save changes
  useEffect(() => {
    persistSaveState(save);
  }, [save]);

  // Configure sound engine
  useEffect(() => {
    soundFX.configure({
      sound: save.settings.sound,
      music: save.settings.music,
      volumeTier: save.settings.volumeTier,
    });
  }, [save.settings.sound, save.settings.music, save.settings.volumeTier]);

  // Safe board guaranteed to match current parsed dimensions
  const safeBoard: (BoardPiece | null)[][] = useMemo(() => {
    if (
      board.length === parsed.R &&
      (board[0]?.length ?? 0) === parsed.C
    ) {
      return board;
    }
    return parsed.fix.map((r) => r.map(() => null));
  }, [board, parsed]);

  const propResult: PropagationResult = useMemo(
    () =>
      propagate(
        parsed.R,
        parsed.C,
        parsed.fix,
        safeBoard,
        activeLevel.range === undefined ? null : activeLevel.range,
      ),
    [parsed, safeBoard, activeLevel.range],
  );

  const usedPipes = useMemo(
    () => safeBoard.flat().filter(Boolean).length,
    [safeBoard],
  );

  const starGoals = useMemo(() => {
    const totalStarsCells = parsed.fix
      .flat()
      .filter((f) => f && f.k === 'star').length;
    const collectedStars = [...propResult.lit.keys()].filter((k) => {
      const [r, c] = k.split(',').map(Number);
      return parsed.fix[r]?.[c]?.k === 'star';
    }).length;
    return [
      { ok: propResult.win, text: '接通全部同色接收端' },
      {
        ok: usedPipes <= activeLevel.par,
        text: `管件不超过 ${activeLevel.par} 个 (当前 ${usedPipes})`,
      },
      {
        ok: totalStarsCells ? collectedStars === totalStarsCells : undoUsed === 0,
        text: totalStarsCells
          ? `点亮全部星点 (${collectedStars}/${totalStarsCells})`
          : `零撤回通关 (已撤回 ${undoUsed} 次)`,
      },
    ];
  }, [parsed.fix, propResult, usedPipes, activeLevel.par, undoUsed]);

  // Initialize / reset level state
  const initLevel = useCallback(
    (targetLevel: RawLevel, targetMode: 'campaign' | 'daily' | 'seed') => {
      const p = parseLevel(targetLevel);
      const nextB = p.fix.map((r) => r.map(() => null as BoardPiece | null));
      const nextI = { ...targetLevel.inv };
      if (
        urlParams.autostart &&
        urlParams.demo &&
        !urlParams.drawer &&
        targetLevel.id === '1-1'
      ) {
        if (nextB[1] && nextB[1].length > 2 && nextI.s >= 2) {
          nextB[1][1] = { t: 's', k: 0 };
          nextB[1][2] = { t: 's', k: 0 };
          nextI.s -= 2;
        }
        if (nextB[0] && nextB[0].length > 2 && nextI.s >= 1) {
          nextB[0][2] = { t: 's', k: 0 };
          nextI.s -= 1;
        }
      }
      setBoard(nextB);
      setInv(nextI);
      const firstAvailable = (['s', 'c', 't', 'a'] as PieceKind[]).find(
        (k) => nextI[k] > 0,
      );
      setSel(firstAvailable || 's');
      setRemoveMode(false);
      setHist([]);
      setUndoUsed(0);
      setSelectedColor(null);
      setCheckCells([]);
      setHintStep(null);
      if (urlParams.win) {
        setVictorySnap({
          levelId: targetLevel.id,
          levelTitle: `第 ${targetLevel.id} 关 · 初识信号`,
          stars: 3,
          clearSec: 6,
          bestSec: 6,
          usedPipes: targetLevel.par,
          parPipes: targetLevel.par,
          baseRewardCoins: 50,
          streakBonusCoins: 50,
          rewardCoins: 100,
          threeStarStreak: 3,
          streakMaster: true,
          goals: [
            { ok: true, text: '接通全部同色接收端' },
            { ok: true, text: `管件不超过 ${targetLevel.par} 个` },
            { ok: true, text: '零撤回通关' },
          ],
        });
      } else {
        setVictorySnap(null);
      }
      setElapsedSec(0);
      playStartTimestampRef.current = null;
      accumulatedMsRef.current = 0;
      prevReachedCountRef.current = 0;
      flowStartedAtRef.current = Date.now();
      particlePoolRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    initLevel(activeLevel, mode);
  }, [activeLevel, mode, initLevel]);

  // Gameplay elapsed timer
  useEffect(() => {
    if (shellState !== 'playing') return;
    const timer = window.setInterval(() => {
      if (playStartTimestampRef.current !== null) {
        const totalMs =
          accumulatedMsRef.current +
          (Date.now() - playStartTimestampRef.current);
        setElapsedSec(Math.floor(totalMs / 1000));
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [shellState]);

  const startGameplay = useCallback(() => {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setSubDrawer(null);
    setShellState('playing');
    canvasRef.current?.focus();
  }, []);

  const pauseGameplay = useCallback(() => {
    if (shellState !== 'playing') return;
    if (playStartTimestampRef.current !== null) {
      accumulatedMsRef.current += Date.now() - playStartTimestampRef.current;
      playStartTimestampRef.current = null;
    }
    soundFX.pauseMusicForModal();
    setShellState('paused');
  }, [shellState]);

  const resumeGameplay = useCallback(() => {
    if (shellState !== 'paused') return;
    if (accumulatedMsRef.current > 0 && playStartTimestampRef.current === null) {
      playStartTimestampRef.current = Date.now();
    }
    soundFX.resumeMusicFromModal();
    setSubDrawer(null);
    setShellState('playing');
    canvasRef.current?.focus();
  }, [shellState]);

  // Evaluate board after any move and trigger juice / victory
  const evaluateBoardAfterMove = useCallback(
    (
      nextBoard: (BoardPiece | null)[][],
      nextUndo: number,
      cellR?: number,
      cellC?: number,
    ) => {
      flowStartedAtRef.current = Date.now();
      const res = propagate(
        parsed.R,
        parsed.C,
        parsed.fix,
        nextBoard,
        activeLevel.range === undefined ? null : activeLevel.range,
      );

      const geom = boardGeometryRef.current;
      if (cellR !== undefined && cellC !== undefined) {
        const cx = geom.bx + (cellC + 0.5) * geom.cs;
        const cy = geom.by + (cellR + 0.5) * geom.cs;
        const litColor = res.lit.get(`${cellR},${cellC}`);
        const hex = litColor
          ? CONFIG.COLORS[litColor]
          : '#ffcd75';
        particlePoolRef.current.spawnBurst(cx, cy, hex, 7, 35, 110, 3.2);
      }

      if (res.reached.size > prevReachedCountRef.current) {
        hitstopRef.current = 0.04;
        // Burst on newly reached target(s)
        for (const key of res.reached) {
          const [tr, tc] = key.split(',').map(Number);
          const cx = geom.bx + (tc + 0.5) * geom.cs;
          const cy = geom.by + (tr + 0.5) * geom.cs;
          const col = res.lit.get(key);
          particlePoolRef.current.spawnBurst(
            cx,
            cy,
            col ? CONFIG.COLORS[col] : '#a7f070',
            18,
            50,
            165,
            4,
          );
        }
      }
      prevReachedCountRef.current = res.reached.size;

      if (res.bad.size > 0) {
        traumaRef.current = Math.min(1, traumaRef.current + 0.35);
        soundFX.play('conflict');
        return;
      }

      if (res.win) {
        hitstopRef.current = 0.07;
        traumaRef.current = 0.25;
        soundFX.play('win');

        const used = nextBoard.flat().filter(Boolean).length;
        let totalStarCells = 0;
        let litStarCells = 0;
        parsed.fix.forEach((row, r) =>
          row.forEach((f, c) => {
            if (f && f.k === 'star') {
              totalStarCells++;
              if (res.lit.has(`${r},${c}`)) litStarCells++;
            }
          }),
        );
        const ok2 = used <= activeLevel.par;
        const ok3 = totalStarCells
          ? litStarCells === totalStarCells
          : nextUndo === 0;
        const earnedStars = 1 + (ok2 ? 1 : 0) + (ok3 ? 1 : 0);

        const totalMs =
          accumulatedMsRef.current +
          (playStartTimestampRef.current !== null
            ? Date.now() - playStartTimestampRef.current
            : 1000);
        const clearSec = Math.max(1, Math.round(totalMs / 1000));
        playStartTimestampRef.current = null;

        const prevStars = save.stars[activeLevel.id] || 0;
        const baseRewardCoins =
          mode === 'daily'
            ? save.dailyCompletedDay === dailyData.day
              ? 0
              : 100
            : mode === 'seed'
              ? 50
              : prevStars === 0
                ? 200
                : earnedStars > prevStars
                  ? 50
                  : 0;

        const streakEval = evaluateThreeStarStreak(
          earnedStars,
          save.threeStarStreak,
          baseRewardCoins,
          mode,
          activeLevel.id,
          save.stars,
        );
        const rewardCoins = streakEval.totalRewardCoins;

        const prevBest = save.bestSec[activeLevel.id];
        const nextBest = prevBest ? Math.min(prevBest, clearSec) : clearSec;

        const usedAmplifier = nextBoard.some((row) =>
          row.some((cell) => cell && cell.t === 'a'),
        );

        setSave((prev) => ({
          ...prev,
          coins: prev.coins + rewardCoins,
          threeStarStreak: streakEval.threeStarStreak,
          dailyCompletedDay:
            mode === 'daily' ? dailyData.day : prev.dailyCompletedDay,
          stars:
            mode === 'campaign'
              ? {
                  ...prev.stars,
                  [activeLevel.id]: Math.max(prevStars, earnedStars),
                }
              : prev.stars,
          bestSec: {
            ...prev.bestSec,
            [activeLevel.id]: nextBest,
          },
          activeRun:
            mode === 'campaign' && campaignIdx + 1 < CAMPAIGN_LEVELS.length
              ? CAMPAIGN_LEVELS[campaignIdx + 1].id
              : prev.activeRun,
          stat: {
            clear: prev.stat.clear + 1,
            par: prev.stat.par + (ok2 ? 1 : 0),
            amp: prev.stat.amp + (usedAmplifier ? 1 : 0),
          },
        }));

        const levelTitle =
          mode === 'seed'
            ? `种子挑战 ${activeSeedCode}`
            : mode === 'daily'
              ? `每日挑战 ${dailyData.day}`
              : `第 ${activeLevel.id} 关 · ${CONFIG.CHAPTERS[Math.floor(campaignIdx / 10)] || ''}`;

        setVictorySnap({
          levelId: activeLevel.id,
          levelTitle,
          stars: earnedStars,
          clearSec,
          bestSec: nextBest,
          usedPipes: used,
          parPipes: activeLevel.par,
          rewardCoins,
          baseRewardCoins,
          streakBonusCoins: streakEval.streakBonusCoins,
          threeStarStreak: streakEval.threeStarStreak,
          streakMaster: streakEval.streakMaster,
          goals: [
            { ok: true, text: '接通全部同色接收端' },
            {
              ok: ok2,
              text: `管件不超过 ${activeLevel.par} 个 (实际使用 ${used} 个)`,
            },
            {
              ok: ok3,
              text: totalStarCells
                ? `点亮全部星点 (${litStarCells}/${totalStarCells})`
                : `零撤回通关 (本局撤回 ${nextUndo} 次)`,
            },
          ],
        });
        setShellState('gameover');
        return;
      }
    },
    [
      parsed,
      activeLevel,
      save.stars,
      save.dailyCompletedDay,
      save.bestSec,
      mode,
      dailyData.day,
      campaignIdx,
      activeSeedCode,
    ],
  );

  // Cell interaction handler
  const interactWithCell = useCallback(
    (r: number, c: number, isRemoveAction: boolean) => {
      if (shellState !== 'playing') return;
      if (playStartTimestampRef.current === null) {
        playStartTimestampRef.current = Date.now();
      }

      const f = parsed.fix[r]?.[c];
      const pc = safeBoard[r]?.[c];
      const spatialInput = {
        col: c,
        totalCols: parsed.C,
        row: r,
        totalRows: parsed.R,
      };

      const syncFeedbackDataset = (
        hapticProfile: CellHapticProfile,
        spatialProfile: SpatialAudioProfile,
        soundProfile?: PipePlacementSoundProfile,
      ) => {
        setLastHaptic(hapticProfile);
        setLastSpatialAudio(spatialProfile);
        if (soundProfile) {
          setLastPlacedSound(soundProfile);
        }
        if (typeof document !== 'undefined') {
          const rootEl = document.querySelector('[data-active-tool]');
          if (rootEl) {
            rootEl.setAttribute('data-last-haptic-action', hapticProfile.action);
            rootEl.setAttribute('data-last-haptic-wx-type', hapticProfile.wxType);
            rootEl.setAttribute('data-last-haptic-duration', String(hapticProfile.durationMs));
            rootEl.setAttribute('data-last-audio-pan', String(spatialProfile.pan));
            rootEl.setAttribute('data-last-audio-bias', spatialProfile.channelBias);
            rootEl.setAttribute('data-last-audio-col', String(spatialProfile.col));
            rootEl.setAttribute('data-last-audio-total-cols', String(spatialProfile.totalCols));
            if (soundProfile) {
              rootEl.setAttribute('data-last-placed-pipe', soundProfile.pipeType);
              rootEl.setAttribute('data-last-sound-category', soundProfile.category);
            }
          }
        }
      };

      if (f && f.k !== 'star') {
        if (f.k === 'src' || f.k === 'tgt') {
          setSelectedColor((prev) => (prev === f.col ? null : f.col || null));
        }
        return;
      }

      if (isRemoveAction || removeMode) {
        if (!pc) return;
        setHist((prev) => [
          ...prev.slice(-49),
          { r, c, p: { ...pc }, inv: { ...inv } },
        ]);
        const nextBoard = safeBoard.map((row, ri) =>
          row.map((cell, ci) => (ri === r && ci === c ? null : cell)),
        );
        const nextInv = { ...inv, [pc.t]: inv[pc.t] + 1 };
        setBoard(nextBoard);
        setInv(nextInv);
        setSel((cur) => (nextInv[cur] > 0 ? cur : pc.t));
        setHintStep(null);
        setCheckCells([]);
        // WeChat Mini-Game wx.vibrateShort haptic feedback: heavy + medium release pulse (62ms) for pipe removal
        const hapticProfile = triggerCellHaptic('remove', pc.t);
        // Web Audio API spatial stereo panning based on cell column (c / parsed.C)
        const spatialProfile = soundFX.play('remove', pc.t, spatialInput);
        syncFeedbackDataset(hapticProfile, spatialProfile);
        evaluateBoardAfterMove(nextBoard, undoUsed, r, c);
        return;
      }

      if (pc) {
        setHist((prev) => [
          ...prev.slice(-49),
          { r, c, p: { ...pc }, inv: { ...inv } },
        ]);
        const nextBoard = safeBoard.map((row, ri) =>
          row.map((cell, ci) =>
            ri === r && ci === c && cell
              ? { ...cell, k: (cell.k + 1) % 4 }
              : cell,
          ),
        );
        activeAnimCellRef.current = {
          r,
          c,
          kind: 'rotate',
          pipeType: pc.t,
          startedAt: Date.now(),
        };
        setBoard(nextBoard);
        setHintStep(null);
        setCheckCells([]);
        // WeChat Mini-Game wx.vibrateShort haptic feedback: crisp light tick (12ms) for pipe rotation
        const hapticProfile = triggerCellHaptic('rotate', pc.t);
        // Web Audio API spatial stereo panning based on cell column (c / parsed.C)
        const spatialProfile = soundFX.play('rotate', pc.t, spatialInput);
        syncFeedbackDataset(hapticProfile, spatialProfile);
        evaluateBoardAfterMove(nextBoard, undoUsed, r, c);
        return;
      }

      if (!sel || inv[sel] <= 0) {
        soundFX.play('conflict', 's', spatialInput);
        return;
      }

      const placedKind: PieceKind = sel;
      const soundProfile = getPipePlacementSoundProfile(placedKind);

      setHist((prev) => [
        ...prev.slice(-49),
        { r, c, p: null, inv: { ...inv } },
      ]);
      const nextBoard = safeBoard.map((row, ri) =>
        row.map((cell, ci) =>
          ri === r && ci === c ? { t: placedKind, k: 0 } : cell,
        ),
      );
      const nextInv = { ...inv, [placedKind]: inv[placedKind] - 1 };
      activeAnimCellRef.current = {
        r,
        c,
        kind: 'pop',
        pipeType: placedKind,
        startedAt: Date.now(),
      };
      setBoard(nextBoard);
      setInv(nextInv);
      if (nextInv[placedKind] === 0) {
        const nextTool = (['s', 'c', 't', 'a'] as PieceKind[]).find(
          (k) => nextInv[k] > 0,
        );
        if (nextTool) setSel(nextTool);
      }
      setHintStep(null);
      setCheckCells([]);
      // WeChat Mini-Game wx.vibrateShort haptic feedback: medium snap (28ms, or 44ms resonant pulse for amplifier 'a')
      const hapticProfile = triggerCellHaptic('place', placedKind);
      // Play distinct placement sound effect with Web Audio API StereoPannerNode spatial panning
      const spatialProfile = soundFX.play('place', placedKind, spatialInput);
      syncFeedbackDataset(hapticProfile, spatialProfile, soundProfile);
      if (placedKind === 'a') {
        const geom = boardGeometryRef.current;
        const cx = geom.bx + (c + 0.5) * geom.cs;
        const cy = geom.by + (r + 0.5) * geom.cs;
        particlePoolRef.current.spawnBurst(cx, cy, '#ffcd75', 14, 48, 138, 3.8);
      }
      evaluateBoardAfterMove(nextBoard, undoUsed, r, c);
    },
    [shellState, parsed.fix, parsed.C, parsed.R, safeBoard, inv, sel, removeMode, undoUsed, evaluateBoardAfterMove],
  );

  // Undo, Reset, Hint, Route Check, Auto-Solve handlers
  const handleUndo = useCallback(() => {
    if (shellState !== 'playing' || hist.length === 0) {
      return;
    }
    const last = hist[hist.length - 1];
    const nextBoard = safeBoard.map((row, ri) =>
      row.map((cell, ci) => (ri === last.r && ci === last.c ? last.p : cell)),
    );
    const nextUndo = undoUsed + 1;
    setBoard(nextBoard);
    setInv(last.inv);
    setHist((prev) => prev.slice(0, -1));
    setUndoUsed(nextUndo);
    setHintStep(null);
    setCheckCells([]);
    soundFX.play('remove');
    evaluateBoardAfterMove(nextBoard, nextUndo, last.r, last.c);
  }, [shellState, hist, safeBoard, undoUsed, evaluateBoardAfterMove]);

  const handleReset = useCallback(() => {
    initLevel(activeLevel, mode);
    if (shellState !== 'playing') {
      setShellState('playing');
    }
    soundFX.play('remove');
  }, [activeLevel, mode, initLevel, shellState]);

  const handleRouteCheck = useCallback(() => {
    if (shellState !== 'playing') return;
    const res = checkRoute(propResult, parsed.fix);
    setCheckCells(res.cells);
    soundFX.play('rotate');
  }, [shellState, propResult, parsed.fix]);

  const handleProgressiveHint = useCallback(() => {
    if (shellState !== 'playing') return;
    const h = nextHint(activeLevel, safeBoard, activeSolution);
    if (!h) {
      return;
    }
    if (!hintStep || hintStep.r !== h.r || hintStep.c !== h.c) {
      setHintStep({ r: h.r, c: h.c, stage: 0, raw: h });
      soundFX.play('rotate');
      return;
    }
    // Second tap on Hint applies the step directly
    if (playStartTimestampRef.current === null) {
      playStartTimestampRef.current = Date.now();
    }
    const nextBoard = safeBoard.map((row) =>
      row.map((cell) => (cell ? { ...cell } : null)),
    );
    const nextInv = { ...inv };
    setHist((prev) => [
      ...prev.slice(-49),
      {
        r: h.r,
        c: h.c,
        p: safeBoard[h.r]?.[h.c] ? { ...safeBoard[h.r][h.c]! } : null,
        inv: { ...inv },
      },
    ]);
    if (applyHint(nextBoard, nextInv, h)) {
      setBoard(nextBoard);
      setInv(nextInv);
      setHintStep(null);
      setLastPlacedSound(getPipePlacementSoundProfile(h.piece.t));
      soundFX.play('place', h.piece.t);
      evaluateBoardAfterMove(nextBoard, undoUsed, h.r, h.c);
    }
  }, [
    shellState,
    activeLevel,
    safeBoard,
    activeSolution,
    hintStep,
    inv,
    undoUsed,
    evaluateBoardAfterMove,
  ]);

  const handleAutoSolve = useCallback(() => {
    if (!activeSolution) return;
    if (playStartTimestampRef.current === null) {
      playStartTimestampRef.current = Date.now() - 5000;
    }
    const nextBoard: (BoardPiece | null)[][] = parsed.fix.map((r) =>
      r.map(() => null),
    );
    const nextInv = { ...activeLevel.inv };
    activeSolution.forEach(([r, c, t, k]) => {
      if (nextBoard[r]) {
        nextBoard[r][c] = { t, k };
        if (nextInv[t] > 0) nextInv[t]--;
      }
    });
    setBoard(nextBoard);
    setInv(nextInv);
    setHintStep(null);
    setCheckCells([]);
    evaluateBoardAfterMove(nextBoard, 0);
  }, [activeSolution, parsed.fix, activeLevel.inv, evaluateBoardAfterMove]);

  const handleNextLevel = useCallback(() => {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (mode === 'campaign' && campaignIdx + 1 < CAMPAIGN_LEVELS.length) {
      setCampaignIdx((idx) => idx + 1);
      setShellState('playing');
    } else if (mode === 'seed') {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let nextCode = 'SR-';
      for (let i = 0; i < 4; i++) {
        nextCode += chars[Math.floor(Math.random() * chars.length)];
      }
      setSeedCodeInput(nextCode);
      setActiveSeedCode(nextCode);
      setShellState('playing');
    } else {
      initLevel(activeLevel, mode);
      setShellState('playing');
    }
  }, [mode, campaignIdx, activeLevel, initLevel]);

  // Global keyboard shortcuts (Title Enter/Space, Playing 1-4, Z, X, H, R, P/Esc, M)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (shellState === 'title') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          startGameplay();
        }
        return;
      }

      if (shellState === 'gameover') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleNextLevel();
        }
        return;
      }

      if (e.key === 'Escape' || e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (subDrawer) {
          setSubDrawer(null);
        } else if (shellState === 'playing') {
          pauseGameplay();
        } else if (shellState === 'paused') {
          resumeGameplay();
        }
        return;
      }

      if (shellState !== 'playing' || subDrawer) return;

      const k = e.key.toLowerCase();
      if (k === '1' && inv.s > 0) setSel('s');
      else if (k === '2' && inv.c > 0) setSel('c');
      else if (k === '3' && inv.t > 0) setSel('t');
      else if (k === '4' && inv.a > 0) setSel('a');
      else if (k === 'z') handleUndo();
      else if (k === 'x') handleRouteCheck();
      else if (k === 'h') handleProgressiveHint();
      else if (k === 'r') handleReset();
      else if (k === 'm') {
        setSave((prev) => ({
          ...prev,
          settings: { ...prev.settings, sound: !prev.settings.sound },
        }));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    shellState,
    subDrawer,
    inv,
    startGameplay,
    handleNextLevel,
    pauseGameplay,
    resumeGameplay,
    handleUndo,
    handleRouteCheck,
    handleProgressiveHint,
    handleReset,
  ]);

  // Bake pixel sprite helper
  const bakeSprite = useCallback((name: string, u: number, dim = false) => {
    const key = `${name}_${u}_${dim ? 'd' : 'n'}`;
    if (spriteCacheRef.current[key]) return spriteCacheRef.current[key];
    const d = SPRITES[name] || SPRITES.star;
    const off = document.createElement('canvas');
    off.width = d.r[0].length * u;
    off.height = d.r.length * u;
    const g = off.getContext('2d')!;
    d.r.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        g.fillStyle =
          dim && name === 'star'
            ? '#566c86'
            : dim && name === 'starPoint'
              ? '#b8a071'
              : d.p[ch];
        g.fillRect(x * u, y * u, u, u);
      }),
    );
    spriteCacheRef.current[key] = off;
    return off;
  }, []);

  // Energized showcase board for Title Screen so the circuit glows live
  const titleShowcase = useMemo(() => {
    const b: (BoardPiece | null)[][] = parsed.fix.map((r) =>
      r.map(() => null as BoardPiece | null),
    );
    if (activeSolution) {
      activeSolution.forEach(([r, c, t, k]) => {
        if (b[r]) b[r][c] = { t, k };
      });
    }
    const p = propagate(
      parsed.R,
      parsed.C,
      parsed.fix,
      b,
      activeLevel.range === undefined ? null : activeLevel.range,
    );
    return { board: b, prop: p };
  }, [parsed, activeSolution, activeLevel.range]);

  // Store latest state in ref for 60Hz Canvas rAF loop (never re-mounting canvas)
  const renderStateRef = useRef({
    shellState,
    parsed,
    safeBoard: shellState === 'title' ? titleShowcase.board : safeBoard,
    propResult: shellState === 'title' ? titleShowcase.prop : propResult,
    selectedColor,
    hintStep,
    checkCells,
    settings: save.settings,
  });
  useEffect(() => {
    renderStateRef.current = {
      shellState,
      parsed,
      safeBoard: shellState === 'title' ? titleShowcase.board : safeBoard,
      propResult: shellState === 'title' ? titleShowcase.prop : propResult,
      selectedColor,
      hintStep,
      checkCells,
      settings: save.settings,
    };
  }, [
    shellState,
    parsed,
    safeBoard,
    propResult,
    titleShowcase,
    selectedColor,
    hintStep,
    checkCells,
    save.settings,
  ]);

  // Mount Canvas2D & ResizeObserver + 60Hz rAF loop once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;

    const updateSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
    };
    updateSize();
    window.addEventListener('resize', updateSize);

    let rafId = 0;
    let timerId = 0;
    let lastTime = performance.now();

    const renderFrame = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const dt = Math.min(Math.max(rawDt, 0), 0.05);

      if (hitstopRef.current > 0) {
        hitstopRef.current = Math.max(0, hitstopRef.current - dt);
      } else {
        particlePoolRef.current.update(dt);
      }

      if (traumaRef.current > 0) {
        traumaRef.current = Math.max(0, traumaRef.current - dt * 2.4);
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = canvas.width;
      const H = canvas.height;
      const rs = renderStateRef.current;
      const highContrast = rs.settings.highContrast;

      g.save();
      g.clearRect(0, 0, W, H);

      // Background canvas fill
      if (highContrast) {
        g.fillStyle = '#0e1422';
        g.fillRect(0, 0, W, H);
      } else {
        const grad = g.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#121626');
        grad.addColorStop(1, '#1c2442');
        g.fillStyle = grad;
        g.fillRect(0, 0, W, H);
      }

      // Subtle atmospheric circuit grid lines
      if (!highContrast) {
        g.strokeStyle = 'rgba(148, 176, 194, 0.045)';
        g.lineWidth = 1;
        const gridStep = Math.round(48 * dpr);
        for (let x = 0; x < W; x += gridStep) {
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x, H);
          g.stroke();
        }
        for (let y = 0; y < H; y += gridStep) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(W, y);
          g.stroke();
        }
      }

      // Camera shake offset from trauma * trauma
      const shakeMag = traumaRef.current * traumaRef.current * 8 * dpr;
      if (shakeMag > 0.2) {
        g.translate(
          (Math.random() * 2 - 1) * shakeMag,
          (Math.random() * 2 - 1) * shakeMag,
        );
      }

      // Compute centered board geometry leaving unobstructed viewport on both desktop and mobile
      const isMobileViewport = W / dpr < 640;
      const topSafe = (isMobileViewport ? 62 : 76) * dpr;
      const bottomSafe = (isMobileViewport ? 142 : 114) * dpr;
      const availW = W * (isMobileViewport ? 0.94 : 0.88);
      const availH = Math.max(180 * dpr, H - topSafe - bottomSafe);
      const { R, C, fix } = rs.parsed;
      const maxU = Math.max(3, Math.round((isMobileViewport ? 4.55 : 5.5) * dpr));
      const u = Math.min(
        maxU,
        Math.max(
          2,
          Math.floor(Math.min(availW / (C * 16), availH / (R * 16))),
        ),
      );
      const cs = 16 * u;

      // Apply subtle parallax on Title screen
      const parallaxX =
        rs.shellState === 'title'
          ? (pointerPosRef.current.x - 0.5) * 18 * dpr
          : 0;
      const parallaxY =
        rs.shellState === 'title'
          ? (pointerPosRef.current.y - 0.5) * 14 * dpr
          : 0;

      const bx =
        Math.round((W - C * cs) / 2) +
        (rs.shellState === 'title' && !isMobileViewport
          ? Math.round(W * 0.16 + parallaxX)
          : 0);
      const by =
        rs.shellState === 'title' && isMobileViewport
          ? Math.round(74 * dpr + Math.max(0, (availH * 0.56 - R * cs) / 2))
          : Math.round(topSafe + (availH - R * cs) / 2) + Math.round(parallaxY);

      boardGeometryRef.current = {
        bx: bx / dpr,
        by: by / dpr,
        cs: cs / dpr,
        u: u / dpr,
        R,
        C,
      };
      canvas.dataset.bx = String(Math.round(bx / dpr));
      canvas.dataset.by = String(Math.round(by / dpr));
      canvas.dataset.cs = String(Math.round(cs / dpr));
      canvas.dataset.rows = String(R);
      canvas.dataset.cols = String(C);

      // Precision Fiber-Optic Waveguide Conduit Renderer
      const drawPipe = (
        px: number,
        py: number,
        ports: string[],
        colorHex: string | null,
      ) => {
        const rectMap: Record<
          string,
          (a: number, b: number, w: number) => [number, number, number, number]
        > = {
          U: (a, b, w) => [px + a, py, w, 8 * u + b],
          D: (a, b, w) => [px + a, py + 8 * u - b, w, 8 * u + b],
          L: (a, b, w) => [px, py + a, 8 * u + b, w],
          R: (a, b, w) => [px + 8 * u - b, py + a, 8 * u + b, w],
        };

        // 1. Armored Conduit Casing + Brushed Rail Walls + Recessed Optical Trench
        const baseLayers: [number, number, number, string][] = [
          [4.6, 3.4, 6.8, '#090c16'],
          [5.3, 2.7, 5.4, colorHex ? '#374870' : '#2a3552'],
          [6.1, 1.9, 3.8, '#111626'],
        ];
        baseLayers.forEach(([a, b, w, fill]) => {
          g.fillStyle = fill;
          ports.forEach((d) => {
            const r = rectMap[d](a * u, b * u, w * u);
            g.fillRect(r[0], r[1], r[2], r[3]);
          });
        });

        // 2. Port Collar Flanges at Tile Edges (Precision Waveguide Couplings)
        ports.forEach((d) => {
          g.fillStyle = colorHex ? '#52689c' : '#39476b';
          if (d === 'U') g.fillRect(px + 4.4 * u, py, 7.2 * u, 1.5 * u);
          else if (d === 'D')
            g.fillRect(px + 4.4 * u, py + 14.5 * u, 7.2 * u, 1.5 * u);
          else if (d === 'L') g.fillRect(px, py + 4.4 * u, 1.5 * u, 7.2 * u);
          else if (d === 'R')
            g.fillRect(px + 14.5 * u, py + 4.4 * u, 1.5 * u, 7.2 * u);
        });

        // 3. Waveguide Optical Core (Dormant vs Energized Plasma Filament)
        if (!colorHex) {
          g.fillStyle = '#334155';
          ports.forEach((d) => {
            const r = rectMap[d](7.2 * u, 0.8 * u, 1.6 * u);
            g.fillRect(r[0], r[1], r[2], r[3]);
          });
        } else {
          // Outer optical bloom inside the trench
          g.save();
          g.globalAlpha = 0.35;
          g.fillStyle = colorHex;
          ports.forEach((d) => {
            const r = rectMap[d](6.1 * u, 1.9 * u, 3.8 * u);
            g.fillRect(r[0], r[1], r[2], r[3]);
          });
          g.restore();

          // Saturated signal core
          g.fillStyle = colorHex;
          ports.forEach((d) => {
            const r = rectMap[d](6.7 * u, 1.3 * u, 2.6 * u);
            g.fillRect(r[0], r[1], r[2], r[3]);
          });

          // High-intensity white-hot inner laser filament
          g.fillStyle = 'rgba(255, 255, 255, 0.82)';
          ports.forEach((d) => {
            const r = rectMap[d](7.5 * u, 0.5 * u, 1.0 * u);
            g.fillRect(r[0], r[1], r[2], r[3]);
          });

          // Animated optical pulse packet along each port arm
          if (!rs.settings.reduceMotion) {
            const phase = ((now / 380) % 1);
            g.fillStyle = '#ffffff';
            ports.forEach((d) => {
              const [dy, dx] = DV[d as keyof typeof DV];
              const dist = (1.8 + phase * 5.2) * u;
              const bxPulse = px + 8 * u + dx * dist;
              const byPulse = py + 8 * u + dy * dist;
              g.fillRect(
                bxPulse - 0.9 * u,
                byPulse - 0.9 * u,
                1.8 * u,
                1.8 * u,
              );
            });
          }
        }

        // 4. Center Conduit Coupling Hub
        const cx = px + 8 * u;
        const cy = py + 8 * u;
        g.fillStyle = '#090c16';
        g.fillRect(cx - 3.1 * u, cy - 3.1 * u, 6.2 * u, 6.2 * u);
        g.fillStyle = colorHex ? '#475b8a' : '#2e3b5c';
        g.fillRect(cx - 2.4 * u, cy - 2.4 * u, 4.8 * u, 4.8 * u);
        g.fillStyle = colorHex || '#475569';
        g.fillRect(cx - 1.4 * u, cy - 1.4 * u, 2.8 * u, 2.8 * u);
        if (colorHex) {
          g.fillStyle = '#ffffff';
          g.fillRect(cx - 0.6 * u, cy - 0.6 * u, 1.2 * u, 1.2 * u);
        }

        if (colorHex && highContrast) {
          const kind = Object.keys(CONFIG.COLORS).find(
            (k) => CONFIG.COLORS[k as keyof typeof CONFIG.COLORS] === colorHex,
          );
          g.fillStyle = '#ffffff';
          for (const d of ports) {
            const [dy, dx] = DV[d as keyof typeof DV];
            for (const n of [3, 6]) {
              const tx = px + (8 + dx * n) * u;
              const ty = py + (8 + dy * n) * u;
              if (kind === 'red') g.fillRect(tx - u / 2, ty - u, u, 2 * u);
              else if (kind === 'blue') g.fillRect(tx - u, ty - u / 2, 2 * u, u);
              else if (kind === 'green') {
                g.fillRect(tx - u, ty - u, u, u);
                g.fillRect(tx, ty, u, u);
              } else {
                g.fillRect(tx - u, ty - u, u, u);
                g.fillRect(tx + u / 2, ty - u, u, u);
              }
            }
          }
        }
      };

      // Board casing shadow & frame
      g.fillStyle = '#090b12';
      g.fillRect(
        bx - u * 3,
        by - u * 3 + u * 2,
        C * cs + u * 6,
        R * cs + u * 6,
      );
      g.fillStyle = '#1a1c2c';
      g.fillRect(bx - u * 3, by - u * 3, C * cs + u * 6, R * cs + u * 6);
      g.strokeStyle = '#333c57';
      g.lineWidth = Math.max(1, u * 0.6);
      g.strokeRect(bx - u * 2, by - u * 2, C * cs + u * 4, R * cs + u * 4);

      const flowSpeed = rs.settings.reduceMotion ? 0 : rs.settings.flowMs;
      const flowElapsed = Date.now() - flowStartedAtRef.current;

      for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
          const x = bx + c * cs;
          const y = by + r * cs;
          const f = fix[r]?.[c];
          const pc = rs.safeBoard[r]?.[c];
          const key = `${r},${c}`;
          const cellDepth = rs.propResult.depth.get(key) || 0;
          const isLitNow =
            flowElapsed >= cellDepth * flowSpeed &&
            rs.propResult.lit.get(key);

          // Precision Circuit Board Tile Substrate
          g.fillStyle = (r + c) % 2 ? '#232d45' : '#28334e';
          g.fillRect(x, y, cs, cs);
          g.strokeStyle = 'rgba(9, 12, 22, 0.55)';
          g.lineWidth = 1;
          g.strokeRect(x, y, cs, cs);
          // Subtle corner PCB micro-vias
          g.fillStyle = 'rgba(148, 176, 194, 0.14)';
          g.fillRect(x + 1.2 * u, y + 1.2 * u, 0.8 * u, 0.8 * u);
          g.fillRect(x + 14 * u, y + 14 * u, 0.8 * u, 0.8 * u);

          // Hover highlight
          if (
            rs.shellState === 'playing' &&
            hoverCellRef.current &&
            hoverCellRef.current.r === r &&
            hoverCellRef.current.c === c
          ) {
            g.fillStyle = 'rgba(255, 205, 117, 0.14)';
            g.fillRect(x, y, cs, cs);
          }

          if (f && f.k === 'obs' && f.e) {
            g.imageSmoothingEnabled = false;
            g.drawImage(bakeSprite(f.e, 2), x, y, cs, cs);
          } else if (f && f.k === 'bridge') {
            // Dual-Axis Signal Overpass Deck
            g.fillStyle = '#182034';
            g.fillRect(x, y, cs, cs);
            g.strokeStyle = '#475569';
            g.lineWidth = Math.max(1, 0.6 * u);
            g.strokeRect(x + u, y + u, cs - 2 * u, cs - 2 * u);
            const rawBr = rs.propResult.br.get(key) || {};
            const hDepth = rs.propResult.bridgeDepth.get(key + 'h') || 0;
            const vDepth = rs.propResult.bridgeDepth.get(key + 'v') || 0;
            drawPipe(
              x,
              y,
              ['L', 'R'],
              flowElapsed >= hDepth * flowSpeed && rawBr.h
                ? CONFIG.COLORS[rawBr.h]
                : null,
            );
            // Overpass isolation collar
            g.fillStyle = '#090c16';
            g.fillRect(x + 4.2 * u, y + 4.2 * u, 7.6 * u, 7.6 * u);
            drawPipe(
              x,
              y,
              ['U', 'D'],
              flowElapsed >= vDepth * flowSpeed && rawBr.v
                ? CONFIG.COLORS[rawBr.v]
                : null,
            );
          } else if (f && (f.k === 'src' || f.k === 'tgt') && f.d && f.col) {
            const on = f.k === 'src' || !!isLitNow;
            const colHex = CONFIG.COLORS[f.col];
            const cx = x + 8 * u;
            const cy = y + 8 * u;

            // 1. Outgoing / Incoming Waveguide Nozzle
            drawPipe(x, y, [f.d], on ? colHex : null);

            // 2. Heavy Octagonal / Armored Signal Tower Foundation Pad
            g.fillStyle = '#080b14';
            g.fillRect(x + 1.6 * u, y + 1.6 * u, 12.8 * u, 12.8 * u);
            g.fillStyle = '#192238';
            g.fillRect(x + 2.3 * u, y + 2.3 * u, 11.4 * u, 11.4 * u);
            g.strokeStyle = on ? colHex : '#3b4a6e';
            g.lineWidth = Math.max(1, 0.75 * u);
            g.strokeRect(x + 2.3 * u, y + 2.3 * u, 11.4 * u, 11.4 * u);

            // 4 Corner Stabilizer Pylons on Tower Base
            const pylonOffsets = [
              [2.3, 2.3],
              [11.5, 2.3],
              [2.3, 11.5],
              [11.5, 11.5],
            ];
            pylonOffsets.forEach(([pxOff, pyOff]) => {
              g.fillStyle = '#2d3b5e';
              g.fillRect(x + pxOff * u, y + pyOff * u, 2.2 * u, 2.2 * u);
              g.fillStyle = on ? colHex : '#475569';
              g.fillRect(
                x + (pxOff + 0.6) * u,
                y + (pyOff + 0.6) * u,
                1.0 * u,
                1.0 * u,
              );
            });

            if (f.k === 'src') {
              // ===============================================================
              // TRANSMITTER SIGNAL TOWER (src · 发射信号塔)
              // ===============================================================
              // Animated radiating signal wave ring
              if (!rs.settings.reduceMotion) {
                const wavePhase = (now / 900) % 1;
                g.save();
                g.strokeStyle = colHex;
                g.globalAlpha = (1 - wavePhase) * 0.65;
                g.lineWidth = Math.max(1, 0.7 * u);
                g.beginPath();
                g.arc(cx, cy, (3.2 + wavePhase * 3.8) * u, 0, Math.PI * 2);
                g.stroke();
                g.restore();
              }

              // Diagonal Transceiver Spire Struts
              g.strokeStyle = colHex;
              g.lineWidth = Math.max(1, 0.9 * u);
              g.beginPath();
              g.moveTo(cx - 3.8 * u, cy - 3.8 * u);
              g.lineTo(cx + 3.8 * u, cy + 3.8 * u);
              g.moveTo(cx + 3.8 * u, cy - 3.8 * u);
              g.lineTo(cx - 3.8 * u, cy + 3.8 * u);
              g.stroke();

              // Central Energized Emitter Ring
              g.beginPath();
              g.arc(cx, cy, 4.1 * u, 0, Math.PI * 2);
              g.fillStyle = '#0b0e18';
              g.fill();
              g.lineWidth = Math.max(1.5, 1.15 * u);
              g.strokeStyle = colHex;
              g.stroke();

              // Glowing Core Crystal Disc
              g.beginPath();
              g.arc(cx, cy, 2.7 * u, 0, Math.PI * 2);
              g.fillStyle = colHex;
              g.fill();

              g.beginPath();
              g.arc(cx, cy, 1.9 * u, 0, Math.PI * 2);
              g.fillStyle = '#ffffff';
              g.fill();

              // Color Code Mark Inside Emitter Spire
              g.font = `800 ${Math.max(9, Math.round(3.6 * u))}px "JetBrains Mono", monospace`;
              g.textAlign = 'center';
              g.textBaseline = 'middle';
              g.fillStyle = '#090c16';
              g.fillText(COLOR_MARKS[f.col], cx, cy + 0.2 * u);
            } else {
              // ===============================================================
              // RECEIVER SIGNAL TOWER (tgt · 接收信号塔)
              // ===============================================================
              // Directional intake guidance chevrons on port side
              const [dy, dx] = DV[f.d];
              g.fillStyle = on ? '#ffffff' : colHex;
              for (let step = 0; step < 2; step++) {
                const a = 5.4 + step * 1.2;
                g.fillRect(
                  Math.round(cx + dx * a * u - 0.7 * u),
                  Math.round(cy + dy * a * u - 0.7 * u),
                  1.4 * u,
                  1.4 * u,
                );
              }

              // Outer Radar Receiver Dish Ring
              g.beginPath();
              g.arc(cx, cy, 4.3 * u, 0, Math.PI * 2);
              g.fillStyle = on ? colHex : '#0f1526';
              g.fill();
              g.lineWidth = Math.max(1.5, 1.1 * u);
              g.strokeStyle = on ? '#ffffff' : colHex;
              g.stroke();

              // Cardinal Antenna Fins on Receiver Dish
              g.fillStyle = on ? '#ffffff' : colHex;
              g.fillRect(cx - 0.5 * u, cy - 5.2 * u, 1.0 * u, 1.6 * u);
              g.fillRect(cx - 0.5 * u, cy + 3.6 * u, 1.0 * u, 1.6 * u);
              g.fillRect(cx - 5.2 * u, cy - 0.5 * u, 1.6 * u, 1.0 * u);
              g.fillRect(cx + 3.6 * u, cy - 0.5 * u, 1.6 * u, 1.0 * u);

              // Inner Receiver Chamber
              g.beginPath();
              g.arc(cx, cy, 2.7 * u, 0, Math.PI * 2);
              g.fillStyle = on ? '#ffffff' : '#161f36';
              g.fill();

              // Color Code Mark Inside Receiver Dish
              g.font = `800 ${Math.max(9, Math.round(3.6 * u))}px "JetBrains Mono", monospace`;
              g.textAlign = 'center';
              g.textBaseline = 'middle';
              g.fillStyle = on ? '#090c16' : colHex;
              g.fillText(COLOR_MARKS[f.col], cx, cy + 0.2 * u);
            }

            if (rs.selectedColor === f.col) {
              g.strokeStyle = '#ffffff';
              g.lineWidth = u;
              g.strokeRect(x + u, y + u, 14 * u, 14 * u);
            }
            if (
              rs.propResult.targetIssues.has(key) &&
              !rs.propResult.reached.has(key)
            ) {
              g.strokeStyle = '#ffcd75';
              g.lineWidth = u;
              g.strokeRect(x + 2 * u, y + 2 * u, 12 * u, 12 * u);
            }
          }

          if (f && f.k === 'star') {
            const size = Math.min(
              cs,
              8 * Math.max(1, Math.floor((cs * 0.92) / 8)),
            );
            g.imageSmoothingEnabled = false;
            g.drawImage(
              bakeSprite('starPoint', 1, !isLitNow),
              Math.round(x + (cs - size) / 2),
              Math.round(y + (cs - size) / 2),
              size,
              size,
            );
          }

          if (pc) {
            const anim = activeAnimCellRef.current;
            const isAnimating = anim && anim.r === r && anim.c === c;
            const animAge = isAnimating ? Date.now() - anim.startedAt : 999;
            const duration =
              anim?.kind === 'rotate'
                ? 130
                : anim?.pipeType === 'a'
                  ? 230
                  : 170;

            if (
              isAnimating &&
              animAge < duration &&
              !rs.settings.reduceMotion
            ) {
              const progress = Math.min(1, animAge / duration);
              const scale =
                anim.kind === 'pop' ? 0.35 + 0.65 * progress : 1;
              g.save();
              g.translate(x + cs / 2, y + cs / 2);
              if (anim.kind === 'rotate') {
                g.rotate((-(1 - progress) * Math.PI) / 2);
              }
              g.scale(scale, scale);
              drawPipe(
                -cs / 2,
                -cs / 2,
                portsOf(pc),
                isLitNow ? CONFIG.COLORS[isLitNow] : null,
              );
              g.restore();

              // Tactile placement shockwave ring: distinct golden dual-ring for Amplifier ('a') vs cyan waveguide lock-in ring for standard pipes
              if (anim.kind === 'pop') {
                const cx = x + cs / 2;
                const cy = y + cs / 2;
                g.save();
                g.globalAlpha = Math.max(0, (1 - progress) * 0.85);
                g.strokeStyle =
                  anim.pipeType === 'a'
                    ? '#ffcd75'
                    : anim.pipeType === 't'
                      ? '#73eff7'
                      : '#94b0c2';
                g.lineWidth = Math.max(1.5, (anim.pipeType === 'a' ? 1.35 : 0.9) * u);
                g.beginPath();
                g.arc(
                  cx,
                  cy,
                  (3.2 + progress * (anim.pipeType === 'a' ? 6.4 : 4.6)) * u,
                  0,
                  Math.PI * 2,
                );
                g.stroke();
                if (anim.pipeType === 'a') {
                  g.strokeStyle = '#ffffff';
                  g.globalAlpha = Math.max(0, (1 - progress) * 0.55);
                  g.beginPath();
                  g.arc(cx, cy, (2.0 + progress * 4.2) * u, 0, Math.PI * 2);
                  g.stroke();
                }
                g.restore();
              }
            } else {
              drawPipe(
                x,
                y,
                portsOf(pc),
                isLitNow ? CONFIG.COLORS[isLitNow] : null,
              );
            }

            if (pc.t === 'a') {
              // Diamond Signal Amplifier Core Module
              const cx = x + cs / 2;
              const cy = y + cs / 2;
              g.save();
              g.beginPath();
              g.moveTo(cx, cy - 4.2 * u);
              g.lineTo(cx + 4.2 * u, cy);
              g.lineTo(cx, cy + 4.2 * u);
              g.lineTo(cx - 4.2 * u, cy);
              g.closePath();
              g.fillStyle = '#12182b';
              g.fill();
              g.lineWidth = Math.max(1.5, 0.9 * u);
              g.strokeStyle = '#ffcd75';
              g.stroke();
              g.font = `bold ${Math.round(cs * 0.36)}px "JetBrains Mono", monospace`;
              g.textAlign = 'center';
              g.textBaseline = 'middle';
              g.fillStyle = '#ffcd75';
              g.fillText('+', cx, cy + 0.2 * u);
              g.restore();
            }
          }

          if (rs.hintStep && rs.hintStep.r === r && rs.hintStep.c === c) {
            g.strokeStyle = '#ffcd75';
            g.lineWidth = Math.max(2, 2.5 * dpr);
            g.strokeRect(x + 2 * dpr, y + 2 * dpr, cs - 4 * dpr, cs - 4 * dpr);
          }

          if (rs.propResult.exhausted.has(key)) {
            g.strokeStyle = '#ffcd75';
            g.lineWidth = Math.max(2, 2 * dpr);
            g.strokeRect(x + 2 * dpr, y + 2 * dpr, cs - 4 * dpr, cs - 4 * dpr);
            g.font = `bold ${Math.max(12, 5 * u)}px "Plus Jakarta Sans", sans-serif`;
            g.fillStyle = '#ffcd75';
            g.fillText('!', x + cs - 4 * u, y + 4 * u);
          }

          if (rs.checkCells.includes(key)) {
            g.strokeStyle = '#73eff7';
            g.lineWidth = Math.max(2, 2.5 * dpr);
            g.strokeRect(x + 2 * dpr, y + 2 * dpr, cs - 4 * dpr, cs - 4 * dpr);
          }

          if (rs.propResult.bad.has(key)) {
            g.strokeStyle = '#ef4b5c';
            g.lineWidth = Math.max(2, u);
            g.strokeRect(x + u / 2, y + u / 2, cs - u, cs - u);
          }
        }
      }

      // Draw pooled particles on top of board
      g.save();
      g.scale(dpr, dpr);
      particlePoolRef.current.draw(g);
      g.restore();

      g.restore();
      timerId = window.setTimeout(() => {
        rafId = window.requestAnimationFrame(renderFrame);
      }, 24);
    };

    rafId = window.requestAnimationFrame(renderFrame);
    return () => {
      window.clearTimeout(timerId);
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updateSize);
    };
  }, [bakeSprite]);

  // Convert pointer event to board cell coordinates
  const getCellAtClientXY = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const geom = boardGeometryRef.current;
    const c = Math.floor((x - geom.bx) / geom.cs);
    const r = Math.floor((y - geom.by) / geom.cs);
    if (r >= 0 && c >= 0 && r < geom.R && c < geom.C) {
      return { r, c };
    }
    return null;
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (typeof window !== 'undefined') {
      pointerPosRef.current = {
        x: e.clientX / Math.max(1, window.innerWidth),
        y: e.clientY / Math.max(1, window.innerHeight),
      };
    }
    hoverCellRef.current = getCellAtClientXY(e.clientX, e.clientY);
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (shellState !== 'playing' || subDrawer) return;
    if (e.button === 2) return;
    const cell = getCellAtClientXY(e.clientX, e.clientY);
    if (!cell) return;
    longPressFiredRef.current = false;
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      interactWithCell(cell.r, cell.c, true);
    }, 430);
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (shellState !== 'playing' || subDrawer) return;
    if (e.button === 2) return;
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (longPressFiredRef.current) return;
    const cell = getCellAtClientXY(e.clientX, e.clientY);
    if (cell) {
      interactWithCell(cell.r, cell.c, false);
    }
  };

  const handleCanvasContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (shellState !== 'playing' || subDrawer) return;
    const cell = getCellAtClientXY(e.clientX, e.clientY);
    if (cell) {
      interactWithCell(cell.r, cell.c, true);
    }
  };

  const cycleVolumeTier = () => {
    const order: VolumeTier[] = ['mid', 'high', 'low'];
    const nextTier =
      order[(order.indexOf(save.settings.volumeTier) + 1) % order.length];
    setSave((prev) => ({
      ...prev,
      settings: { ...prev.settings, volumeTier: nextTier, sound: true },
    }));
    soundFX.configure({ volumeTier: nextTier, sound: true });
    soundFX.play('place');
  };

  const chapterSummaries = useMemo(
    () => getChapterSummary(save.stars),
    [save.stars],
  );
  const totalClearedCount = Object.keys(save.stars).length;
  const totalStarsCount = Object.values(save.stars).reduce((a, b) => a + b, 0);
  const hasUnclaimedAch = ACHIEVEMENTS.some(
    (a) => a.progress(save) >= a.goal && !save.achClaimed[a.id],
  );
  const canSignToday = save.signDay !== getTodayKey();

  // Compute Radar Chart metrics across pipe difficulties (s / c / t / a)
  const pipeRadarData = useMemo(() => {
    const configs: {
      kind: PieceKind;
      axisLabel: string;
      shortName: string;
      difficultyTag: string;
      fallbackWinRate: number;
      fallbackAvgSec: number;
    }[] = [
      {
        kind: 's',
        axisLabel: '直线管 (s)',
        shortName: '直线管 s',
        difficultyTag: '基础直通',
        fallbackWinRate: 88,
        fallbackAvgSec: 9,
      },
      {
        kind: 'c',
        axisLabel: '拐角管 (c)',
        shortName: '拐角管 c',
        difficultyTag: '90°转向',
        fallbackWinRate: 76,
        fallbackAvgSec: 14,
      },
      {
        kind: 't',
        axisLabel: '三通管 (t)',
        shortName: '三通管 t',
        difficultyTag: '多路分流',
        fallbackWinRate: 64,
        fallbackAvgSec: 21,
      },
      {
        kind: 'a',
        axisLabel: '增幅器 (a)',
        shortName: '增幅器 a',
        difficultyTag: '射程恢复',
        fallbackWinRate: 58,
        fallbackAvgSec: 25,
      },
    ];

    const hasAnyCleared = Object.keys(save.stars).length > 0;

    return configs.map((cfg) => {
      const levelsWithPipe = CAMPAIGN_LEVELS.filter(
        (lv) => (lv.inv[cfg.kind] || 0) > 0,
      );
      const totalCount = Math.max(1, levelsWithPipe.length);
      const clearedLevels = levelsWithPipe.filter(
        (lv) => (save.stars[lv.id] || 0) > 0,
      );
      const benchmarkSec = Math.round(
        levelsWithPipe.reduce((acc, lv) => acc + lv.par * 2.4, 0) / totalCount,
      );

      let winRate: number;
      let avgSec: number;
      let isSimulated = false;

      if (clearedLevels.length > 0) {
        const earnedOnPipe = clearedLevels.reduce(
          (acc, lv) => acc + (save.stars[lv.id] || 0),
          0,
        );
        const starRate = earnedOnPipe / (clearedLevels.length * 3);
        const progressRate =
          clearedLevels.length /
          Math.max(clearedLevels.length + 1, Math.min(totalCount, 10));
        winRate = Math.min(
          98,
          Math.max(42, Math.round((starRate * 0.68 + progressRate * 0.32) * 100)),
        );
        const totalSec = clearedLevels.reduce(
          (acc, lv) => acc + (save.bestSec[lv.id] || Math.round(lv.par * 2.1)),
          0,
        );
        avgSec = Math.max(1, Math.round(totalSec / clearedLevels.length));
      } else if (hasAnyCleared) {
        isSimulated = true;
        winRate = Math.max(38, Math.round(cfg.fallbackWinRate * 0.72));
        avgSec = cfg.fallbackAvgSec;
      } else {
        isSimulated = true;
        winRate = cfg.fallbackWinRate;
        avgSec = cfg.fallbackAvgSec;
      }

      // Normalize average clear time onto 0-100 radar scale (higher = faster efficiency, while preserving raw avgSec)
      const timeIndex = Math.min(
        100,
        Math.max(20, Math.round((benchmarkSec / Math.max(4, avgSec)) * 72)),
      );

      return {
        kind: cfg.kind,
        axisLabel: cfg.axisLabel,
        shortName: cfg.shortName,
        difficultyTag: cfg.difficultyTag,
        totalLevels: levelsWithPipe.length,
        clearedLevels: clearedLevels.length,
        winRate,
        avgSec,
        benchmarkSec,
        timeIndex,
        isSimulated,
      };
    });
  }, [save.stars, save.bestSec]);

  const claimedAchCount = Object.keys(save.achClaimed).length;
  const offlineSyncMeta = useMemo(
    () => getOfflineSyncStatus(isOffline, claimedAchCount),
    [isOffline, claimedAchCount],
  );

  return (
    <div
      data-active-tool={sel}
      data-offline-state={isOffline ? 'offline' : 'online'}
      data-last-placed-pipe={lastPlacedSound?.pipeType || ''}
      data-last-sound-category={lastPlacedSound?.category || ''}
      data-last-haptic-action={lastHaptic?.action || ''}
      data-last-haptic-wx-type={lastHaptic?.wxType || ''}
      data-last-haptic-duration={lastHaptic?.durationMs ?? ''}
      data-last-audio-pan={lastSpatialAudio?.pan ?? ''}
      data-last-audio-bias={lastSpatialAudio?.channelBias || ''}
      data-last-audio-col={lastSpatialAudio?.col ?? ''}
      data-last-audio-total-cols={lastSpatialAudio?.totalCols ?? ''}
      className="relative h-screen w-screen overflow-hidden no-scrollbar select-none bg-[#121626] text-[#f4f4f4]"
    >
      {/* Isolated Full-Viewport Canvas2D Stage */}
      <canvas
        ref={canvasRef}
        tabIndex={0}
        data-testid="game-canvas"
        aria-label="信号接力游戏棋盘"
        onPointerMove={handleCanvasPointerMove}
        onPointerDown={handleCanvasPointerDown}
        onPointerUp={handleCanvasPointerUp}
        onContextMenu={handleCanvasContextMenu}
        className="fixed inset-0 block h-full w-full cursor-pointer outline-none"
      />

      {/* ================================================================= */}
      {/* STATE 1: TITLE SCREEN ('title') - WeChat Mini Game Launch Screen  */}
      {/* ================================================================= */}
      {shellState === 'title' && (
        <div
          className="fixed inset-0 z-20 flex flex-col justify-between p-3.5 sm:p-8 md:p-12 pointer-events-none overflow-hidden no-scrollbar"
          style={{
            background:
              'linear-gradient(180deg, rgba(11,12,21,0.32) 0%, rgba(11,12,21,0.72) 44%, rgba(11,12,21,0.94) 100%)',
          }}
        >
          {/* WeChat Mini Game Native Top Bar: Progress Pill + Offline Status Indicator + Top-Right Capsule */}
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-1.5 pointer-events-auto">
            <div className="flex items-center justify-between gap-2 font-mono text-xs text-slate-200 tabular-nums">
              <div className="inline-flex h-9 items-center gap-2 rounded-xl border-2 border-[#0b0c15] bg-[#1a1c2c]/95 px-3 text-[11px] sm:text-xs shadow-[0_3px_0_#0b0c15] whitespace-nowrap">
                <span className="inline-flex items-center gap-1 font-bold text-[#ffcd75]">
                  <PixelSprite name="star" className="h-3.5 w-3.5" />
                  <span>{totalStarsCount}/180</span>
                </span>
                <span className="text-slate-600">|</span>
                <span className="text-emerald-300 font-semibold">
                  通关 {totalClearedCount}/60
                </span>
                <span className="text-slate-600">|</span>
                <span className="inline-flex items-center gap-1 text-amber-200 font-semibold">
                  <PixelSprite name="coin" className="h-3.5 w-3.5" />
                  <span>{save.coins}</span>
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {/* Lightweight Top-Bar Offline Status Indicator */}
                {isOffline && (
                  <div
                    role="status"
                    aria-live="polite"
                    data-testid="offline-status-indicator"
                    data-offline="true"
                    title={offlineSyncMeta.detailTooltip}
                    className="hidden sm:inline-flex h-9 items-center gap-1.5 rounded-xl border-2 border-amber-400/75 bg-amber-950/90 px-3 text-[11px] font-bold text-amber-200 shadow-[0_3px_0_#0b0c15] whitespace-nowrap"
                  >
                    <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                    <span>{offlineSyncMeta.topBarWarningText}</span>
                  </div>
                )}

                {/* Native WeChat Mini Game Right Capsule (音效 / 签到成就) */}
                <div className="inline-flex h-9 items-center rounded-xl border-2 border-[#0b0c15] bg-[#1a1c2c]/95 px-1.5 shadow-[0_3px_0_#0b0c15]">
                  <button
                    type="button"
                    aria-label="开关背景音乐与音效"
                    onClick={() => {
                      setSave((prev) => ({
                        ...prev,
                        settings: {
                          ...prev.settings,
                          music: !prev.settings.music,
                        },
                      }));
                    }}
                    className="flex h-7 w-8 items-center justify-center rounded-lg text-xs text-slate-200 hover:bg-[#242d50] hover:text-[#ffcd75]"
                  >
                    <PixelSprite
                      name={save.settings.music ? 'soundOn' : 'soundOff'}
                      className="h-4 w-4"
                    />
                  </button>
                  <span className="mx-0.5 h-4 w-px bg-slate-700" />
                  <button
                    type="button"
                    aria-label="打开成就与签到"
                    onClick={() => {
                      setShellState('playing');
                      setSubDrawer('achievements');
                    }}
                    className="relative flex h-7 w-8 items-center justify-center rounded-lg text-xs text-[#ffcd75] hover:bg-[#242d50] hover:text-amber-300"
                  >
                    <PixelSprite name="trophy" className="h-4 w-4" />
                    {(hasUnclaimedAch || canSignToday) && (
                      <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-[#ef4b5c]" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {isOffline && (
              <div
                role="status"
                aria-live="polite"
                data-testid="offline-status-banner-mobile"
                className="sm:hidden inline-flex self-start items-center gap-1.5 rounded-xl border border-amber-400/75 bg-amber-950/92 px-2.5 py-1 text-[11px] font-bold text-amber-200 shadow-[0_2px_0_#0b0c15] whitespace-nowrap"
              >
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                <span>离线状态 · 暂无法同步成就数据</span>
              </div>
            )}
          </div>

          {/* Focal Lockup & Compact WeChat Mini Game Launch Dock */}
          <div className="mx-auto flex w-full max-w-5xl flex-1 items-end sm:items-center pointer-events-none pb-2 sm:py-4">
            <div className="w-full max-w-sm mx-auto sm:mx-0 space-y-4 sm:space-y-5 pointer-events-auto">
              {/* Custom Inline <svg> Title Emblem */}
              <div className="space-y-1.5 text-center sm:text-left">
                <svg
                  viewBox="0 0 420 92"
                  className="w-full max-w-[330px] sm:max-w-[384px] mx-auto sm:mx-0 drop-shadow"
                  role="img"
                  aria-label="信号接力 SIGNAL RELAY"
                >
                  <rect
                    x="4"
                    y="10"
                    width="68"
                    height="68"
                    rx="8"
                    fill="#1a1c2c"
                    stroke="#ffcd75"
                    strokeWidth="3"
                  />
                  <path
                    d="M16 44 H36 V24 H56"
                    fill="none"
                    stroke="#ef4b5c"
                    strokeWidth="6"
                    strokeLinecap="square"
                  />
                  <path
                    d="M20 62 H48 V44 H62"
                    fill="none"
                    stroke="#41a6f6"
                    strokeWidth="5"
                    strokeLinecap="square"
                  />
                  <circle cx="56" cy="24" r="5" fill="#ffcd75" />
                  <circle cx="16" cy="44" r="4" fill="#ffffff" />
                  <text
                    x="88"
                    y="50"
                    fill="#0b0c15"
                    fontSize="44"
                    fontWeight="800"
                    fontFamily="Plus Jakarta Sans, PingFang SC, sans-serif"
                  >
                    信号接力
                  </text>
                  <text
                    x="85"
                    y="47"
                    fill="#ffcd75"
                    fontSize="44"
                    fontWeight="800"
                    fontFamily="Plus Jakarta Sans, PingFang SC, sans-serif"
                  >
                    信号接力
                  </text>
                  <text
                    x="86"
                    y="73"
                    fill="#94b0c2"
                    fontSize="12"
                    fontWeight="700"
                    letterSpacing="2.2"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    SIGNAL RELAY · OPTICAL PUZZLE
                  </text>
                </svg>
              </div>

              {/* Primary Start CTA + 2 Secondary Mini-Game Modes */}
              <div className="flex flex-col gap-2.5 w-full">
                <button
                  type="button"
                  data-start="true"
                  onClick={startGameplay}
                  className="flex h-12 items-center justify-between rounded-xl border-2 border-[#0b0c15] bg-[#ffcd75] px-4 text-base font-extrabold text-[#1a1c2c] shadow-[0_4px_0_#0b0c15] active:translate-y-0.5 transition-transform whitespace-nowrap"
                >
                  <span className="inline-flex items-center gap-2">
                    <PixelSprite name="bolt" className="h-4 w-4" />
                    <span>
                      {totalClearedCount > 0 ? '继续闯关' : '开始游戏'}
                    </span>
                  </span>
                  <span className="rounded-md bg-[#1a1c2c]/15 px-2.5 py-1 font-mono text-xs font-extrabold text-[#1a1c2c]">
                    第 {CAMPAIGN_LEVELS[campaignIdx]?.id || '1-1'} 关 →
                  </span>
                </button>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setShellState('playing');
                      setSubDrawer('levels');
                    }}
                    className="flex h-11 items-center justify-between rounded-xl border-2 border-[#0b0c15] bg-[#242d50] px-3.5 text-xs sm:text-sm font-bold text-white shadow-[0_4px_0_#0b0c15] hover:bg-[#2e3963] whitespace-nowrap"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <PixelSprite name="map" className="h-3.5 w-3.5" />
                      <span>章节选关</span>
                    </span>
                    <span className="font-mono text-[11px] text-[#ffcd75] tabular-nums">
                      {totalClearedCount}/60
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShellState('playing');
                      setSubDrawer('seed');
                    }}
                    className="flex h-11 items-center justify-between rounded-xl border-2 border-[#0b0c15] bg-[#242d50] px-3.5 text-xs sm:text-sm font-bold text-white shadow-[0_4px_0_#0b0c15] hover:bg-[#2e3963] whitespace-nowrap"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <PixelSprite name="seedChip" className="h-3.5 w-3.5" />
                      <span>每日挑战</span>
                    </span>
                    <span className="font-mono text-[11px] text-cyan-300">
                      挑战码
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="hidden sm:block h-2" />
        </div>
      )}

      {/* ================================================================= */}
      {/* STATE 2: PLAYING HUD ('playing') - Mobile WeChat Mini Game Layout */}
      {/* ================================================================= */}
      {shellState !== 'title' && (
        <div className="fixed inset-0 z-10 flex flex-col justify-between p-2 sm:p-3.5 md:p-5 pointer-events-none">
          {/* Sleek Top Header Area (Aligned with Bottom Dock max-w-3xl) */}
          <div data-testid="top-hud-bar" className="mx-auto flex w-full max-w-3xl flex-col gap-1.5">
            <div className="flex w-full items-center justify-between gap-1.5 sm:gap-2">
              {/* Top-Left Level Identity & Live Telemetry Strip */}
              <div className="pointer-events-auto flex h-11 sm:h-12 flex-1 min-w-0 items-center justify-between sm:justify-start gap-1.5 sm:gap-3.5 rounded-xl border-2 border-[#0b0c15] bg-[#1a1c2c]/95 px-2.5 sm:px-3.5 shadow-[0_3px_0_#0b0c15]">
                {/* Level Title + 3 Stars */}
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 shrink-0">
                  <span className="font-mono text-sm sm:text-base font-extrabold text-[#ffcd75] tabular-nums whitespace-nowrap">
                    {mode === 'seed'
                      ? `${activeSeedCode}`
                      : mode === 'daily'
                        ? `每日 ${activeLevel.id}`
                        : `第 ${activeLevel.id} 关`}
                  </span>
                  <span
                    className="text-xs sm:text-sm tracking-tight text-[#ffcd75] shrink-0"
                    aria-label="当前星级评价状态"
                  >
                    {starGoals.map((g, idx) => (
                      <span key={idx}>{g.ok ? '★' : '☆'}</span>
                    ))}
                  </span>
                </div>

                <div className="h-5 w-px bg-slate-700/80 shrink-0" />

                {/* Compact Tabular Readouts: 目标 / 步数 / 射程 / 用时 */}
                <div className="flex items-center gap-2 sm:gap-4 font-mono tabular-nums shrink-0">
                  <div className="text-center sm:text-left">
                    <div className="text-[9px] leading-none text-slate-400">目标</div>
                    <div className="mt-0.5 text-xs sm:text-sm font-bold leading-none text-white">
                      {propResult.reached.size}/{propResult.total}
                    </div>
                  </div>
                  <div className="text-center sm:text-left">
                    <div className="text-[9px] leading-none text-slate-400">步数</div>
                    <div
                      className={`mt-0.5 text-xs sm:text-sm font-bold leading-none ${
                        usedPipes <= activeLevel.par
                          ? 'text-emerald-400'
                          : 'text-amber-300'
                      }`}
                    >
                      {usedPipes}/{activeLevel.par}
                    </div>
                  </div>
                  {typeof activeLevel.range === 'number' && (
                    <div className="text-center sm:text-left">
                      <div className="text-[9px] leading-none text-amber-300/80">射程</div>
                      <div className="mt-0.5 text-xs sm:text-sm font-bold leading-none text-amber-300">
                        {activeLevel.range}
                      </div>
                    </div>
                  )}
                  <div className="text-center sm:text-left">
                    <div className="text-[9px] leading-none text-slate-400">用时</div>
                    <div className="mt-0.5 text-xs sm:text-sm font-bold leading-none text-slate-200">
                      {String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:
                      {String(elapsedSec % 60).padStart(2, '0')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Desktop Lightweight Offline Status Pill in Top Bar */}
              {isOffline && (
                <button
                  type="button"
                  data-testid="offline-status-indicator-desktop"
                  data-offline="true"
                  title={offlineSyncMeta.detailTooltip}
                  onClick={() => setSubDrawer('achievements')}
                  className="pointer-events-auto hidden md:inline-flex h-11 sm:h-12 items-center gap-1.5 rounded-xl border-2 border-amber-400/85 bg-amber-950/95 px-3 text-xs font-extrabold text-amber-200 shadow-[0_3px_0_#0b0c15] hover:bg-amber-900/90 shrink-0 whitespace-nowrap"
                >
                  <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                  <span>{offlineSyncMeta.topBarWarningText}</span>
                </button>
              )}

              {/* Top-Right WeChat Mini Game Style Capsule (网络状态/音量/色觉/暂停菜单) */}
              <div className="pointer-events-auto flex h-11 sm:h-12 items-center rounded-xl border-2 border-[#0b0c15] bg-[#1a1c2c]/95 px-1.5 shadow-[0_3px_0_#0b0c15] shrink-0">
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="offline-status-indicator"
                  data-offline={isOffline ? 'true' : 'false'}
                  aria-label={offlineSyncMeta.detailTooltip}
                  title={offlineSyncMeta.detailTooltip}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setSubDrawer((d) =>
                      d === 'achievements' ? null : 'achievements',
                    );
                  }}
                  className={`flex h-7 px-1.5 sm:h-8 sm:px-2 items-center justify-center gap-1 rounded-lg text-[10px] font-bold transition-colors whitespace-nowrap ${
                    isOffline
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-400/60'
                      : 'text-emerald-300 hover:bg-[#242d50]'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full shrink-0 ${
                      isOffline
                        ? 'bg-amber-400 animate-pulse'
                        : 'bg-emerald-400'
                    }`}
                  />
                  <span className="hidden sm:inline">
                    {isOffline ? '离线' : '已同步'}
                  </span>
                </button>

                <span className="mx-0.5 h-4 w-px bg-slate-700/90" />

                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="切换音量与背景音乐"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    cycleVolumeTier();
                  }}
                  className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg text-xs text-[#ffcd75] hover:bg-[#242d50]"
                >
                  <PixelSprite name="soundOn" className="h-4 w-4" />
                </button>

                <span className="mx-0.5 h-4 w-px bg-slate-700/90" />

                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="色觉辅助高对比模式"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setSave((prev) => ({
                      ...prev,
                      settings: {
                        ...prev.settings,
                        highContrast: !prev.settings.highContrast,
                      },
                    }));
                  }}
                  className={`flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg text-xs ${
                    save.settings.highContrast
                      ? 'bg-cyan-400 text-[#1a1c2c]'
                      : 'text-slate-300 hover:bg-[#242d50]'
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                  </svg>
                </button>

                <span className="mx-0.5 h-4 w-px bg-slate-700/90" />

                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="暂停游戏"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    if (shellState === 'paused') resumeGameplay();
                    else pauseGameplay();
                  }}
                  className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg text-[#ffcd75] hover:bg-[#242d50]"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Lightweight Offline Sync Warning Pill on Mobile / Tablet when Offline */}
            {isOffline && (
              <div
                role="status"
                aria-live="polite"
                data-testid="offline-sync-alert"
                className="pointer-events-auto flex md:hidden items-center justify-between gap-2 rounded-xl border border-amber-400/75 bg-amber-950/92 px-3 py-1 text-[11px] font-bold text-amber-200 shadow-[0_2px_0_#0b0c15] whitespace-nowrap"
              >
                <span className="inline-flex items-center gap-1.5 truncate">
                  <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                  <span>离线状态 · 无法同步成就数据（本机进度已保存）</span>
                </span>
                <button
                  type="button"
                  onClick={() => setSubDrawer('achievements')}
                  className="rounded bg-amber-400/20 px-1.5 py-0.5 font-mono text-[10px] text-[#ffcd75] shrink-0"
                >
                  详情
                </button>
              </div>
            )}
          </div>

          {/* Bottom Unified Thumb Dock: 4 Waveguide Pipe Slots + Pure Tactile Controls */}
          <div data-testid="bottom-dock-bar" className="mx-auto flex w-full max-w-3xl flex-col items-center">
            <div className="pointer-events-auto flex w-full flex-col gap-1.5 rounded-2xl border-2 border-[#0b0c15] bg-[#1a1c2c]/95 p-2 shadow-[0_4px_0_#0b0c15]">
              {/* Row 1: 4 Pipe Selection Cards (Zero-Truncation Mobile & Desktop Grid) */}
              <div className="grid w-full grid-cols-4 gap-1.5">
                {(['s', 'c', 't', 'a'] as PieceKind[]).map((kind) => {
                  const stock = inv[kind] || 0;
                  const active = !removeMode && sel === kind;
                  const meta = PIECE_META[kind];
                  const shortRoleMap: Record<PieceKind, string> = {
                    s: '直通',
                    c: '转向',
                    t: '分流',
                    a: '增幅',
                  };
                  return (
                    <button
                      key={kind}
                      type="button"
                      tabIndex={-1}
                      data-pipe-tool={kind}
                      onClick={(e) => {
                        e.currentTarget.blur();
                        setRemoveMode(false);
                        if (stock > 0) setSel(kind);
                      }}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2 rounded-xl border-2 px-2 py-1.5 sm:px-3 sm:py-2 text-left transition-all active:scale-95 ${
                        active
                          ? 'border-[#0b0c15] bg-[#ffcd75] text-[#1a1c2c] shadow-[0_2px_0_#0b0c15]'
                          : stock > 0
                            ? 'border-slate-700 bg-[#242d50] text-slate-100 hover:border-slate-500'
                            : 'border-slate-800 bg-[#141829] text-slate-500 opacity-50'
                      }`}
                    >
                      <div className="flex items-center justify-between sm:justify-start gap-1">
                        <PipeSvgIcon kind={kind} active={active} />
                        <span
                          className={`sm:hidden font-mono text-xs font-extrabold tabular-nums whitespace-nowrap ${
                            active ? 'text-[#1a1c2c]' : 'text-[#ffcd75]'
                          }`}
                        >
                          ×{stock}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] sm:text-xs font-extrabold whitespace-nowrap">
                            {meta.name}
                          </span>
                          <span
                            className={`hidden sm:inline font-mono text-xs font-extrabold tabular-nums whitespace-nowrap ${
                              active ? 'text-[#1a1c2c]' : 'text-[#ffcd75]'
                            }`}
                          >
                            ×{stock}
                          </span>
                          <span
                            className={`sm:hidden text-[9px] font-semibold whitespace-nowrap ${
                              active ? 'text-[#1a1c2c]/80' : 'text-slate-400'
                            }`}
                          >
                            {shortRoleMap[kind]}
                          </span>
                        </div>
                        <div
                          className={`hidden sm:block text-[10px] leading-tight whitespace-nowrap ${
                            active ? 'text-[#1a1c2c]/85 font-semibold' : 'text-slate-400'
                          }`}
                        >
                          {meta.role}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Row 2: 6-Button Mobile Thumb Bar (拆除 / 撤回 / 重玩 / 选关 / 挑战 / 成就) */}
              <div className="grid w-full grid-cols-6 gap-1.5">
                <button
                  type="button"
                  tabIndex={-1}
                  data-remove-mode={removeMode ? 'true' : 'false'}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setRemoveMode((prev) => !prev);
                  }}
                  className={`flex h-9 sm:h-10 items-center justify-center gap-1 rounded-xl border text-xs font-bold transition-colors whitespace-nowrap ${
                    removeMode
                      ? 'border-rose-300 bg-rose-500 text-white shadow-[0_0_10px_rgba(244,63,94,0.45)]'
                      : 'border-slate-700 bg-[#242d50] text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  <PixelSprite name="wrench" className="h-3.5 w-3.5" />
                  <span>拆除</span>
                </button>

                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    handleUndo();
                  }}
                  className="flex h-9 sm:h-10 items-center justify-center gap-1 rounded-xl border border-slate-700 bg-[#242d50] text-xs font-bold text-slate-100 hover:bg-slate-700 whitespace-nowrap"
                >
                  <PixelSprite name="undo" className="h-3.5 w-3.5" />
                  <span>撤回</span>
                </button>

                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    handleReset();
                  }}
                  className="flex h-9 sm:h-10 items-center justify-center gap-1 rounded-xl border border-slate-700 bg-[#242d50] text-xs font-bold text-slate-100 hover:bg-slate-700 whitespace-nowrap"
                >
                  <PixelSprite name="replay" className="h-3.5 w-3.5" />
                  <span>重玩</span>
                </button>

                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setSubDrawer((d) => (d === 'levels' ? null : 'levels'));
                  }}
                  className="flex h-9 sm:h-10 items-center justify-center gap-1 rounded-xl border border-slate-700 bg-[#242d50] text-xs font-bold text-[#ffcd75] hover:border-[#ffcd75] whitespace-nowrap"
                >
                  <PixelSprite name="map" className="h-3.5 w-3.5" />
                  <span>选关</span>
                </button>

                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setSubDrawer((d) => (d === 'seed' ? null : 'seed'));
                  }}
                  className="flex h-9 sm:h-10 items-center justify-center gap-1 rounded-xl border border-slate-700 bg-[#242d50] text-xs font-bold text-cyan-300 hover:border-cyan-300 whitespace-nowrap"
                >
                  <PixelSprite name="seedChip" className="h-3.5 w-3.5" />
                  <span>挑战</span>
                </button>

                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setSubDrawer((d) =>
                      d === 'achievements' ? null : 'achievements',
                    );
                  }}
                  className="relative flex h-9 sm:h-10 items-center justify-center gap-1 rounded-xl border border-slate-700 bg-[#242d50] text-xs font-bold text-emerald-300 hover:border-emerald-300 whitespace-nowrap"
                >
                  <PixelSprite name="trophy" className="h-3.5 w-3.5" />
                  <span>成就</span>
                  {(hasUnclaimedAch || canSignToday) && (
                    <span
                      aria-label="有可领取奖励"
                      className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-[#ef4b5c] border border-[#0b0c15]"
                    />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-DRAWERS: LEVEL SELECT / SEED WORKSHOP / ACHIEVEMENTS          */}
      {/* ================================================================= */}
      {subDrawer === 'levels' && (() => {
        const inspectedLevel = inspectedLevelId
          ? CAMPAIGN_LEVELS.find((item) => item.id === inspectedLevelId) || null
          : null;
        const inspectedAbsIndex = inspectedLevel
          ? CAMPAIGN_LEVELS.findIndex((item) => item.id === inspectedLevel.id)
          : -1;
        const inspectedSummary = inspectedLevel
          ? getLevelDetailSummary(inspectedLevel, save.stars, save.bestSec)
          : null;
        const inspectedStars = inspectedLevel
          ? save.stars[inspectedLevel.id] || 0
          : 0;
        const inspectedBestSec = inspectedLevel
          ? save.bestSec[inspectedLevel.id]
          : undefined;
        const inspectedEfficiencyPct = inspectedLevel
          ? getLevelTimeEfficiencyPct(inspectedLevel, inspectedBestSec)
          : 0;
        const inspectedIsFav = inspectedLevel
          ? save.favorites.includes(inspectedLevel.id)
          : false;

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="章节与选关地图"
            className="fixed inset-0 z-30 flex items-center justify-center bg-[#090b12]/85 p-2.5 sm:p-4 overflow-hidden no-scrollbar"
          >
            <div
              className={`relative w-full ${
                inspectedLevel ? 'max-w-5xl' : 'max-w-2xl'
              } max-h-[92vh] overflow-y-auto no-scrollbar rounded-xl border-2 border-[#0b0c15] bg-[#1a1c2c] p-3.5 sm:p-5 shadow-[0_6px_0_#0b0c15] transition-all duration-200`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-[#ffcd75]">
                    接力修复地图 · 6 章 60 关主线
                  </h2>
                  <p className="text-xs text-slate-400 font-mono tabular-nums">
                    已接通 {totalClearedCount}/60 关 · 累计星章 {totalStarsCount}/180 ★
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setInspectedLevelId(null);
                      setSubDrawer(null);
                    }}
                    className="h-8 rounded-lg border border-slate-700 bg-[#242d50] px-3 text-xs font-semibold text-slate-200 hover:bg-slate-700 whitespace-nowrap"
                  >
                    关闭
                  </button>
                </div>
              </div>

              {/* Quick Filter & Sort Bar: All vs Favorites + Sort By (Default / Difficulty / Fastest Time) */}
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-[#141829] p-1">
                  <button
                    type="button"
                    data-filter-tab="all"
                    onClick={() => setLevelFilter('all')}
                    className={`h-7 rounded-md px-2.5 sm:px-3 text-xs font-bold transition-colors whitespace-nowrap ${
                      levelFilter === 'all'
                        ? 'bg-[#ffcd75] text-[#1a1c2c]'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    全部章节关卡 (60)
                  </button>
                  <button
                    type="button"
                    data-filter-tab="favorites"
                    onClick={() => setLevelFilter('favorites')}
                    className={`inline-flex h-7 items-center gap-1 rounded-md px-2.5 sm:px-3 text-xs font-bold transition-colors whitespace-nowrap ${
                      levelFilter === 'favorites'
                        ? 'bg-rose-500 text-white'
                        : 'text-rose-300 hover:bg-rose-950/50'
                    }`}
                  >
                    <PixelSprite name="heart" className="h-3.5 w-3.5" />
                    <span>我的收藏 ({save.favorites.length})</span>
                  </button>
                </div>

                {/* Level Sort Control Group: 默认 / 按难度排序 / 按完成时间（最快） */}
                <div
                  role="group"
                  aria-label="关卡排序方式"
                  data-sort-active={levelSortBy}
                  className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 bg-[#141829] p-1"
                >
                  {(
                    [
                      { id: 'default', label: '默认' },
                      { id: 'difficulty', label: '按难度排序' },
                      { id: 'fastest', label: '按完成时间（最快）' },
                    ] as { id: LevelSortMode; label: string }[]
                  ).map((opt) => {
                    const active = levelSortBy === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        data-sort-btn={opt.id}
                        onClick={() => setLevelSortBy(opt.id)}
                        className={`h-7 rounded-md px-2 sm:px-2.5 text-[11px] font-bold transition-colors whitespace-nowrap ${
                          active
                            ? 'bg-cyan-400 text-[#1a1c2c]'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Chapter Tabs (shown when browsing by chapter) */}
              {levelFilter === 'all' && (
                <div className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {chapterSummaries.map((ch) => {
                    const isSelected = selectedChapter === ch.index;
                    const hasCleared = ch.cleared > 0;
                    return (
                      <button
                        key={ch.index}
                        type="button"
                        onClick={() => setSelectedChapter(ch.index)}
                        className={`relative rounded-lg border p-2 text-left transition-transform hover:scale-[1.02] ${
                          isSelected
                            ? 'border-[#ffcd75] bg-[#ffcd75] text-[#1a1c2c]'
                            : ch.restored
                              ? 'border-emerald-400/70 bg-[#172836] text-emerald-100 hover:border-emerald-300'
                              : hasCleared
                                ? 'border-emerald-500/40 bg-[#1d2842] text-slate-100 hover:border-emerald-400/60'
                                : 'border-slate-700 bg-[#242d50] text-slate-200 hover:border-slate-500'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold whitespace-nowrap">
                            第 {ch.index + 1} 章
                          </span>
                          {hasCleared && (
                            <span
                              className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-extrabold ${
                                isSelected
                                  ? 'bg-[#1a1c2c] text-[#ffcd75]'
                                  : 'bg-emerald-500/25 text-emerald-300 border border-emerald-400/50'
                              }`}
                              title={
                                ch.restored
                                  ? '本章 10 关已全部接通'
                                  : `本章已接通 ${ch.cleared}/10 关`
                              }
                            >
                              ✓
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11px] opacity-90">
                          {ch.name}
                        </div>
                        <div className="mt-1 flex items-center justify-between font-mono text-[10px] tabular-nums">
                          <span>{ch.totalStars}/30 ★</span>
                          <span>{ch.cleared}/10</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Empty State for My Favorites */}
              {levelFilter === 'favorites' && save.favorites.length === 0 && (
                <div className="mt-3 rounded-xl border border-slate-800 bg-[#141829] p-6 text-center space-y-2">
                  <div className="text-sm font-bold text-slate-200">
                    暂无收藏关卡
                  </div>
                  <p className="text-xs text-slate-400">
                    点击任意关卡卡片右上角的心形图标 <span className="text-rose-400">♥</span> 即可将难点或喜爱的关卡加入收藏夹。
                  </p>
                  <button
                    type="button"
                    onClick={() => setLevelFilter('all')}
                    className="mt-2 rounded-lg border border-slate-700 bg-[#242d50] px-3.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                  >
                    返回章节列表
                  </button>
                </div>
              )}

              {/* Split Container: Left Levels Grid + Right Slide-Out Level Detail Panel */}
              {(levelFilter === 'all' || save.favorites.length > 0) && (
                <div className="mt-3 flex flex-col md:flex-row items-stretch gap-3">
                  {/* Left: Levels Grid */}
                  <div
                    key={`chapter-grid-${levelFilter}-${levelSortBy}-${selectedChapter}-${totalClearedCount}`}
                    className={`flex-1 min-w-0 grid grid-cols-2 gap-2 ${
                      inspectedLevel ? 'sm:grid-cols-3 lg:grid-cols-5' : 'sm:grid-cols-5'
                    } no-scrollbar`}
                  >
                    {sortLevelsForDisplay(
                      levelFilter === 'favorites'
                        ? CAMPAIGN_LEVELS.filter((lv) =>
                            save.favorites.includes(lv.id),
                          )
                        : CAMPAIGN_LEVELS.slice(
                            selectedChapter * 10,
                            selectedChapter * 10 + 10,
                          ),
                      levelSortBy,
                      save.bestSec,
                    ).map((lv, idx) => {
                      const absIndex = CAMPAIGN_LEVELS.findIndex(
                        (item) => item.id === lv.id,
                      );
                      const earned = save.stars[lv.id] || 0;
                      const isCompleted = earned > 0;
                      const isPerfect = earned === 3;
                      const isFavorite = save.favorites.includes(lv.id);
                      const diffMeta = getLevelDifficultyMeta(lv);
                      const isBursting = burstingLevel?.id === lv.id;
                      const best = save.bestSec[lv.id];
                      const optimalSec = getLevelOptimalTimeSec(lv);
                      const efficiencyPct = getLevelTimeEfficiencyPct(lv, best);
                      const isCur =
                        mode === 'campaign' && campaignIdx === absIndex;
                      const isInspected = inspectedLevelId === lv.id;
                      const burstVectors: [string, string, string][] = [
                        ['-38px', '-30px', '#ffcd75'],
                        ['0px', '-42px', '#ffe8a3'],
                        ['38px', '-30px', '#ffcd75'],
                        ['46px', '0px', '#73eff7'],
                        ['38px', '30px', '#ffcd75'],
                        ['0px', '42px', '#ffe8a3'],
                        ['-38px', '30px', '#ffcd75'],
                        ['-46px', '0px', '#a7f070'],
                      ];
                      return (
                        <button
                          key={lv.id}
                          type="button"
                          data-level-id={lv.id}
                          data-completed={isCompleted ? 'true' : 'false'}
                          data-perfect={isPerfect ? 'true' : 'false'}
                          data-favorite={isFavorite ? 'true' : 'false'}
                          data-inspected={isInspected ? 'true' : 'false'}
                          data-difficulty={diffMeta.tier}
                          data-has-amp={diffMeta.hasAmplifier ? 'true' : 'false'}
                          data-efficiency={`${efficiencyPct}%`}
                          data-bursting={isBursting ? 'true' : 'false'}
                          style={
                            isCompleted && !save.settings.reduceMotion && !isBursting
                              ? { animationDelay: `${idx * 32}ms` }
                              : undefined
                          }
                          onClick={(e) => {
                            if (perfectSelectTimerRef.current) {
                              window.clearTimeout(perfectSelectTimerRef.current);
                              perfectSelectTimerRef.current = null;
                            }
                            setInspectedLevelId(lv.id);

                            if (isPerfect) {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const cx = rect.left + rect.width / 2;
                              const cy = rect.top + rect.height / 2;
                              particlePoolRef.current.spawnBurst(
                                cx,
                                cy,
                                '#ffcd75',
                                22,
                                45,
                                165,
                                3.8,
                              );
                              soundFX.play('reward');

                              if (!save.settings.reduceMotion) {
                                setBurstingLevel({ id: lv.id, key: Date.now() });
                                perfectSelectTimerRef.current = window.setTimeout(
                                  () => {
                                    setBurstingLevel(null);
                                  },
                                  320,
                                );
                              }
                            } else {
                              soundFX.play('place');
                            }
                          }}
                          className={`group relative flex flex-col justify-between rounded-lg border-2 p-2.5 text-left transition-all duration-150 hover:scale-[1.03] active:scale-[0.98] ${
                            isBursting && !save.settings.reduceMotion
                              ? 'perfect-click-bounce z-10'
                              : isCompleted && !save.settings.reduceMotion
                                ? 'completed-level-pop'
                                : ''
                          } ${
                            isInspected
                              ? 'ring-2 ring-cyan-300 border-cyan-300 bg-[#223052] shadow-[0_0_14px_rgba(115,239,247,0.35)]'
                              : isPerfect
                                ? 'perfect-gold-card'
                                : isCur
                                  ? 'border-[#ffcd75] bg-[#2a3452] shadow-[0_3px_0_#0b0c15]'
                                  : isCompleted
                                    ? 'border-emerald-400/65 bg-[#162636] hover:border-emerald-300 shadow-[0_3px_0_#0b0c15]'
                                    : 'border-slate-800 bg-[#141829] hover:border-slate-600'
                          }`}
                        >
                          {/* Golden Corner Accents for 3-Star Perfect Levels */}
                          {isPerfect && (
                            <>
                              <span
                                aria-hidden="true"
                                className="pointer-events-none absolute top-0.5 left-0.5 h-2 w-2 border-t-2 border-l-2 border-[#ffe39f]"
                              />
                              <span
                                aria-hidden="true"
                                className="pointer-events-none absolute top-0.5 right-0.5 h-2 w-2 border-t-2 border-r-2 border-[#ffe39f]"
                              />
                              <span
                                aria-hidden="true"
                                className="pointer-events-none absolute bottom-0.5 left-0.5 h-2 w-2 border-b-2 border-l-2 border-[#ffe39f]"
                              />
                              <span
                                aria-hidden="true"
                                className="pointer-events-none absolute bottom-0.5 right-0.5 h-2 w-2 border-b-2 border-r-2 border-[#ffe39f]"
                              />
                            </>
                          )}

                          {/* Radial Particle Burst on 3-Star Level Click */}
                          {isBursting && !save.settings.reduceMotion && (
                            <div
                              key={burstingLevel.key}
                              data-perfect-burst="true"
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-0 z-20 overflow-visible"
                            >
                              {burstVectors.map(([tx, ty, color], pIdx) => (
                                <span
                                  key={pIdx}
                                  style={
                                    {
                                      '--tx': tx,
                                      '--ty': ty,
                                      backgroundColor: color,
                                      boxShadow: `0 0 6px ${color}`,
                                    } as React.CSSProperties
                                  }
                                  className="perfect-burst-particle absolute top-1/2 left-1/2 h-2 w-2 rounded-sm"
                                />
                              ))}
                            </div>
                          )}

                          {/* Row 1: Level ID + Favorite Heart Button + Completed Badge / Uncompleted Grey Ring */}
                          <div className="flex items-center justify-between gap-1 font-mono">
                            <div className="flex items-center gap-1 shrink-0">
                              <span
                                className={`whitespace-nowrap shrink-0 text-sm font-bold ${
                                  isPerfect ? 'text-[#ffe8a3]' : 'text-white'
                                }`}
                              >
                                {lv.id}
                              </span>
                              {/* Favorite Heart Icon Trigger */}
                              <span
                                role="button"
                                tabIndex={0}
                                data-favorite-btn={lv.id}
                                aria-label={
                                  isFavorite
                                    ? `取消收藏关卡 ${lv.id}`
                                    : `收藏关卡 ${lv.id}`
                                }
                                title={isFavorite ? '已收藏 (点击取消)' : '加入我的收藏'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleFavoriteLevel(lv.id);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    toggleFavoriteLevel(lv.id);
                                  }
                                }}
                                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition-transform hover:scale-125 ${
                                  isFavorite
                                    ? 'text-rose-400'
                                    : 'text-slate-500 hover:text-rose-300'
                                }`}
                              >
                                <svg
                                  viewBox="0 0 20 20"
                                  className="h-3.5 w-3.5"
                                  fill={isFavorite ? 'currentColor' : 'none'}
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                >
                                  <path d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" />
                                </svg>
                              </span>
                            </div>

                            {isCompleted ? (
                              <span
                                data-completed-badge="true"
                                style={
                                  !save.settings.reduceMotion
                                    ? { animationDelay: `${idx * 32 + 60}ms` }
                                    : undefined
                                }
                                className={`completed-check-badge inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${
                                  isPerfect
                                    ? 'border border-amber-300/80 bg-amber-400/25 text-[#ffcd75] shadow-[0_0_8px_rgba(255,205,117,0.3)]'
                                    : 'border border-emerald-400/60 bg-emerald-500/20 text-emerald-300'
                                }`}
                              >
                                <svg
                                  viewBox="0 0 16 16"
                                  className="h-3 w-3 fill-none stroke-current stroke-[2.4]"
                                  aria-hidden="true"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M3 8.5l3.2 3.2L13 4.8"
                                  />
                                </svg>
                                <span>{isPerfect ? '满星' : '已通'}</span>
                              </span>
                            ) : (
                              <span
                                data-uncompleted-ring="true"
                                style={
                                  !save.settings.reduceMotion
                                    ? { animationDelay: `${idx * 28}ms` }
                                    : undefined
                                }
                                className="uncompleted-ring-fade inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] text-slate-400"
                                title={`待接通 · 当前全局进度 ${totalClearedCount}/60`}
                              >
                                <svg
                                  viewBox="0 0 20 20"
                                  className="h-3.5 w-3.5 shrink-0"
                                  aria-hidden="true"
                                >
                                  <circle
                                    cx="10"
                                    cy="10"
                                    r="7"
                                    fill="none"
                                    stroke="#334155"
                                    strokeWidth="2.2"
                                  />
                                  <circle
                                    cx="10"
                                    cy="10"
                                    r="7"
                                    fill="none"
                                    stroke="#64748b"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                    strokeDasharray="44"
                                    strokeDashoffset={Math.round(
                                      44 *
                                        (1 -
                                          Math.max(
                                            0.18,
                                            Math.min(0.85, totalClearedCount / 60),
                                          )),
                                    )}
                                    transform="rotate(-90 10 10)"
                                  />
                                </svg>
                                <span>待接通</span>
                              </span>
                            )}
                          </div>

                          {/* Row 2: Dynamic Difficulty Index Badge (Auto-bolded if level contains Amplifier 'a') */}
                          <div className="mt-1.5 flex items-center justify-between gap-1 font-mono text-[10px]">
                            <span
                              data-difficulty-badge={lv.id}
                              className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 whitespace-nowrap ${
                                diffMeta.colorClass
                              } ${
                                diffMeta.hasAmplifier
                                  ? 'font-extrabold ring-1 ring-amber-300/75 shadow-[0_0_6px_rgba(255,205,117,0.28)]'
                                  : 'font-medium'
                              }`}
                              title={`难度指数：${diffMeta.tier} (标准 ${lv.par} 步 · ${diffMeta.varietyCount} 类管件${diffMeta.hasAmplifier ? ' · 含增幅器加粗提醒' : ''})`}
                            >
                              <span>
                                {diffMeta.hasAmplifier
                                  ? `⚡${diffMeta.tier}·增幅`
                                  : `难度:${diffMeta.tier}`}
                              </span>
                            </span>

                            <span
                              className={
                                isCompleted ? 'text-[#ffcd75]' : 'text-slate-600'
                              }
                            >
                              {'★'.repeat(earned)}
                              {'☆'.repeat(3 - earned)}
                            </span>
                          </div>

                          {/* Row 3: Best Time / Par & Progress Bar + Efficiency Percentage Label */}
                          {isCompleted ? (
                            <div
                              data-n60-progress="true"
                              className="mt-1.5 space-y-1 font-mono"
                            >
                              <div className="flex items-center justify-between text-[10px] tabular-nums">
                                <span className="text-slate-400">
                                  {best ? `最佳 ${best}s` : '总进度'}
                                </span>
                                <span
                                  className={
                                    isPerfect
                                      ? 'font-bold text-[#ffcd75]'
                                      : 'font-bold text-emerald-300'
                                  }
                                >
                                  {totalClearedCount}/60
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-900/95">
                                  <div
                                    className={`h-full transition-all duration-300 ${
                                      isPerfect
                                        ? 'bg-gradient-to-r from-[#ffcd75] via-[#fff0b8] to-[#ffcd75]'
                                        : 'bg-emerald-400'
                                    }`}
                                    style={{
                                      width: `${Math.max(8, efficiencyPct)}%`,
                                    }}
                                  />
                                </div>
                                <span
                                  data-efficiency-pct={lv.id}
                                  title={`用时效率：${efficiencyPct}%（最佳用时 ${best}s / 最优通关时间 ${optimalSec}s）`}
                                  className={`shrink-0 text-[10px] font-bold tabular-nums leading-none ${
                                    efficiencyPct >= 80
                                      ? 'text-[#ffcd75]'
                                      : efficiencyPct >= 50
                                        ? 'text-cyan-300'
                                        : 'text-emerald-300'
                                  }`}
                                >
                                  {efficiencyPct}%
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-1.5 space-y-1 font-mono">
                              <div className="flex items-center justify-between text-[10px] text-slate-500 tabular-nums">
                                <span>标准 {lv.par}步</span>
                                <span>{totalClearedCount}/60</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-900/90">
                                  <div
                                    className="h-full bg-slate-700/60 transition-all duration-300"
                                    style={{
                                      width: `${Math.max(
                                        4,
                                        Math.round((totalClearedCount / 60) * 100),
                                      )}%`,
                                    }}
                                  />
                                </div>
                                <span
                                  data-efficiency-pct={lv.id}
                                  title={`待通关（最优通关时间 ${optimalSec}s）`}
                                  className="shrink-0 text-[10px] font-semibold tabular-nums leading-none text-slate-500"
                                >
                                  {efficiencyPct}%
                                </span>
                              </div>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Right-Side Pop-Out Level Detail Panel (右侧弹出详情面板) */}
                  {inspectedLevel && inspectedSummary && (
                    <aside
                      key={`detail-panel-${inspectedLevel.id}`}
                      data-level-detail-panel="true"
                      data-inspected-level={inspectedLevel.id}
                      aria-label={`关卡 ${inspectedLevel.id} 详情面板`}
                      className="level-detail-slide-in max-md:fixed max-md:inset-y-3 max-md:right-2.5 max-md:z-40 max-md:w-[calc(100vw-24px)] max-md:max-w-[320px] max-md:overflow-y-auto w-full md:w-[310px] shrink-0 flex flex-col justify-between rounded-xl border-2 border-[#ffcd75]/80 bg-gradient-to-b from-[#171d33] via-[#13182b] to-[#101424] p-3.5 shadow-[0_10px_32px_rgba(0,0,0,0.82)] space-y-3"
                    >
                      <div className="space-y-3">
                        {/* Detail Panel Header */}
                        <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2.5">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="rounded bg-[#ffcd75] px-1.5 py-0.5 font-mono text-xs font-extrabold text-[#1a1c2c]">
                                第 {inspectedLevel.id} 关
                              </span>
                              <span className="text-xs font-bold text-white truncate">
                                {inspectedSummary.chapterName}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center gap-2 font-mono text-[11px] tabular-nums">
                              <span className="text-[#ffcd75]">
                                {'★'.repeat(inspectedStars)}
                                {'☆'.repeat(3 - inspectedStars)}
                              </span>
                              <span className="text-slate-400">
                                {inspectedBestSec
                                  ? `最佳 ${inspectedBestSec}s (${inspectedEfficiencyPct}%)`
                                  : `最优目标 ${getLevelOptimalTimeSec(inspectedLevel)}s`}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => toggleFavoriteLevel(inspectedLevel.id)}
                              title={inspectedIsFav ? '取消收藏' : '加入收藏'}
                              className={`rounded-lg border px-2 py-1 text-xs transition-colors ${
                                inspectedIsFav
                                  ? 'border-rose-400/60 bg-rose-950/60 text-rose-300'
                                  : 'border-slate-700 bg-[#1c233b] text-slate-400 hover:text-rose-300'
                              }`}
                            >
                              ♥
                            </button>
                            <button
                              type="button"
                              data-detail-close="true"
                              aria-label="关闭关卡详情面板"
                              onClick={() => setInspectedLevelId(null)}
                              className="rounded-lg border border-slate-700 bg-[#242d50] px-2 py-1 text-xs font-bold text-slate-300 hover:bg-slate-700 hover:text-white"
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        {/* Section 1: 难度描述 (Difficulty Description) */}
                        <div
                          data-detail-difficulty-desc="true"
                          className="rounded-lg border border-slate-800/90 bg-[#0e1322] p-2.5 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-extrabold text-cyan-300">
                              难度描述
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                                inspectedSummary.difficulty.colorClass
                              } ${
                                inspectedSummary.difficulty.hasAmplifier
                                  ? 'font-extrabold'
                                  : 'font-semibold'
                              }`}
                            >
                              {inspectedSummary.difficulty.hasAmplifier
                                ? `⚡${inspectedSummary.difficulty.tier}·增幅`
                                : `难度:${inspectedSummary.difficulty.tier}`}{' '}
                              ({inspectedSummary.difficulty.score})
                            </span>
                          </div>
                          <p className="text-[11px] leading-relaxed text-slate-300">
                            {inspectedSummary.difficultyDesc}
                          </p>
                          <div className="grid grid-cols-4 gap-1 pt-0.5 font-mono text-[10px] tabular-nums">
                            {inspectedSummary.pipeTags.map((tag) => (
                              <div
                                key={tag.key}
                                className={`rounded border px-1.5 py-1 text-center ${
                                  tag.count > 0
                                    ? tag.key === 'a'
                                      ? 'border-amber-400/50 bg-amber-950/40 text-amber-200 font-bold'
                                      : 'border-slate-700 bg-[#182038] text-slate-200'
                                    : 'border-slate-800/60 bg-slate-950/40 text-slate-600'
                                }`}
                              >
                                <div className="truncate text-[9px] opacity-80">
                                  {tag.label.slice(0, 2)}
                                </div>
                                <div className="font-bold">×{tag.count}</div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Section 2: 本章通关统计 (Chapter Completion Statistics) */}
                        <div
                          data-detail-chapter-stats="true"
                          className="rounded-lg border border-slate-800/90 bg-[#0e1322] p-2.5 space-y-2 font-mono tabular-nums"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-sans text-xs font-extrabold text-[#ffcd75]">
                              本章通关统计
                            </span>
                            <span className="text-[10px] text-emerald-300 font-bold">
                              第 {inspectedSummary.chapterIndex + 1} 章 · 已通{' '}
                              {inspectedSummary.chapterStats.clearedCount}/
                              {inspectedSummary.chapterStats.totalLevels} 关
                            </span>
                          </div>

                          {/* Chapter Progress Bar */}
                          <div className="space-y-1">
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-900">
                              <div
                                className="h-full bg-gradient-to-r from-emerald-400 via-cyan-300 to-[#ffcd75] transition-all duration-300"
                                style={{
                                  width: `${Math.max(
                                    6,
                                    inspectedSummary.chapterStats.clearedPct,
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-1.5 text-center text-[10px]">
                            <div className="rounded border border-slate-800 bg-[#151c31] p-1.5">
                              <div className="text-[9px] text-slate-400">
                                本章星章
                              </div>
                              <div className="mt-0.5 font-bold text-[#ffcd75]">
                                {inspectedSummary.chapterStats.earnedStars}/
                                {inspectedSummary.chapterStats.maxStars} ★
                              </div>
                            </div>
                            <div className="rounded border border-slate-800 bg-[#151c31] p-1.5">
                              <div className="text-[9px] text-slate-400">
                                满星评价
                              </div>
                              <div className="mt-0.5 font-bold text-emerald-300">
                                {inspectedSummary.chapterStats.perfectThreeStarCount}
                                /10 关
                              </div>
                            </div>
                            <div className="rounded border border-slate-800 bg-[#151c31] p-1.5">
                              <div className="text-[9px] text-slate-400">
                                本章均时
                              </div>
                              <div className="mt-0.5 font-bold text-cyan-300">
                                {inspectedSummary.chapterStats.avgClearSec
                                  ? `${inspectedSummary.chapterStats.avgClearSec}s`
                                  : '待建立'}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Section 3: 极速开始 Direct Launch Button */}
                      <button
                        type="button"
                        data-quick-start-btn="true"
                        onClick={() => {
                          if (perfectSelectTimerRef.current) {
                            window.clearTimeout(perfectSelectTimerRef.current);
                            perfectSelectTimerRef.current = null;
                          }
                          setMode('campaign');
                          setCampaignIdx(
                            inspectedAbsIndex >= 0 ? inspectedAbsIndex : 0,
                          );
                          setShellState('playing');
                          setInspectedLevelId(null);
                          setSubDrawer(null);
                          soundFX.play('win');
                        }}
                        className="w-full rounded-lg border-2 border-[#0b0c15] bg-[#ffcd75] py-2.5 px-4 text-xs sm:text-sm font-extrabold text-[#1a1c2c] shadow-[0_3px_0_#0b0c15] hover:bg-amber-300 active:translate-y-0.5 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap"
                      >
                        <span>⚡ 极速开始 · 进入第 {inspectedLevel.id} 关</span>
                      </button>
                    </aside>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {subDrawer === 'seed' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="挑战码种子工坊与每日挑战"
          className="fixed inset-0 z-30 flex items-center justify-center bg-[#090b12]/85 p-4"
        >
          <div className="w-full max-w-xl rounded-xl border-2 border-[#0b0c15] bg-[#1a1c2c] p-6 shadow-[0_6px_0_#0b0c15] space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-lg font-bold text-[#ffcd75]">
                挑战码种子工坊 & 每日一题
              </h2>
              <button
                type="button"
                onClick={() => setSubDrawer(null)}
                className="rounded-lg border border-slate-700 bg-[#242d50] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
              >
                关闭
              </button>
            </div>

            {/* Daily Challenge Card */}
            <div className="rounded-xl border border-slate-700 bg-[#242d50] p-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-mono text-cyan-300">
                  DAILY CHALLENGE · {dailyData.day}
                </div>
                <div className="mt-0.5 text-base font-bold text-white">
                  今日挑战 ({dailyData.level.id}) · 首次通关 +100 金币
                </div>
                <div className="mt-1 text-xs text-slate-300">
                  {save.dailyCompletedDay === dailyData.day
                    ? '今日奖励已领取，可随时免费重练刷新最佳用时'
                    : '每天零点刷新一题，不消耗体力'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMode('daily');
                  setSubDrawer(null);
                  setShellState('playing');
                }}
                className="rounded-lg bg-[#ffcd75] px-4 py-2.5 text-xs font-bold text-[#1a1c2c] hover:bg-amber-300 whitespace-nowrap shrink-0"
              >
                进入今日挑战
              </button>
            </div>

            {/* 6-Char Seed Challenge Workshop */}
            <div className="rounded-xl border border-slate-700 bg-[#141829] p-4 space-y-3">
              <div className="text-xs font-mono text-[#ffcd75]">
                SEED WORKSHOP · 6 位挑战码同题竞速
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                输入任意挑战码即可确定性生成一张 100% 经数学验证可解的信号接力谜题，与好友输入相同挑战码即可同题比拼用时。
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="modal-seed-input" className="sr-only">
                  挑战码
                </label>
                <input
                  id="modal-seed-input"
                  type="text"
                  value={seedCodeInput}
                  onChange={(e) => setSeedCodeInput(e.target.value)}
                  maxLength={10}
                  placeholder="例如 SR-2026"
                  className="w-36 rounded-lg border border-slate-600 bg-[#0b0c15] px-3 py-2 font-mono text-xs uppercase text-white focus:border-[#ffcd75] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                    let code = 'SR-';
                    for (let i = 0; i < 4; i++) {
                      code += chars[Math.floor(Math.random() * chars.length)];
                    }
                    setSeedCodeInput(code);
                  }}
                  className="rounded-lg border border-slate-700 bg-[#242d50] px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  随机种子
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSeedCode(seedCodeInput || 'SR-2026');
                    setMode('seed');
                    setSubDrawer(null);
                    setShellState('playing');
                  }}
                  className="rounded-lg bg-[#ffcd75] px-4 py-2 text-xs font-bold text-[#1a1c2c] hover:bg-amber-300 whitespace-nowrap shrink-0"
                >
                  生成并开始挑战
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs font-mono">
                <span className="text-slate-400">推荐挑战码:</span>
                {['SR-2026', 'AURORA', 'BRIDGE', 'MUSE-99', 'GALAXY'].map(
                  (preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setSeedCodeInput(preset);
                        setActiveSeedCode(preset);
                        setMode('seed');
                        setSubDrawer(null);
                        setShellState('playing');
                      }}
                      className="rounded border border-slate-700 bg-[#1a1c2c] px-2 py-0.5 text-slate-300 hover:border-[#ffcd75] hover:text-[#ffcd75]"
                    >
                      {preset}
                    </button>
                  ),
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {subDrawer === 'achievements' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="全周期成就与每日签到"
          className="fixed inset-0 z-30 flex items-center justify-center bg-[#090b12]/85 p-3 sm:p-4 overflow-hidden no-scrollbar"
        >
          <div className="w-full max-w-4xl rounded-xl border-2 border-[#0b0c15] bg-[#1a1c2c] p-4 sm:p-5 shadow-[0_6px_0_#0b0c15] space-y-3.5 max-h-[92vh] overflow-y-auto no-scrollbar">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-[#ffcd75]">
                  每日签到、6 阶成就与管件胜率雷达图
                </h2>
                <p className="text-xs font-mono text-slate-400 tabular-nums">
                  金币 {save.coins} · 已接通 {totalClearedCount}/60 关 · 完美步数 {save.stat.par} 次 · 增幅通关 {save.stat.amp} 次
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="achievements-sync-badge"
                  data-offline={isOffline ? 'true' : 'false'}
                  title={`${offlineSyncMeta.detailTooltip}（点击可切换离线状态演练）`}
                  onClick={() => setIsOffline((prev) => !prev)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-bold transition-colors whitespace-nowrap ${
                    isOffline
                      ? 'border-amber-400/75 bg-amber-950/80 text-amber-200 hover:bg-amber-900/80'
                      : 'border-emerald-500/50 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/50'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isOffline ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'
                    }`}
                  />
                  <span>{offlineSyncMeta.shortBadgeText}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSubDrawer(null)}
                  className="h-8 rounded-lg border border-slate-700 bg-[#242d50] px-3 text-xs font-semibold text-slate-200 hover:bg-slate-700 whitespace-nowrap"
                >
                  关闭
                </button>
              </div>
            </div>

            {/* Mobile Segmented Switcher (Zero-Scroll Fit on 390x844) */}
            <div className="grid grid-cols-2 gap-2 lg:hidden">
              <button
                type="button"
                onClick={() => setAchTab('ach')}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-lg border text-xs font-bold transition-colors ${
                  achTab === 'ach'
                    ? 'border-[#0b0c15] bg-[#ffcd75] text-[#1a1c2c] shadow-[0_2px_0_#0b0c15]'
                    : 'border-slate-700 bg-[#141829] text-slate-300'
                }`}
              >
                <PixelSprite name="trophy" className="h-3.5 w-3.5" />
                <span>签到与 6 阶成就</span>
              </button>
              <button
                type="button"
                onClick={() => setAchTab('radar')}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-lg border text-xs font-bold transition-colors ${
                  achTab === 'radar'
                    ? 'border-[#0b0c15] bg-[#73eff7] text-[#1a1c2c] shadow-[0_2px_0_#0b0c15]'
                    : 'border-slate-700 bg-[#141829] text-slate-300'
                }`}
              >
                <PixelSprite name="seedChip" className="h-3.5 w-3.5" />
                <span>管件胜率雷达</span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12 items-stretch">
              {/* Left Column: Recharts Radar Chart - Level Win Rate & Pipe Difficulty (s/c/t/a) Average Clear Time */}
              <div
                data-testid="pipe-radar-panel"
                className={`${
                  achTab === 'radar' ? 'flex' : 'hidden lg:flex'
                } lg:col-span-6 flex-col justify-between rounded-xl border border-slate-800 bg-[#141829] p-3.5`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-mono font-bold text-[#73eff7]">
                      RADAR TELEMETRY · 关卡胜率分布 & 管件用时对比
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      对比直线管(s)、拐角管(c)、三通管(t)、增幅器(a)四类管件难度的胜率与平均通关用时
                    </p>
                  </div>
                  <span className="rounded border border-slate-700 bg-[#1a1c2c] px-2 py-0.5 font-mono text-[10px] text-amber-300 whitespace-nowrap">
                    {totalClearedCount > 0 ? '实测数据' : '基准预览'}
                  </span>
                </div>

                {/* Recharts RadarChart */}
                <div className="my-1 flex flex-col items-center justify-center">
                  <RadarChart
                    width={310}
                    height={195}
                    cx="50%"
                    cy="50%"
                    outerRadius={64}
                    data={pipeRadarData}
                  >
                    <PolarGrid stroke="#334155" />
                    <PolarAngleAxis
                      dataKey="axisLabel"
                      tick={{
                        fill: '#e2e8f0',
                        fontSize: 11,
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    />
                    <PolarRadiusAxis
                      angle={30}
                      domain={[0, 100]}
                      tick={{ fill: '#64748b', fontSize: 9 }}
                      stroke="#334155"
                    />
                    <Radar
                      name="关卡胜率 (%)"
                      dataKey="winRate"
                      stroke="#ffcd75"
                      strokeWidth={2}
                      fill="#ffcd75"
                      fillOpacity={0.34}
                      isAnimationActive={false}
                    />
                    <Radar
                      name="用时效率分 (对比基准)"
                      dataKey="timeIndex"
                      stroke="#73eff7"
                      strokeWidth={2}
                      fill="#73eff7"
                      fillOpacity={0.22}
                      isAnimationActive={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f1422',
                        borderColor: '#334155',
                        borderRadius: '8px',
                        fontSize: '11px',
                        color: '#f4f4f4',
                      }}
                      formatter={(
                        value: unknown,
                        name: unknown,
                        item: {
                          payload?: {
                            avgSec?: number;
                            benchmarkSec?: number;
                            clearedLevels?: number;
                            totalLevels?: number;
                          };
                        },
                      ) => {
                        const p = item?.payload;
                        if (String(name).includes('胜率')) {
                          return [
                            `${value}% (已通 ${p?.clearedLevels ?? 0}/${p?.totalLevels ?? 0} 关)`,
                            '关卡胜率分布',
                          ];
                        }
                        return [
                          `平均 ${p?.avgSec ?? 0}s (基准 ${p?.benchmarkSec ?? 0}s · 效率 ${value})`,
                          '管件用时表现',
                        ];
                      }}
                    />
                  </RadarChart>

                  {/* Non-overlapping Custom Radar Legend */}
                  <div className="mb-1.5 flex items-center justify-center gap-4 font-mono text-[11px]">
                    <span className="inline-flex items-center gap-1.5 text-[#ffcd75]">
                      <span className="h-2.5 w-2.5 rounded-xs bg-[#ffcd75]" />
                      <span>关卡胜率分布 (%)</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[#73eff7]">
                      <span className="h-2.5 w-2.5 rounded-xs bg-[#73eff7]" />
                      <span>平均用时表现 (对比基准)</span>
                    </span>
                  </div>
                </div>

                {/* 4-Pipe Difficulty (s / c / t / a) Average Time & Win Rate Breakdown */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 font-mono tabular-nums">
                  {pipeRadarData.map((row) => (
                    <div
                      key={row.kind}
                      data-pipe-stat={row.kind}
                      className="rounded-lg border border-slate-800/90 bg-[#1a1c2c] p-2"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-white">
                          {row.shortName}
                        </span>
                        <span className="text-[10px] text-amber-300">
                          {row.winRate}%
                        </span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {row.difficultyTag}
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px]">
                        <span className="text-cyan-300">均 {row.avgSec}s</span>
                        <span className="text-slate-500">
                          基 {row.benchmarkSec}s
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: Daily Sign-In Strip + 6-Tier Full-Campaign Achievements in Aligned 2x3 Grid */}
              <div
                className={`${
                  achTab === 'ach' ? 'flex' : 'hidden lg:flex'
                } lg:col-span-6 flex-col justify-between gap-2.5`}
              >
                {/* Daily Sign-In Strip */}
                <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-700 bg-[#242d50] p-2.5 sm:p-3">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-white">
                      <PixelSprite name="coin" className="h-3.5 w-3.5" />
                      <span>每日接力签到</span>
                    </div>
                    <div className="text-[11px] sm:text-xs text-slate-300 leading-snug">
                      每日签到领 100 金币 · 补充体力与收集
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!canSignToday}
                    onClick={() => {
                      if (!canSignToday) return;
                      setSave((prev) => ({
                        ...prev,
                        signDay: getTodayKey(),
                        coins: prev.coins + 100,
                      }));
                      soundFX.play('sign');
                    }}
                    className={`h-8 rounded-lg px-3 text-xs font-bold whitespace-nowrap shrink-0 ${
                      canSignToday
                        ? 'bg-[#ffcd75] text-[#1a1c2c] hover:bg-amber-300'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    {canSignToday ? '立即签到 (+100)' : '今日已签到'}
                  </button>
                </div>

                {/* 6-Tier Achievements in Symmetrical 2x3 Grid (Zero Scrollbar Needed on Mobile & Desktop) */}
                <div className="grid grid-cols-2 gap-2 flex-1">
                  {ACHIEVEMENTS.map((ach) => {
                    const cur = ach.progress(save);
                    const claimed = !!save.achClaimed[ach.id];
                    const ready = cur >= ach.goal && !claimed;
                    return (
                      <div
                        key={ach.id}
                        data-testid={`achievement-${ach.id}`}
                        className="flex flex-col justify-between gap-1.5 rounded-lg border border-slate-800 bg-[#141829] p-2.5"
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-white">
                              {ach.title}
                            </div>
                            <div className="mt-0.5 text-[10px] sm:text-[11px] leading-snug text-slate-400">
                              {ach.desc}
                            </div>
                          </div>
                          <span className="font-mono text-[10px] text-slate-400 tabular-nums shrink-0">
                            {Math.min(cur, ach.goal)}/{ach.goal}
                          </span>
                        </div>
                        <button
                          type="button"
                          disabled={!ready}
                          onClick={() => {
                            if (!ready) return;
                            setSave((prev) => ({
                              ...prev,
                              coins: prev.coins + ach.reward,
                              achClaimed: {
                                ...prev.achClaimed,
                                [ach.id]: true,
                              },
                            }));
                            soundFX.play('reward');
                          }}
                          className={`h-7 w-full rounded font-mono text-[11px] font-bold whitespace-nowrap ${
                            claimed
                              ? 'bg-slate-900 text-slate-500'
                              : ready
                                ? 'bg-[#ffcd75] text-[#1a1c2c] hover:bg-amber-300'
                                : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {claimed
                            ? '✓ 已领取'
                            : ready
                              ? `领取 +${ach.reward} 金币`
                              : `奖励 +${ach.reward} 金币`}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* STATE 3: PAUSE MODAL ('paused')                                   */}
      {/* ================================================================= */}
      {shellState === 'paused' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="游戏已暂停"
          className="fixed inset-0 z-40 flex items-center justify-center bg-[#090b12]/88 p-4 overflow-hidden no-scrollbar"
        >
          <div className="w-full max-w-md rounded-xl border-2 border-[#0b0c15] bg-[#1a1c2c] p-6 text-center shadow-[0_6px_0_#0b0c15]">
            <h2 className="text-2xl font-extrabold text-[#ffcd75]">
              接力暂停
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              暂停期间不计入通关用时 · 本机进度已自动保存
            </p>

            {/* 3 Tabular Stat Tiles */}
            <div className="my-5 grid grid-cols-3 gap-2 font-mono tabular-nums">
              <div className="rounded-lg border border-slate-800 bg-[#141829] p-2.5">
                <div className="text-[10px] text-slate-400">当前关卡</div>
                <div className="mt-0.5 text-sm font-bold text-white">
                  {activeLevel.id}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#141829] p-2.5">
                <div className="text-[10px] text-slate-400">已用步数</div>
                <div className="mt-0.5 text-sm font-bold text-[#ffcd75]">
                  {usedPipes}/{activeLevel.par}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-[#141829] p-2.5">
                <div className="text-[10px] text-slate-400">总星章</div>
                <div className="mt-0.5 text-sm font-bold text-emerald-400">
                  {totalStarsCount}/180 ★
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={resumeGameplay}
                className="w-full rounded-lg border-2 border-[#0b0c15] bg-[#ffcd75] py-3 text-sm font-bold text-[#1a1c2c] shadow-[0_3px_0_#0b0c15] hover:bg-amber-300"
              >
                继续接力 (Resume)
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="w-full rounded-lg border border-slate-700 bg-[#242d50] py-2.5 text-xs font-semibold text-white hover:bg-slate-700"
              >
                重新开始本关 (Restart)
              </button>
              <a
                href="/wx-assets/signal-relay-wx-v0.6.0-refactored.zip"
                download="signal-relay-wx-v0.6.0-refactored.zip"
                className="block w-full rounded-lg border border-emerald-500/40 bg-emerald-950/40 py-2.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-900/50"
              >
                下载重构版微信小游戏源码包 (v0.6.0 .zip · 41组测试全绿)
              </a>
              <button
                type="button"
                onClick={() => {
                  setSubDrawer(null);
                  setShellState('title');
                }}
                className="w-full rounded-lg border border-slate-800 bg-[#141829] py-2.5 text-xs font-medium text-slate-400 hover:text-white"
              >
                返回标题画面 (Title)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* STATE 4: VICTORY / STAGE CLEAR MODAL ('gameover')                 */}
      {/* ================================================================= */}
      {shellState === 'gameover' && victorySnap && (() => {
        const streakHint = getNextStreakCountdownHint(
          victorySnap,
          streakCountdownSec,
          15,
        );
        const coinRollPct =
          victorySnap.rewardCoins > 0
            ? Math.min(
                100,
                Math.max(
                  12,
                  Math.round(
                    (rollingRewardCoins / victorySnap.rewardCoins) * 100,
                  ),
                ),
              )
            : 100;
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="挑战成功结算"
            className="fixed inset-0 z-40 flex items-center justify-center bg-[#090b12]/88 p-2.5 sm:p-4 overflow-hidden no-scrollbar"
          >
            <div className="relative w-full max-w-md my-auto">
              {/* Golden Radiant Aura Surround Animation when Player Earns '连胜大师' Badge */}
              {victorySnap.streakMaster && (
                <>
                  <div
                    data-streak-golden-aura="true"
                    aria-hidden="true"
                    className="streak-master-golden-aura pointer-events-none absolute -inset-3.5 sm:-inset-5 rounded-3xl z-0"
                  />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -inset-1.5 rounded-2xl border-2 border-[#ffcd75]/75 shadow-[0_0_42px_rgba(255,205,117,0.55)] animate-pulse z-0"
                  />
                </>
              )}

              <div
                className={`relative z-10 w-full max-h-[94vh] overflow-y-auto no-scrollbar rounded-xl border-2 border-[#0b0c15] bg-[#1a1c2c] p-4 sm:p-5 text-center shadow-[0_6px_0_#0b0c15] ${
                  victorySnap.streakMaster ? 'streak-master-modal-border' : ''
                }`}
              >
                {/* Temporary Win Streak Countdown Banner at Top of VictorySnapshot Modal */}
                <div
                  data-streak-countdown-banner="true"
                  className="mb-3 rounded-xl border border-cyan-400/55 bg-gradient-to-r from-[#132238] via-[#182c46] to-[#132238] p-2.5 text-left shadow-[0_0_14px_rgba(115,239,247,0.18)]"
                >
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                    <span className="inline-flex items-center gap-1.5 font-extrabold text-cyan-300">
                      <span className="inline-block h-2 w-2 rounded-full bg-cyan-300 animate-pulse" />
                      <span>{streakHint.headline}</span>
                    </span>
                    <span className="rounded bg-[#ffcd75] px-1.5 py-0.5 text-[10px] font-extrabold text-[#1a1c2c] whitespace-nowrap">
                      下一关 3★ 奖 +{streakHint.nextBonusCoins} 金币
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-slate-200">
                    {streakHint.detail}
                  </p>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-950/90">
                    <div
                      data-streak-countdown-bar="true"
                      className="h-full bg-gradient-to-r from-cyan-400 via-[#73eff7] to-[#ffcd75] transition-all duration-500"
                      style={{ width: `${streakHint.progressPct}%` }}
                    />
                  </div>
                </div>

                <div className="text-xs font-mono text-slate-400">
                  {victorySnap.levelTitle}
                </div>
                <h2 className="mt-0.5 text-xl sm:text-2xl font-extrabold text-[#ffcd75]">
                  挑战成功
                </h2>

                <div className="my-2 text-3xl sm:text-4xl tracking-widest text-[#ffcd75]">
                  {'★'.repeat(victorySnap.stars)}
                  {'☆'.repeat(3 - victorySnap.stars)}
                </div>

                {/* Win Streak Master Badge (awarded when achieving 3 stars across 3 consecutive levels) */}
                {victorySnap.streakMaster && (
                  <div
                    data-streak-master-badge="true"
                    className="my-2.5 flex items-center justify-between gap-2 rounded-xl border-2 border-[#ffcd75] bg-gradient-to-r from-amber-950/90 via-[#2a2218] to-amber-950/90 px-3 py-2 text-left shadow-[0_0_16px_rgba(255,205,117,0.32)]"
                  >
                    <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#ffcd75]/80 bg-[#ffcd75]/20">
                        <PixelSprite name="trophy" className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-extrabold tracking-wide text-[#ffcd75]">
                            连胜大师
                          </span>
                          <span className="rounded bg-[#ffcd75] px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-[#1a1c2c]">
                            {victorySnap.threeStarStreak} 连满星
                          </span>
                        </div>
                        <div className="whitespace-nowrap text-[11px] text-amber-200/90">
                          连续 3 关满星 · 触发金色光环加奖
                        </div>
                      </div>
                    </div>
                    <span
                      data-streak-bonus-coins={victorySnap.streakBonusCoins}
                      className="shrink-0 rounded-lg border border-[#ffcd75]/70 bg-[#1a1c2c] px-2.5 py-1 font-mono text-xs font-extrabold text-[#ffcd75] tabular-nums whitespace-nowrap"
                    >
                      +{rollingBonusCoins} 金币
                    </span>
                  </div>
                )}

                {/* 3 Tabular Mastery Metric Tiles (with Unified 4-Line Rhythm & Coin Rolling Visual Effect) */}
                <div className="my-3 grid grid-cols-3 gap-2 font-mono tabular-nums">
                  <div className="rounded-lg border border-slate-800 bg-[#141829] p-2 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 whitespace-nowrap">
                      <span>本局用时</span>
                      <span className="text-[9px] text-cyan-300">最佳纪录</span>
                    </div>
                    <div className="mt-0.5 text-sm sm:text-base font-extrabold text-white whitespace-nowrap">
                      {victorySnap.clearSec}s / {victorySnap.bestSec}s
                    </div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-950/90">
                      <div
                        className="h-full bg-cyan-400"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(
                              20,
                              Math.round(
                                (Math.max(1, victorySnap.bestSec) /
                                  Math.max(1, victorySnap.clearSec)) *
                                  100,
                              ),
                            ),
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="mt-1 text-[9px] text-cyan-300/90 whitespace-nowrap">
                      {victorySnap.clearSec <= victorySnap.bestSec
                        ? '★ 刷新最佳用时'
                        : '稳定接通回路'}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-800 bg-[#141829] p-2 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 whitespace-nowrap">
                      <span>管件步数</span>
                      <span className="text-[9px] text-emerald-300">标准配额</span>
                    </div>
                    <div className="mt-0.5 text-sm sm:text-base font-extrabold text-emerald-400 whitespace-nowrap">
                      {victorySnap.usedPipes}/{victorySnap.parPipes}
                    </div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-950/90">
                      <div
                        className="h-full bg-emerald-400"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(
                              25,
                              Math.round(
                                (victorySnap.parPipes /
                                  Math.max(1, victorySnap.usedPipes)) *
                                  100,
                              ),
                            ),
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="mt-1 text-[9px] text-emerald-300/90 whitespace-nowrap">
                      {victorySnap.usedPipes <= victorySnap.parPipes
                        ? '✓ 最优标准步数'
                        : '可精简波导数'}
                    </div>
                  </div>

                  <div
                    data-coin-settlement="true"
                    data-coin-rolling={isCoinRolling ? 'true' : 'false'}
                    data-target-reward-coins={victorySnap.rewardCoins}
                    className={`rounded-lg border p-2 flex flex-col justify-between transition-all ${
                      victorySnap.streakMaster
                        ? 'border-[#ffcd75]/80 bg-gradient-to-b from-[#2b2215] to-[#141829] shadow-[0_0_14px_rgba(255,205,117,0.25)]'
                        : 'border-amber-500/40 bg-[#141829]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-amber-200/90 whitespace-nowrap">
                      <span>奖励金币</span>
                      <span className="text-[9px] text-amber-300">滚动结算</span>
                    </div>
                    <div
                      data-coin-roll-value={rollingRewardCoins}
                      className={`mt-0.5 inline-block text-sm sm:text-base font-extrabold text-[#ffcd75] ${
                        isCoinRolling ? 'coin-roll-active' : 'coin-roll-settled'
                      }`}
                    >
                      +{rollingRewardCoins}
                    </div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-950/90">
                      <div
                        className="h-full bg-gradient-to-r from-amber-400 via-[#ffe8a3] to-[#ffcd75] transition-all duration-150"
                        style={{ width: `${coinRollPct}%` }}
                      />
                    </div>
                    <div className="mt-1 text-[9px] text-amber-300/95 whitespace-nowrap">
                      {victorySnap.streakMaster
                        ? `基础+${victorySnap.baseRewardCoins} 连胜+${rollingBonusCoins}`
                        : `通关+${victorySnap.baseRewardCoins} 金币`}
                    </div>
                  </div>
                </div>

                {/* 3-Star Breakdown */}
                <div className="mb-3.5 space-y-1.5 rounded-lg border border-slate-800 bg-[#141829] p-2.5 text-left text-xs">
                  {victorySnap.goals.map((g, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center justify-between gap-2 ${
                        g.ok ? 'text-emerald-300' : 'text-amber-300'
                      }`}
                    >
                      <span className="truncate">
                        {g.ok ? '✓ 已达成 · ' : '☆ 未达成 · '}
                        {g.text}
                      </span>
                      <span className="font-mono font-bold shrink-0">
                        {g.ok ? '+1 ★' : '0 ★'}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex-1 h-10 sm:h-11 rounded-lg border border-slate-700 bg-[#242d50] text-xs font-semibold text-white hover:bg-slate-700 whitespace-nowrap"
                  >
                    再练一次
                  </button>
                  <button
                    type="button"
                    data-start="true"
                    onClick={handleNextLevel}
                    className="flex-[1.6] h-10 sm:h-11 rounded-lg border-2 border-[#0b0c15] bg-[#ffcd75] text-xs sm:text-sm font-bold text-[#1a1c2c] shadow-[0_3px_0_#0b0c15] hover:bg-amber-300 whitespace-nowrap"
                  >
                    {mode === 'campaign' && campaignIdx + 1 < CAMPAIGN_LEVELS.length
                      ? `下一关 (${CAMPAIGN_LEVELS[campaignIdx + 1].id})`
                      : mode === 'seed'
                        ? '随机下一题种子'
                        : '再来一局'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
