import type {
  CalloutType,
  FrameData,
  PlayerScorecard,
  RollResult,
} from '../types/game';

export const ALL_PIN_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/**
 * Standard 10-pin layout (0-indexed matching Pin 1..10):
 *       6  7  8  9      (Row 4: pins 7, 8, 9, 10)
 *        3  4  5        (Row 3: pins 4, 5, 6)
 *         1  2          (Row 2: pins 2, 3)
 *          0            (Row 1: pin 1 headpin)
 *
 * Adjacency graph used for authentic USBC split detection.
 */
const PIN_ADJACENCY: Record<number, number[]> = {
  0: [1, 2],
  1: [0, 2, 3, 4],
  2: [0, 1, 4, 5],
  3: [1, 4, 6, 7],
  4: [1, 2, 3, 5, 7, 8],
  5: [2, 4, 8, 9],
  6: [3, 7],
  7: [3, 4, 6, 8],
  8: [4, 5, 7, 9],
  9: [5, 8],
};

export function isSplitFormation(standingPinIds: number[]): boolean {
  if (standingPinIds.length < 2) return false;
  // A split requires the headpin (index 0) to be knocked down
  if (standingPinIds.includes(0)) return false;

  const standingSet = new Set(standingPinIds);
  const visited = new Set<number>();
  const queue: number[] = [standingPinIds[0]];
  visited.add(standingPinIds[0]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of PIN_ADJACENCY[current] ?? []) {
      if (standingSet.has(neighbor) && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  // If standing pins break into 2+ disconnected clusters, it is a split
  return visited.size < standingSet.size;
}

export function createEmptyScorecard(playerId: string): PlayerScorecard {
  const frames: FrameData[] = Array.from({ length: 10 }, (_, idx) => ({
    frameNumber: idx + 1,
    rolls: [],
    symbols: [],
    cumulativeScore: null,
    isStrike: false,
    isSpare: false,
    isSplit: false,
    isComplete: false,
  }));

  return {
    playerId,
    frames,
    currentFrameIndex: 0,
    totalScore: 0,
    isFinished: false,
    consecutiveStrikes: 0,
    standingPinIds: [...ALL_PIN_IDS],
  };
}

function formatRollSymbol(
  frameNumber: number,
  rolls: number[],
  rollIdx: number
): string {
  const val = rolls[rollIdx];
  if (val === 0) return '-';

  if (frameNumber < 10) {
    if (rollIdx === 0 && val === 10) return 'X';
    if (rollIdx === 1 && rolls[0] + val === 10) return '/';
    return String(val);
  }

  // 10th frame symbol rules
  if (rollIdx === 0) {
    return val === 10 ? 'X' : String(val);
  }
  if (rollIdx === 1) {
    if (rolls[0] === 10) {
      return val === 10 ? 'X' : String(val);
    }
    if (rolls[0] + val === 10) return '/';
    return String(val);
  }
  // rollIdx === 2
  const r0 = rolls[0];
  const r1 = rolls[1];
  if (r0 === 10 && r1 === 10) {
    return val === 10 ? 'X' : String(val);
  }
  if (r0 === 10 && r1 < 10) {
    return r1 + val === 10 ? '/' : String(val);
  }
  // r0 + r1 === 10 (spare)
  return val === 10 ? 'X' : String(val);
}

function recomputeScores(frames: FrameData[]): number {
  // Flatten all rolls with their frame index so lookahead is exact
  const flatRolls: Array<{ frameIdx: number; pins: number }> = [];
  for (let i = 0; i < frames.length; i++) {
    for (const pins of frames[i].rolls) {
      flatRolls.push({ frameIdx: i, pins });
    }
  }

  let running = 0;
  let rollCursor = 0;

  for (let f = 0; f < 10; f++) {
    const frame = frames[f];
    frame.symbols = frame.rolls.map((_, idx) =>
      formatRollSymbol(frame.frameNumber, frame.rolls, idx)
    );

    if (frame.rolls.length === 0) {
      frame.cumulativeScore = null;
      continue;
    }

    if (f < 9) {
      if (frame.rolls[0] === 10) {
        // Strike needs next 2 rolls
        const next1 = flatRolls[rollCursor + 1];
        const next2 = flatRolls[rollCursor + 2];
        if (next1 && next2) {
          running += 10 + next1.pins + next2.pins;
          frame.cumulativeScore = running;
        } else {
          frame.cumulativeScore = null;
        }
        rollCursor += 1;
      } else if (frame.rolls.length >= 2) {
        const sum = frame.rolls[0] + frame.rolls[1];
        if (sum === 10) {
          const next1 = flatRolls[rollCursor + 2];
          if (next1) {
            running += 10 + next1.pins;
            frame.cumulativeScore = running;
          } else {
            frame.cumulativeScore = null;
          }
        } else {
          running += sum;
          frame.cumulativeScore = running;
        }
        rollCursor += 2;
      } else {
        frame.cumulativeScore = null;
        rollCursor += frame.rolls.length;
      }
    } else {
      // Frame 10
      if (frame.isComplete) {
        const sum = frame.rolls.reduce((a, b) => a + b, 0);
        running += sum;
        frame.cumulativeScore = running;
      } else {
        frame.cumulativeScore = null;
      }
      rollCursor += frame.rolls.length;
    }
  }

  return running;
}

function getStrikeCallout(streak: number): CalloutType {
  if (streak >= 5) return 'FIVE_BAGGER';
  if (streak === 4) return 'FOUR_BAGGER';
  if (streak === 3) return 'TURKEY';
  if (streak === 2) return 'DOUBLE';
  return 'STRIKE';
}

export function recordRoll(
  previous: PlayerScorecard,
  pinsKnockedRaw: number,
  remainingStandingPinIds: number[],
  isGutter = false
): { scorecard: PlayerScorecard; result: RollResult } {
  const card: PlayerScorecard = {
    ...previous,
    frames: previous.frames.map((f) => ({
      ...f,
      rolls: [...f.rolls],
      symbols: [...f.symbols],
    })),
    standingPinIds: [...remainingStandingPinIds],
  };

  if (card.isFinished) {
    return {
      scorecard: card,
      result: {
        playerId: card.playerId,
        frameNumber: 10,
        rollIndexInFrame: card.frames[9].rolls.length,
        pinsKnocked: 0,
        standingPinIds: [],
        isGutter,
        callout: null,
        needsFullReset: false,
        frameCompleted: true,
        gameFinished: true,
      },
    };
  }

  const fIdx = card.currentFrameIndex;
  const frame = card.frames[fIdx];
  const maxAvailable = previous.standingPinIds.length;
  const pinsKnocked = Math.max(0, Math.min(maxAvailable, Math.round(pinsKnockedRaw)));
  const rollIndexInFrame = frame.rolls.length;
  const wasFreshRack = previous.standingPinIds.length === 10;

  frame.rolls.push(pinsKnocked);

  let callout: CalloutType | null = null;
  let needsFullReset = false;
  let frameCompleted = false;

  const isStrikeRoll = wasFreshRack && pinsKnocked === 10;
  const isSpareRoll = !wasFreshRack && pinsKnocked === maxAvailable && maxAvailable > 0;

  if (isStrikeRoll) {
    card.consecutiveStrikes += 1;
    callout = getStrikeCallout(card.consecutiveStrikes);
  } else {
    card.consecutiveStrikes = 0;
  }

  if (fIdx < 9) {
    if (isStrikeRoll) {
      frame.isStrike = true;
      frame.isComplete = true;
      frameCompleted = true;
      needsFullReset = true;
    } else if (rollIndexInFrame === 0) {
      if (isGutter && pinsKnocked === 0) {
        callout = 'GUTTER';
      } else if (isSplitFormation(remainingStandingPinIds)) {
        frame.isSplit = true;
        callout = 'SPLIT';
      }
      needsFullReset = false;
    } else {
      // Second roll of frames 1..9
      if (isSpareRoll) {
        frame.isSpare = true;
        callout = frame.isSplit ? 'NICE_PICKUP' : 'SPARE';
      } else if (isGutter && pinsKnocked === 0) {
        callout = 'GUTTER';
      }
      frame.isComplete = true;
      frameCompleted = true;
      needsFullReset = true;
    }
  } else {
    // 10th Frame rules
    if (rollIndexInFrame === 0) {
      if (isStrikeRoll) {
        frame.isStrike = true;
        needsFullReset = true;
      } else {
        if (isGutter && pinsKnocked === 0) {
          callout = 'GUTTER';
        } else if (isSplitFormation(remainingStandingPinIds)) {
          frame.isSplit = true;
          callout = 'SPLIT';
        }
        needsFullReset = false;
      }
    } else if (rollIndexInFrame === 1) {
      const r0 = frame.rolls[0];
      if (r0 === 10) {
        // After a 10th-frame strike, roll 2 is on a fresh rack
        if (isStrikeRoll) {
          needsFullReset = true;
        } else {
          if (isGutter && pinsKnocked === 0) callout = 'GUTTER';
          needsFullReset = false;
        }
      } else if (r0 + pinsKnocked === 10) {
        frame.isSpare = true;
        callout = frame.isSplit ? 'NICE_PICKUP' : 'SPARE';
        needsFullReset = true;
      } else {
        if (isGutter && pinsKnocked === 0) callout = 'GUTTER';
        frame.isComplete = true;
        frameCompleted = true;
        needsFullReset = true;
      }
    } else {
      // Roll 3 of 10th frame (always ends the game)
      if (isSpareRoll) {
        callout = 'SPARE';
      } else if (!isStrikeRoll && isGutter && pinsKnocked === 0) {
        callout = 'GUTTER';
      }
      frame.isComplete = true;
      frameCompleted = true;
      needsFullReset = true;
    }
  }

  if (frameCompleted) {
    if (fIdx < 9) {
      card.currentFrameIndex = fIdx + 1;
    } else {
      card.isFinished = true;
    }
  }

  card.standingPinIds = needsFullReset
    ? [...ALL_PIN_IDS]
    : [...remainingStandingPinIds];

  card.totalScore = recomputeScores(card.frames);

  if (card.isFinished && card.totalScore === 300) {
    callout = 'PERFECT_GAME';
  }

  return {
    scorecard: card,
    result: {
      playerId: card.playerId,
      frameNumber: frame.frameNumber,
      rollIndexInFrame,
      pinsKnocked,
      standingPinIds: card.standingPinIds,
      isGutter: isGutter && pinsKnocked === 0,
      callout,
      needsFullReset,
      frameCompleted,
      gameFinished: card.isFinished,
    },
  };
}
