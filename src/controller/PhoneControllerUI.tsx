import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bug,
  Check,
  Compass,
  Copy,
  Hand,
  MoveHorizontal,
  RotateCcw,
  Smartphone,
  Sparkles,
  Trash2,
  Trophy,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  BALL_COLORS,
  BALL_COLOR_ORDER,
  type AimState,
  type ArmPoseState,
  type BallColorId,
  type ThrowParams,
} from '../types/game';
import type {
  ControllerPlayerSummary,
  PeerConnectionStatus,
} from '../types/network';
import {
  PhoneControllerSession,
  type ControllerStatusPayload,
} from '../network/LobbyController';
import { SwingDetector, type SwingLiveTelemetry } from './SwingDetector';
import { SensorBridge, type SensorPermissionState } from './SensorBridge';
import {
  uploadDebugTrace,
  type ImuTraceRecord,
} from './ThrowTraceRecorder';
import { SpoccoLogoMark } from '../ui/SportArtwork';

interface PhoneControllerUIProps {
  initialRoomCode?: string;
  initialDisplayId?: string;
  onExit: () => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function friendlyConnectionLabel(status: PeerConnectionStatus): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'connecting':
    case 'new':
      return 'Connecting...';
    case 'disconnected':
    case 'failed':
      return 'Disconnected';
  }
}

