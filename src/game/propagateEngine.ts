import {
  CAMPAIGN_LEVELS,
  CAMPAIGN_SOLUTIONS,
  DAILY_LEVELS,
  DAILY_SOLUTIONS,
  RawLevel,
  SolutionStep,
} from '../wx-data/gameData';

export type Dir = 'U' | 'R' | 'D' | 'L';
export type PieceKind = 's' | 'c' | 't' | 'a';
export type SignalColor = 'red' | 'green' | 'blue' | 'yellow';

export interface BoardPiece {
  t: PieceKind;
  k: number; // 0..3 rotation
}

export interface FixedCell {
  k: 'star' | 'bridge' | 'obs' | 'src' | 'tgt';
  e?: string;
  d?: Dir;
  col?: SignalColor;
}

export interface PropagationStop {
  kind: 'edge' | 'blocked' | 'gap' | 'pipe';
  r: number;
  c: number;
  col: SignalColor;
}

export interface TargetIssue {
  expected: SignalColor;
  actual: SignalColor;
  kind: 'color' | 'direction';
}

export interface PropagationResult {
  lit: Map<string, SignalColor>;
  br: Map<string, { h?: SignalColor; v?: SignalColor }>;
  reached: Set<string>;
  bad: Set<string>;
  depth: Map<string, number>;
  bridgeDepth: Map<string, number>;
  targetIssues: Map<string, TargetIssue>;
  exhausted: Set<string>;
  stops: PropagationStop[];
  total: number;
  win: boolean;
}

export const DV: Record<Dir, [number, number]> = {
  U: [-1, 0],
  R: [0, 1],
  D: [1, 0],
  L: [0, -1],
};

export const OPP: Record<Dir, Dir> = { U: 'D', R: 'L', D: 'U', L: 'R' };
export const ORD: Dir[] = ['U', 'R', 'D', 'L'];
export const BASE: Record<PieceKind, Dir[]> = {
  s: ['L', 'R'],
  c: ['L', 'U'],
  t: ['L', 'U', 'D'],
  a: ['L', 'R'],
};

const COL: Record<string, SignalColor> = {
  r: 'red',
  g: 'green',
  b: 'blue',
  y: 'yellow',
};

const DIRM: Record<string, Dir> = { '>': 'R', '<': 'L', '^': 'U', v: 'D' };
const OB: Record<string, string> = {
  TT: 'tree',
  '##': 'rock',
  XX: 'box',
  '~~': 'water',
};

export const rot = (d: Dir, k: number): Dir => ORD[(ORD.indexOf(d) + k) % 4];
export const portsOf = (p: BoardPiece): Dir[] =>
  BASE[p.t].map((d) => rot(d, p.k));

export function parseToken(t: string): FixedCell | null {
  if (t === '..') return null;
  if (t === '**') return { k: 'star' };
  if (t === '==') return { k: 'bridge' };
  if (OB[t]) return { k: 'obs', e: OB[t] };
  const ch = t[0];
  return {
    k: ch === ch.toUpperCase() ? 'src' : 'tgt',
    d: DIRM[t[1]],
    col: COL[ch.toLowerCase()],
  };
}

export function parseLevel(level: RawLevel): {
  R: number;
  C: number;
  fix: (FixedCell | null)[][];
} {
  const fix = level.g.map((r) => r.split(' ').map(parseToken));
  return { R: fix.length, C: fix[0].length, fix };
}

