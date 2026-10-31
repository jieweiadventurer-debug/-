import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPAIGN_LEVELS,
  CAMPAIGN_SOLUTIONS,
  DAILY_LEVELS,
  DAILY_SOLUTIONS,
} from '../wx-data/gameData';
import {
  simulateSolution,
  getReplacementV053,
  getReplacementV054Fixed,
  writeRunKeysV054Fixed,
  ROOT_MD_FILES_V053,
  IGNORED_MD_FILES_V053,
  findUnignoredDocs,
  generateSeedLevel,
  parseLevel,
  propagate,
  nextHint,
  applyHint,
} from './propagateEngine';

test('All 60 campaign levels and 30 daily levels pass 3-star reference solution verification', () => {
  assert.equal(CAMPAIGN_LEVELS.length, 60);
  assert.equal(DAILY_LEVELS.length, 30);

  for (const level of CAMPAIGN_LEVELS) {
    const sol = CAMPAIGN_SOLUTIONS[level.id];
    assert.ok(sol, `Missing solution for campaign level ${level.id}`);
    assert.equal(
      simulateSolution(level, sol),
      true,
      `Campaign level ${level.id} failed simulation`,
    );
    assert.ok(sol.length <= level.par, `Campaign level ${level.id} exceeds par`);
  }

  for (const level of DAILY_LEVELS) {
    const sol = DAILY_SOLUTIONS[level.id];
    assert.ok(sol, `Missing solution for daily level ${level.id}`);
    assert.equal(
      simulateSolution(level, sol),
      true,
      `Daily level ${level.id} failed simulation`,
    );
  }
});

test('Issue #2 Fix: runs replacement and write protect activeRun when activeRun is at index 0', () => {
  const legacyKeys = ['1-1', '1-2', '1-3', '1-4', '1-5'];
  const activeRun = '1-1';

  // In v0.5.3, replacement('1-6') erroneously picks '1-1' (which is activeRun!)
  assert.equal(getReplacementV053(legacyKeys, '1-6'), '1-1');

  // In v0.5.4 Fixed, replacement('1-6') skips activeRun ('1-1') and picks '1-2'
  assert.equal(getReplacementV054Fixed(legacyKeys, '1-6', activeRun), '1-2');

  // And when writing '1-6', '1-1' is preserved while '1-2' is evicted
  const afterWrite = writeRunKeysV054Fixed(legacyKeys, '1-6', activeRun);
  assert.equal(afterWrite.keys.length, 5);
  assert.ok(afterWrite.keys.includes('1-1'), 'Previous activeRun 1-1 must be preserved');
  assert.ok(!afterWrite.keys.includes('1-2'), 'Oldest non-active run 1-2 should be evicted');
  assert.equal(afterWrite.activeRun, '1-6');
});

test('Issue #3 Fix: detects the 4 unignored markdown files in v0.5.3 project.config.json', () => {
  const leaked = findUnignoredDocs(ROOT_MD_FILES_V053, IGNORED_MD_FILES_V053);
  assert.deepEqual(leaked, [
    'BATCH-I.md',
    'BATCH-J.md',
    'LAUNCH-CHECKLIST.md',
    'SUBMISSION.md',
  ]);

  const patchedIgnored = [...IGNORED_MD_FILES_V053, ...leaked];
  assert.deepEqual(findUnignoredDocs(ROOT_MD_FILES_V053, patchedIgnored), []);
});

test('v0.6 Seed Challenge Generator creates valid, solvable Signal Relay puzzles for any seed', () => {
  for (const seed of ['SR-2026', 'AURORA', 'MUSE-99', 'WECHAT', 'RELAY8']) {
    const generated = generateSeedLevel(seed);
    assert.equal(
      simulateSolution(generated.level, generated.solution),
      true,
      `Seed ${seed} level must be solvable with its transformed solution`,
    );

    // Progressive hints also converge to win on generated seed levels
    const { R, C, fix } = parseLevel(generated.level);
    const board = fix.map((r) => r.map(() => null));
    const inv = { ...generated.level.inv };
    let steps = 0;
    while (steps < 60) {
      const h = nextHint(generated.level, board, generated.solution);
      if (!h) break;
      assert.equal(applyHint(board, inv, h), true);
      steps++;
    }
    const res = propagate(
      R,
      C,
      fix,
      board,
      generated.level.range === undefined ? null : generated.level.range,
    );
    assert.equal(res.win, true, `Progressive hints must solve seed ${seed}`);
  }
});

