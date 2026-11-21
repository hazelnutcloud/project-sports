import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  Hand,
  RotateCcw,
  Smartphone,
  Sparkles,
  Trophy,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import { BALL_COLORS, BALL_COLOR_ORDER, type BallColorId } from '../types/game';
import type { PeerConnectionStatus } from '../types/network';
import type {
  TennisControllerStatusPayload,
  TennisRacketPose,
  TennisShotType,
} from '../types/tennis';
import { TennisPhoneControllerSession } from '../network/TennisLobbyController';
import { TennisSwingDetector } from './TennisSwingDetector';
import { SensorBridge, type SensorPermissionState } from './SensorBridge';
import { SpoccoLogoMark } from '../ui/SportArtwork';

interface TennisPhoneControllerUIProps {
  initialRoomCode?: string;
  initialDisplayId?: string;
  onExit: () => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export const TennisPhoneControllerUI: React.FC<TennisPhoneControllerUIProps> = ({
  initialRoomCode = '',
  initialDisplayId,
  onExit,
}) => {
  const [roomCode, setRoomCode] = useState(initialRoomCode.toUpperCase());
  const [playerName, setPlayerName] = useState('Player');
  const [connectedOnce, setConnectedOnce] = useState(false);
  const [connStatus, setConnStatus] = useState<PeerConnectionStatus>('new');
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<TennisControllerStatusPayload | null>(null);
  const [sensorState, setSensorState] = useState<SensorPermissionState>('prompt');
  const [useSwipeMode, setUseSwipeMode] = useState(false);
  const [touchShotType, setTouchShotType] = useState<'topspin' | 'slice' | 'lob'>('topspin');
  const [pose, setPose] = useState<TennisRacketPose>({
    pitch: 0,
    roll: 0,
    yaw: 0,
    swingEnergy: 0,
  });
  const [lastShotLabel, setLastShotLabel] = useState<string | null>(null);

  const sessionRef = useRef<TennisPhoneControllerSession | null>(null);
  const detectorRef = useRef<TennisSwingDetector>(new TennisSwingDetector());
  const sensorRef = useRef<SensorBridge | null>(null);
  const statusRef = useRef<TennisControllerStatusPayload | null>(null);
  const lastPoseEmitRef = useRef<number>(0);

  const swipeStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const bridge = new SensorBridge((sample) => {
      const st = statusRef.current;
      const expectServeToss = Boolean(
        st && st.phase === 'playing' && st.isMyServe && st.rallyPhase === 'waiting-serve'
      );
      const isServeStrike = Boolean(
        st && st.phase === 'playing' && st.isMyServe && st.rallyPhase === 'serve-toss'
      );

      const out = detectorRef.current.pushSample(sample, {
        expectServeToss,
        isServeStrike,
      });
      setPose(out.pose);

      const now = performance.now();
      if (st?.phase === 'playing' && now - lastPoseEmitRef.current >= 22) {
        lastPoseEmitRef.current = now;
        sessionRef.current?.sendRacketPose(out.pose);
      }

      if (out.serveTossTriggered) {
        bridge.triggerHaptic('serve-toss');
        setLastShotLabel('SERVE TOSS!');
        sessionRef.current?.sendServeToss();
      } else if (out.swing) {
        bridge.triggerHaptic('racket-hit');
        const mph = Math.round(52 + out.swing.power * 64);
        setLastShotLabel(`${out.swing.shotType.toUpperCase()} · ${mph} mph`);
        if (st?.phase === 'playing') {
          sessionRef.current?.sendSwing(out.swing);
        }
      }
    });

    sensorRef.current = bridge;
    if (!bridge.isSupported()) {
      setSensorState('unsupported');
      setUseSwipeMode(true);
    }

    return () => {
      bridge.stop();
      sessionRef.current?.destroy();
    };
  }, []);

  useEffect(() => {
    if (initialRoomCode && !connectedOnce) {
      void handleJoinRoom(initialRoomCode, playerName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleJoinRoom = async (codeOverride?: string, nameOverride?: string) => {
    const code = (codeOverride ?? roomCode).trim().toUpperCase();
    if (code.length < 4) {
      setError('Enter the 4-letter room code shown on the screen.');
      return;
    }
    setError(null);
    setConnStatus('connecting');
    sessionRef.current?.destroy();

    const session = new TennisPhoneControllerSession({
      onConnectionStatus: (st) => {
        setConnStatus(st);
        if (st === 'connected') {
          setConnectedOnce(true);
          setError(null);
        }
      },
      onControllerStatus: (payload) => setStatus(payload),
      onHaptic: (pattern) => sensorRef.current?.triggerHaptic(pattern),
      onError: (msg) => setError(msg),
    });
    sessionRef.current = session;

    try {
      await session.connect(code, nameOverride ?? playerName, initialDisplayId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to connect to Tennis room.');
      setConnStatus('failed');
    }
  };

  const handleEnableSensors = async () => {
    if (!sensorRef.current) return;
    const perm = await sensorRef.current.requestPermissionAndStart();
    setSensorState(perm);
    if (perm === 'granted') {
      setUseSwipeMode(false);
      detectorRef.current.calibrate();
      sensorRef.current.triggerHaptic('tick');
    } else {
      setUseSwipeMode(true);
    }
  };

  const handleTossTap = () => {
    sensorRef.current?.triggerHaptic('serve-toss');
    setLastShotLabel('SERVE TOSS!');
    sessionRef.current?.sendServeToss();
  };

  const handleSwipeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    swipeStartRef.current = { x: e.clientX, y: e.clientY, time: performance.now() };
  };

  const handleSwipeUp = (e: React.PointerEvent) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;

    const dx = e.clientX - start.x;
    const dy = start.y - e.clientY;
    const dtSec = Math.max(0.05, (performance.now() - start.time) / 1000);

    const st = statusRef.current;
    if (st?.isMyServe && st.rallyPhase === 'waiting-serve') {
      handleTossTap();
      return;
    }

    const swipeDist = Math.hypot(dx, dy);
    const power = clamp(0.42 + (swipeDist / dtSec / 1400) * 0.58, 0.35, 1);
    const aimBias = clamp(dx / 135, -0.95, 0.95);
    const isServeStrike = Boolean(st?.isMyServe && st.rallyPhase === 'serve-toss');
    const shotType: TennisShotType = isServeStrike ? 'serve' : touchShotType;
    const spin =
      shotType === 'topspin' ? 0.72 : shotType === 'slice' ? -0.72 : shotType === 'lob' ? 0.25 : 0.35;

    sensorRef.current?.triggerHaptic('racket-hit');
    setLastShotLabel(`${shotType.toUpperCase()} · ${Math.round(52 + power * 64)} mph`);
    sessionRef.current?.sendSwing({
      strokeSide: isServeStrike ? 'overhead' : dx >= 0 ? 'forehand' : 'backhand',
      shotType,
      power: Number(power.toFixed(3)),
      aimBias: Number(aimBias.toFixed(3)),
      spin,
      timestampMs: performance.now(),
    });
  };

  const colorSpec = BALL_COLORS[status?.color ?? 'cyan'];

  if (!connectedOnce && connStatus !== 'connected') {
    return (
      <div className="min-h-full w-full spocco-plaza-bg flex flex-col items-center justify-center p-5 text-[#162436]">
        <div className="w-full max-w-sm space-y-5">
          <div className="flex items-center justify-between">
            <SpoccoLogoMark compact />
            <button
              type="button"
              onClick={onExit}
              className="btn-tactile btn-surface px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Plaza
            </button>
          </div>

          <div className="rounded-[28px] bg-white border-2 border-[#cdecc7] p-6 shadow-xl space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[#eef9ec] border border-[#cdecc7] flex items-center justify-center text-[#3d9230] shrink-0">
                <Smartphone className="w-6 h-6" />
              </div>
              <div>
                <h1 className="font-display text-xl font-black text-[#162436]">
                  Tennis Racket Controller
                </h1>
                <p className="text-xs text-[#5b6d82]">
                  Enter the room code shown on your court screen
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <input
                type="text"
                maxLength={4}
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="ABCD"
                className="w-full rounded-2xl bg-[#f5f9fd] border-2 border-[#d5e0ec] focus:border-[#58b947] px-4 py-3 text-center font-display text-2xl font-black tracking-[0.35em] uppercase focus:outline-none"
              />
              <input
                type="text"
                maxLength={14}
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Your Name"
                className="w-full rounded-2xl bg-[#f5f9fd] border-2 border-[#d5e0ec] focus:border-[#58b947] px-4 py-3 text-base font-bold focus:outline-none"
              />
            </div>

            {error && (
              <div className="rounded-2xl bg-[#fff1f2] border border-[#fecdd3] px-3.5 py-2.5 text-xs font-semibold text-[#be123c]">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleJoinRoom()}
              disabled={connStatus === 'connecting'}
              className="btn-tactile btn-tennis w-full py-3.5 rounded-2xl font-display font-extrabold text-base disabled:opacity-55 cursor-pointer"
            >
              {connStatus === 'connecting' ? 'Connecting...' : 'Pair Racket'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const inLobby = !status || status.phase === 'lobby';
  const isFinished = status?.phase === 'finished';
  const isMyServeWait = Boolean(
    status?.phase === 'playing' && status.isMyServe && status.rallyPhase === 'waiting-serve'
  );
  const isMyServeToss = Boolean(
    status?.phase === 'playing' && status.isMyServe && status.rallyPhase === 'serve-toss'
  );

  return (
    <div className="h-full w-full bg-[#f2f9f2] text-[#162436] flex flex-col justify-between p-3.5 pb-4 select-none overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-2 bg-white rounded-2xl border border-[#cdecc7] px-3 py-2 shadow-2xs shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-9 h-9 rounded-full border-2 border-white shadow-sm flex items-center justify-center font-display font-black text-xs text-white shrink-0"
            style={{ backgroundColor: colorSpec.primary }}
          >
            {(status?.playerName ?? playerName).slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-display text-sm font-black truncate">
              {status?.playerName ?? playerName}
            </div>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-[#5b6d82]">
              {connStatus === 'connected' ? (
                <Wifi className="w-3 h-3 text-[#58b947]" />
              ) : (
                <WifiOff className="w-3 h-3 text-[#ee5656]" />
              )}
              <span>{status?.team === 'far' ? 'Far Court' : 'Near Court'}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-[#f2fbf1] border border-[#cdecc7] px-3 py-1 text-right shrink-0">
          {inLobby ? (
            <>
              <div className="text-[10px] uppercase font-extrabold text-[#3d9230]">
                Tennis · {roomCode}
              </div>
              <div className="font-display text-sm font-black tabular-nums">
                {status?.roomPlayerCount ?? 1}/{status?.maxPlayers ?? 4} Players
              </div>
            </>
          ) : (
            <>
              <div className="text-[10px] uppercase font-extrabold text-[#3d9230] tabular-nums">
                Games {status.gamesNear}–{status.gamesFar}
              </div>
              <div className="font-display text-lg font-black leading-none tabular-nums">
                {status.pointsNearLabel} – {status.pointsFarLabel}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Motion Sensor Enable CTA */}
      {sensorState === 'prompt' && !useSwipeMode && !isFinished && (
        <button
          type="button"
          onClick={() => void handleEnableSensors()}
          className="btn-tactile btn-tennis mt-2 w-full py-2.5 rounded-2xl font-display font-extrabold text-xs uppercase tracking-wider cursor-pointer shrink-0"
        >
          Tap to Enable Motion Racket
        </button>
      )}

      {/* Lobby Side & Jersey Picker */}
      {inLobby && status && (
        <div className="mt-2 rounded-2xl bg-white border border-[#cdecc7] p-3 space-y-2.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-extrabold text-[#5b6d82]">Choose Your Court Side</span>
            <div className="inline-flex rounded-xl bg-[#edf3f9] p-1">
              {(['near', 'far'] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  onClick={() => {
                    sensorRef.current?.triggerHaptic('tick');
                    sessionRef.current?.switchTeam(side);
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                    status.team === side ? 'bg-white text-[#162436] shadow-2xs' : 'text-[#5b6d82]'
                  }`}
                >
                  {side === 'near' ? 'Near Court' : 'Far Court'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-extrabold text-[#5b6d82]">Jersey Color</span>
            <div className="flex items-center gap-1.5">
              {BALL_COLOR_ORDER.map((cid) => (
                <button
                  key={cid}
                  type="button"
                  onClick={() => {
                    sensorRef.current?.triggerHaptic('tick');
                    sessionRef.current?.updateProfile({ color: cid as BallColorId });
                  }}
                  className={`w-6 h-6 rounded-full border-2 cursor-pointer ${
                    status.color === cid ? 'border-[#162436] scale-110' : 'border-white opacity-65'
                  }`}
                  style={{ backgroundColor: BALL_COLORS[cid].primary }}
                  aria-label={`Select ${BALL_COLORS[cid].label}`}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Center Interactive Racket Zone */}
      <div className="flex-1 my-2.5 flex flex-col gap-2.5 min-h-0">
        {isFinished && status ? (
          <div className="flex-1 rounded-[28px] bg-white border-2 border-[#cdecc7] p-6 flex flex-col items-center justify-center text-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-[#fff7dc] border-2 border-[#f6d365] text-[#d97706] flex items-center justify-center">
              <Trophy className="w-7 h-7" />
            </div>
            <div className="font-display text-2xl font-black text-[#162436]">
              {status.winnerTeam === status.team ? 'You Won the Match!' : 'Great Match!'}
            </div>
            <div className="text-sm font-bold text-[#5b6d82] tabular-nums">
              Final Games: {status.gamesNear} – {status.gamesFar}
            </div>
          </div>
        ) : !useSwipeMode ? (
          <div className="flex-1 rounded-[28px] bg-white border-2 border-[#58b947]/55 p-5 flex flex-col items-center justify-center text-center gap-3.5 shadow-sm">
            {isMyServeWait ? (
              <>
                <div className="px-3 py-1 rounded-full bg-[#eef9ec] text-[#3d9230] text-[11px] font-extrabold uppercase tracking-wider">
                  Your Serve {status?.serveFaultCount === 1 ? '· 2nd Serve' : ''}
                </div>
                <button
                  type="button"
                  onClick={handleTossTap}
                  className="btn-tactile btn-tennis w-full max-w-xs py-5 rounded-3xl font-display font-black text-lg flex items-center justify-center gap-2 cursor-pointer"
                >
                  <ArrowUp className="w-5 h-5" />
                  TAP OR FLICK UP TO TOSS
                </button>
                <p className="text-xs text-[#5b6d82]">
                  Toss the ball up, then swing overhead right at the peak for a Rocket Serve!
                </p>
              </>
            ) : isMyServeToss ? (
              <>
                <div className="w-16 h-16 rounded-full bg-[#fff4eb] border-3 border-[#f97316] text-[#ea580c] flex items-center justify-center animate-bounce">
                  <Zap className="w-8 h-8" />
                </div>
                <div className="font-display text-2xl font-black text-[#ea580c]">
                  SWING NOW!!
                </div>
                <p className="text-xs text-[#5b6d82]">Strike the ball at its peak!</p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-full bg-[#eef9ec] border-3 border-[#58b947] text-[#3d9230] flex items-center justify-center">
                  <Sparkles className="w-7 h-7" />
                </div>
                <div className="font-display text-xl font-black text-[#162436]">
                  {inLobby ? 'PRACTICE RACKET SWING' : 'SWING TO HIT!'}
                </div>
                <p className="text-xs text-[#5b6d82] max-w-xs leading-relaxed">
                  Hold your phone like a tennis racket — no button needed! Brush up for{' '}
                  <strong>Topspin</strong>, chop down for <strong>Slice</strong>, or scoop up for a{' '}
                  <strong>Lob</strong>.
                </p>

                {/* Live Swing Energy Meter */}
                <div className="w-52 space-y-1">
                  <div className="h-2.5 rounded-full bg-[#e8f0f8] border border-[#d5e0ec] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#58b947] via-[#f59e0b] to-[#ee5656] transition-[width] duration-75"
                      style={{ width: `${Math.round(pose.swingEnergy * 100)}%` }}
                    />
                  </div>
                  <div className="text-[10px] font-extrabold uppercase tracking-widest text-[#7c8fa4]">
                    Live Swing Power
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    detectorRef.current.calibrate();
                    sensorRef.current?.triggerHaptic('tick');
                  }}
                  className="btn-tactile btn-surface px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-[#5b6d82]" />
                  Center Racket
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col gap-2 min-h-0">
            {/* Shot Type Pills for Touch Swipe Mode */}
            <div className="grid grid-cols-3 gap-1.5 shrink-0">
              {(['topspin', 'slice', 'lob'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTouchShotType(t)}
                  className={`py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider border-2 cursor-pointer ${
                    touchShotType === t
                      ? 'bg-[#58b947] border-[#3d9230] text-white'
                      : 'bg-white border-[#dce6f1] text-[#5b6d82]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div
              onPointerDown={handleSwipeDown}
              onPointerUp={handleSwipeUp}
              onPointerCancel={handleSwipeUp}
              className="flex-1 rounded-[28px] border-2 border-dashed border-[#58b947] bg-white flex flex-col items-center justify-center gap-2 touch-none"
            >
              <div className="w-14 h-14 rounded-2xl bg-[#eef9ec] text-[#3d9230] flex items-center justify-center">
                <Hand className="w-7 h-7 animate-bounce" />
              </div>
              <div className="font-display text-xl font-black text-[#162436]">
                {isMyServeWait
                  ? 'TAP TO TOSS SERVE'
                  : isMyServeToss
                    ? 'SWIPE UP TO SERVE!'
                    : 'SWIPE TO SWING'}
              </div>
              <p className="text-xs text-[#5b6d82] text-center px-6">
                Swipe left or right to aim across the court · Swipe faster for power
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer Switch & Last Shot Readout */}
      <div className="flex items-center justify-between gap-2 text-xs shrink-0">
        <button
          type="button"
          onClick={() => {
            if (useSwipeMode && sensorState === 'prompt') {
              void handleEnableSensors();
            } else {
              setUseSwipeMode((v) => !v);
            }
          }}
          className="btn-tactile btn-surface px-3 py-2 rounded-xl font-bold text-[#162436] cursor-pointer"
        >
          {useSwipeMode ? 'Use Motion Racket' : 'Switch to Touch Swipe'}
        </button>

        {lastShotLabel ? (
          <div className="text-[11px] font-extrabold text-[#3d9230] bg-white border border-[#cdecc7] px-2.5 py-1.5 rounded-xl tabular-nums">
            {lastShotLabel}
          </div>
        ) : (
          <button
            type="button"
            onClick={onExit}
            className="text-[#5b6d82] hover:text-[#162436] font-bold px-2 py-1 cursor-pointer"
          >
            Leave
          </button>
        )}
      </div>
    </div>
  );
};