export function propagate(
  R: number,
  C: number,
  fix: (FixedCell | null)[][],
  board: (BoardPiece | null)[][],
  range: number | null,
): PropagationResult {
  const lit = new Map<string, SignalColor>();
  const br = new Map<string, { h?: SignalColor; v?: SignalColor }>();
  const reached = new Set<string>();
  const occ = new Map<string, SignalColor>();
  const bad = new Set<string>();
  const seen = new Map<string, number>();
  const depth = new Map<string, number>();
  const bridgeDepth = new Map<string, number>();
  const targetIssues = new Map<string, TargetIssue>();
  const exhausted = new Set<string>();
  const stops: PropagationStop[] = [];
  const q: {
    r: number;
    c: number;
    o: Dir;
    p: number | null;
    col: SignalColor;
    d: number;
  }[] = [];

  fix.forEach((row, r) =>
    row.forEach((f, c) => {
      if (f && f.k === 'src' && f.d && f.col) {
        q.push({ r, c, o: f.d, p: range, col: f.col, d: 0 });
      }
    }),
  );

  while (q.length) {
    const { r, c, o, p, col, d } = q.shift()!;
    const nr = r + DV[o][0];
    const nc = c + DV[o][1];
    if (nr < 0 || nc < 0 || nr >= R || nc >= C) {
      stops.push({ kind: 'edge', r, c, col });
      continue;
    }
    const key = nr + ',' + nc;
    const sk = key + o + col;
    const strength = p === null ? Infinity : p;
    if (seen.has(sk) && seen.get(sk)! >= strength) continue;
    seen.set(sk, strength);

    const mark = () =>
      depth.set(key, Math.min(depth.has(key) ? depth.get(key)! : Infinity, d + 1));

    const f = fix[nr] ? fix[nr][nc] : null;
    const pc = board[nr] ? board[nr][nc] : null;
    const inp = OPP[o];

    if (f && f.k === 'tgt' && f.col && f.d) {
      if (f.d === inp && f.col === col) {
        reached.add(key);
        lit.set(key, col);
        mark();
      } else {
        targetIssues.set(key, {
          expected: f.col,
          actual: col,
          kind: f.col !== col ? 'color' : 'direction',
        });
      }
      continue;
    }

    if (f && f.k === 'bridge') {
      const ax = o === 'L' || o === 'R' ? 'h' : 'v';
      const b = br.get(key) || {};
      if (b[ax] && b[ax] !== col) bad.add(key);
      b[ax] = col;
      br.set(key, b);
      mark();
      const bk = key + ax;
      bridgeDepth.set(
        bk,
        Math.min(bridgeDepth.has(bk) ? bridgeDepth.get(bk)! : Infinity, d + 1),
      );
      q.push({ r: nr, c: nc, o, p, col, d: d + 1 });
      continue;
    }

    if (!pc) {
      stops.push({
        kind: f && f.k !== 'star' ? 'blocked' : 'gap',
        r: nr,
        c: nc,
        col,
      });
      continue;
    }

    const ps = portsOf(pc);
    if (!ps.includes(inp)) {
      stops.push({ kind: 'pipe', r: nr, c: nc, col });
      continue;
    }

    if (p !== null && p <= 0) {
      exhausted.add(key);
      continue;
    }

    if (occ.has(key) && occ.get(key) !== col) bad.add(key);
    occ.set(key, col);
    lit.set(key, col);
    mark();

    const np = pc.t === 'a' ? range : p === null ? null : p - 1;
    ps.forEach((x) => {
      if (x !== inp) q.push({ r: nr, c: nc, o: x, p: np, col, d: d + 1 });
    });
  }

  for (const key of lit.keys()) exhausted.delete(key);
  let tg = 0;
  for (const row of fix) {
    for (const cell of row) if (cell && cell.k === 'tgt') tg++;
  }

  return {
    lit,
    br,
    reached,
    bad,
    depth,
    bridgeDepth,
    targetIssues,
    exhausted,
    stops,
    total: tg,
    win: tg > 0 && reached.size === tg && bad.size === 0,
  };
}

export function simulateSolution(
  level: RawLevel,
  solution: SolutionStep[],
): boolean {
  const { R, C, fix } = parseLevel(level);
  const board: (BoardPiece | null)[][] = fix.map((r) => r.map(() => null));
  (solution || []).forEach(([r, c, t, k]) => {
    board[r][c] = { t, k };
  });
  return propagate(
    R,
    C,
    fix,
    board,
    level.range === undefined ? null : level.range,
  ).win;
}

const COLOR_NAMES: Record<SignalColor, string> = {
  red: '红',
  blue: '蓝',
  green: '绿',
  yellow: '黄',
};
const COLOR_MARKS: Record<SignalColor, string> = {
  red: 'R',
  blue: 'B',
  green: 'G',
  yellow: 'Y',
};
const DIR_NAMES: Record<Dir, string> = { U: '上', R: '右', D: '下', L: '左' };

const placeOf = (key: string) => {
  const [r, c] = key.split(',').map(Number);
  return '第 ' + (r + 1) + ' 行、第 ' + (c + 1) + ' 列';
};

