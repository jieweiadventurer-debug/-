import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  CAMPAIGN_LEVELS,
  CAMPAIGN_SOLUTIONS,
  DAILY_LEVELS,
  DAILY_SOLUTIONS,
  CONFIG,
  SPRITES,
  RawLevel,
  SolutionStep,
} from '../wx-data/gameData';
import {
  parseLevel,
  propagate,
  portsOf,
  DV,
  diagnose,
  checkRoute,
  nextHint,
  applyHint,
  BoardPiece,
  PieceKind,
  PropagationResult,
} from '../game/propagateEngine';
import {
  Volume2,
  VolumeX,
  RotateCcw,
  Sparkles,
  Undo2,
  Eye,
  Compass,
  HelpCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Award,
  Calendar,
  Settings,
} from 'lucide-react';

interface GameSimulatorProps {
  activeLevel: RawLevel;
  activeSolution?: SolutionStep[];
  isDaily?: boolean;
  isSeedMode?: boolean;
  seedLabel?: string;
  v054FixesEnabled: boolean;
  onSelectCampaignLevel: (index: number) => void;
  onOpenDaily: () => void;
}

type SimScreen = 'home' | 'game' | 'settings';
type VolumeLevel = 'low' | 'mid' | 'high';

interface SaveState {
  coins: number;
  energy: number;
  stars: Record<string, number>;
  best: Record<string, { sec: number }>;
  signDay: string;
  ach: Record<string, boolean>;
  tasks: { day: string; clear: number; par: number; claimed: Record<string, boolean> };
  settings: {
    sound: boolean;
    music: boolean;
    volumeLevel: VolumeLevel;
    vibration: boolean;
    flow: 30 | 60 | 120;
    reduceMotion: boolean;
    highContrast: boolean;
  };
}

const VOLUME_MAP: Record<VolumeLevel, { label: string; sfx: number; music: number }> = {
  low: { label: '低', sfx: 0.3, music: 0.18 },
  mid: { label: '中', sfx: 0.6, music: 0.35 },
  high: { label: '高', sfx: 1.0, music: 0.55 },
};

const PIECE_NAMES: Record<PieceKind, string> = {
  s: '直线',
  c: '拐角',
  t: '三通',
  a: '增幅',
};