import {
  getLevelOptimalTimeSec,
  getLevelTimeEfficiencyPct,
  evaluateThreeStarStreak,
  sortLevelsForDisplay,
  getNextStreakCountdownHint,
  getLevelDifficultyMeta,
  getLevelDetailSummary,
  getOfflineSyncStatus,
  STREAK_MASTER_BONUS_COINS,
} from './saveStore';
import {
  getPipePlacementSoundProfile,
  getCellInteractionHapticProfile,
  triggerCellHaptic,
  computeSpatialAudioPan,
  getSpatialAudioProfile,
  soundFX,
} from './juiceEngine';

test('Level clear-time efficiency percentage calculates relative to optimal clear time', () => {
  const lv1_3 = CAMPAIGN_LEVELS.find((l) => l.id === '1-3')!;
  // par = 3 => optimalSec = 9s
  assert.equal(getLevelOptimalTimeSec(lv1_3), 9);

  // Uncompleted level returns 0%
  assert.equal(getLevelTimeEfficiencyPct(lv1_3, undefined), 0);

  // Optimal clear (9s / 9s) => 100%
  assert.equal(getLevelTimeEfficiencyPct(lv1_3, 9), 100);
  // Faster than optimal (6s / 9s) => clamped at 100%
  assert.equal(getLevelTimeEfficiencyPct(lv1_3, 6), 100);
  // 12s clear (9 / 12) => 75%
  assert.equal(getLevelTimeEfficiencyPct(lv1_3, 12), 75);
  // 20s clear (9 / 20) => 45%
  assert.equal(getLevelTimeEfficiencyPct(lv1_3, 20), 45);
});

test('evaluateThreeStarStreak awards Win Streak Master badge and +50 coins on 3 consecutive 3-star levels', () => {
  const s1 = evaluateThreeStarStreak(3, 0, 200, 'campaign', '1-1', {});
  assert.equal(s1.threeStarStreak, 1);
  assert.equal(s1.streakMaster, false);
  assert.equal(s1.streakBonusCoins, 0);
  assert.equal(s1.totalRewardCoins, 200);

  const s2 = evaluateThreeStarStreak(3, 1, 200, 'campaign', '1-2', { '1-1': 3 });
  assert.equal(s2.threeStarStreak, 2);
  assert.equal(s2.streakMaster, false);
  assert.equal(s2.streakBonusCoins, 0);
  assert.equal(s2.totalRewardCoins, 200);

  const s3 = evaluateThreeStarStreak(3, 2, 200, 'campaign', '1-3', {
    '1-1': 3,
    '1-2': 3,
  });
  assert.equal(s3.threeStarStreak, 3);
  assert.equal(s3.streakMaster, true);
  assert.equal(s3.streakBonusCoins, STREAK_MASTER_BONUS_COINS);
  assert.equal(s3.totalRewardCoins, 250);

  const reset = evaluateThreeStarStreak(2, 3, 200, 'campaign', '1-4', {
    '1-1': 3,
    '1-2': 3,
    '1-3': 3,
  });
  assert.equal(reset.threeStarStreak, 0);
  assert.equal(reset.streakMaster, false);
  assert.equal(reset.streakBonusCoins, 0);
  assert.equal(reset.totalRewardCoins, 200);
});

test('sortLevelsForDisplay orders levels by default, difficulty, and fastest completion time', () => {
  const ch1 = CAMPAIGN_LEVELS.slice(0, 10);
  const bestSec = { '1-1': 9, '1-2': 12, '1-3': 20, '1-4': 15 };

  const def = sortLevelsForDisplay(ch1, 'default', bestSec);
  assert.equal(def[0].id, '1-1');
  assert.equal(def[9].id, '1-10');

  const diff = sortLevelsForDisplay(ch1, 'difficulty', bestSec);
  assert.ok(
    getLevelDifficultyMeta(diff[0]).score >=
      getLevelDifficultyMeta(diff[1]).score,
  );
  assert.equal(diff[0].id, '1-9');

  const fast = sortLevelsForDisplay(ch1, 'fastest', bestSec);
  assert.deepEqual(
    fast.slice(0, 4).map((l) => l.id),
    ['1-1', '1-2', '1-4', '1-3'],
  );
});