export function diagnose(
  res: PropagationResult,
  fix: (FixedCell | null)[][],
): { kind: string; key: string; message: string } | null {
  if (res.bad.size) {
    const key = [...res.bad][0];
    return {
      kind: 'bad',
      key,
      message: placeOf(key) + '有不同颜色混入同一路线，请分路或走桥',
    };
  }
  for (const [key, issue] of res.targetIssues.entries()) {
    if (res.reached.has(key)) continue;
    const [r, c] = key.split(',').map(Number);
    const f = fix[r][c]!;
    if (issue.kind === 'color') {
      return {
        kind: 'color',
        key,
        message:
          placeOf(key) +
          '是' +
          COLOR_NAMES[issue.expected] +
          '色 ' +
          COLOR_MARKS[issue.expected] +
          ' 接收端，当前接入了' +
          COLOR_NAMES[issue.actual] +
          '色 ' +
          COLOR_MARKS[issue.actual] +
          ' 信号',
      };
    }
    return {
      kind: 'direction',
      key,
      message:
        placeOf(key) +
        '的' +
        COLOR_NAMES[f.col!] +
        '色 ' +
        COLOR_MARKS[f.col!] +
        ' 接收端需从' +
        DIR_NAMES[f.d!] +
        '侧白箭头接入',
    };
  }
  if (res.exhausted.size) {
    const key = [...res.exhausted][0];
    return {
      kind: 'range',
      key,
      message:
        '信号在' + placeOf(key) + '前耗尽，请在该位置之前放 + 增幅器',
    };
  }
  return null;
}

export function checkRoute(
  res: PropagationResult,
  fix: (FixedCell | null)[][],
): { kind: string; cells: string[]; message: string } {
  const problem = diagnose(res, fix);
  if (problem) {
    return { kind: problem.kind, cells: [problem.key], message: problem.message };
  }
  if (res.win) {
    return {
      kind: 'win',
      cells: [],
      message: '全部接收端都已正确接通',
    };
  }
  const stop = (res.stops || [])[0];
  if (!stop) {
    return {
      kind: 'unreached',
      cells: [],
      message: '还有接收端未接通，请从发射端继续铺设管件',
    };
  }
  const where = placeOf(stop.r + ',' + stop.c);
  const color = COLOR_NAMES[stop.col] + '色 ' + COLOR_MARKS[stop.col] + ' 信号';
  const text: Record<PropagationStop['kind'], string> = {
    gap: '停在空格，可在此接续管件',
    pipe: '遇到未对齐管件，请旋转或换件',
    blocked: '被固定格挡住，请调整路线',
    edge: '走到棋盘边缘，请调整路线',
  };
  return {
    kind: stop.kind,
    cells: [stop.r + ',' + stop.c],
    message: color + '在' + where + text[stop.kind],
  };
}

const samePiece = (a: BoardPiece | null, b: BoardPiece | null) =>
  !!(
    a &&
    b &&
    a.t === b.t &&
    portsOf(a).slice().sort().join('') === portsOf(b).slice().sort().join('')
  );

export function nextHint(
  level: RawLevel,
  board: (BoardPiece | null)[][],
  customSolution?: SolutionStep[],
): { r: number; c: number; kind: 'remove' | 'rotate' | 'place'; piece: BoardPiece } | null {
  const solution =
    customSolution ||
    CAMPAIGN_SOLUTIONS[level.id] ||
    DAILY_SOLUTIONS[level.id];
  if (!solution) return null;
  const wanted = new Map(
    solution.map(([r, c, t, k]) => [r + ',' + c, { t, k }]),
  );
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const pc = board[r][c];
      const target = wanted.get(r + ',' + c);
      if (pc && (!target || pc.t !== target.t)) {
        return { r, c, kind: 'remove', piece: pc };
      }
    }
  }
  for (const [r, c, t, k] of solution) {
    const pc = board[r][c];
    const piece: BoardPiece = { t, k };
    if (!samePiece(pc, piece)) {
      return { r, c, kind: pc ? 'rotate' : 'place', piece };
    }
  }
  return null;
}

