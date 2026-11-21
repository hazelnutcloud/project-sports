import { describe, expect, it } from 'vitest';
import {
  ALL_PIN_IDS,
  createEmptyScorecard,
  isSplitFormation,
  recordRoll,
} from '../src/rules/scoring';

function playRolls(rolls: number[]) {
  let card = createEmptyScorecard('p1');
  let lastResult = null;
  for (const pins of rolls) {
    const remaining = card.standingPinIds.slice(pins);
    const out = recordRoll(card, pins, remaining, pins === 0);
    card = out.scorecard;
    lastResult = out.result;
  }
  return { card, lastResult };
}

describe('10-Frame Bowling Scoring Engine', () => {
  it('scores a gutter game as 0 and finishes after 20 rolls', () => {
    const { card, lastResult } = playRolls(Array(20).fill(0));
    expect(card.isFinished).toBe(true);
    expect(card.totalScore).toBe(0);
    expect(lastResult?.callout).toBe('GUTTER');
    expect(card.frames[0].symbols).toEqual(['-', '-']);
  });

  it('scores an all-ones game as 20', () => {
    const { card } = playRolls(Array(20).fill(1));
    expect(card.isFinished).toBe(true);
    expect(card.totalScore).toBe(20);
    expect(card.frames[9].cumulativeScore).toBe(20);
  });

  it('computes spare lookahead bonus correctly', () => {
    // Frame 1: 6 + 4 = 10 (/), Frame 2: 5 + 3 = 8 => Frame 1 = 15, Frame 2 = 23
    const { card } = playRolls([6, 4, 5, 3]);
    expect(card.frames[0].symbols).toEqual(['6', '/']);
    expect(card.frames[0].cumulativeScore).toBe(15);
    expect(card.frames[1].cumulativeScore).toBe(23);
    expect(card.totalScore).toBe(23);
  });

  it('computes strike, double, and turkey callouts and lookahead bonuses', () => {
    let card = createEmptyScorecard('p1');
    const r1 = recordRoll(card, 10, [], false);
    card = r1.scorecard;
    expect(r1.result.callout).toBe('STRIKE');

    const r2 = recordRoll(card, 10, [], false);
    card = r2.scorecard;
    expect(r2.result.callout).toBe('DOUBLE');

    const r3 = recordRoll(card, 10, [], false);
    card = r3.scorecard;
    expect(r3.result.callout).toBe('TURKEY');
    expect(card.frames[0].cumulativeScore).toBe(30);
    expect(card.frames[1].cumulativeScore).toBeNull();
  });

  it('scores a 300 perfect game with 12 strikes and PERFECT_GAME callout', () => {
    const { card, lastResult } = playRolls(Array(12).fill(10));
    expect(card.isFinished).toBe(true);
    expect(card.totalScore).toBe(300);
    expect(card.frames[9].symbols).toEqual(['X', 'X', 'X']);
    expect(card.frames[9].cumulativeScore).toBe(300);
    expect(lastResult?.callout).toBe('PERFECT_GAME');
  });

  it('handles 10th-frame spare + bonus roll cleanly', () => {
    // 9 frames of open 4+4 (=72), then 10th frame: 7, 3 (/), 10 (X) => +20 = 92
    const rolls = [...Array(18).fill(4), 7, 3, 10];
    const { card } = playRolls(rolls);
    expect(card.isFinished).toBe(true);
    expect(card.frames[9].symbols).toEqual(['7', '/', 'X']);
    expect(card.totalScore).toBe(92);
  });

  it('detects authentic USBC split formations accurately', () => {
    // 7-10 split (indices 6 and 9)
    expect(isSplitFormation([6, 9])).toBe(true);
    // 4-6 split (indices 3 and 5)
    expect(isSplitFormation([3, 5])).toBe(true);
    // Headpin still standing -> NOT a split
    expect(isSplitFormation([0, 6, 9])).toBe(false);
    // Adjacent cluster (pins 4 & 7 -> indices 3 and 6) -> NOT a split
    expect(isSplitFormation([3, 6])).toBe(false);
    // Full rack -> NOT a split
    expect(isSplitFormation([...ALL_PIN_IDS])).toBe(false);
  });
});