export const PhoneControllerUI: React.FC<PhoneControllerUIProps> = ({
  initialRoomCode = '',
  initialDisplayId,
  onExit,
}) => {
  const [roomCode, setRoomCode] = useState(initialRoomCode.toUpperCase());
  const [playerName, setPlayerName] = useState('Player');
  const [connectedOnce, setConnectedOnce] = useState(false);
  const [connStatus, setConnStatus] = useState<PeerConnectionStatus>('new');
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<ControllerStatusPayload | null>(null);
  const [sensorState, setSensorState] = useState<SensorPermissionState>('prompt');
  const [useSwipeMode, setUseSwipeMode] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [aimMode, setAimMode] = useState<'position' | 'angle'>('position');
  const [aim, setAim] = useState<AimState>({ xOffset: 0, aimAngle: 0 });
  const [pose, setPose] = useState<ArmPoseState>({
    pitch: 0,
    roll: 0,
    holdingGrip: false,
    phase: 'idle',
  });
  const [telemetry, setTelemetry] = useState<SwingLiveTelemetry | null>(null);
  const [lastThrowInfo, setLastThrowInfo] = useState<ThrowParams | null>(null);
  const [lastTrace, setLastTrace] = useState<ImuTraceRecord | null>(null);
  const [traceUploadMsg, setTraceUploadMsg] = useState<string | null>(null);
  const [copiedTrace, setCopiedTrace] = useState(false);
  const [showSwingTip, setShowSwingTip] = useState(true);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [pendingHandoffPlayer, setPendingHandoffPlayer] =
    useState<ControllerPlayerSummary | null>(null);

  const sessionRef = useRef<PhoneControllerSession | null>(null);
  const detectorRef = useRef<SwingDetector>(new SwingDetector());
  const sensorRef = useRef<SensorBridge | null>(null);
  const aimRef = useRef<AimState>(aim);
  const isMyTurnRef = useRef<boolean>(false);
  const debugModeRef = useRef<boolean>(false);
  const lastPoseEmitRef = useRef<number>(0);

  const swipeStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const [swipeVector, setSwipeVector] = useState<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    aimRef.current = aim;
  }, [aim]);

  useEffect(() => {
    debugModeRef.current = debugMode;
    detectorRef.current.setDebugTracing(debugMode);
  }, [debugMode]);

  const prevTurnKeyRef = useRef<string>('');
  const lastActivePhonePlayerIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!status || status.phase !== 'playing') {
      prevTurnKeyRef.current = '';
      lastActivePhonePlayerIdRef.current = null;
      setPendingHandoffPlayer(null);
      return;
    }

    const phonePlayers = status.players ?? [];
    const sharedPhone = phonePlayers.length > 1;

    if (status.isMyTurn) {
      const key = `${status.playerId}-${status.frameNumber}-${status.rollNumber}`;
      if (prevTurnKeyRef.current !== key) {
        prevTurnKeyRef.current = key;
        const zeroAim: AimState = { xOffset: 0, aimAngle: 0 };
        setAim(zeroAim);
        aimRef.current = zeroAim;
      }

      if (
        sharedPhone &&
        lastActivePhonePlayerIdRef.current !== null &&
        lastActivePhonePlayerIdRef.current !== status.playerId
      ) {
        const activeSummary = phonePlayers.find((p) => p.playerId === status.playerId);
        if (activeSummary) {
          detectorRef.current.reset();
          setPendingHandoffPlayer(activeSummary);
        }
      }
      lastActivePhonePlayerIdRef.current = status.playerId;
    } else {
      setPendingHandoffPlayer(null);
    }
  }, [status]);

  useEffect(() => {
    isMyTurnRef.current = Boolean(
      status?.isMyTurn && status?.phase === 'playing' && !pendingHandoffPlayer
    );
  }, [status, pendingHandoffPlayer]);

  const emitTraceIfPresent = (trace: ImuTraceRecord | null) => {
    if (!trace) return;
    setLastTrace(trace);
    setTraceUploadMsg('Saving trace...');
    void uploadDebugTrace(trace).then((res) => {
      if (res.ok) {
        setTraceUploadMsg(
          `Saved #${res.seq} (${trace.summary.sampleCount} samples, ${trace.summary.endReason})`
        );
      } else {
        setTraceUploadMsg(`Upload failed: ${res.error ?? 'unknown error'}`);
      }
    });
  };

  const holdIntervalRef = useRef<number | null>(null);
  const startAimNudge = (dir: -1 | 1) => {
    const step = () => {
      setAim((prev) => {
        const next: AimState =
          aimMode === 'position'
            ? { ...prev, xOffset: clamp(prev.xOffset + dir * 0.025, -0.4, 0.4) }
            : { ...prev, aimAngle: clamp(prev.aimAngle + dir * 0.015, -0.17, 0.17) };
        sessionRef.current?.sendAim(next);
        return next;
      });
    };
    sensorRef.current?.triggerHaptic('tick');
    step();
    if (holdIntervalRef.current) window.clearInterval(holdIntervalRef.current);
    holdIntervalRef.current = window.setInterval(step, 55);
  };

  const stopAimNudge = () => {
    if (holdIntervalRef.current) {
      window.clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  };

  useEffect(() => {
    const bridge = new SensorBridge((sample) => {
      const out = detectorRef.current.pushSample(sample, aimRef.current);
      setPose(out.pose);
      if (debugModeRef.current) {
        setTelemetry(out.telemetry);
      }

      const now = performance.now();
      if (isMyTurnRef.current && now - lastPoseEmitRef.current >= 16) {
        lastPoseEmitRef.current = now;
        sessionRef.current?.sendArmPose(out.pose, aimRef.current);
      }

      if (out.completedTrace) {
        emitTraceIfPresent(out.completedTrace);
      }

      if (out.releasedThrow) {
        setLastThrowInfo(out.releasedThrow);
        bridge.triggerHaptic('release');
        if (isMyTurnRef.current) {
          sessionRef.current?.sendThrow(out.releasedThrow);
        }
      }
    });
    sensorRef.current = bridge;

    if (!bridge.isSupported()) {
      setSensorState('unsupported');
      setUseSwipeMode(true);
    }

    return () => {
      stopAimNudge();
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
      setError('Enter the 4-letter room code shown on your game screen.');
      return;
    }
    setError(null);
    setConnStatus('connecting');
    sessionRef.current?.destroy();

    const session = new PhoneControllerSession({
      onConnectionStatus: (st) => {
        setConnStatus(st);
        if (st === 'connected') {
          setConnectedOnce(true);
          setError(null);
        }
      },
      onControllerStatus: (payload) => {
        setStatus(payload);
      },
      onHaptic: (pattern) => {
        sensorRef.current?.triggerHaptic(pattern);
      },
      onError: (msg) => {
        setError(msg);
      },
    });
    sessionRef.current = session;

    try {
      await session.connect(code, nameOverride ?? playerName, initialDisplayId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to the room.');
      setConnStatus('failed');
    }
  };

  const handleEnableSensors = async () => {
    if (!sensorRef.current) return;
    const perm = await sensorRef.current.requestPermissionAndStart();
    setSensorState(perm);
    if (perm === 'granted') {
      setUseSwipeMode(false);
      sensorRef.current.triggerHaptic('tick');
    } else {
      setUseSwipeMode(true);
    }
  };

  const handleRecenter = () => {
    detectorRef.current.reset();
    sensorRef.current?.triggerHaptic('tick');
    const zeroAim: AimState = { xOffset: 0, aimAngle: 0 };
    setAim(zeroAim);
    sessionRef.current?.sendAim(zeroAim);
  };

  const handleGripPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (sensorState === 'prompt') {
      void handleEnableSensors();
    }
    sensorRef.current?.triggerHaptic('tick');
    const practiceOnly = !isMyTurnRef.current;
    const out = detectorRef.current.setGripHeld(
      true,
      performance.now(),
      aimRef.current,
      practiceOnly
    );
    setPose(out.pose);
    if (debugModeRef.current) setTelemetry(out.telemetry);
    if (isMyTurnRef.current) {
      sessionRef.current?.sendArmPose(out.pose, aimRef.current);
    }
  };

  const handleGripPointerUp = (e: React.PointerEvent) => {
    e.preventDefault();
    const practiceOnly = !isMyTurnRef.current;
    const out = detectorRef.current.setGripHeld(
      false,
      performance.now(),
      aimRef.current,
      practiceOnly
    );
    setPose(out.pose);
    if (debugModeRef.current) setTelemetry(out.telemetry);
    if (out.completedTrace) {
      emitTraceIfPresent(out.completedTrace);
    }
    if (isMyTurnRef.current) {
      sessionRef.current?.sendArmPose(out.pose, aimRef.current);
      if (out.releasedThrow) {
        setLastThrowInfo(out.releasedThrow);
        sensorRef.current?.triggerHaptic('release');
        sessionRef.current?.sendThrow(out.releasedThrow);
      }
    } else if (out.releasedThrow) {
      setLastThrowInfo(out.releasedThrow);
      sensorRef.current?.triggerHaptic('release');
    }
  };

  const handleCopyTrace = async () => {
    if (!lastTrace) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(lastTrace, null, 2));
      setCopiedTrace(true);
      window.setTimeout(() => setCopiedTrace(false), 1800);
    } catch {
      // ignore
    }
  };

  const handleSwipeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    swipeStartRef.current = { x: e.clientX, y: e.clientY, time: performance.now() };
    setSwipeVector({ dx: 0, dy: 0 });
    if (isMyTurnRef.current) {
      sessionRef.current?.sendArmPose(
        { pitch: -0.65, roll: 0, holdingGrip: true, phase: 'backswing' },
        aimRef.current
      );
    }
  };

  const handleSwipeMove = (e: React.PointerEvent) => {
    if (!swipeStartRef.current) return;
    const dx = e.clientX - swipeStartRef.current.x;
    const dy = e.clientY - swipeStartRef.current.y;
    setSwipeVector({ dx, dy });
  };

  const handleSwipeUp = (e: React.PointerEvent) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    setSwipeVector(null);
    if (!start) return;

    const dx = e.clientX - start.x;
    const dy = start.y - e.clientY;
    const dtSec = Math.max(0.06, (performance.now() - start.time) / 1000);

    if (dy < 35) {
      if (isMyTurnRef.current) {
        sessionRef.current?.sendArmPose(
          { pitch: 0, roll: 0, holdingGrip: false, phase: 'idle' },
          aimRef.current
        );
      }
      return;
    }

    const swipeSpeedPx = dy / dtSec;
    const speed = clamp(7.2 + (swipeSpeedPx / 1600) * 6.8, 7.2, 14.0);
    const spin = clamp(dx / 140, -1, 1);

    const throwParams: ThrowParams = {
      xOffset: aimRef.current.xOffset,
      aimAngle: aimRef.current.aimAngle,
      speed: Number(speed.toFixed(2)),
      spin: Number(spin.toFixed(3)),
      loft: 0.28,
    };

    if (isMyTurnRef.current) {
      setLastThrowInfo(throwParams);
      sensorRef.current?.triggerHaptic('release');
      sessionRef.current?.sendArmPose(
        { pitch: 1.0, roll: spin * 0.6, holdingGrip: false, phase: 'released' },
        aimRef.current
      );
      sessionRef.current?.sendThrow(throwParams);
    }
  };

  const colorSpec = BALL_COLORS[status?.ballColor ?? 'purple'];

  // Pre-connection Onboarding Screen
  if (!connectedOnce && connStatus !== 'connected') {
    return (
      <div className="min-h-full w-full spocco-plaza-bg flex flex-col items-center justify-center p-5 text-[#162436] overflow-y-auto">
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

          <div className="rounded-[28px] bg-white border-2 border-[#dce6f1] p-6 shadow-[0_18px_40px_-18px_rgba(22,36,54,0.22)] space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[#e6faf7] border border-[#b7efe6] flex items-center justify-center text-[#0c8c7e] shrink-0">
                <Smartphone className="w-6 h-6" />
              </div>
              <div>
                <h1 className="font-display text-xl font-black tracking-tight text-[#162436]">
                  Motion Controller
                </h1>
                <p className="text-xs text-[#5b6d82]">
                  Enter the room code shown on your game screen
                </p>
              </div>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[#5b6d82] mb-1.5">
                  Room Code
                </label>
                <input
                  type="text"
                  maxLength={4}
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="ABCD"
                  className="w-full rounded-2xl bg-[#f5f9fd] border-2 border-[#d5e0ec] focus:border-[#12b8a6] px-4 py-3 text-center font-display text-2xl font-black tracking-[0.35em] uppercase text-[#162436] placeholder:text-[#b4c4d4] focus:outline-none tabular-nums"
                />
              </div>

              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[#5b6d82] mb-1.5">
                  Your Name
                </label>
                <input
                  type="text"
                  maxLength={14}
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Alex"
                  className="w-full rounded-2xl bg-[#f5f9fd] border-2 border-[#d5e0ec] focus:border-[#12b8a6] px-4 py-3 text-base font-bold text-[#162436] placeholder:text-[#b4c4d4] focus:outline-none"
                />
              </div>
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
              className="btn-tactile btn-coral w-full py-3.5 rounded-2xl font-display font-extrabold text-base disabled:opacity-55 cursor-pointer"
            >
              {connStatus === 'connecting' ? 'Connecting...' : 'Connect Phone'}
            </button>

            <p className="text-[11px] text-center text-[#5b6d82] leading-snug">
              Sharing one phone? Connect first, then add up to 4 players in the lobby!
            </p>
          </div>
        </div>
      </div>
    );
  }

  const playersOnPhone: ControllerPlayerSummary[] = status?.players ?? [];
  const isSharedPhone = playersOnPhone.length > 1;
  const maxPlayers = status?.maxPlayers ?? 4;
  const roomPlayerCount = status?.roomPlayerCount ?? playersOnPhone.length;
  const canAddMorePlayers = roomPlayerCount < maxPlayers;

  const isPlaying = status?.phase === 'playing';
  const isMyTurn = Boolean(status?.isMyTurn && isPlaying);
  const inLobby = !status || status.phase === 'lobby';
  const isFinished = status?.phase === 'finished';

  const handleAddPhonePlayer = () => {
    if (!canAddMorePlayers) return;
    sensorRef.current?.triggerHaptic('tick');
    sessionRef.current?.addPlayer(`Player ${roomPlayerCount + 1}`);
  };

  const handleRemovePhonePlayer = (id: string) => {
    if (playersOnPhone.length <= 1) return;
    sensorRef.current?.triggerHaptic('tick');
    sessionRef.current?.removePlayer(id);
  };

  const handleCycleColor = (id: string, color: BallColorId) => {
    sensorRef.current?.triggerHaptic('tick');
    sessionRef.current?.updatePlayerProfile(id, { color });
  };

  const handleConfirmHandoff = () => {
    detectorRef.current.reset();
    sensorRef.current?.triggerHaptic('tick');
    setPendingHandoffPlayer(null);
  };

  const rankedPhonePlayers = [...playersOnPhone].sort(
    (a, b) => b.totalScore - a.totalScore
  );

  return (
    <div className="h-full w-full bg-[#f3f7fb] text-[#162436] flex flex-col justify-between p-3.5 pb-4 select-none overflow-hidden">
      {/* Top Player & Score Bar */}
      <div className="flex items-center justify-between gap-2 bg-white rounded-2xl border border-[#dce6f1] px-3 py-2 shadow-2xs shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-9 h-9 rounded-full border-2 border-white shadow-sm flex items-center justify-center font-display font-black text-xs text-white shrink-0"
            style={{
              background: `radial-gradient(circle at 30% 30%, ${colorSpec.swirl}, ${colorSpec.primary})`,
            }}
          >
            {(status?.playerName ?? playerName).slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-display text-sm font-black leading-tight truncate flex items-center gap-1.5">
              <span className="truncate">
                {inLobby && isSharedPhone
                  ? `${playersOnPhone.length} Players · Shared`
                  : status?.playerName ?? playerName}
              </span>
            </div>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-[#5b6d82]">
              {connStatus === 'connected' ? (
                <Wifi className="w-3 h-3 text-[#12b8a6]" />
              ) : (
                <WifiOff className="w-3 h-3 text-[#ee5656]" />
              )}
              <span>{friendlyConnectionLabel(connStatus)}</span>
              {isSharedPhone && !inLobby && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full bg-[#eef6ff] text-[#1d6bb8] text-[10px] font-extrabold">
                  {playersOnPhone.length}P Phone
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-[#f4f8fc] border border-[#dce6f1] px-3 py-1 text-right shrink-0">
          {inLobby ? (
            <>
              <div className="text-[10px] uppercase font-extrabold text-[#0c8c7e] tabular-nums">
                Room {roomCode}
              </div>
              <div className="font-display text-sm font-black leading-tight text-[#162436] tabular-nums">
                {roomPlayerCount}/{maxPlayers} Bowlers
              </div>
            </>
          ) : (
            <>
              <div className="text-[10px] uppercase font-extrabold text-[#0c8c7e] tabular-nums">
                Frame {status?.frameNumber ?? 1} · Roll {status?.rollNumber ?? 1}
              </div>
              <div className="font-display text-lg font-black leading-none text-[#162436] tabular-nums">
                {status?.totalScore ?? 0}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Shared Phone Live Mini Standings Strip (during gameplay) */}
      {isPlaying && isSharedPhone && (
        <div className="mt-1.5 flex items-center gap-1.5 overflow-x-auto shrink-0 pb-0.5">
          {playersOnPhone.map((p) => {
            const pColor = BALL_COLORS[p.color].primary;
            return (
              <div
                key={p.playerId}
                className={`px-2.5 py-1 rounded-full border text-[11px] font-bold flex items-center gap-1.5 shrink-0 transition ${
                  p.isActiveTurn
                    ? 'bg-white border-[#12b8a6] ring-2 ring-[#12b8a6]/25 text-[#162436] shadow-2xs'
                    : 'bg-white/75 border-[#dce6f1] text-[#5b6d82]'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: pColor }}
                />
                <span className="truncate max-w-[72px]">{p.name}</span>
                <span className="font-display font-black text-[#162436] tabular-nums">
                  {p.totalScore}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Turn / Lobby Status Banner */}
      <div className="my-2 shrink-0">
        {inLobby ? (
          <div className="rounded-2xl bg-[#eef6ff] border border-[#c7dff8] px-3.5 py-1.5 text-center">
            <div className="text-xs font-extrabold text-[#1d6bb8]">
              {isSharedPhone
                ? `Room ${roomCode} · Pass & Play ready! Practice swinging below.`
                : `You're in Room ${roomCode}! Add friends below or try a practice swing.`}
            </div>
          </div>
        ) : isFinished ? (
          <div className="rounded-2xl bg-[#fffbeb] border border-[#f5d57a] px-3.5 py-2 text-center">
            <div className="text-xs font-extrabold text-[#b45309]">
              {isSharedPhone
                ? 'Game Complete! Check out the final standings below.'
                : `Game Complete! Final Score: ${status.totalScore}`}
            </div>
          </div>
        ) : isMyTurn ? (
          <div
            className="rounded-2xl border-2 px-3.5 py-1.5 text-center"
            style={{
              backgroundColor: isSharedPhone ? `${colorSpec.primary}14` : '#e6faf7',
              borderColor: isSharedPhone ? colorSpec.primary : '#12b8a6',
            }}
          >
            <div
              className="font-display text-xs font-black tracking-wide flex items-center justify-center gap-1.5"
              style={{ color: isSharedPhone ? colorSpec.accent : '#0c8c7e' }}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {isSharedPhone
                ? `${status.playerName.toUpperCase()}'S TURN TO BOWL!`
                : 'YOUR TURN TO BOWL!'}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl bg-white border border-[#dce6f1] px-3.5 py-1.5 text-center">
            <div className="text-xs font-bold text-[#5b6d82]">
              Up now:{' '}
              <span className="text-[#162436] font-extrabold">
                {status.activePlayerName || 'Next Player'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Motion Permission Onboarding CTA */}
      {sensorState === 'prompt' && !useSwipeMode && !isFinished && (
        <button
          type="button"
          onClick={() => void handleEnableSensors()}
          className="btn-tactile btn-coral mb-2 w-full py-2.5 rounded-2xl font-display font-extrabold text-xs uppercase tracking-wider cursor-pointer shrink-0"
        >
          Tap to Turn On Motion Controls
        </button>
      )}

      {/* Tucked Developer Trace Drawer (only visible when explicitly toggled from footer) */}
      {debugMode && (
        <div className="mb-2 rounded-2xl bg-[#fffbeb] border border-[#f5c451] p-2.5 text-[11px] font-mono space-y-1 text-[#78350f] shrink-0">
          <div className="flex items-center justify-between font-bold">
            <span>
              TRACE · {pose.phase.toUpperCase()} ({telemetry?.gyroSource ?? 'idle'})
            </span>
            {lastTrace && (
              <button
                type="button"
                onClick={() => void handleCopyTrace()}
                className="px-2 py-0.5 rounded bg-[#fde68a] text-[#78350f] flex items-center gap-1 cursor-pointer"
              >
                {copiedTrace ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedTrace ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
          {telemetry && (
            <div className="grid grid-cols-3 gap-1 text-[10px]">
              <div>Ang: {telemetry.swingAngleDeg}°</div>
              <div>Rate: {telemetry.swingRateDeg}°/s</div>
              <div>Pull: {telemetry.lateralPullDeg}°</div>
              <div>Twist: {telemetry.twistAngleDeg}°</div>
              <div>Acc: {telemetry.accelMag}m/s²</div>
              <div>Axis: {telemetry.axisLocked ? 'LOCKED' : 'wait'}</div>
            </div>
          )}
          {traceUploadMsg && (
            <div className="text-[10px] text-[#0c8c7e] truncate">{traceUploadMsg}</div>
          )}
        </div>
      )}

      {/* Friendly First-Time Tip (only when actively playing and not handing off) */}
      {showSwingTip && !debugMode && isPlaying && !pendingHandoffPlayer && (
        <div className="mb-2 rounded-2xl bg-white border border-[#dce6f1] px-3 py-1.5 flex items-center justify-between gap-2 text-[11px] font-medium text-[#5b6d82] shrink-0">
          <span>Hold your arm by your side, press the pad below, and swing smoothly!</span>
          <button
            type="button"
            onClick={() => setShowSwingTip(false)}
            className="text-[#0c8c7e] font-extrabold shrink-0 cursor-pointer"
          >
            Got it
          </button>
        </div>
      )}

      {/* Lobby Pass-and-Play Roster Card (replaces Aim Controls while in Lobby) */}
      {inLobby && playersOnPhone.length > 0 && (
        <div className="rounded-2xl bg-white border border-[#dce6f1] p-2.5 space-y-2 shadow-2xs shrink-0 max-h-[38%] overflow-y-auto select-text">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#162436]">
              <Users className="w-3.5 h-3.5 text-[#12b8a6]" />
              <span>Players on This Phone ({playersOnPhone.length})</span>
            </div>
            {canAddMorePlayers && (
              <button
                type="button"
                onClick={handleAddPhonePlayer}
                className="btn-tactile btn-mint px-2.5 py-1 rounded-xl text-[11px] font-extrabold flex items-center gap-1 cursor-pointer"
              >
                <UserPlus className="w-3 h-3" />
                Add Player
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            {playersOnPhone.map((p) => {
              const pSpec = BALL_COLORS[p.color];
              const inputValue =
                editingPlayerId === p.playerId
                  ? (nameDrafts[p.playerId] ?? p.name)
                  : p.name;
              return (
                <div
                  key={p.playerId}
                  className="rounded-xl bg-[#f7fafd] border border-[#e2ebf4] px-2.5 py-1.5 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      className="w-6 h-6 rounded-full border-2 border-white shadow-2xs shrink-0"
                      style={{
                        background: `radial-gradient(circle at 30% 30%, ${pSpec.swirl}, ${pSpec.primary})`,
                      }}
                    />
                    <input
                      type="text"
                      maxLength={14}
                      value={inputValue}
                      onFocus={() => {
                        setEditingPlayerId(p.playerId);
                        setNameDrafts((prev) => ({ ...prev, [p.playerId]: p.name }));
                      }}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNameDrafts((prev) => ({ ...prev, [p.playerId]: val }));
                        if (val.trim()) {
                          sessionRef.current?.updatePlayerProfile(p.playerId, { name: val });
                        }
                      }}
                      onBlur={() => {
                        const draft = (nameDrafts[p.playerId] ?? '').trim();
                        if (draft && draft !== p.name) {
                          sessionRef.current?.updatePlayerProfile(p.playerId, { name: draft });
                        }
                        setEditingPlayerId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          (e.currentTarget as HTMLInputElement).blur();
                        }
                      }}
                      aria-label="Player name"
                      className="font-display font-bold text-xs text-[#162436] bg-white border border-[#dce6f1] focus:border-[#12b8a6] rounded-lg px-2 py-1 min-w-0 flex-1 focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {BALL_COLOR_ORDER.map((cid) => (
                      <button
                        key={cid}
                        type="button"
                        onClick={() => handleCycleColor(p.playerId, cid)}
                        className={`w-4 h-4 rounded-full border-2 transition cursor-pointer ${
                          p.color === cid
                            ? 'border-[#162436] scale-110'
                            : 'border-white opacity-60'
                        }`}
                        style={{ backgroundColor: BALL_COLORS[cid].primary }}
                        aria-label={`Select ${BALL_COLORS[cid].label}`}
                      />
                    ))}
                    {playersOnPhone.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemovePhonePlayer(p.playerId)}
                        className="ml-0.5 p-1 rounded-lg text-[#7c8fa4] hover:text-[#dc2626] hover:bg-[#fee2e2] transition cursor-pointer"
                        aria-label={`Remove ${p.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Center Area: Finished Standings, Pass-the-Phone Handoff, or Aim + Swing Controls */}
      {isFinished && isSharedPhone ? (
        <div className="flex-1 my-2 rounded-[28px] bg-white border-2 border-[#dce6f1] p-5 flex flex-col justify-center gap-4 shadow-xs overflow-y-auto">
          <div className="text-center space-y-1">
            <div className="w-12 h-12 rounded-2xl bg-[#fff7dc] border-2 border-[#f6d365] text-[#d97706] flex items-center justify-center mx-auto">
              <Trophy className="w-6 h-6" />
            </div>
            <div className="font-display text-lg font-black text-[#162436]">
              This Phone&apos;s Final Scores
            </div>
          </div>

          <div className="space-y-2">
            {rankedPhonePlayers.map((p, idx) => (
              <div
                key={p.playerId}
                className={`rounded-2xl px-3.5 py-2.5 flex items-center justify-between border-2 ${
                  idx === 0
                    ? 'bg-[#fffbeb] border-[#f5c451]'
                    : 'bg-[#f7fafd] border-[#e2ebf4]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`w-6 h-6 rounded-lg font-display font-black text-xs flex items-center justify-center shrink-0 ${
                      idx === 0
                        ? 'bg-[#f59e0b] text-white'
                        : 'bg-[#e4edf6] text-[#5b6d82]'
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <span
                    className="w-3.5 h-3.5 rounded-full shrink-0"
                    style={{ backgroundColor: BALL_COLORS[p.color].primary }}
                  />
                  <span className="font-display font-bold text-sm text-[#162436] truncate">
                    {p.name}
                  </span>
                </div>
                <span className="font-display text-xl font-black text-[#162436] tabular-nums">
                  {p.totalScore}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : pendingHandoffPlayer ? (
        <div className="flex-1 my-2 rounded-[28px] bg-white border-2 border-[#12b8a6] p-6 flex flex-col items-center justify-center text-center gap-4 shadow-[0_14px_34px_-16px_rgba(18,184,166,0.45)] animate-modal-in">
          <div className="px-3 py-1 rounded-full bg-[#e6faf7] border border-[#b7efe6] text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#0c8c7e]">
            Pass the Phone
          </div>

          <div
            className="w-20 h-20 rounded-full border-4 border-white shadow-lg flex items-center justify-center font-display text-2xl font-black text-white"
            style={{
              background: `radial-gradient(circle at 30% 30%, ${BALL_COLORS[pendingHandoffPlayer.color].swirl}, ${BALL_COLORS[pendingHandoffPlayer.color].primary})`,
            }}
          >
            {pendingHandoffPlayer.name.slice(0, 2).toUpperCase()}
          </div>

          <div className="space-y-1">
            <h2 className="font-display text-2xl font-black text-[#162436]">
              {pendingHandoffPlayer.name}&apos;s Turn!
            </h2>
            <p className="text-xs font-bold text-[#5b6d82] tabular-nums">
              Frame {pendingHandoffPlayer.frameNumber} · Roll {pendingHandoffPlayer.rollNumber} ·
              Score {pendingHandoffPlayer.totalScore}
            </p>
          </div>

          <button
            type="button"
            onClick={handleConfirmHandoff}
            className="btn-tactile btn-coral w-full max-w-xs py-4 rounded-2xl font-display font-extrabold text-base cursor-pointer"
          >
            I&apos;m {pendingHandoffPlayer.name} — Ready to Bowl!
          </button>
        </div>
      ) : (
        <>
          {/* Aim Controls (Move vs Angle) — shown during gameplay */}
          {!inLobby && (
            <div className="rounded-2xl bg-white border border-[#dce6f1] p-2.5 space-y-2 shadow-2xs shrink-0">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex rounded-xl bg-[#edf3f9] p-1 border border-[#dce6f1]">
                  <button
                    type="button"
                    onClick={() => setAimMode('position')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition cursor-pointer ${
                      aimMode === 'position'
                        ? 'bg-white text-[#162436] shadow-2xs'
                        : 'text-[#5b6d82]'
                    }`}
                  >
                    <MoveHorizontal className="w-3.5 h-3.5 text-[#12b8a6]" /> Move
                  </button>
                  <button
                    type="button"
                    onClick={() => setAimMode('angle')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition cursor-pointer ${
                      aimMode === 'angle'
                        ? 'bg-white text-[#162436] shadow-2xs'
                        : 'text-[#5b6d82]'
                    }`}
                  >
                    <Compass className="w-3.5 h-3.5 text-[#ee5656]" /> Aim Angle
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleRecenter}
                  className="btn-tactile btn-surface px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-[#5b6d82]" /> Center
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onPointerDown={() => startAimNudge(-1)}
                  onPointerUp={stopAimNudge}
                  onPointerLeave={stopAimNudge}
                  onPointerCancel={stopAimNudge}
                  className="btn-tactile btn-surface py-2.5 rounded-xl font-display font-extrabold text-sm active:bg-[#e6faf7] active:border-[#12b8a6] cursor-pointer"
                >
                  ◀ {aimMode === 'position' ? 'Move Left' : 'Aim Left'}
                </button>
                <button
                  type="button"
                  onPointerDown={() => startAimNudge(1)}
                  onPointerUp={stopAimNudge}
                  onPointerLeave={stopAimNudge}
                  onPointerCancel={stopAimNudge}
                  className="btn-tactile btn-surface py-2.5 rounded-xl font-display font-extrabold text-sm active:bg-[#e6faf7] active:border-[#12b8a6] cursor-pointer"
                >
                  {aimMode === 'position' ? 'Move Right' : 'Aim Right'} ▶
                </button>
              </div>
            </div>
          )}

          {/* Main Hold & Swing Pad */}
          <div className="flex-1 my-2.5 flex flex-col min-h-0">
            {!useSwipeMode ? (
              <div
                onPointerDown={handleGripPointerDown}
                onPointerUp={handleGripPointerUp}
                onPointerCancel={handleGripPointerUp}
                className={`flex-1 rounded-[28px] border-2 flex flex-col items-center justify-center gap-2.5 transition-all touch-none ${
                  pose.holdingGrip
                    ? 'bg-[#e6faf7] border-[#12b8a6] shadow-[inset_0_0_0_3px_rgba(18,184,166,0.18)] scale-[0.99]'
                    : 'bg-white border-[#cddae8] shadow-[0_6px_0_#d5e0ec]'
                } ${!isMyTurn && !inLobby && !debugMode ? 'opacity-65' : ''}`}
              >
                <div
                  className={`w-16 h-16 rounded-full border-3 flex items-center justify-center transition ${
                    pose.holdingGrip
                      ? 'bg-[#12b8a6] border-[#0c8c7e] text-white shadow-md'
                      : 'bg-[#fff1f1] border-[#ee5656] text-[#ee5656]'
                  }`}
                >
                  <span className="font-display text-sm font-black uppercase tracking-wider">
                    {pose.holdingGrip ? 'GO!' : 'HOLD'}
                  </span>
                </div>

                <div className="text-center px-5">
                  <div className="font-display text-xl font-black tracking-tight text-[#162436]">
                    {pose.holdingGrip
                      ? pose.phase === 'backswing'
                        ? 'SWING FORWARD!'
                        : pose.phase === 'forwardswing'
                          ? 'FOLLOW THROUGH!'
                          : 'READY · SWING BACK'
                      : inLobby
                        ? 'PRACTICE SWING'
                        : 'HOLD & SWING'}
                  </div>
                  <p className="text-[11px] font-medium text-[#5b6d82] mt-0.5">
                    Keep your thumb down through the whole swing
                  </p>
                </div>

                {/* Live Swing Arc & Wrist Curve Gauges */}
                <div className="space-y-1.5 flex flex-col items-center pt-0.5">
                  <div className="w-48 h-2.5 rounded-full bg-[#e8f0f8] border border-[#d5e0ec] overflow-hidden relative">
                    <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-[#94a3b8]" />
                    <div
                      className="absolute top-0 bottom-0 w-4 rounded-full bg-[#ee5656] transition-transform duration-75"
                      style={{
                        left: 'calc(50% - 8px)',
                        transform: `translateX(${clamp((pose.pitch / 1.4) * 86, -86, 86)}px)`,
                      }}
                    />
                  </div>
                  <div className="text-[10px] font-extrabold uppercase tracking-widest text-[#7c8fa4]">
                    Back ◀ · Swing · ▶ Forward
                  </div>

                  <div className="w-48 h-2.5 rounded-full bg-[#e8f0f8] border border-[#d5e0ec] overflow-hidden relative mt-1">
                    <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-[#94a3b8]" />
                    <div
                      className="absolute top-0 bottom-0 w-4 rounded-full bg-[#12b8a6] transition-transform duration-75"
                      style={{
                        left: 'calc(50% - 8px)',
                        transform: `translateX(${clamp((pose.roll / 1.1) * 86, -86, 86)}px)`,
                      }}
                    />
                  </div>
                  <div className="text-[10px] font-extrabold uppercase tracking-widest text-[#7c8fa4]">
                    Left ◀ · Curve · ▶ Right
                  </div>
                </div>
              </div>
            ) : (
              <div
                onPointerDown={handleSwipeDown}
                onPointerMove={handleSwipeMove}
                onPointerUp={handleSwipeUp}
                onPointerCancel={handleSwipeUp}
                className={`flex-1 rounded-[28px] border-2 border-dashed border-[#12b8a6] bg-white flex flex-col items-center justify-center gap-2 touch-none relative overflow-hidden ${
                  !isMyTurn && !inLobby ? 'opacity-65' : ''
                }`}
              >
                <div className="w-14 h-14 rounded-2xl bg-[#e6faf7] text-[#0c8c7e] flex items-center justify-center">
                  <Hand className="w-7 h-7 animate-bounce" />
                </div>
                <div className="font-display text-xl font-black text-[#162436]">
                  SWIPE UP TO BOWL
                </div>
                <p className="text-xs text-[#5b6d82] text-center px-8">
                  Swipe faster for speed · Curve left or right as you swipe for spin
                </p>
                {swipeVector && (
                  <div className="mt-2 px-3.5 py-1 rounded-full bg-[#e6faf7] border border-[#b5ece4] text-xs font-extrabold text-[#0c8c7e] tabular-nums">
                    Power {Math.min(100, Math.max(0, Math.round((-swipeVector.dy / 260) * 100)))}% ·
                    Curve {Math.round(clamp(swipeVector.dx / 140, -1, 1) * 100)}%
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Footer Switch, Last Roll Speed & Quiet Dev Trace Toggle */}
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
          {useSwipeMode ? 'Use Motion Swing' : 'Switch to Touch Swipe'}
        </button>

        <div className="flex items-center gap-2">
          {lastThrowInfo ? (
            <div className="text-[11px] font-extrabold text-[#0c8c7e] bg-white border border-[#dce6f1] px-2.5 py-1.5 rounded-xl tabular-nums">
              {(lastThrowInfo.speed * 2.237).toFixed(0)} mph · Curve{' '}
              {Math.round(lastThrowInfo.spin * 100)}%
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

          {/* Quiet developer motion trace toggle */}
          <button
            type="button"
            onClick={() => {
              const next = !debugMode;
              setDebugMode(next);
              sensorRef.current?.triggerHaptic('tick');
              if (next && sensorState === 'prompt') {
                void handleEnableSensors();
              }
            }}
            className={`p-2 rounded-xl border transition cursor-pointer ${
              debugMode
                ? 'bg-[#fef3c7] border-[#f59e0b] text-[#b45309]'
                : 'bg-white border-[#e2ebf4] text-[#94a3b8] hover:text-[#5b6d82]'
            }`}
            title="Developer motion trace"
            aria-label="Developer motion trace"
          >
            <Bug className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