export function applyHint(
  board: (BoardPiece | null)[][],
  inv: Record<PieceKind, number>,
  h: { r: number; c: number; kind: 'remove' | 'rotate' | 'place'; piece: BoardPiece } | null,
): boolean {
  if (!h || !board[h.r] || h.c < 0 || h.c >= board[h.r].length) return false;
  const pc = board[h.r][h.c];
  if (h.kind === 'remove') {
    if (!pc) return false;
    inv[pc.t]++;
    board[h.r][h.c] = null;
    return true;
  }
  if (h.kind === 'rotate') {
    if (!pc || pc.t !== h.piece.t) return false;
    pc.k = h.piece.k;
    return true;
  }
  if (h.kind === 'place') {
    if (pc || !(inv[h.piece.t] > 0)) return false;
    inv[h.piece.t]--;
    board[h.r][h.c] = { t: h.piece.t, k: h.piece.k };
    return true;
  }
  return false;
}

// === Issue #2 Fix Verification: runs.js replacement & prune with activeRun protection ===
export function getReplacementV053(
  runsKeys: string[],
  targetLevelId: string,
): string | null {
  if (runsKeys.includes(targetLevelId) || runsKeys.length < 5) return null;
  return runsKeys[0]; // Bug in v0.5.3: does not filter out activeRun!
}

export function getReplacementV054Fixed(
  runsKeys: string[],
  targetLevelId: string,
  activeRunId?: string,
): string | null {
  if (runsKeys.includes(targetLevelId) || runsKeys.length < 5) return null;
  const candidates = runsKeys.filter((id) => id !== activeRunId);
  return candidates[0] || runsKeys[0] || null;
}

export function writeRunKeysV054Fixed(
  runsKeys: string[],
  newLevelId: string,
  previousActiveRunId?: string,
): { keys: string[]; activeRun: string } {
  // Keep previousActiveRunId at the tail before inserting newLevelId so it is never evicted as the oldest entry
  const nextKeys = runsKeys.filter((k) => k !== newLevelId);
  if (previousActiveRunId && nextKeys.includes(previousActiveRunId)) {
    const idx = nextKeys.indexOf(previousActiveRunId);
    nextKeys.splice(idx, 1);
    nextKeys.push(previousActiveRunId);
  }
  nextKeys.push(newLevelId);
  while (nextKeys.length > 5) {
    nextKeys.shift();
  }
  return { keys: nextKeys, activeRun: newLevelId };
}

// === Issue #3 Verification: project.config.json Markdown Leak Check ===
export const ROOT_MD_FILES_V053 = [
  'ACCEPTANCE.md',
  'BATCH-A.md',
  'BATCH-B.md',
  'BATCH-C.md',
  'BATCH-D.md',
  'BATCH-E.md',
  'BATCH-F.md',
  'BATCH-G.md',
  'BATCH-HISTORY.md',
  'BATCH-I.md',
  'BATCH-J.md',
  'BATCH-REVIEW.md',
  'CLOUD-SAVE-DESIGN.md',
  'LAUNCH-CHECKLIST.md',
  'README.md',
  'SUBMISSION.md',
  'TEST-REPORT.md',
];

export const IGNORED_MD_FILES_V053 = [
  'README.md',
  'TEST-REPORT.md',
  'ACCEPTANCE.md',
  'BATCH-REVIEW.md',
  'BATCH-A.md',
  'BATCH-B.md',
  'BATCH-C.md',
  'CLOUD-SAVE-DESIGN.md',
  'BATCH-D.md',
  'BATCH-E.md',
  'BATCH-F.md',
  'BATCH-HISTORY.md',
  'BATCH-G.md',
];

export function findUnignoredDocs(
  allDocs: string[],
  ignoredDocs: string[],
): string[] {
  const ignoredSet = new Set(ignoredDocs);
  return allDocs.filter((doc) => !ignoredSet.has(doc));
}

