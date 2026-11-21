import { describe, expect, it } from 'vitest';
import {
  createTennisScoreState,
  getTennisPointDisplay,
  recordPointWon,
  recordServeFault,
} from '../src/rules/tennisScoring';

describe('Tennis Scoring Rules Engine', () => {
  it('progresses 0 -> 15 -> 30 -> 40 -> Game with serve side alternation', () => {
    let score = createTennisScoreState('best-of-3', 'singles', 'near');
    expect(score.serveSide).toBe('deuce');
    expect(getTennisPointDisplay(score).nearLabel).toBe('0');

    // 15 - 0 (ad side)
    score = recordPointWon(score, 'near', 'winner').score;
    expect(getTennisPointDisplay(score).nearLabel).toBe('15');
    expect(score.serveSide).toBe('ad');

    // 30 - 0 (deuce side)
    score = recordPointWon(score, 'near', 'winner').score;
    expect(getTennisPointDisplay(score).nearLabel).toBe('30');
    expect(score.serveSide).toBe('deuce');

    // 40 - 0 (Game Point!)
    const gp = recordPointWon(score, 'near', 'winner');
    score = gp.score;
    expect(getTennisPointDisplay(score).nearLabel).toBe('40');
    expect(getTennisPointDisplay(score).gamePointTeam).toBe('near');
    expect(gp.callout).toBe('GAME_POINT');

    // Game won -> 1-0 games, points reset, server flips to far
    const won = recordPointWon(score, 'near', 'winner');
    expect(won.gameWonBy).toBe('near');
    expect(won.matchWonBy).toBeNull();
    expect(won.callout).toBe('GAME');
    expect(won.score.games).toEqual({ near: 1, far: 0 });
    expect(won.score.points).toEqual({ near: 0, far: 0 });
    expect(won.score.servingTeam).toBe('far');
    expect(won.score.servingSlot).toBe('far-back');
  });

  it('handles Deuce, Advantage, back to Deuce, and win-by-2', () => {
    let score = createTennisScoreState('best-of-3', 'singles', 'near');
    for (let i = 0; i < 3; i++) {
      score = recordPointWon(score, 'near', 'winner').score;
      score = recordPointWon(score, 'far', 'winner').score;
    }
    expect(getTennisPointDisplay(score).isDeuce).toBe(true);
    expect(getTennisPointDisplay(score).nearLabel).toBe('40');
    expect(getTennisPointDisplay(score).farLabel).toBe('40');

    // Near gets Advantage
    const adOut = recordPointWon(score, 'near', 'winner');
    score = adOut.score;
    expect(getTennisPointDisplay(score).nearLabel).toBe('AD');
    expect(getTennisPointDisplay(score).advantageTeam).toBe('near');
    expect(adOut.callout).toBe('ADVANTAGE');

    // Far saves -> back to Deuce
    const deuceOut = recordPointWon(score, 'far', 'winner');
    score = deuceOut.score;
    expect(getTennisPointDisplay(score).isDeuce).toBe(true);
    expect(deuceOut.callout).toBe('DEUCE');

    // Far wins 2 in a row -> wins game
    score = recordPointWon(score, 'far', 'winner').score;
    const gameWin = recordPointWon(score, 'far', 'winner');
    expect(gameWin.gameWonBy).toBe('far');
    expect(gameWin.score.games).toEqual({ near: 0, far: 1 });
  });

  it('supports 1-Game Quick Match and Best of 3 Games (first to 2)', () => {
    let quick = createTennisScoreState('1-game', 'singles', 'near');
    for (let i = 0; i < 3; i++) {
      quick = recordPointWon(quick, 'near', 'winner').score;
    }
    expect(getTennisPointDisplay(quick).matchPointTeam).toBe('near');
    const quickWin = recordPointWon(quick, 'near', 'ace');
    expect(quickWin.matchWonBy).toBe('near');
    expect(quickWin.callout).toBe('MATCH_WIN');
    expect(quickWin.score.winnerTeam).toBe('near');
    expect(quickWin.score.stats.aces.near).toBe(1);

    // Best of 3 requires 2 games
    let bo3 = createTennisScoreState('best-of-3', 'doubles', 'near');
    for (let g = 0; g < 2; g++) {
      for (let p = 0; p < 4; p++) {
        bo3 = recordPointWon(bo3, 'far', 'winner').score;
      }
    }
    expect(bo3.games).toEqual({ near: 0, far: 2 });
    expect(bo3.winnerTeam).toBe('far');
  });

  it('tracks 1st fault -> 2nd serve -> Double Fault awarding point to receiver', () => {
    let score = createTennisScoreState('best-of-3', 'singles', 'near');
    const f1 = recordServeFault(score);
    expect(f1.callout).toBe('FAULT');
    expect(f1.score.serveFaultCount).toBe(1);
    expect(f1.score.points).toEqual({ near: 0, far: 0 });

    const f2 = recordServeFault(f1.score);
    expect(f2.callout).toBe('DOUBLE_FAULT');
    expect(f2.score.serveFaultCount).toBe(0);
    expect(f2.score.points).toEqual({ near: 0, far: 1 });
    expect(f2.score.stats.doubleFaults.near).toBe(1);
  });

  it('rotates all 4 server slots cleanly in Doubles', () => {
    let score = createTennisScoreState('best-of-3', 'doubles', 'near');
    expect(score.servingSlot).toBe('near-back');

    // Game 1 -> near wins -> server becomes far-back
    for (let i = 0; i < 4; i++) score = recordPointWon(score, 'near', 'winner').score;
    expect(score.servingSlot).toBe('far-back');

    // Game 2 -> far wins -> 1-1 -> server becomes near-front
    for (let i = 0; i < 4; i++) score = recordPointWon(score, 'far', 'winner').score;
    expect(score.servingSlot).toBe('near-front');
  });
});