test('getNextStreakCountdownHint generates motivating streak countdown prompt and progress percentage', () => {
  const hintMaster = getNextStreakCountdownHint(
    { stars: 3, threeStarStreak: 3, streakMaster: true },
    12,
    15,
  );
  assert.ok(hintMaster.headline.includes('12s'));
  assert.ok(hintMaster.detail.includes('3 星通关'));
  assert.equal(hintMaster.nextBonusCoins, 50);
  assert.equal(hintMaster.progressPct, 80);

  const hintAlmost = getNextStreakCountdownHint(
    { stars: 3, threeStarStreak: 2, streakMaster: false },
    15,
    15,
  );
  assert.ok(hintAlmost.headline.includes('连胜决胜倒计时'));
  assert.equal(hintAlmost.progressPct, 100);
});

test('getLevelDetailSummary builds difficulty description and chapter completion statistics for detail panel', () => {
  const lv1_3 = CAMPAIGN_LEVELS.find((l) => l.id === '1-3')!;
  const stars = { '1-1': 3, '1-2': 3, '1-3': 2 };
  const bestSec = { '1-1': 9, '1-2': 12, '1-3': 15 };
  const summary = getLevelDetailSummary(lv1_3, stars, bestSec);

  assert.equal(summary.levelId, '1-3');
  assert.equal(summary.chapterIndex, 0);
  assert.ok(summary.difficultyDesc.includes('评级'));
  assert.ok(summary.difficultyDesc.includes('标准步数'));
  assert.equal(summary.chapterStats.clearedCount, 3);
  assert.equal(summary.chapterStats.totalLevels, 10);
  assert.equal(summary.chapterStats.earnedStars, 8);
  assert.equal(summary.chapterStats.perfectThreeStarCount, 2);
  assert.equal(summary.chapterStats.avgClearSec, 12);
});

test('getPipePlacementSoundProfile differentiates amplifier (a) from standard pipes (s, c, t)', () => {
  const straight = getPipePlacementSoundProfile('s');
  const corner = getPipePlacementSoundProfile('c');
  const tee = getPipePlacementSoundProfile('t');
  const amp = getPipePlacementSoundProfile('a');

  assert.equal(straight.category, 'standard');
  assert.equal(corner.category, 'standard');
  assert.equal(tee.category, 'standard');
  assert.equal(amp.category, 'amplifier');

  // Amplifier has higher peak frequency, longer resonant duration, and richer harmonic overtone than standard pipes
  assert.ok(amp.endHz > straight.endHz);
  assert.ok(amp.endHz > corner.endHz);
  assert.ok(amp.endHz > tee.endHz);
  assert.ok(amp.durationSec > straight.durationSec);
  assert.ok(amp.harmonicGainRatio > straight.harmonicGainRatio);

  // All 4 pipe types have distinct frequency profiles
  const profiles = [straight, corner, tee, amp].map(
    (p) => `${p.startHz}-${p.midHz}-${p.endHz}`,
  );
  assert.equal(new Set(profiles).size, 4);

  // soundFX.play('place', kind) records the last played pipe sound profile
  soundFX.play('place', 'a');
  assert.equal(soundFX.lastPlayedPipeProfile?.pipeType, 'a');
  assert.equal(soundFX.lastPlayedPipeProfile?.category, 'amplifier');

  soundFX.play('place', 's');
  assert.equal(soundFX.lastPlayedPipeProfile?.pipeType, 's');
  assert.equal(soundFX.lastPlayedPipeProfile?.category, 'standard');
});

test('getOfflineSyncStatus generates accurate offline warning and online sync status metadata', () => {
  const offline = getOfflineSyncStatus(true, 4);
  assert.equal(offline.isOffline, true);
  assert.equal(offline.syncState, 'offline_unsynced');
  assert.ok(offline.topBarWarningText.includes('无法同步成就数据'));
  assert.ok(offline.detailTooltip.includes('4 项成就'));

  const online = getOfflineSyncStatus(false, 4);
  assert.equal(online.isOffline, false);
  assert.equal(online.syncState, 'online_synced');
  assert.ok(online.shortBadgeText.includes('已同步'));
});