// === v0.6 Feature Prototype: Deterministic 6-Char Seed Level Generator ===
function hashSeed(seedStr: string): number {
  let h = 2166136261;
  const clean = (seedStr || 'SR2026').trim().toUpperCase();
  for (let i = 0; i < clean.length; i++) {
    h ^= clean.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function generateSeedLevel(seedInput: string): {
  seedCode: string;
  level: RawLevel;
  solution: SolutionStep[];
  themeName: string;
  difficultyLabel: string;
} {
  const normalized =
    (seedInput || 'SR-2026')
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '')
      .slice(0, 10) || 'SR-2026';
  const h = hashSeed(normalized);

  // Use the 30 pre-verified daily levels + 30 mid/late campaign levels as topological templates
  // and apply deterministic symmetry transforms (horizontal/vertical/color permutation)
  // so every seed produces a 100% mathematically verified, multi-color Signal Relay puzzle!
  const pool = [...DAILY_LEVELS, ...CAMPAIGN_LEVELS.slice(15, 60)];
  const baseIdx = h % pool.length;
  const baseLevel = pool[baseIdx];
  const baseSol =
    DAILY_SOLUTIONS[baseLevel.id] || CAMPAIGN_SOLUTIONS[baseLevel.id] || [];

  const flipH = ((h >>> 4) & 1) === 1;
  const flipV = ((h >>> 5) & 1) === 1;
  const colorShift = (h >>> 7) % 4;
  const colorCycle = ['r', 'b', 'g', 'y'];

  const mapColorChar = (ch: string): string => {
    const lower = ch.toLowerCase();
    const idx = colorCycle.indexOf(lower);
    if (idx === -1) return ch;
    const mapped = colorCycle[(idx + colorShift) % 4];
    return ch === ch.toUpperCase() ? mapped.toUpperCase() : mapped;
  };

  const mapDirChar = (d: string): string => {
    let cur = d;
    if (flipH) {
      if (cur === '>') cur = '<';
      else if (cur === '<') cur = '>';
    }
    if (flipV) {
      if (cur === '^') cur = 'v';
      else if (cur === 'v') cur = '^';
    }
    return cur;
  };

  const R = baseLevel.g.length;
  const C = baseLevel.g[0].split(' ').length;

  const newRows: string[] = [];
  for (let r = 0; r < R; r++) {
    const srcR = flipV ? R - 1 - r : r;
    const tokens = baseLevel.g[srcR].split(' ');
    const rowTokens: string[] = [];
    for (let c = 0; c < C; c++) {
      const srcC = flipH ? C - 1 - c : c;
      const tok = tokens[srcC];
      if (
        tok === '..' ||
        tok === '**' ||
        tok === '==' ||
        tok === 'TT' ||
        tok === '##' ||
        tok === 'XX' ||
        tok === '~~'
      ) {
        rowTokens.push(tok);
      } else {
        rowTokens.push(mapColorChar(tok[0]) + mapDirChar(tok[1]));
      }
    }
    newRows.push(rowTokens.join(' '));
  }

  const transformDir = (d: Dir): Dir => {
    let res = d;
    if (flipH) {
      if (res === 'L') res = 'R';
      else if (res === 'R') res = 'L';
    }
    if (flipV) {
      if (res === 'U') res = 'D';
      else if (res === 'D') res = 'U';
    }
    return res;
  };

  const findRotation = (kind: PieceKind, targetPorts: Dir[]): number => {
    const targetSorted = targetPorts.slice().sort().join('');
    for (let k = 0; k < 4; k++) {
      const pSorted = portsOf({ t: kind, k }).slice().sort().join('');
      if (pSorted === targetSorted) return k;
    }
    return 0;
  };

  const newSol: SolutionStep[] = baseSol.map(([r, c, t, k]) => {
    const nr = flipV ? R - 1 - r : r;
    const nc = flipH ? C - 1 - c : c;
    const origPorts = portsOf({ t, k });
    const nextPorts = origPorts.map(transformDir);
    const nk = findRotation(t, nextPorts);
    return [nr, nc, t, nk];
  });

  const generatedLevel: RawLevel = {
    id: `SEED-${normalized}`,
    g: newRows,
    inv: { ...baseLevel.inv },
    par: baseLevel.par,
    ...(baseLevel.range !== undefined ? { range: baseLevel.range } : {}),
  };

  const themes = [
    '晨光回路',
    '林间双桥',
    '潮汐矩阵',
    '峡谷脉动',
    '云端星轨',
    '极光共振',
  ];
  const themeName = themes[h % themes.length];
  const difficultyLabel =
    generatedLevel.par >= 18
      ? '大师级 (Master)'
      : generatedLevel.par >= 12
        ? '进阶级 (Advanced)'
        : '标准级 (Standard)';

  return {
    seedCode: normalized,
    level: generatedLevel,
    solution: newSol,
    themeName,
    difficultyLabel,
  };
}
