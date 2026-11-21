import React from 'react';
import {
  HelpCircle,
  Home,
  RotateCcw,
  Trophy,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  BALL_COLORS,
  type CalloutType,
  type MatchState,
  type PlayerProfile,
} from '../types/game';

interface ScoreboardHUDProps {
  matchState: MatchState;
  activeLocalPlayer: PlayerProfile | null;
  callout: { id: number; playerName: string; type: CalloutType; pinsKnocked: number } | null;
  isHost: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onOpenHelp: () => void;
  onRematch: () => void;
  onBackToLobby: () => void;
}

const CALLOUT_STYLES: Record<CalloutType, { title: string; color: string; pillBg: string }> = {
  STRIKE: { title: 'STRIKE!', color: '#ee5656', pillBg: '#fff0f0' },
  DOUBLE: { title: 'DOUBLE!', color: '#f97316', pillBg: '#fff4eb' },
  TURKEY: { title: 'TURKEY!!', color: '#e11d48', pillBg: '#fff0f5' },
  FOUR_BAGGER: { title: '4 IN A ROW!!', color: '#9333ea', pillBg: '#f8f0ff' },
  FIVE_BAGGER: { title: 'UNSTOPPABLE!!', color: '#0284c7', pillBg: '#eef8ff' },
  SPARE: { title: 'SPARE!', color: '#0d9488', pillBg: '#e8faf7' },
  NICE_PICKUP: { title: 'SPLIT PICKUP!', color: '#059669', pillBg: '#ecfdf5' },
  SPLIT: { title: 'SPLIT', color: '#ea580c', pillBg: '#fff5ed' },
  GUTTER: { title: 'GUTTER', color: '#64748b', pillBg: '#f1f5f9' },
  PERFECT_GAME: { title: '300 PERFECT GAME!!', color: '#d97706', pillBg: '#fffbeb' },
};