test('wx.vibrateShort cell interaction haptics differentiate rotate, place, and remove durations and intensities', () => {
  const rotateProf = getCellInteractionHapticProfile('rotate', 's');
  const placeStandardProf = getCellInteractionHapticProfile('place', 's');
  const placeAmpProf = getCellInteractionHapticProfile('place', 'a');
  const removeProf = getCellInteractionHapticProfile('remove', 's');

  // Verify distinct wx.vibrateShort types: light (rotate), medium (place), heavy (remove)
  assert.equal(rotateProf.wxType, 'light');
  assert.equal(placeStandardProf.wxType, 'medium');
  assert.equal(placeAmpProf.wxType, 'medium');
  assert.equal(removeProf.wxType, 'heavy');

  // Verify strictly increasing haptic durations: rotate (12ms) < place standard (28ms) < place amp (44ms) < remove (62ms)
  assert.ok(rotateProf.durationMs < placeStandardProf.durationMs);
  assert.ok(placeStandardProf.durationMs < placeAmpProf.durationMs);
  assert.ok(placeAmpProf.durationMs < removeProf.durationMs);

  // Verify triggerCellHaptic invokes globalThis.wx.vibrateShort with the exact type
  const recordedCalls: string[] = [];
  const g = globalThis as unknown as {
    wx?: { vibrateShort?: (opts?: { type?: string }) => void };
  };
  const prevWx = g.wx;
  g.wx = {
    vibrateShort: (opts) => {
      recordedCalls.push(opts?.type || 'default');
    },
  };

  try {
    const p1 = triggerCellHaptic('place', 's');
    assert.equal(p1.action, 'place');
    assert.equal(p1.wxType, 'medium');

    const p2 = triggerCellHaptic('rotate', 's');
    assert.equal(p2.action, 'rotate');
    assert.equal(p2.wxType, 'light');

    const p3 = triggerCellHaptic('remove', 's');
    assert.equal(p3.action, 'remove');
    assert.equal(p3.wxType, 'heavy');

    assert.deepEqual(recordedCalls.slice(0, 3), ['medium', 'light', 'heavy']);
    assert.equal(soundFX.lastHapticProfile?.action, 'remove');
    assert.equal(soundFX.lastHapticProfile?.wxType, 'heavy');
  } finally {
    g.wx = prevWx;
  }
});

test('Web Audio API spatial audio panning shifts left columns to negative pan (left channel) and right columns to positive pan', () => {
  // 5-column board (cols = 0..4)
  const leftEdgePan = computeSpatialAudioPan(0, 5);
  const leftInnerPan = computeSpatialAudioPan(1, 5);
  const centerPan = computeSpatialAudioPan(2, 5);
  const rightInnerPan = computeSpatialAudioPan(3, 5);
  const rightEdgePan = computeSpatialAudioPan(4, 5);

  assert.ok(leftEdgePan < leftInnerPan, 'Far-left column must pan further left than inner-left');
  assert.ok(leftInnerPan < 0, 'Left-side column must have negative pan (left channel bias)');
  assert.equal(centerPan, 0, 'Center column on odd grid must be centered (pan = 0)');
  assert.ok(rightInnerPan > 0, 'Right-side column must have positive pan (right channel bias)');
  assert.ok(rightEdgePan > rightInnerPan, 'Far-right column must pan further right than inner-right');
  assert.equal(leftEdgePan, -rightEdgePan, 'Left and right edge pans must be symmetric');

  const leftProf = getSpatialAudioProfile({ col: 1, totalCols: 5, row: 0, totalRows: 5 });
  assert.equal(leftProf.channelBias, 'left');
  assert.ok(leftProf.leftGainRatio > leftProf.rightGainRatio);
  assert.ok(leftProf.detuneCents > 0);

  const centerProf = getSpatialAudioProfile({ col: 2, totalCols: 5, row: 2, totalRows: 5 });
  assert.equal(centerProf.channelBias, 'center');
  assert.equal(centerProf.pan, 0);
  assert.equal(centerProf.leftGainRatio, centerProf.rightGainRatio);

  const rightProf = getSpatialAudioProfile({ col: 3, totalCols: 5, row: 4, totalRows: 5 });
  assert.equal(rightProf.channelBias, 'right');
  assert.ok(rightProf.rightGainRatio > rightProf.leftGainRatio);
  assert.ok(rightProf.detuneCents < 0);

  // soundFX.play records spatial audio profile per cell interaction
  const sLeft = soundFX.play('place', 's', { col: 1, totalCols: 5, row: 1, totalRows: 3 });
  assert.equal(sLeft.channelBias, 'left');
  assert.equal(soundFX.lastSpatialProfile?.pan, -0.34);

  const sRight = soundFX.play('place', 'a', { col: 4, totalCols: 5, row: 1, totalRows: 3 });
  assert.equal(sRight.channelBias, 'right');
  assert.equal(soundFX.lastSpatialProfile?.pan, 0.68);
});
