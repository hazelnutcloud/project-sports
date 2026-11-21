import React, { useEffect, useRef, useState } from 'react';
import type {
  TennisPlayer,
  TennisRallyPhase,
  TennisShotType,
  TennisSwingInput,
} from '../types/tennis';

interface TennisDesktopControlsProps {
  desktopPlayers: TennisPlayer[];
  servingTeam: 'near' | 'far';
  rallyPhase: TennisRallyPhase;
  getServeTossProgress: () => number;
  onServeToss: (playerId: string) => void;
  onSwing: (swing: TennisSwingInput) => void;
  onAimNudge: (playerId: string, nudgeX: number) => void;
}

export const TennisDesktopControls: React.FC<TennisDesktopControlsProps> = ({
  desktopPlayers,
  servingTeam,
  rallyPhase,
  getServeTossProgress,
  onServeToss,
  onSwing,
  onAimNudge,
}) => {
  const p1 = desktopPlayers.find((p) => p.desktopSlot === 1) ?? desktopPlayers[0] ?? null;
  const p2 = desktopPlayers.find((p) => p.desktopSlot === 2 && p.id !== p1?.id) ?? null;

  const [tossProgress, setTossProgress] = useState(0);
  const p1AimRef = useRef(0);
  const p2AimRef = useRef(0);
  const keysHeldRef = useRef(new Set<string>());

  const rallyPhaseRef = useRef(rallyPhase);
  useEffect(() => {
    rallyPhaseRef.current = rallyPhase;
  }, [rallyPhase]);

  // Animate serve toss sweet-spot meter while toss is active
  useEffect(() => {
    if (rallyPhase !== 'serve-toss') {
      setTossProgress(0);
      return;
    }
    let raf = 0;
    const tick = () => {
      setTossProgress(getServeTossProgress());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rallyPhase, getServeTossProgress]);

  const fireShot = (
    player: TennisPlayer | null,
    shotType: TennisShotType,
    aimBias: number
  ) => {
    if (!player) return;
    if (rallyPhaseRef.current === 'waiting-serve' && player.team === servingTeam) {
      onServeToss(player.id);
      return;
    }
    const isServeStrike =
      rallyPhaseRef.current === 'serve-toss' && player.team === servingTeam;

    const spin =
      shotType === 'topspin'
        ? 0.72
        : shotType === 'slice'
          ? -0.72
          : shotType === 'lob'
            ? 0.25
            : 0.2;

    onSwing({
      playerId: player.id,
      strokeSide: isServeStrike ? 'overhead' : aimBias >= 0 ? 'forehand' : 'backhand',
      shotType: isServeStrike ? 'serve' : shotType,
      power: shotType === 'lob' ? 0.65 : 0.82,
      aimBias,
      spin,
      timestampMs: performance.now(),
    });
  };

  useEffect(() => {
    if (!p1 && !p2) return;

    const updateNudges = () => {
      const held = keysHeldRef.current;
      if (p1) {
        const left = held.has('KeyA') || (!p2 && held.has('ArrowLeft'));
        const right = held.has('KeyD') || (!p2 && held.has('ArrowRight'));
        const val = (right ? 1 : 0) - (left ? 1 : 0);
        p1AimRef.current = val;
        onAimNudge(p1.id, val);
      }
      if (p2) {
        const left = held.has('ArrowLeft');
        const right = held.has('ArrowRight');
        const val = (right ? 1 : 0) - (left ? 1 : 0);
        p2AimRef.current = val;
        onAimNudge(p2.id, val);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      keysHeldRef.current.add(e.code);
      updateNudges();

      if (e.repeat) return;

      // Player 1 controls: Space/J = Topspin/Serve, S/K = Slice, W/L = Lob
      if (p1) {
        if (e.code === 'Space' || e.code === 'KeyJ') {
          e.preventDefault();
          fireShot(p1, 'topspin', p1AimRef.current);
        } else if (e.code === 'KeyS' || e.code === 'KeyK') {
          e.preventDefault();
          fireShot(p1, 'slice', p1AimRef.current);
        } else if (e.code === 'KeyW' || e.code === 'KeyL') {
          e.preventDefault();
          fireShot(p1, 'lob', p1AimRef.current);
        }
      }

      // Player 2 local keyboard controls: Enter = Topspin/Serve, ArrowDown = Slice, ArrowUp = Lob
      if (p2) {
        if (e.code === 'Enter' || e.code === 'NumpadEnter') {
          e.preventDefault();
          fireShot(p2, 'topspin', p2AimRef.current);
        } else if (e.code === 'ArrowDown') {
          e.preventDefault();
          fireShot(p2, 'slice', p2AimRef.current);
        } else if (e.code === 'ArrowUp') {
          e.preventDefault();
          fireShot(p2, 'lob', p2AimRef.current);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysHeldRef.current.delete(e.code);
      updateNudges();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p1?.id, p2?.id, servingTeam]);

  if (!p1) return null;

  const isDesktopServing =
    (p1.team === servingTeam || p2?.team === servingTeam) &&
    (rallyPhase === 'waiting-serve' || rallyPhase === 'serve-toss');

  const activeServerPlayer =
    p1.team === servingTeam ? p1 : p2 && p2.team === servingTeam ? p2 : p1;

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-[94%] max-w-2xl rounded-3xl bg-white/94 backdrop-blur-md border-2 border-[#cdecc7] px-4 py-3 text-[#162436] shadow-[0_14px_34px_-12px_rgba(22,36,54,0.28)]">
      {/* Serve Toss Sweet-Spot Bar */}
      {rallyPhase === 'serve-toss' && isDesktopServing && (
        <div className="mb-2.5 space-y-1">
          <div className="flex items-center justify-between text-[11px] font-extrabold">
            <span className="text-[#ea580c]">TAP SPACE AT THE GREEN APEX FOR ROCKET SERVE!</span>
            <span className="text-[#3d9230]">APEX</span>
          </div>
          <div className="relative h-3 rounded-full bg-[#e6eef6] border border-[#d5e0ec] overflow-hidden">
            {/* Sweet-spot center band */}
            <div className="absolute top-0 bottom-0 left-[41%] right-[41%] bg-[#86efac]" />
            <div
              className="absolute top-0 bottom-0 w-3 rounded-full bg-[#ea580c]"
              style={{ left: `calc(${Math.round(tossProgress * 100)}% - 6px)` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[#5b6d82]">
          <span className="font-display font-black text-xs text-[#3d9230] uppercase tracking-wider">
            {p1.name}
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded-md bg-[#eef4fa] border border-[#cddae8] font-bold text-[#162436] text-[10px]">
              {p2 ? 'A/D' : 'A/D or ←/→'}
            </kbd>
            Aim
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded-md bg-[#eef4fa] border border-[#cddae8] font-bold text-[#162436] text-[10px]">
              Space
            </kbd>
            {rallyPhase === 'waiting-serve' && p1.team === servingTeam
              ? 'Toss'
              : rallyPhase === 'serve-toss' && p1.team === servingTeam
                ? 'Serve!'
                : 'Topspin'}
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded-md bg-[#eef4fa] border border-[#cddae8] font-bold text-[#162436] text-[10px]">
              S/K
            </kbd>
            Slice
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded-md bg-[#eef4fa] border border-[#cddae8] font-bold text-[#162436] text-[10px]">
              W/L
            </kbd>
            Lob
          </span>

          {p2 && (
            <>
              <span className="text-[#c5d3e2]">|</span>
              <span className="font-display font-black text-xs text-[#ee5656] uppercase tracking-wider">
                {p2.name}
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded-md bg-[#eef4fa] border border-[#cddae8] font-bold text-[#162436] text-[10px]">
                  ←/→
                </kbd>
                Aim
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded-md bg-[#eef4fa] border border-[#cddae8] font-bold text-[#162436] text-[10px]">
                  Enter
                </kbd>
                Hit
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded-md bg-[#eef4fa] border border-[#cddae8] font-bold text-[#162436] text-[10px]">
                  ↓/↑
                </kbd>
                Slice/Lob
              </span>
            </>
          )}
        </div>

        {/* Quick Click Buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isDesktopServing ? (
            <button
              type="button"
              onClick={() =>
                rallyPhase === 'waiting-serve'
                  ? onServeToss(activeServerPlayer.id)
                  : fireShot(activeServerPlayer, 'serve', p1AimRef.current)
              }
              className="btn-tactile btn-tennis px-4 py-2 rounded-2xl font-display font-extrabold text-xs uppercase tracking-wider cursor-pointer"
            >
              {rallyPhase === 'waiting-serve' ? 'Toss Serve' : 'Strike Serve!'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => fireShot(p1, 'topspin', p1AimRef.current)}
                className="btn-tactile btn-tennis px-3 py-1.5 rounded-xl font-display font-extrabold text-xs cursor-pointer"
              >
                Topspin
              </button>
              <button
                type="button"
                onClick={() => fireShot(p1, 'slice', p1AimRef.current)}
                className="btn-tactile btn-surface px-3 py-1.5 rounded-xl font-display font-bold text-xs cursor-pointer"
              >
                Slice
              </button>
              <button
                type="button"
                onClick={() => fireShot(p1, 'lob', p1AimRef.current)}
                className="btn-tactile btn-surface px-3 py-1.5 rounded-xl font-display font-bold text-xs cursor-pointer"
              >
                Lob
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
