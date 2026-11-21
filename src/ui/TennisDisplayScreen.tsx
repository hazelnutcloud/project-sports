import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Smartphone } from 'lucide-react';
import type { BallColorId } from '../types/game';
import type { PeerConnectionStatus } from '../types/network';
import type {
  TennisCalloutType,
  TennisMatchState,
  TennisRallyPhase,
} from '../types/tennis';
import { createTennisScoreState } from '../rules/tennisScoring';
import {
  buildTennisCourtSlots,
  TennisDisplayLobbyController,
} from '../network/TennisLobbyController';
import { TennisEngine } from '../game/tennis/TennisEngine';
import { SoundEngine } from '../audio/SoundEngine';
import { TennisLobbyOverlay } from './TennisLobbyOverlay';
import { TennisScoreboardHUD } from './TennisScoreboardHUD';
import { TennisDesktopControls } from './TennisDesktopControls';
import { HowToPlayModal } from './HowToPlayGuide';

interface TennisDisplayScreenProps {
  mode: 'host' | 'join';
  joinRoomCode?: string;
  onExit: () => void;
}

export const TennisDisplayScreen: React.FC<TennisDisplayScreenProps> = ({
  mode,
  joinRoomCode,
  onExit,
}) => {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<TennisEngine | null>(null);
  const lobbyRef = useRef<TennisDisplayLobbyController | null>(null);
  const soundRef = useRef<SoundEngine>(new SoundEngine());

  const [matchState, setMatchState] = useState<TennisMatchState>(() => ({
    roomCode: '',
    hostDisplayId: '',
    phase: 'lobby',
    config: { courtMode: 'singles', format: 'best-of-3', difficulty: 'pro' },
    players: [],
    slots: buildTennisCourtSlots([], 'singles'),
    score: createTennisScoreState('best-of-3', 'singles'),
  }));
  const [peerStatuses, setPeerStatuses] = useState<Record<string, PeerConnectionStatus>>({});
  const [rallyPhase, setRallyPhase] = useState<TennisRallyPhase>('waiting-serve');
  const [rallyCount, setRallyCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [callout, setCallout] = useState<{
    id: number;
    type: TennisCalloutType;
    subtitle?: string;
  } | null>(null);

  const triggerCallout = useCallback((type: TennisCalloutType, subtitle?: string) => {
    soundRef.current.playTennisCalloutJingle(type);
    setCallout({ id: Date.now() + Math.random(), type, subtitle });
  }, []);

  useEffect(() => {
    let disposed = false;

    const lobby = new TennisDisplayLobbyController({
      onMatchStateChange: (nextState) => {
        setMatchState(nextState);
        engineRef.current?.syncMatchState(nextState, lobby.isHost());
      },
      onPeerStatusesChange: (statuses) => setPeerStatuses(statuses),
      onServeToss: (playerId) => {
        engineRef.current?.handleServeToss(playerId);
      },
      onPlayerSwing: (swing) => {
        engineRef.current?.handlePlayerSwing(swing);
      },
      onRemoteRacketPose: (playerId, pose) => {
        engineRef.current?.updatePlayerRacketPose(playerId, pose);
      },
      onRemoteSnapshot: (snapshot) => {
        engineRef.current?.applyRemoteSnapshot(snapshot);
        setRallyPhase(snapshot.rallyPhase);
        setRallyCount(snapshot.rallyCount);
      },
      onCallout: (type, subtitle) => {
        triggerCallout(type, subtitle);
      },
      onError: (msg) => setError(msg),
    });
    lobbyRef.current = lobby;

    const boot = async () => {
      if (canvasHostRef.current) {
        const engine = await TennisEngine.create(canvasHostRef.current, soundRef.current, {
          onPointResolved: (winner, reason, rLen) => {
            lobby.reportPointResolved(winner, reason, rLen);
          },
          onServeFault: () => {
            lobby.reportServeFault();
          },
          onRallyCallout: (type, subtitle) => {
            lobby.emitCalloutAsHost(type, subtitle);
          },
          onRallyPhaseChange: (phase, count) => {
            setRallyPhase(phase);
            setRallyCount(count);
            lobby.setRallyPhase(phase);
          },
          onLocalSnapshot: (snapshot) => {
            lobby.broadcastLocalSnapshot(snapshot);
          },
          onPlayerHitHaptic: (playerId, isPower) => {
            lobby.sendHapticToPlayer(playerId, isPower ? 'smash-hit' : 'racket-hit');
          },
        });
        if (disposed) {
          engine.dispose();
          return;
        }
        engineRef.current = engine;
        engine.syncMatchState(lobby.getState(), lobby.isHost());
      }

      try {
        if (mode === 'host') {
          await lobby.hostRoom('Main Tennis Screen');
        } else if (joinRoomCode) {
          await lobby.joinRoom(joinRoomCode, 'Guest Tennis Screen');
        }
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : 'Unable to connect to Tennis room');
        }
      }
    };

    void boot();

    return () => {
      disposed = true;
      lobby.destroy();
      engineRef.current?.dispose();
      engineRef.current = null;
      lobbyRef.current = null;
    };
  }, [mode, joinRoomCode, triggerCallout]);

  const localDisplayId = lobbyRef.current?.displayId ?? '';
  const isHost = Boolean(localDisplayId && matchState.hostDisplayId === localDisplayId);
  const localDesktopPlayers = matchState.players.filter(
    (p) => p.displayId === localDisplayId && p.isDesktopFallback
  );
  const localPhonePlayers = matchState.players.filter(
    (p) => p.displayId === localDisplayId && !p.isDesktopFallback
  );

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    soundRef.current.setMuted(next);
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#bce4ff]">
      {/* 3D Sunlit Spocco Tennis Court Canvas */}
      <div ref={canvasHostRef} className="w-full h-full" />

      {/* Error Toast */}
      {error && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 px-4 py-2.5 rounded-2xl bg-white border-2 border-[#fda4af] text-[#be123c] text-xs font-bold shadow-xl flex items-center gap-3">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="underline font-extrabold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Tennis Lobby Overlay */}
      {matchState.phase === 'lobby' && (
        <TennisLobbyOverlay
          matchState={matchState}
          localDisplayId={localDisplayId}
          isHost={isHost}
          peerStatuses={peerStatuses}
          onUpdateConfig={(patch) => {
            soundRef.current.playUiPop(660);
            lobbyRef.current?.updateConfig(patch);
          }}
          onAddDesktopPlayer={() => {
            soundRef.current.playUiPop(620);
            lobbyRef.current?.addDesktopPlayer();
          }}
          onRemovePlayer={(id) => lobbyRef.current?.removePlayer(id)}
          onRenamePlayer={(id, name) => lobbyRef.current?.updatePlayerProfile(id, { name })}
          onChangePlayerColor={(id, color: BallColorId) => {
            soundRef.current.playUiPop(720);
            lobbyRef.current?.updatePlayerProfile(id, { color });
          }}
          onAssignTeam={(id, team) => {
            soundRef.current.playUiPop(690);
            lobbyRef.current?.assignPlayerTeam(id, team);
          }}
          onStartMatch={() => {
            soundRef.current.unlock();
            soundRef.current.playUiPop(840);
            lobbyRef.current?.startMatch();
          }}
          onLeave={onExit}
        />
      )}

      {/* Active Broadcast Tennis HUD & Final Podium */}
      {matchState.phase !== 'lobby' && (
        <TennisScoreboardHUD
          matchState={matchState}
          rallyCount={rallyCount}
          callout={callout}
          isHost={isHost}
          muted={muted}
          onToggleMute={toggleMute}
          onOpenHelp={() => setHelpOpen(true)}
          onRematch={() => lobbyRef.current?.rematch()}
          onBackToPlaza={onExit}
        />
      )}

      {/* Phone Player Prompt Banner */}
      {matchState.phase === 'playing' &&
        localDesktopPlayers.length === 0 &&
        localPhonePlayers.length > 0 && (
          <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 z-10 px-4 py-2.5 rounded-full bg-white/94 backdrop-blur-md border-2 border-[#cdecc7] text-xs font-extrabold text-[#162436] shadow-lg flex items-center gap-2">
            <Smartphone className="w-3.5 h-3.5 text-[#58b947] shrink-0" />
            <span>
              {rallyPhase === 'waiting-serve'
                ? 'Flick phone up or tap Toss to serve!'
                : rallyPhase === 'serve-toss'
                  ? 'Swing overhead at the peak for a Rocket Serve!'
                  : 'Swing your phone like a tennis racket!'}
            </span>
          </div>
        )}

      {/* Desktop Keyboard & Mouse Controls */}
      {matchState.phase === 'playing' && localDesktopPlayers.length > 0 && (
        <TennisDesktopControls
          desktopPlayers={localDesktopPlayers}
          servingTeam={matchState.score.servingTeam}
          rallyPhase={rallyPhase}
          getServeTossProgress={() => engineRef.current?.getServeTossProgress() ?? 0}
          onServeToss={(playerId) => lobbyRef.current?.submitLocalServeToss(playerId)}
          onSwing={(swing) => lobbyRef.current?.submitLocalSwing(swing)}
          onAimNudge={(playerId, nudgeX) =>
            engineRef.current?.setManualNudge(playerId, nudgeX)
          }
        />
      )}

      {/* Tennis How-to-Play Modal */}
      <HowToPlayModal
        sport="tennis"
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        defaultMode={localDesktopPlayers.length > 0 ? 'keyboard' : 'phone'}
      />
    </div>
  );
};
