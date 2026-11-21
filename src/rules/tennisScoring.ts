import type {
  TennisCalloutType,
  TennisCourtMode,
  TennisFormat,
  TennisScoreState,
  TennisSlotId,
  TennisTeamId,
} from '../types/tennis';

export type TennisPointReason =
  | 'winner'
  | 'ace'
  | 'out'
  | 'net'
  | 'double-bounce'
  | 'double-fault';

export interface TennisPointDisplay {
  nearLabel: string;
  farLabel: string;
  isDeuce: boolean;
  advantageTeam: TennisTeamId | null;
  gamePointTeam: TennisTeamId | null;
  matchPointTeam: TennisTeamId | null;
}

export interface TennisPointOutcome {
  score: TennisScoreState;
  callout: TennisCalloutType | null;
  subtitle?: string;
  gameWonBy: TennisTeamId | null;
  matchWonBy: TennisTeamId | null;
}

const POINT_LABELS = ['0', '15', '30', '40'] as const;

const SINGLES_SERVER_ORDER: TennisSlotId[] = ['near-back', 'far-back'];
const DOUBLES_SERVER_ORDER: TennisSlotId[] = [
  'near-back',
  'far-back',
  'near-front',
  'far-front',
];

export function getGamesToWin(format: TennisFormat): number {
  return format === '1-game' ? 1 : 2;
}

export function getServeSide(points: { near: number; far: number }): 'deuce' | 'ad' {
  return (points.near + points.far) % 2 === 0 ? 'deuce' : 'ad';
}

export function getServingSlotForRotation(
  courtMode: TennisCourtMode,
  rotationIndex: number
): TennisSlotId {
  const order = courtMode === 'doubles' ? DOUBLES_SERVER_ORDER : SINGLES_SERVER_ORDER;
  const idx = ((rotationIndex % order.length) + order.length) % order.length;
  return order[idx];
}

export function getTeamForSlot(slotId: TennisSlotId): TennisTeamId {
  return slotId.startsWith('near') ? 'near' : 'far';
}

export function otherTeam(team: TennisTeamId): TennisTeamId {
  return team === 'near' ? 'far' : 'near';
}

export function createTennisScoreState(
  format: TennisFormat,
  courtMode: TennisCourtMode,
  initialServer: TennisTeamId = 'near'
): TennisScoreState {
  const startRotation = initialServer === 'near' ? 0 : 1;
  const servingSlot = getServingSlotForRotation(courtMode, startRotation);
  return {
    format,
    courtMode,
    gamesToWin: getGamesToWin(format),
    games: { near: 0, far: 0 },
    points: { near: 0, far: 0 },
    servingTeam: getTeamForSlot(servingSlot),
    servingSlot,
    serverRotationIndex: startRotation,
    serveSide: 'deuce',
    serveFaultCount: 0,
    winnerTeam: null,
    currentRally: 0,
    stats: {
      aces: { near: 0, far: 0 },
      winners: { near: 0, far: 0 },
      doubleFaults: { near: 0, far: 0 },
      longestRally: 0,
      totalPoints: 0,
    },
  };
}

export function getTennisPointDisplay(score: TennisScoreState): TennisPointDisplay {
  const { near, far } = score.points;
  let nearLabel = '0';
  let farLabel = '0';
  let isDeuce = false;
  let advantageTeam: TennisTeamId | null = null;

  if (near >= 3 && far >= 3) {
    if (near === far) {
      nearLabel = '40';
      farLabel = '40';
      isDeuce = true;
    } else if (near > far) {
      nearLabel = 'AD';
      farLabel = '40';
      advantageTeam = 'near';
    } else {
      nearLabel = '40';
      farLabel = 'AD';
      advantageTeam = 'far';
    }
  } else {
    nearLabel = POINT_LABELS[Math.min(3, near)] ?? '40';
    farLabel = POINT_LABELS[Math.min(3, far)] ?? '40';
  }

  let gamePointTeam: TennisTeamId | null = null;
  if (!score.winnerTeam) {
    if (near >= 3 && near >= far + 1) {
      gamePointTeam = 'near';
    } else if (far >= 3 && far >= near + 1) {
      gamePointTeam = 'far';
    }
  }

  let matchPointTeam: TennisTeamId | null = null;
  if (gamePointTeam && score.games[gamePointTeam] + 1 >= score.gamesToWin) {
    matchPointTeam = gamePointTeam;
  }

  return {
    nearLabel,
    farLabel,
    isDeuce,
    advantageTeam,
    gamePointTeam,
    matchPointTeam,
  };
}