export const ScoreboardHUD: React.FC<ScoreboardHUDProps> = ({
  matchState,
  activeLocalPlayer,
  callout,
  isHost,
  muted,
  onToggleMute,
  onOpenHelp,
  onRematch,
  onBackToLobby,
}) => {
  const focusPlayer = activeLocalPlayer ?? matchState.players[0] ?? null;
  const focusCard = focusPlayer ? matchState.scorecards[focusPlayer.id] : null;
  const focusBallColor = focusPlayer ? BALL_COLORS[focusPlayer.color].primary : '#12b8a6';

  const rankedPlayers = [...matchState.players].sort((a, b) => {
    const sa = matchState.scorecards[a.id]?.totalScore ?? 0;
    const sb = matchState.scorecards[b.id]?.totalScore ?? 0;
    return sb - sa;
  });

  return (
    <>
      {/* Top Bright Spocco Broadcast Scoreboard Bar */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 z-10 p-3 sm:p-4 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          {/* Active Player 10-Frame Scorecard */}
          {focusPlayer && focusCard && (
            <div className="pointer-events-auto rounded-2xl bg-white/94 backdrop-blur-md border border-[#d5e0ec] shadow-[0_10px_28px_-12px_rgba(22,36,54,0.28)] overflow-hidden max-w-full">
              {/* Colored Player Top Stripe */}
              <div className="h-1.5 w-full" style={{ backgroundColor: focusBallColor }} />

              <div className="px-3.5 py-1.5 bg-[#f7fafd] border-b border-[#e5edf6] flex items-center justify-between gap-5">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-3.5 h-3.5 rounded-full border-2 border-white shadow-xs shrink-0"
                    style={{ backgroundColor: focusBallColor }}
                  />
                  <span className="font-display text-xs sm:text-sm font-black tracking-tight text-[#162436] truncate">
                    {focusPlayer.name}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#e6faf7] text-[#0c8c7e] font-extrabold shrink-0">
                    Lane {focusPlayer.laneIndex + 1}
                  </span>
                </div>
                <div className="font-display text-xs sm:text-sm font-black text-[#162436] tabular-nums shrink-0">
                  <span className="text-[#5b6d82] font-bold mr-1">Total</span>
                  {focusCard.totalScore}
                </div>
              </div>

              <div className="flex overflow-x-auto">
                {focusCard.frames.map((frame, idx) => {
                  const isCurrent =
                    !focusCard.isFinished && idx === focusCard.currentFrameIndex;
                  return (
                    <div
                      key={frame.frameNumber}
                      className={`min-w-[42px] sm:min-w-[50px] border-r border-[#e7eff7] last:border-r-0 flex flex-col ${
                        isCurrent ? 'bg-[#e9faf7]' : 'bg-white'
                      }`}
                    >
                      <div
                        className={`text-[9px] font-extrabold text-center border-b border-[#edf3f9] py-0.5 tabular-nums ${
                          isCurrent ? 'text-[#0c8c7e]' : 'text-[#7c8fa4]'
                        }`}
                      >
                        {frame.frameNumber}
                      </div>
                      <div className="flex justify-end gap-0.5 px-1 pt-0.5 text-[11px] font-black h-5 tabular-nums">
                        {(frame.frameNumber === 10 ? [0, 1, 2] : [0, 1]).map((slot) => {
                          const sym = frame.symbols[slot] ?? '';
                          const isX = sym === 'X';
                          const isSpare = sym === '/';
                          return (
                            <span
                              key={slot}
                              className={`w-4 text-center rounded ${
                                isX
                                  ? 'text-[#ee5656]'
                                  : isSpare
                                    ? 'text-[#0d9488]'
                                    : 'text-[#334155]'
                              }`}
                            >
                              {sym}
                            </span>
                          );
                        })}
                      </div>
                      <div className="font-display text-center text-xs sm:text-sm font-black py-1 text-[#162436] tabular-nums">
                        {frame.cumulativeScore !== null ? frame.cumulativeScore : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Top-Right Clean Utility Cluster */}
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
              <HelpCircle className="w-4 h-4 text-[#0d9488]" />
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
              onClick={onBackToLobby}
              className="px-3 py-2.5 rounded-2xl bg-white/92 hover:bg-white border border-[#d5e0ec] text-[#162436] shadow-sm text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
              title="Return to Spocco Plaza"
            >
              <Home className="w-3.5 h-3.5 text-[#5b6d82]" />
              <span className="hidden sm:inline">Plaza</span>
            </button>
          </div>
        </div>

        {/* Multi-Player Mini Standings Strip */}
        {matchState.players.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {matchState.players.map((p) => {
              const sc = matchState.scorecards[p.id];
              const isFocused = focusPlayer?.id === p.id;
              return (
                <div
                  key={p.id}
                  className={`px-3 py-1 rounded-full backdrop-blur-md border text-xs font-bold flex items-center gap-2 shadow-xs ${
                    isFocused
                      ? 'bg-white border-[#12b8a6] ring-2 ring-[#12b8a6]/25 text-[#162436]'
                      : 'bg-white/85 border-[#d5e0ec] text-[#5b6d82]'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: BALL_COLORS[p.color].primary }}
                  />
                  <span>{p.name}</span>
                  <span className="font-display font-black text-[#162436] tabular-nums">
                    {sc?.totalScore ?? 0}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Athletic Center Callout Banner (STRIKE! / SPARE! / TURKEY!!) */}
      {callout && (
        <div
          key={callout.id}
          className="pointer-events-none absolute inset-x-0 top-1/3 z-20 flex flex-col items-center justify-center animate-callout"
        >
          <div
            className="px-4 py-1 rounded-full border border-white shadow-md text-[11px] font-extrabold uppercase tracking-[0.22em] text-[#162436] mb-1.5"
            style={{ backgroundColor: CALLOUT_STYLES[callout.type].pillBg }}
          >
            {callout.playerName}
          </div>
          <div
            className="font-display text-5xl sm:text-7xl font-black italic tracking-tight callout-text-outline"
            style={{ color: CALLOUT_STYLES[callout.type].color }}
          >
            {CALLOUT_STYLES[callout.type].title}
          </div>
        </div>
      )}

      {/* Finished Match Podium Modal */}
      {matchState.phase === 'finished' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-[#162436]/30 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-[28px] bg-white border-2 border-[#d5e0ec] p-6 text-[#162436] shadow-2xl space-y-5 animate-modal-in">
            <div className="text-center space-y-1.5">
              <div className="w-14 h-14 rounded-2xl bg-[#fff7dc] border-2 border-[#f6d365] text-[#d97706] flex items-center justify-center mx-auto mb-2">
                <Trophy className="w-7 h-7" />
              </div>
              <div className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#12b8a6]">
                10 Frames Complete
              </div>
              <h2 className="font-display text-3xl font-black tracking-tight text-[#162436]">
                Final Results
              </h2>
            </div>

            <div className="space-y-2.5">
              {rankedPlayers.map((p, rank) => {
                const score = matchState.scorecards[p.id]?.totalScore ?? 0;
                const isWinner = rank === 0;
                return (
                  <div
                    key={p.id}
                    className={`rounded-2xl px-4 py-3 flex items-center justify-between border-2 ${
                      isWinner
                        ? 'bg-[#fffbeb] border-[#f5c451]'
                        : 'bg-[#f7fafd] border-[#e2ebf4]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-7 h-7 rounded-xl font-display font-black text-sm flex items-center justify-center ${
                          isWinner
                            ? 'bg-[#f59e0b] text-white'
                            : 'bg-[#e4edf6] text-[#5b6d82]'
                        }`}
                      >
                        {rank + 1}
                      </span>
                      <span
                        className="w-4 h-4 rounded-full border border-white shadow-2xs"
                        style={{ backgroundColor: BALL_COLORS[p.color].primary }}
                      />
                      <span className="font-display font-bold text-base text-[#162436]">
                        {p.name}
                      </span>
                    </div>
                    <span className="font-display text-2xl font-black text-[#162436] tabular-nums">
                      {score}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2.5 pt-2">
              {isHost && (
                <button
                  type="button"
                  onClick={onRematch}
                  className="btn-tactile btn-coral flex-1 py-3 rounded-2xl font-display font-extrabold text-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  Play Again
                </button>
              )}
              <button
                type="button"
                onClick={onBackToLobby}
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