const COLOR_MARKS: Record<string, string> = {
  red: 'R',
  blue: 'B',
  green: 'G',
  yellow: 'Y',
};

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const GameSimulator: React.FC<GameSimulatorProps> = ({
  activeLevel,
  activeSolution,
  isDaily = false,
  isSeedMode = false,
  seedLabel,
  v054FixesEnabled,
  onSelectCampaignLevel,
  onOpenDaily,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const sfxPoolRef = useRef<Record<string, HTMLAudioElement>>({});

  const [screen, setScreen] = useState<SimScreen>('game');
  const [save, setSave] = useState<SaveState>(() => ({
    coins: 350,
    energy: 28,
    stars: { '1-1': 3, '1-2': 3, '1-3': 2 },
    best: { '1-1': { sec: 5 }, '1-2': { sec: 8 }, '1-3': { sec: 14 } },
    signDay: '',
    ach: {},
    tasks: { day: todayKey(), clear: 3, par: 2, claimed: {} },
    settings: {
      sound: true,
      music: false,
      volumeLevel: 'mid',
      vibration: true,
      flow: 60,
      reduceMotion: false,
      highContrast: false,
    },
  }));

  const parsed = parseLevel(activeLevel);
  const [board, setBoard] = useState<(BoardPiece | null)[][]>(() =>
    parsed.fix.map((r) => r.map(() => null)),
  );
  const [inv, setInv] = useState<Record<PieceKind, number>>(() => ({
    ...activeLevel.inv,
  }));
  const [sel, setSel] = useState<PieceKind>('s');
  const [hist, setHist] = useState<
    { r: number; c: number; p: BoardPiece | null; inv: Record<PieceKind, number> }[]
  >([]);
  const [undoUsed, setUndoUsed] = useState(0);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [coachMsg, setCoachMsg] = useState<string>(
    '点空格放置管件，点管件旋转，右键或长按取回管件',
  );
  const [checkCells, setCheckCells] = useState<string[]>([]);
  const [hintCell, setHintCell] = useState<{
    r: number;
    c: number;
    text: string;
    raw: ReturnType<typeof nextHint>;
  } | null>(null);
  const [wonInfo, setWonInfo] = useState<{ stars: number; sec: number; reward: number } | null>(
    null,
  );
  const [elapsedSec, setElapsedSec] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const spriteCacheRef = useRef<Record<string, HTMLCanvasElement>>({});

  // Preload real wav sfx from unpacked WeChat mini-game package
  useEffect(() => {
    const names = ['place', 'rotate', 'win', 'reward', 'sign'];
    names.forEach((n) => {
      const audio = new Audio(`/wx-assets/audio/${n}.wav`);
      audio.preload = 'auto';
      sfxPoolRef.current[n] = audio;
    });
    const bgm = new Audio('/wx-assets/music/relay-loop.mp3');
    bgm.loop = true;
    bgm.preload = 'auto';
    bgmRef.current = bgm;
    return () => {
      bgm.pause();
    };
  }, []);

  const playSfx = useCallback(
    (name: 'place' | 'rotate' | 'win' | 'reward' | 'sign') => {
      if (!save.settings.sound) return;
      const audio = sfxPoolRef.current[name];
      if (!audio) return;
      try {
        audio.volume = VOLUME_MAP[save.settings.volumeLevel].sfx;
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } catch {
        // Ignore autoplay restrictions
      }
    },
    [save.settings.sound, save.settings.volumeLevel],
  );

  // Reset level state when activeLevel changes
  useEffect(() => {
    const { fix } = parseLevel(activeLevel);
    setBoard(fix.map((r) => r.map(() => null)));
    setInv({ ...activeLevel.inv });
    const firstTool = (['s', 'c', 't', 'a'] as PieceKind[]).find(
      (k) => activeLevel.inv[k] > 0,
    );
    setSel(firstTool || 's');
    setHist([]);
    setUndoUsed(0);
    setSelectedColor(null);
    setCheckCells([]);
    setHintCell(null);
    setWonInfo(null);
    setElapsedSec(0);
    startTimeRef.current = null;
    setCoachMsg(
      isSeedMode
        ? `种子挑战 ${seedLabel || activeLevel.id} · 连接所有同色字母节点`
        : isDaily
          ? `每日挑战 (${activeLevel.id}) · 首次接通奖励 100 金币`
          : `第 ${activeLevel.id} 关 · 点空格放置，点管件旋转，右键/长按取回`,
    );
  }, [activeLevel, isDaily, isSeedMode, seedLabel]);

  // Timer tick
  useEffect(() => {
    if (wonInfo || screen !== 'game') return;
    const id = window.setInterval(() => {
      if (startTimeRef.current !== null) {
        setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [wonInfo, screen]);

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

  const safeBoard: (BoardPiece | null)[][] =
    board.length === parsed.R && (board[0]?.length ?? 0) === parsed.C
      ? board
      : parsed.fix.map((r) => r.map(() => null));

  const propResult: PropagationResult = propagate(
    parsed.R,
    parsed.C,
    parsed.fix,
    safeBoard,
    activeLevel.range === undefined ? null : activeLevel.range,
  );

  const usedCount = safeBoard.flat().filter(Boolean).length;

  // Check victory
  const checkAndTriggerWin = useCallback(
    (nextBoard: (BoardPiece | null)[][], nextUndoUsed: number) => {
      const res = propagate(
        parsed.R,
        parsed.C,
        parsed.fix,
        nextBoard,
        activeLevel.range === undefined ? null : activeLevel.range,
      );
      if (res.win && !wonInfo) {
        const used = nextBoard.flat().filter(Boolean).length;
        let totalStarsCells = 0;
        let collectedStars = 0;
        parsed.fix.forEach((row, r) =>
          row.forEach((f, c) => {
            if (f && f.k === 'star') {
              totalStarsCells++;
              if (res.lit.has(`${r},${c}`)) collectedStars++;
            }
          }),
        );
        const ok2 = used <= activeLevel.par;
        const ok3 = totalStarsCells ? collectedStars === totalStarsCells : nextUndoUsed === 0;
        const stars = 1 + (ok2 ? 1 : 0) + (ok3 ? 1 : 0);
        const sec =
          startTimeRef.current !== null
            ? Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000))
            : 1;
        const oldStars = save.stars[activeLevel.id] || 0;
        const reward = isDaily
          ? 100
          : oldStars === 0
            ? 200
            : stars > oldStars
              ? 50
              : 0;

        setSave((prev) => ({
          ...prev,
          coins: prev.coins + reward,
          stars: {
            ...prev.stars,
            [activeLevel.id]: Math.max(oldStars, stars),
          },
          best: {
            ...prev.best,
            [activeLevel.id]: {
              sec: prev.best[activeLevel.id]
                ? Math.min(prev.best[activeLevel.id].sec, sec)
                : sec,
            },
          },
        }));
        setWonInfo({ stars, sec, reward });
        setCoachMsg(`接力完成！获得 ${stars} 星 · 用时 ${sec}s · 金币 +${reward}`);
        playSfx('win');
      } else if (res.bad.size > 0) {
        const diag = diagnose(res, parsed.fix);
        setCoachMsg(diag ? diag.message : '信号冲突了，请检查红框中的交叉连接');
      } else {
        const diag = diagnose(res, parsed.fix);
        if (diag) setCoachMsg(diag.message);
        else if (res.reached.size > 0) {
          setCoachMsg(`已点亮 ${res.reached.size}/${res.total} 个目标，继续铺设路线`);
        }
      }
    },
    [
      parsed.R,
      parsed.C,
      parsed.fix,
      activeLevel.range,
      activeLevel.par,
      activeLevel.id,
      wonInfo,
      save.stars,
      isDaily,
      playSfx,
    ],
  );

  // Compute board geometry on 360x420 canvas
  const CW = 360;
  const CH = 380;
  const u = Math.max(2, Math.floor((CW * 0.9) / (parsed.C * 16)));
  const cs = 16 * u;
  const bx = Math.round((CW - parsed.C * cs) / 2);
  const by = Math.round((CH - parsed.R * cs) / 2);

  // Render Canvas2D board using authentic Signal Relay pixel rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;

    const highContrast = save.settings.highContrast;
    g.clearRect(0, 0, CW, CH);

    // Background
    if (highContrast) {
      g.fillStyle = '#101827';
      g.fillRect(0, 0, CW, CH);
    } else {
      const grad = g.createLinearGradient(0, 0, 0, CH);
      grad.addColorStop(0, '#1a1c2c');
      grad.addColorStop(1, '#242d50');
      g.fillStyle = grad;
      g.fillRect(0, 0, CW, CH);
    }

    const drawPipe = (x: number, y: number, ports: string[], color: string | null) => {
      const rect: Record<string, (a: number, b: number, w: number) => [number, number, number, number]> = {
        U: (a, b, w) => [x + a, y, w, 8 * u + b],
        D: (a, b, w) => [x + a, y + 8 * u - b, w, 8 * u + b],
        L: (a, b, w) => [x, y + a, 8 * u + b, w],
        R: (a, b, w) => [x + 8 * u - b, y + a, 8 * u + b, w],
      };
      const layers: [number, number, number, string | null][] = [
        [5, 3, 6, '#1a1c2c'],
        [6, 2, 4, '#b3b9d1'],
        [7, 1, 2, color],
      ];
      layers.forEach(([a, b, w, fill]) => {
        if (!fill) return;
        g.fillStyle = fill;
        ports.forEach((d) => {
          const r = rect[d](a * u, b * u, w * u);
          g.fillRect(r[0], r[1], r[2], r[3]);
        });
      });

      if (color && highContrast) {
        const kind = Object.keys(CONFIG.COLORS).find(
          (k) => CONFIG.COLORS[k as keyof typeof CONFIG.COLORS] === color,
        );
        g.fillStyle = '#ffffff';
        for (const d of ports) {
          const [dy, dx] = DV[d as keyof typeof DV];
          for (const n of [3, 6]) {
            const px = x + (8 + dx * n) * u;
            const py = y + (8 + dy * n) * u;
            if (kind === 'red') g.fillRect(px - u / 2, py - u, u, 2 * u);
            else if (kind === 'blue') g.fillRect(px - u, py - u / 2, 2 * u, u);
            else if (kind === 'green') {
              g.fillRect(px - u, py - u, u, u);
              g.fillRect(px, py, u, u);
            } else {
              g.fillRect(px - u, py - u, u, u);
              g.fillRect(px + u / 2, py - u, u, u);
            }
          }
        }
      }
    };

    // Board outer frame
    g.fillStyle = '#0b0c15';
    g.fillRect(bx - u * 2, by - u * 2 + 3, parsed.C * cs + u * 4, parsed.R * cs + u * 4);
    g.fillStyle = '#1a1c2c';
    g.fillRect(bx - u * 2, by - u * 2, parsed.C * cs + u * 4, parsed.R * cs + u * 4);

    for (let r = 0; r < parsed.R; r++) {
      for (let c = 0; c < parsed.C; c++) {
        const x = bx + c * cs;
        const y = by + r * cs;
        const f = parsed.fix[r][c];
        const pc = safeBoard[r] ? safeBoard[r][c] : null;
        const key = `${r},${c}`;
        const lit = propResult.lit.get(key);

        g.fillStyle = (r + c) % 2 ? '#4a5d78' : '#566c86';
        g.fillRect(x, y, cs, cs);
        g.strokeStyle = 'rgba(0,0,0,.28)';
        g.lineWidth = 1;
        g.strokeRect(x, y, cs, cs);

        if (f && f.k === 'obs' && f.e) {
          g.imageSmoothingEnabled = false;
          g.drawImage(bakeSprite(f.e, u * 2), x, y);
        } else if (f && f.k === 'bridge') {
          g.fillStyle = '#a8714f';
          g.fillRect(x, y, cs, cs);
          g.fillStyle = '#73464c';
          for (let i = 0; i < 16; i += 4) {
            g.fillRect(x, y + (i + 3) * u, cs, u);
          }
          const raw = propResult.br.get(key) || {};
          drawPipe(
            x,
            y,
            ['L', 'R'],
            raw.h ? CONFIG.COLORS[raw.h] : null,
          );
          drawPipe(
            x,
            y,
            ['U', 'D'],
            raw.v ? CONFIG.COLORS[raw.v] : null,
          );
        } else if (f && (f.k === 'src' || f.k === 'tgt') && f.d && f.col) {
          const on = f.k === 'src' || !!lit;
          const colHex = CONFIG.COLORS[f.col];
          drawPipe(x, y, [f.d], colHex);
          if (f.k === 'tgt') {
            const [dy, dx] = DV[f.d];
            g.fillStyle = '#ffffff';
            for (let step = 0; step < 3; step++) {
              for (const side of step ? [-1, 1] : [0]) {
                const a = 5 + step;
                const b = step * side;
                g.fillRect(
                  Math.round(x + (8 + dx * a - dy * b) * u - u / 2),
                  Math.round(y + (8 + dy * a + dx * b) * u - u / 2),
                  u,
                  u,
                );
              }
            }
          }
          g.fillStyle = '#1a1c2c';
          g.fillRect(x + 3 * u, y + 3 * u, 10 * u, 10 * u);
          g.fillStyle = colHex;
          g.fillRect(x + 4 * u, y + 4 * u, 8 * u, 8 * u);
          g.fillStyle = on ? '#ffffff' : '#1a1c2c';
          g.fillRect(x + 5 * u, y + 5 * u, 6 * u, 6 * u);
          g.font = `bold ${Math.max(10, 5 * u)}px "Plus Jakarta Sans", sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillStyle = on ? '#1a1c2c' : '#ffffff';
          g.fillText(COLOR_MARKS[f.col], x + 8 * u, y + 8 * u);

          if (selectedColor === f.col) {
            g.strokeStyle = '#ffffff';
            g.lineWidth = u;
            g.strokeRect(x + u, y + u, 14 * u, 14 * u);
          }
          if (propResult.targetIssues.has(key) && !propResult.reached.has(key)) {
            g.strokeStyle = '#ffcd75';
            g.lineWidth = u;
            g.strokeRect(x + 2 * u, y + 2 * u, 12 * u, 12 * u);
          }
        }

        if (f && f.k === 'star') {
          const size = Math.min(cs, 8 * Math.max(1, Math.floor((cs * 0.92) / 8)));
          g.imageSmoothingEnabled = false;
          g.drawImage(
            bakeSprite('starPoint', 1, !lit),
            Math.round(x + (cs - size) / 2),
            Math.round(y + (cs - size) / 2),
            size,
            size,
          );
        }

        if (pc) {
          drawPipe(
            x,
            y,
            portsOf(pc),
            lit ? CONFIG.COLORS[lit] : null,
          );
          if (pc.t === 'a') {
            g.font = `bold ${Math.round(cs * 0.45)}px "Plus Jakarta Sans", sans-serif`;
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillStyle = '#ffcd75';
            g.fillText('+', x + cs / 2, y + cs / 2);
          }
        }

        if (hintCell && hintCell.r === r && hintCell.c === c) {
          g.strokeStyle = '#ffcd75';
          g.lineWidth = 2.5;
          g.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
        }

        if (propResult.exhausted.has(key)) {
          g.strokeStyle = '#ffcd75';
          g.lineWidth = 2;
          g.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
          g.font = `bold ${Math.max(11, 5 * u)}px "Plus Jakarta Sans", sans-serif`;
          g.fillStyle = '#ffcd75';
          g.fillText('!', x + cs - 4 * u, y + 4 * u);
        }

        if (checkCells.includes(key)) {
          g.strokeStyle = '#73eff7';
          g.lineWidth = 2.5;
          g.strokeRect(x + 1.5, y + 1.5, cs - 3, cs - 3);
        }

        if (propResult.bad.has(key)) {
          g.strokeStyle = '#ef4b5c';
          g.lineWidth = u;
          g.strokeRect(x + u / 2, y + u / 2, cs - u, cs - u);
        }
      }
    }
  }, [
    parsed.R,
    parsed.C,
    parsed.fix,
    board,
    propResult,
    u,
    cs,
    bx,
    by,
    bakeSprite,
    selectedColor,
    hintCell,
    checkCells,
    save.settings.highContrast,
  ]);

  const handleCellAction = (r: number, c: number, isRemove: boolean) => {
    if (wonInfo) return;
    if (startTimeRef.current === null) startTimeRef.current = Date.now();
    const f = parsed.fix[r][c];
    const pc = board[r][c];

    if (f && f.k !== 'star') {
      if (f.k === 'src' || f.k === 'tgt') {
        setSelectedColor((prev) => (prev === f.col ? null : f.col || null));
        setCoachMsg(
          f.k === 'src'
            ? `${f.col?.toUpperCase()} 实心框是发射端，请连接同色空心接收端`
            : `${f.col?.toUpperCase()} 空心框是接收端，请从白色箭头侧接入同色信号`,
        );
      } else if (f.k === 'bridge') {
        setCoachMsg('桥的横向与纵向通道各自独立直通，不能在桥上转弯');
      } else {
        setCoachMsg('障碍物格不可放置管件，请绕行铺设');
      }
      return;
    }

    if (isRemove) {
      if (!pc) return;
      setHist((prev) => [...prev.slice(-49), { r, c, p: { ...pc }, inv: { ...inv } }]);
      const nextBoard = board.map((row, ri) =>
        row.map((cell, ci) => (ri === r && ci === c ? null : cell)),
      );
      const nextInv = { ...inv, [pc.t]: inv[pc.t] + 1 };
      setBoard(nextBoard);
      setInv(nextInv);
      setSel((curSel) => (nextInv[curSel] > 0 ? curSel : pc.t));
      setHintCell(null);
      setCheckCells([]);
      if (v054FixesEnabled) playSfx('rotate'); // v0.5.4 optimization: audio feedback on remove
      setCoachMsg(`已取回第 ${r + 1} 行、第 ${c + 1} 列的${PIECE_NAMES[pc.t]}`);
      checkAndTriggerWin(nextBoard, undoUsed);
      return;
    }

    if (pc) {
      setHist((prev) => [...prev.slice(-49), { r, c, p: { ...pc }, inv: { ...inv } }]);
      const nextBoard = board.map((row, ri) =>
        row.map((cell, ci) =>
          ri === r && ci === c && cell ? { ...cell, k: (cell.k + 1) % 4 } : cell,
        ),
      );
      setBoard(nextBoard);
      setHintCell(null);
      setCheckCells([]);
      playSfx('rotate');
      checkAndTriggerWin(nextBoard, undoUsed);
      return;
    }

    if (!sel || inv[sel] <= 0) {
      setCoachMsg('当前管件库存已用完：右键/长按取回棋盘管件，或点击撤回');
      return;
    }

    setHist((prev) => [...prev.slice(-49), { r, c, p: null, inv: { ...inv } }]);
    const nextBoard = board.map((row, ri) =>
      row.map((cell, ci) => (ri === r && ci === c ? { t: sel, k: 0 } : cell)),
    );
    const nextInv = { ...inv, [sel]: inv[sel] - 1 };
    setBoard(nextBoard);
    setInv(nextInv);
    if (nextInv[sel] === 0) {
      const fallback = (['s', 'c', 't', 'a'] as PieceKind[]).find(
        (k) => nextInv[k] > 0,
      );
      if (fallback) setSel(fallback);
    }
    setHintCell(null);
    setCheckCells([]);
    playSfx('place');
    checkAndTriggerWin(nextBoard, undoUsed);
  };

  const getCellFromPointer = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const c = Math.floor((x - bx) / cs);
    const r = Math.floor((y - by) / cs);
    if (r >= 0 && c >= 0 && r < parsed.R && c < parsed.C) return { r, c };
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 2) return;
    const cell = getCellFromPointer(e);
    if (!cell) return;
    longPressTriggeredRef.current = false;
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      handleCellAction(cell.r, cell.c, true);
    }, 450);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 2) return;
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (longPressTriggeredRef.current) return;
    const cell = getCellFromPointer(e);
    if (cell) handleCellAction(cell.r, cell.c, false);
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const cell = getCellFromPointer(e);
    if (cell) handleCellAction(cell.r, cell.c, true);
  };

  const handleUndo = () => {
    if (!hist.length || wonInfo) {
      setCoachMsg('没有可撤回的操作');
      return;
    }
    const last = hist[hist.length - 1];
    const nextBoard = board.map((row, ri) =>
      row.map((cell, ci) => (ri === last.r && ci === last.c ? last.p : cell)),
    );
    setBoard(nextBoard);
    setInv(last.inv);
    setHist((prev) => prev.slice(0, -1));
    setUndoUsed((uCount) => uCount + 1);
    if (v054FixesEnabled) playSfx('rotate');
    setCoachMsg('已撤回上一步');
  };

  const handleReset = () => {
    setBoard(parsed.fix.map((r) => r.map(() => null)));
    setInv({ ...activeLevel.inv });
    setHist([]);
    setUndoUsed(0);
    setWonInfo(null);
    setHintCell(null);
    setCheckCells([]);
    setCoachMsg('已清空本关管件，重新开始接力（不扣体力）');
  };

  const handleAutoSolve = () => {
    const sol =
      activeSolution ||
      CAMPAIGN_SOLUTIONS[activeLevel.id] ||
      DAILY_SOLUTIONS[activeLevel.id];
    if (!sol) {
      setCoachMsg('未找到该关卡的参考解');
      return;
    }
    if (startTimeRef.current === null) startTimeRef.current = Date.now() - 6000;
    const nextBoard: (BoardPiece | null)[][] = parsed.fix.map((r) =>
      r.map(() => null),
    );
    const nextInv = { ...activeLevel.inv };
    sol.forEach(([r, c, t, k]) => {
      nextBoard[r][c] = { t, k };
      if (nextInv[t] > 0) nextInv[t]--;
    });
    setBoard(nextBoard);
    setInv(nextInv);
    setHintCell(null);
    setCheckCells([]);
    checkAndTriggerWin(nextBoard, 0);
  };

  const handleAskHint = () => {
    const h = nextHint(activeLevel, board, activeSolution);
    if (!h) {
      setCoachMsg('当前盘面已是完整参考路线！');
      return;
    }
    const dirMap: Record<string, string> = { U: '上', R: '右', D: '下', L: '左' };
    const text =
      h.kind === 'remove'
        ? `提示：取回第 ${h.r + 1} 行、第 ${h.c + 1} 列的管件以腾出库存`
        : `提示：在第 ${h.r + 1} 行、第 ${h.c + 1} 列${h.kind === 'rotate' ? '旋转' : '放置'}${PIECE_NAMES[h.piece.t]}（朝${portsOf(h.piece).map((d) => dirMap[d]).join('、')}）`;
    setHintCell({ r: h.r, c: h.c, text, raw: h });
    setCoachMsg(text);
  };

  const handleApplyHintStep = () => {
    const h = hintCell?.raw || nextHint(activeLevel, board, activeSolution);
    if (!h) return;
    if (startTimeRef.current === null) startTimeRef.current = Date.now();
    const nextBoard = board.map((row) => row.map((c) => (c ? { ...c } : null)));
    const nextInv = { ...inv };
    setHist((prev) => [
      ...prev.slice(-49),
      { r: h.r, c: h.c, p: board[h.r][h.c] ? { ...board[h.r][h.c]! } : null, inv: { ...inv } },
    ]);
    if (applyHint(nextBoard, nextInv, h)) {
      setBoard(nextBoard);
      setInv(nextInv);
      setHintCell(null);
      playSfx('place');
      setCoachMsg(`已自动执行提示：第 ${h.r + 1} 行、第 ${h.c + 1} 列`);
      checkAndTriggerWin(nextBoard, undoUsed);
    }
  };

  const handleRouteCheck = () => {
    const res = checkRoute(propResult, parsed.fix);
    setCheckCells(res.cells);
    setCoachMsg(`线路自查：${res.message}`);
  };

  const toggleMusic = () => {
    const nextMusic = !save.settings.music;
    setSave((prev) => ({
      ...prev,
      settings: { ...prev.settings, music: nextMusic },
    }));
    const bgm = bgmRef.current;
    if (bgm) {
      if (nextMusic) {
        bgm.volume = VOLUME_MAP[save.settings.volumeLevel].music;
        bgm.play().catch(() => {});
      } else {
        bgm.pause();
      }
    }
  };

  const cycleVolume = () => {
    const order: VolumeLevel[] = ['low', 'mid', 'high'];
    const nextLevel =
      order[(order.indexOf(save.settings.volumeLevel) + 1) % order.length];
    setSave((prev) => ({
      ...prev,
      settings: { ...prev.settings, volumeLevel: nextLevel },
    }));
    // Demonstrate Issue #1 difference between v0.5.3 and v0.5.4!
    if (v054FixesEnabled && bgmRef.current) {
      bgmRef.current.volume = VOLUME_MAP[nextLevel].music;
    }
    try {
      const sfx = sfxPoolRef.current.place;
      if (sfx && save.settings.sound) {
        sfx.volume = VOLUME_MAP[nextLevel].sfx;
        sfx.currentTime = 0;
        sfx.play().catch(() => {});
      }
    } catch {
      // ignore
    }
  };

  const currentCampaignIdx = CAMPAIGN_LEVELS.findIndex(
    (l) => l.id === activeLevel.id,
  );

  // Achievements list: 3 in v0.5.3 vs 6 in v0.5.4
  const totalCleared = Object.keys(save.stars).length;
  const totalStarsEarned = Object.values(save.stars).reduce((a, b) => a + b, 0);
  const achievementsList = v054FixesEnabled
    ? [
        { id: 'first', title: '初次点亮 (1关)', goal: 1, val: totalCleared, reward: 100 },
        { id: 'ten', title: '接力达人 (10关)', goal: 10, val: totalCleared, reward: 300 },
        { id: 'thirty', title: '半程贯通 (30关)', goal: 30, val: totalCleared, reward: 400 },
        { id: 'allclear', title: '全域接通 (60关)', goal: 60, val: totalCleared, reward: 600 },
        { id: 'stars', title: '星光收藏家 (30星)', goal: 30, val: totalStarsEarned, reward: 300 },
        { id: 'maxstars', title: '满星工程师 (180星)', goal: 180, val: totalStarsEarned, reward: 800 },
      ]
    : [
        { id: 'first', title: '初次点亮 (1关)', goal: 1, val: totalCleared, reward: 100 },
        { id: 'ten', title: '接力达人 (10关)', goal: 10, val: totalCleared, reward: 300 },
        { id: 'stars', title: '星光收藏家 (30星)', goal: 30, val: totalStarsEarned, reward: 300 },
      ];

  const hasUnclaimedAch = achievementsList.some(
    (a) => a.val >= a.goal && !save.ach[a.id],
  );
  const hasUnclaimedSign = save.signDay !== todayKey();

  return (
    <div className="flex flex-col items-center w-full">
      {/* Device Bezel Shell */}
      <div className="w-[404px] max-w-full rounded-2xl border border-slate-700/80 bg-[#141829] p-3.5 shadow-xl">
        {/* Top WeChat Mini-Game Capsule & Status Bar */}
        <div className="mb-2.5 flex items-center justify-between gap-2 px-1 text-xs text-slate-300">
          <div className="flex items-center gap-1.5 font-mono tabular-nums whitespace-nowrap shrink-0">
            <span className="font-semibold text-[#ffcd75]">
              {v054FixesEnabled ? 'v0.5.4 修复版' : 'v0.5.3 原版'}
            </span>
            <span aria-hidden="true">·</span>
            <span>体力 {save.energy}/30</span>
            <span aria-hidden="true">·</span>
            <span>金币 {save.coins}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setScreen('home')}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                screen === 'home'
                  ? 'bg-[#ffcd75] text-[#1a1c2c]'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              首页
            </button>
            <button
              type="button"
              onClick={() => setScreen('game')}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                screen === 'game'
                  ? 'bg-[#ffcd75] text-[#1a1c2c]'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              棋盘
            </button>
            <button
              type="button"
              onClick={() => setScreen('settings')}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                screen === 'settings'
                  ? 'bg-[#ffcd75] text-[#1a1c2c]'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              设置
            </button>
          </div>
        </div>

        {screen === 'game' && (
          <div>
            {/* Game Level Header */}
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#1a1c2c] px-2.5 py-2 text-xs">
              <div className="flex items-center gap-1 whitespace-nowrap shrink-0">
                {!isDaily && !isSeedMode && currentCampaignIdx >= 0 && (
                  <>
                    <button
                      type="button"
                      aria-label="上一关"
                      disabled={currentCampaignIdx <= 0}
                      onClick={() =>
                        onSelectCampaignLevel(Math.max(0, currentCampaignIdx - 1))
                      }
                      className="rounded p-1 text-slate-300 hover:bg-slate-800 disabled:opacity-30 shrink-0"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="font-mono font-bold text-[#ffcd75] tabular-nums whitespace-nowrap">
                      第 {activeLevel.id} 关
                    </span>
                    <button
                      type="button"
                      aria-label="下一关"
                      disabled={currentCampaignIdx >= CAMPAIGN_LEVELS.length - 1}
                      onClick={() =>
                        onSelectCampaignLevel(
                          Math.min(
                            CAMPAIGN_LEVELS.length - 1,
                            currentCampaignIdx + 1,
                          ),
                        )
                      }
                      className="rounded p-1 text-slate-300 hover:bg-slate-800 disabled:opacity-30 shrink-0"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
                {(isDaily || isSeedMode) && (
                  <span className="font-mono font-bold text-[#ffcd75] whitespace-nowrap">
                    {isSeedMode ? `种子 ${seedLabel || activeLevel.id}` : `每日 ${activeLevel.id}`}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 font-mono text-xs text-slate-300 tabular-nums whitespace-nowrap shrink-0">
                <span>
                  目标 {propResult.reached.size}/{propResult.total}
                </span>
                {activeLevel.range !== undefined && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-amber-300">射程 {activeLevel.range}</span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span>
                  管件 {usedCount}/{activeLevel.par}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:
                  {String(elapsedSec % 60).padStart(2, '0')}
                </span>
              </div>
            </div>

            {/* Canvas2D Playfield */}
            <div className="relative overflow-hidden rounded-lg border border-slate-800 bg-[#1a1c2c]">
              <canvas
                ref={canvasRef}
                width={CW}
                height={CH}
                data-testid="signal-relay-canvas"
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onContextMenu={handleContextMenu}
                className="block h-[380px] w-[360px] cursor-pointer select-none"
              />

              {/* Victory Modal Overlay on Canvas */}
              {wonInfo && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/85 p-5 text-center">
                  <div className="w-full rounded-xl border border-[#ffcd75]/40 bg-[#242d50] p-4 shadow-lg">
                    <h4 className="text-lg font-bold text-[#ffcd75]">挑战成功</h4>
                    <div className="my-2 text-2xl tracking-widest text-[#ffcd75]">
                      {'★'.repeat(wonInfo.stars)}
                      {'☆'.repeat(3 - wonInfo.stars)}
                    </div>
                    <p className="font-mono text-xs text-slate-200 tabular-nums">
                      用时 {wonInfo.sec}s · 管件 {usedCount}/{activeLevel.par} · 金币 +{wonInfo.reward}
                    </p>
                    <div className="mt-4 flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={handleReset}
                        className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 whitespace-nowrap shrink-0"
                      >
                        再挑战
                      </button>
                      {!isDaily &&
                        !isSeedMode &&
                        currentCampaignIdx >= 0 &&
                        currentCampaignIdx < CAMPAIGN_LEVELS.length - 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              onSelectCampaignLevel(currentCampaignIdx + 1)
                            }
                            className="rounded-lg bg-[#ffcd75] px-4 py-2 text-xs font-bold text-[#1a1c2c] hover:bg-amber-300 whitespace-nowrap shrink-0"
                          >
                            下一关 ({CAMPAIGN_LEVELS[currentCampaignIdx + 1].id})
                          </button>
                        )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Piece Inventory Selector */}
            <div className="mt-2.5 grid grid-cols-4 gap-1.5">
              {(['s', 'c', 't', 'a'] as PieceKind[]).map((kind) => {
                const count = inv[kind] || 0;
                const isSelected = sel === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => count > 0 && setSel(kind)}
                    className={`flex flex-col items-center justify-between rounded-lg border px-2 py-2 text-xs transition-colors ${
                      isSelected
                        ? 'border-[#ffcd75] bg-[#ffcd75] text-[#1a1c2c] font-bold'
                        : count > 0
                          ? 'border-slate-700 bg-[#242d50] text-slate-100 hover:border-slate-500'
                          : 'border-slate-800/80 bg-[#1a1c2c]/60 text-slate-500 opacity-60'
                    }`}
                  >
                    <span className="whitespace-nowrap">
                      {PIECE_NAMES[kind]}
                      {kind === 'a' ? ' +' : ''}
                    </span>
                    <span
                      className={`mt-1 font-mono text-xs tabular-nums ${
                        isSelected ? 'text-[#1a1c2c]' : 'text-[#ffcd75]'
                      }`}
                    >
                      剩余 {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Action Toolbar */}
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={handleUndo}
                className="flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-[#1a1c2c] py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Undo2 className="h-3.5 w-3.5" />
                <span>撤回</span>
              </button>
              <button
                type="button"
                onClick={handleAskHint}
                className="flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-[#1a1c2c] py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <HelpCircle className="h-3.5 w-3.5 text-[#ffcd75]" />
                <span>提示</span>
              </button>
              <button
                type="button"
                onClick={handleRouteCheck}
                className="flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-[#1a1c2c] py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Compass className="h-3.5 w-3.5 text-cyan-300" />
                <span>自查</span>
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-[#1a1c2c] py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>重置</span>
              </button>
            </div>

            {/* Quick Auto-Solve & Apply Hint Strip */}
            <div className="mt-2 flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleAutoSolve}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#ffcd75] px-3 py-2 text-xs font-bold text-[#1a1c2c] hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>一键填入标准解 (验证三星)</span>
              </button>
              {hintCell && (
                <button
                  type="button"
                  onClick={handleApplyHintStep}
                  className="rounded-lg border border-amber-400/60 bg-amber-500/20 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 whitespace-nowrap shrink-0"
                >
                  应用提示步
                </button>
              )}
            </div>

            {/* Robot Coach Inspection Bar */}
            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#1a1c2c] px-3 py-2 text-xs text-slate-300">
              <span className="leading-relaxed">{coachMsg}</span>
            </div>
          </div>
        )}

        {screen === 'home' && (
          <div className="flex min-h-[480px] flex-col justify-between rounded-lg border border-slate-800 bg-[#1a1c2c] p-4">
            <div className="text-center">
              <h3 className="mt-2 text-2xl font-bold tracking-tight text-[#ffcd75]">
                信号接力
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                连接每一个节点 · 让信号抵达远方
              </p>

              {/* Simulated Home Scene Preview */}
              <div className="my-4 rounded-xl border border-slate-800 bg-[#242d50] p-4 text-left">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>当前主线进度</span>
                  <span className="font-mono text-[#ffcd75] tabular-nums">
                    已通关 {totalCleared}/60 关 · {totalStarsEarned}/180 ★
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  {v054FixesEnabled
                    ? 'v0.5.4 已开启：首页「成就」与「签到」按钮已支持未领红点提醒，且扩展至 6 阶全周期成就。'
                    : 'v0.5.3 原版：仅「每日任务」有红点，「成就」可领与「签到」未签时无红点提醒。'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setScreen('game')}
                className="w-full rounded-xl bg-[#ffcd75] py-3.5 text-base font-bold text-[#1a1c2c] hover:bg-amber-300"
              >
                继续游戏 ({activeLevel.id})
              </button>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onOpenDaily();
                    setScreen('game');
                  }}
                  className="relative flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-[#242d50] py-2.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
                >
                  <Calendar className="h-3.5 w-3.5 text-[#ffcd75]" />
                  <span>每日挑战</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const claimable = achievementsList.find(
                      (a) => a.val >= a.goal && !save.ach[a.id],
                    );
                    if (claimable) {
                      setSave((prev) => ({
                        ...prev,
                        coins: prev.coins + claimable.reward,
                        ach: { ...prev.ach, [claimable.id]: true },
                      }));
                      playSfx('reward');
                    }
                  }}
                  className="relative flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-[#242d50] py-2.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
                >
                  <Award className="h-3.5 w-3.5 text-[#ffcd75]" />
                  <span>成就 ({achievementsList.length})</span>
                  {v054FixesEnabled && hasUnclaimedAch && (
                    <span
                      title="v0.5.4 新增可领成就红点"
                      className="absolute top-1 right-1 h-2 w-2 rounded-sm bg-[#ef4b5c]"
                    />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (save.signDay !== todayKey()) {
                      setSave((prev) => ({
                        ...prev,
                        signDay: todayKey(),
                        coins: prev.coins + 100,
                      }));
                      playSfx('sign');
                    }
                  }}
                  className="relative flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-[#242d50] py-2.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span>{save.signDay === todayKey() ? '已签到' : '签到 +100'}</span>
                  {v054FixesEnabled && hasUnclaimedSign && (
                    <span
                      title="v0.5.4 新增未签到红点"
                      className="absolute top-1 right-1 h-2 w-2 rounded-sm bg-[#ef4b5c]"
                    />
                  )}
                </button>
              </div>

              {/* Achievements list preview */}
              <div className="mt-4 space-y-1.5 text-left">
                <div className="text-xs font-semibold text-slate-300">
                  成就列表 ({v054FixesEnabled ? 'v0.5.4 扩展 6 项' : 'v0.5.3 原版 3 项'})
                </div>
                {achievementsList.map((a) => {
                  const claimed = !!save.ach[a.id];
                  const ready = a.val >= a.goal && !claimed;
                  return (
                    <div
                      key={a.id}
                      className="flex items-center justify-between rounded border border-slate-800 bg-slate-900/70 px-2.5 py-1.5 text-xs"
                    >
                      <span className="text-slate-200">{a.title}</span>
                      <span className="font-mono text-slate-400 tabular-nums">
                        {Math.min(a.val, a.goal)}/{a.goal} ·{' '}
                        {claimed ? (
                          <span className="text-slate-500">已领取</span>
                        ) : ready ? (
                          <span className="font-semibold text-[#ffcd75]">
                            可领 +{a.reward}
                          </span>
                        ) : (
                          <span>+{a.reward}金币</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {screen === 'settings' && (
          <div className="flex min-h-[480px] flex-col justify-between rounded-lg border border-slate-800 bg-[#1a1c2c] p-4">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-sm font-bold text-[#ffcd75]">
                  游戏设置与音频诊断
                </span>
                <Settings className="h-4 w-4 text-slate-400" />
              </div>

              <button
                type="button"
                onClick={() =>
                  setSave((p) => ({
                    ...p,
                    settings: { ...p.settings, sound: !p.settings.sound },
                  }))
                }
                className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-[#242d50] px-3 py-2.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
              >
                <span className="flex items-center gap-2">
                  {save.settings.sound ? (
                    <Volume2 className="h-4 w-4 text-[#ffcd75]" />
                  ) : (
                    <VolumeX className="h-4 w-4 text-slate-400" />
                  )}
                  音效开关
                </span>
                <span className="font-mono text-[#ffcd75]">
                  {save.settings.sound ? '开' : '关'}
                </span>
              </button>

              <button
                type="button"
                onClick={toggleMusic}
                className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-[#242d50] px-3 py-2.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
              >
                <span>背景音乐 (relay-loop.mp3)</span>
                <span className="font-mono text-[#ffcd75]">
                  {save.settings.music ? '播放中' : '关'}
                </span>
              </button>

              <button
                type="button"
                onClick={cycleVolume}
                className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-[#242d50] px-3 py-2.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
              >
                <span>音量档位（点击循环切换并试听）</span>
                <span className="font-mono text-[#ffcd75]">
                  {VOLUME_MAP[save.settings.volumeLevel].label} (SFX{' '}
                  {VOLUME_MAP[save.settings.volumeLevel].sfx} / BGM{' '}
                  {VOLUME_MAP[save.settings.volumeLevel].music})
                </span>
              </button>

              <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-2.5 text-xs text-amber-200/90 leading-relaxed">
                {v054FixesEnabled
                  ? '✓ v0.5.4 已修复 ISS-01：当背景音乐处于「播放中」时，点击上方「音量档位」会立即调用 music.syncVolume() 实时改变 BGM 音量。'
                  : '⚠ v0.5.3 原版 Bug 复现：先开启背景音乐，再点上方「音量档位」，会发现只有音效音量变了，正在播放的 BGM 音量由于 if (playing) return 短路而完全没变！'}
              </div>

              <button
                type="button"
                onClick={() =>
                  setSave((p) => ({
                    ...p,
                    settings: {
                      ...p.settings,
                      highContrast: !p.settings.highContrast,
                    },
                  }))
                }
                className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-[#242d50] px-3 py-2.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
              >
                <span className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-cyan-300" />
                  高对比度与色觉辅助纹理
                </span>
                <span className="font-mono text-[#ffcd75]">
                  {save.settings.highContrast ? '开 (纹理开启)' : '关'}
                </span>
              </button>
            </div>

            <div className="mt-4 border-t border-slate-800 pt-2 text-center text-xs text-slate-400">
              {v054FixesEnabled
                ? '本地安全存档 · 适度益智健脑 (v0.5.4 已移除草案占位词)'
                : '本地存档 · 协议草案需确认 (v0.5.3 原版残留文案)'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