export function recordServeFault(state: TennisScoreState): TennisPointOutcome {
  if (state.winnerTeam) {
    return { score: state, callout: null, gameWonBy: null, matchWonBy: state.winnerTeam };
  }

  if (state.serveFaultCount === 0) {
    return {
      score: {
        ...state,
        serveFaultCount: 1,
        currentRally: 0,
      },
      callout: 'FAULT',
      subtitle: '2nd Serve',
      gameWonBy: null,
      matchWonBy: null,
    };
  }

  // Second consecutive fault -> Double Fault, receiving team wins the point
  const receiver = otherTeam(state.servingTeam);
  return recordPointWon(state, receiver, 'double-fault', 0);
}

export function recordPointWon(
  state: TennisScoreState,
  winner: TennisTeamId,
  reason: TennisPointReason,
  rallyLength = state.currentRally
): TennisPointOutcome {
  if (state.winnerTeam) {
    return { score: state, callout: null, gameWonBy: null, matchWonBy: state.winnerTeam };
  }

  const nextStats = {
    aces: { ...state.stats.aces },
    winners: { ...state.stats.winners },
    doubleFaults: { ...state.stats.doubleFaults },
    longestRally: Math.max(state.stats.longestRally, rallyLength),
    totalPoints: state.stats.totalPoints + 1,
  };

  if (reason === 'ace') {
    nextStats.aces[winner] += 1;
    nextStats.winners[winner] += 1;
  } else if (reason === 'winner' || reason === 'double-bounce') {
    nextStats.winners[winner] += 1;
  } else if (reason === 'double-fault') {
    nextStats.doubleFaults[state.servingTeam] += 1;
  }

  const nextPoints = {
    near: state.points.near + (winner === 'near' ? 1 : 0),
    far: state.points.far + (winner === 'far' ? 1 : 0),
  };

  const loser = otherTeam(winner);
  const wonGame = nextPoints[winner] >= 4 && nextPoints[winner] - nextPoints[loser] >= 2;

  if (wonGame) {
    const nextGames = {
      near: state.games.near + (winner === 'near' ? 1 : 0),
      far: state.games.far + (winner === 'far' ? 1 : 0),
    };
    const wonMatch = nextGames[winner] >= state.gamesToWin;
    const nextRotation = state.serverRotationIndex + 1;
    const nextServingSlot = getServingSlotForRotation(state.courtMode, nextRotation);

    const nextScore: TennisScoreState = {
      ...state,
      games: nextGames,
      points: { near: 0, far: 0 },
      servingTeam: wonMatch ? state.servingTeam : getTeamForSlot(nextServingSlot),
      servingSlot: wonMatch ? state.servingSlot : nextServingSlot,
      serverRotationIndex: wonMatch ? state.serverRotationIndex : nextRotation,
      serveSide: 'deuce',
      serveFaultCount: 0,
      winnerTeam: wonMatch ? winner : null,
      currentRally: 0,
      stats: nextStats,
    };

    return {
      score: nextScore,
      callout: wonMatch ? 'MATCH_WIN' : 'GAME',
      subtitle: `${nextGames.near} – ${nextGames.far}`,
      gameWonBy: winner,
      matchWonBy: wonMatch ? winner : null,
    };
  }

  const nextScore: TennisScoreState = {
    ...state,
    points: nextPoints,
    serveSide: getServeSide(nextPoints),
    serveFaultCount: 0,
    currentRally: 0,
    stats: nextStats,
  };

  const display = getTennisPointDisplay(nextScore);
  let callout: TennisCalloutType | null = null;
  let subtitle: string | undefined;

  if (reason === 'ace') {
    callout = 'ACE';
    subtitle = `${display.nearLabel} – ${display.farLabel}`;
  } else if (reason === 'double-fault') {
    callout = 'DOUBLE_FAULT';
    subtitle = `${display.nearLabel} – ${display.farLabel}`;
  } else if (reason === 'out') {
    callout = 'OUT';
    subtitle = `${display.nearLabel} – ${display.farLabel}`;
  } else if (reason === 'net') {
    callout = 'NET';
    subtitle = `${display.nearLabel} – ${display.farLabel}`;
  } else if (display.matchPointTeam) {
    callout = 'MATCH_POINT';
  } else if (display.gamePointTeam && !display.advantageTeam) {
    callout = 'GAME_POINT';
  } else if (display.isDeuce) {
    callout = 'DEUCE';
  } else if (display.advantageTeam) {
    callout = 'ADVANTAGE';
  } else if (reason === 'winner') {
    callout = 'NICE_SHOT';
    subtitle = `${display.nearLabel} – ${display.farLabel}`;
  }

  return {
    score: nextScore,
    callout,
    subtitle,
    gameWonBy: null,
    matchWonBy: null,
  };
}
