import React from 'react';
import {
  Flame,
  HelpCircle,
  Home,
  RotateCcw,
  Trophy,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { BALL_COLORS } from '../types/game';
import type { TennisCalloutType, TennisMatchState } from '../types/tennis';
import { getTennisPointDisplay } from '../rules/tennisScoring';

interface TennisScoreboardHUDProps {
  matchState: TennisMatchState;
  rallyCount: number;
  callout: { id: number; type: TennisCalloutType; subtitle?: string } | null;
  isHost: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onOpenHelp: () => void;
  onRematch: () => void;
  onBackToPlaza: () => void;
}

const TENNIS_CALLOUT_STYLES: Record<
  TennisCalloutType,
  { title: string; color: string; pillBg: string }
> = {
  ACE: { title: 'ACE!!', color: '#16a34a', pillBg: '#eefbf0' },
  POWER_SERVE: { title: 'ROCKET SERVE!', color: '#f97316', pillBg: '#fff4eb' },
  SMASH: { title: 'SMASH!!', color: '#ee5656', pillBg: '#fff0f0' },
  NICE_SHOT: { title: 'WINNER!', color: '#0d9488', pillBg: '#e8faf7' },
  FAULT: { title: 'FAULT', color: '#d97706', pillBg: '#fffbeb' },
  DOUBLE_FAULT: { title: 'DOUBLE FAULT', color: '#dc2626', pillBg: '#fef2f2' },
  LET: { title: 'LET', color: '#0284c7', pillBg: '#eff8ff' },
  OUT: { title: 'OUT!', color: '#ea580c', pillBg: '#fff5ed' },
  NET: { title: 'NET!', color: '#64748b', pillBg: '#f1f5f9' },
  DEUCE: { title: 'DEUCE!', color: '#7c3aed', pillBg: '#f6f0ff' },
  ADVANTAGE: { title: 'ADVANTAGE!', color: '#0284c7', pillBg: '#eef8ff' },
  GAME_POINT: { title: 'GAME POINT!', color: '#0d9488', pillBg: '#e8faf7' },
  MATCH_POINT: { title: 'MATCH POINT!!', color: '#e11d48', pillBg: '#fff0f5' },
  GAME: { title: 'GAME!', color: '#16a34a', pillBg: '#eefbf0' },
  MATCH_WIN: { title: 'GAME, SET & MATCH!!', color: '#d97706', pillBg: '#fffbeb' },
};

export const TennisScoreboardHUD: React.FC<TennisScoreboardHUDProps> = ({
  matchState,
  rallyCount,
  callout,
  isHost,
  muted,
  onToggleMute,
  onOpenHelp,
  onRematch,
  onBackToPlaza,
}) => {
  const score = matchState.score;
  const pt = getTennisPointDisplay(score);

  const nearSlots = matchState.slots.filter((s) => s.team === 'near');
  const farSlots = matchState.slots.filter((s) => s.team === 'far');
  const nearLabel = nearSlots.map((s) => s.name).join(' & ') || 'Near Team';
  const farLabel = farSlots.map((s) => s.name).join(' & ') || 'Far Team';
  const nearColor = BALL_COLORS[nearSlots[0]?.color ?? 'cyan'].primary;
  const farColor = BALL_COLORS[farSlots[0]?.color ?? 'coral'].primary;

  const winnerName =
    score.winnerTeam === 'near' ? nearLabel : score.winnerTeam === 'far' ? farLabel : '';

  return (
    <>
      {/* Top Broadcast Tennis Scorebug & Utility Cluster */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 z-10 p-3 sm:p-4 flex items-start justify-between gap-3">
        {/* Left: Wimbledon / Spocco Broadcast Scoreboard */}
        <div className="pointer-events-auto flex flex-col gap-2">
          <div className="rounded-2xl bg-white/95 backdrop-blur-md border border-[#cdecc7] shadow-[0_12px_28px_-12px_rgba(22,36,54,0.3)] overflow-hidden min-w-[260px] sm:min-w-[310px]">
            <div className="px-3 py-1 bg-[#162436] text-white flex items-center justify-between text-[10px] font-extrabold uppercase tracking-[0.16em]">
              <span className="text-[#86efac]">
                Spocco Tennis · {score.format === '1-game' ? '1-Game' : 'Best of 3'}
              </span>
              <div className="flex items-center gap-3.5 text-[#cbd5e1]">
                <span>Games</span>
                <span className="w-7 text-center">Pts</span>
              </div>
            </div>

            {/* Far Team Row */}
            <div className="px-3 py-2 flex items-center justify-between gap-3 border-b border-[#e8f0f6]">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: farColor }}
                />
                <span className="font-display text-xs sm:text-sm font-black text-[#162436] truncate max-w-[140px] sm:max-w-[175px]">
                  {farLabel}
                </span>
                {score.servingTeam === 'far' && matchState.phase === 'playing' && (
                  <span
                    className="w-2.5 h-2.5 rounded-full bg-[#c6f628] border border-[#4d7c0f] shrink-0"
                    title="Serving"
                  />
                )}
              </div>
              <div className="flex items-center gap-3.5 tabular-nums">
                <span className="font-display text-base font-black text-[#162436] w-5 text-center">
                  {score.games.far}
                </span>
                <span className="font-display text-base font-black px-2 py-0.5 rounded-lg bg-[#eef4fa] text-[#162436] w-9 text-center">
                  {pt.farLabel}
                </span>
              </div>
            </div>

            {/* Near Team Row */}
            <div className="px-3 py-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: nearColor }}
                />
                <span className="font-display text-xs sm:text-sm font-black text-[#162436] truncate max-w-[140px] sm:max-w-[175px]">
                  {nearLabel}
                </span>
                {score.servingTeam === 'near' && matchState.phase === 'playing' && (
                  <span
                    className="w-2.5 h-2.5 rounded-full bg-[#c6f628] border border-[#4d7c0f] shrink-0"
                    title="Serving"
                  />
                )}
              </div>
              <div className="flex items-center gap-3.5 tabular-nums">
                <span className="font-display text-base font-black text-[#162436] w-5 text-center">
                  {score.games.near}
                </span>
                <span className="font-display text-base font-black px-2 py-0.5 rounded-lg bg-[#e6faf7] text-[#0c8c7e] w-9 text-center">
                  {pt.nearLabel}
                </span>
              </div>
            </div>
          </div>

          {/* Contextual Badges (2nd Serve / Deuce / Rally Counter) */}
          <div className="flex flex-wrap items-center gap-1.5">
            {score.serveFaultCount === 1 && matchState.phase === 'playing' && (
              <span className="px-2.5 py-1 rounded-full bg-[#fffbeb] border border-[#f5c451] text-[11px] font-extrabold text-[#b45309] shadow-xs">
                2nd Serve
              </span>
            )}
            {pt.isDeuce && matchState.phase === 'playing' && (
              <span className="px-2.5 py-1 rounded-full bg-[#f5f3ff] border border-[#c4b5fd] text-[11px] font-extrabold text-[#6d28d9] shadow-xs">
                Deuce
              </span>
            )}
            {pt.matchPointTeam && matchState.phase === 'playing' && (
              <span className="px-2.5 py-1 rounded-full bg-[#fff1f2] border border-[#fda4af] text-[11px] font-extrabold text-[#be123c] shadow-xs">
                Match Point
              </span>
            )}
            {rallyCount >= 4 && matchState.phase === 'playing' && (
              <span className="px-2.5 py-1 rounded-full bg-white/95 border border-[#f59e0b] text-[11px] font-extrabold text-[#d97706] shadow-xs flex items-center gap-1 tabular-nums">
                <Flame className="w-3.5 h-3.5 text-[#f97316]" />
                {rallyCount}-Shot Rally
              </span>
            )}
          </div>
        </div>

        {/* Right: Utility Buttons */}
        <div className="pointer-events-auto flex items-center gap-2 shrink-0">
          <div className="hidden sm:flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-white/92 backdrop-blur-md border border-[#d5e0ec] shadow-sm text-xs font-extrabold">
            <span className="text-[#7c8fa4] text-[10px] tracking-wider">ROOM</span>
            <span className="font-display text-[#162436] tracking-[0.18em] tabular-nums">
              {matchState.roomCode}
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenHelp}
            className="p-2.5 rounded-2xl bg-white/92 hover:bg-white border border-[#d5e0ec] text-[#162436] shadow-sm transition cursor-pointer"
            title="How to Play"
            aria-label="How to Play"
          >
            <HelpCircle className="w-4 h-4 text-[#3d9230]" />
          </button>
          <button
            type="button"
            onClick={onToggleMute}
            className="p-2.5 rounded-2xl bg-white/92 hover:bg-white border border-[#d5e0ec] text-[#162436] shadow-sm transition cursor-pointer"
            title={muted ? 'Unmute sound' : 'Mute sound'}
            aria-label={muted ? 'Unmute sound' : 'Mute sound'}
          >
            {muted ? (
              <VolumeX className="w-4 h-4 text-[#ee5656]" />
            ) : (
              <Volume2 className="w-4 h-4 text-[#162436]" />
            )}
          </button>
          <button
            type="button"
            onClick={onBackToPlaza}
            className="px-3 py-2.5 rounded-2xl bg-white/92 hover:bg-white border border-[#d5e0ec] text-[#162436] shadow-sm text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
          >
            <Home className="w-3.5 h-3.5 text-[#5b6d82]" />
            <span className="hidden sm:inline">Plaza</span>
          </button>
        </div>
      </div>

      {/* Center Callout Banner */}
      {callout && (
        <div
          key={callout.id}
          className="pointer-events-none absolute inset-x-0 top-[30%] z-20 flex flex-col items-center justify-center animate-callout"
        >
          {callout.subtitle && (
            <div
              className="px-4 py-1 rounded-full border border-white shadow-md text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#162436] mb-1.5"
              style={{ backgroundColor: TENNIS_CALLOUT_STYLES[callout.type].pillBg }}
            >
              {callout.subtitle}
            </div>
          )}
          <div
            className="font-display text-5xl sm:text-7xl font-black italic tracking-tight callout-text-outline text-center px-4"
            style={{ color: TENNIS_CALLOUT_STYLES[callout.type].color }}
          >
            {TENNIS_CALLOUT_STYLES[callout.type].title}
          </div>
        </div>
      )}

      {/* Finished Match Podium Modal */}
      {matchState.phase === 'finished' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-[#162436]/32 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-[28px] bg-white border-2 border-[#cdecc7] p-6 text-[#162436] shadow-2xl space-y-5 animate-modal-in">
            <div className="text-center space-y-1.5">
              <div className="w-14 h-14 rounded-2xl bg-[#fff7dc] border-2 border-[#f6d365] text-[#d97706] flex items-center justify-center mx-auto mb-2">
                <Trophy className="w-7 h-7" />
              </div>
              <div className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#3d9230]">
                Game, Set &amp; Match
              </div>
              <h2 className="font-display text-3xl font-black tracking-tight text-[#162436]">
                {winnerName} Wins!
              </h2>
            </div>

            <div className="rounded-2xl bg-[#f7fafd] border border-[#dce6f1] p-4 space-y-3">
              <div className="flex items-center justify-between font-display font-black text-lg tabular-nums">
                <span className="truncate max-w-[130px]" style={{ color: nearColor }}>
                  {nearLabel}
                </span>
                <span className="px-3 py-1 rounded-xl bg-white border border-[#dce6f1] text-2xl">
                  {score.games.near} – {score.games.far}
                </span>
                <span className="truncate max-w-[130px] text-right" style={{ color: farColor }}>
                  {farLabel}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#e5edf6] text-center">
                <div>
                  <div className="text-[10px] font-extrabold uppercase text-[#7c8fa4]">Aces</div>
                  <div className="font-display text-base font-black tabular-nums">
                    {score.stats.aces.near} – {score.stats.aces.far}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-extrabold uppercase text-[#7c8fa4]">
                    Winners
                  </div>
                  <div className="font-display text-base font-black tabular-nums">
                    {score.stats.winners.near} – {score.stats.winners.far}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-extrabold uppercase text-[#7c8fa4]">
                    Best Rally
                  </div>
                  <div className="font-display text-base font-black tabular-nums">
                    {score.stats.longestRally}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2.5 pt-1">
              {isHost && (
                <button
                  type="button"
                  onClick={onRematch}
                  className="btn-tactile btn-tennis flex-1 py-3 rounded-2xl font-display font-extrabold text-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  Rematch
                </button>
              )}
              <button
                type="button"
                onClick={onBackToPlaza}
                className="btn-tactile btn-surface flex-1 py-3 rounded-2xl font-display font-bold text-sm cursor-pointer"
              >
                Back to Plaza
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
