import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Smartphone } from 'lucide-react';
import {
  BALL_COLORS,
  type AimState,
  type ArmPoseState,
  type BallColorId,
  type CalloutType,
  type MatchState,
  type ThrowParams,
} from './types/game';
import type { PeerConnectionStatus } from './types/network';
import { DisplayLobbyController } from './network/LobbyController';
import { BowlingEngine } from './game/BowlingEngine';
import { recordRoll } from './rules/scoring';
import { SoundEngine } from './audio/SoundEngine';
import { MainMenuView, type AppEntryChoice } from './ui/MainMenuView';
import { LobbyOverlay } from './ui/LobbyOverlay';
import { ScoreboardHUD } from './ui/ScoreboardHUD';
import { DesktopFallbackControls } from './ui/DesktopFallbackControls';
import { HowToPlayModal } from './ui/HowToPlayGuide';
import { PhoneControllerUI } from './controller/PhoneControllerUI';
import { TennisPhoneControllerUI } from './controller/TennisPhoneControllerUI';
import { TennisDisplayScreen } from './ui/TennisDisplayScreen';
import type { SportId } from './data/sports';

type ActiveRoute =
  | { view: 'landing' }
  | { view: 'display'; sport: SportId; mode: 'host' | 'join'; roomCode?: string }
  | { view: 'controller'; sport?: SportId; roomCode?: string; displayId?: string };

function parseSportParam(raw: string | null): SportId | undefined {
  if (raw === 'tennis' || raw === 'bowling' || raw === 'golf' || raw === 'badminton') {
    return raw;
  }
  return undefined;
}

function getInitialRouteFromUrl(): ActiveRoute {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const room = params.get('room') ?? undefined;
  const display = params.get('display') ?? undefined;
  const sport = parseSportParam(params.get('sport'));

  if (mode === 'controller') {
    return { view: 'controller', sport, roomCode: room, displayId: display };
  }
  if (mode === 'join' && room) {
    return { view: 'display', sport: sport ?? 'bowling', mode: 'join', roomCode: room };
  }
  return { view: 'landing' };
}

async function resolveRoomSport(roomCode?: string, fallback: SportId = 'bowling'): Promise<SportId> {
  const code = roomCode?.trim().toUpperCase();
  if (!code || code.length < 4) return fallback;
  try {
    const res = await fetch(`/api/room-info?code=${encodeURIComponent(code)}`);
    if (!res.ok) return fallback;
    const data = (await res.json()) as { found?: boolean; sport?: SportId };
    if (data.found && data.sport) return data.sport;
  } catch {
    // fallback cleanly
  }
  return fallback;
}

interface DisplayScreenProps {
  mode: 'host' | 'join';
  joinRoomCode?: string;
  onExit: () => void;
}

const DisplayScreen: React.FC<DisplayScreenProps> = ({
  mode,
  joinRoomCode,
  onExit,
}) => {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<BowlingEngine | null>(null);
  const lobbyRef = useRef<DisplayLobbyController | null>(null);
  const soundRef = useRef<SoundEngine>(new SoundEngine());

  const [matchState, setMatchState] = useState<MatchState>({
    roomCode: '',
    hostDisplayId: '',
    phase: 'lobby',
    players: [],
    scorecards: {},
    activePlayerByDisplay: {},
  });
  const [peerStatuses, setPeerStatuses] = useState<Record<string, PeerConnectionStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [callout, setCallout] = useState<{
    id: number;
    playerName: string;
    type: CalloutType;
    pinsKnocked: number;
  } | null>(null);

  const matchStateRef = useRef(matchState);
  useEffect(() => {
    matchStateRef.current = matchState;
  }, [matchState]);

  const triggerCallout = useCallback(
    (playerId: string, type: CalloutType | null, pinsKnocked: number) => {
      if (!type) return;
      const pName =
        matchStateRef.current.players.find((p) => p.id === playerId)?.name ?? 'Bowler';
      soundRef.current.playCalloutJingle(type);
      setCallout({ id: Date.now() + Math.random(), playerName: pName, type, pinsKnocked });
    },
    []
  );

  useEffect(() => {
    let disposed = false;

    const lobby = new DisplayLobbyController({
      onMatchStateChange: (nextState) => {
        setMatchState(nextState);
        const engine = engineRef.current;
        if (!engine) return;
        engine.setPhase(nextState.phase);
        if (nextState.phase === 'playing' && !engine.isRollInProgress()) {
          const activeId = nextState.activePlayerByDisplay[lobby.displayId];
          const activePlayer =
            nextState.players.find((p) => p.id === activeId) ?? null;
          const standing = activePlayer
            ? nextState.scorecards[activePlayer.id]?.standingPinIds ?? [
                0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
              ]
            : [];
          engine.prepareTurn(activePlayer, standing, false);
        }
      },
      onPeerStatusesChange: (statuses) => setPeerStatuses(statuses),
      onRemoteAim: (_playerId, aim) => {
        engineRef.current?.updateAim(aim);
      },
      onRemoteArmPose: (_playerId, pose, aim) => {
        engineRef.current?.updateArmPose(pose, aim);
      },
      onThrowRelease: (playerId, throwParams) => {
        const st = matchStateRef.current;
        const player = st.players.find((p) => p.id === playerId);
        if (!player) return;
        if (player.displayId === lobby.displayId) {
          const standing = st.scorecards[player.id]?.standingPinIds ?? [
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
          ];
          engineRef.current?.launchLocalThrow(player, standing, throwParams);
        }
      },
      onRemoteLaneSnapshot: (snapshot) => {
        engineRef.current?.applyRemoteLaneSnapshot(snapshot);
      },
      onCallout: (playerId, type, pinsKnocked) => {
        triggerCallout(playerId, type, pinsKnocked);
      },
      onError: (msg) => setError(msg),
    });
    lobbyRef.current = lobby;

    const boot = async () => {
      if (canvasHostRef.current) {
        const engine = await BowlingEngine.create(
          canvasHostRef.current,
          soundRef.current,
          {
            onLocalRollSettled: (playerId, pinsKnocked, standingPinIds, isGutter) => {
              lobby.reportLocalRollSettled(
                playerId,
                pinsKnocked,
                standingPinIds,
                isGutter
              );
            },
            onLocalLaneSnapshot: (snapshot) => {
              lobby.broadcastLocalLaneSnapshot(snapshot);
            },
            getRollOutcomePreview: (playerId, pinsKnocked, standingPinIds, isGutter) => {
              const card = matchStateRef.current.scorecards[playerId];
              if (!card) return null;
              const { result } = recordRoll(card, pinsKnocked, standingPinIds, isGutter);
              return {
                needsFullReset: result.needsFullReset,
                nextStandingPinIds: result.standingPinIds,
              };
            },
          }
        );
        if (disposed) {
          engine.dispose();
          return;
        }
        engineRef.current = engine;
      }

      try {
        if (mode === 'host') {
          await lobby.hostRoom('Main Screen');
        } else if (joinRoomCode) {
          await lobby.joinRoom(joinRoomCode, 'Guest Screen');
        }
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : 'Unable to connect to room');
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
  const isHost = Boolean(
    localDisplayId && matchState.hostDisplayId === localDisplayId
  );
  const activeLocalId = localDisplayId
    ? matchState.activePlayerByDisplay[localDisplayId]
    : null;
  const activeLocalPlayer =
    matchState.players.find((p) => p.id === activeLocalId) ?? null;
  const activePhonePlayerCount =
    activeLocalPlayer && !activeLocalPlayer.isDesktopFallback && activeLocalPlayer.controllerPeerId
      ? matchState.players.filter(
          (p) =>
            !p.isDesktopFallback &&
            p.controllerPeerId === activeLocalPlayer.controllerPeerId
        ).length
      : 0;
  const activeCard = activeLocalPlayer
    ? matchState.scorecards[activeLocalPlayer.id]
    : null;
  const activeRollNumber = activeCard
    ? (activeCard.frames[activeCard.currentFrameIndex]?.rolls.length ?? 0) + 1
    : 1;

  const handleDesktopAim = useCallback((aim: AimState) => {
    engineRef.current?.updateAim(aim);
  }, []);

  const handleDesktopArmPose = useCallback((pose: ArmPoseState, aim: AimState) => {
    engineRef.current?.updateArmPose(pose, aim);
  }, []);

  const handleDesktopThrow = useCallback(
    (params: ThrowParams) => {
      if (!activeLocalPlayer || !lobbyRef.current) return;
      lobbyRef.current.submitLocalThrow(activeLocalPlayer.id, params);
    },
    [activeLocalPlayer]
  );

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    soundRef.current.setMuted(next);
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#dff0fb]">
      {/* 3D Sunlit Bowling Alley Canvas */}
      <div ref={canvasHostRef} className="w-full h-full" />

      {/* Friendly Error Toast */}
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

      {/* Guided Bowling Lobby */}
      {matchState.phase === 'lobby' && (
        <LobbyOverlay
          matchState={matchState}
          localDisplayId={localDisplayId}
          isHost={isHost}
          peerStatuses={peerStatuses}
          onAddDesktopPlayer={() => {
            soundRef.current.playUiPop(620);
            lobbyRef.current?.addDesktopPlayer();
          }}
          onAddPhonePlayer={(controllerPeerId) => {
            soundRef.current.playUiPop(660);
            lobbyRef.current?.addPhonePlayer(controllerPeerId);
          }}
          onRemovePlayer={(id) => lobbyRef.current?.removePlayer(id)}
          onRenamePlayer={(id, name) => {
            lobbyRef.current?.updatePlayerProfile(id, { name });
          }}
          onChangePlayerColor={(id, color: BallColorId) => {
            soundRef.current.playUiPop(720);
            lobbyRef.current?.updatePlayerProfile(id, { color });
          }}
          onStartMatch={() => {
            soundRef.current.unlock();
            soundRef.current.playUiPop(840);
            lobbyRef.current?.startMatch();
          }}
          onLeave={onExit}
        />
      )}

      {/* Active Game Broadcast HUD & Final Podium */}
      {matchState.phase !== 'lobby' && (
        <ScoreboardHUD
          matchState={matchState}
          activeLocalPlayer={activeLocalPlayer}
          callout={callout}
          isHost={isHost}
          muted={muted}
          onToggleMute={toggleMute}
          onOpenHelp={() => setHelpOpen(true)}
          onRematch={() => lobbyRef.current?.rematch()}
          onBackToLobby={onExit}
        />
      )}

      {/* Turn Prompt for Connected Phone Player */}
      {matchState.phase === 'playing' &&
        activeLocalPlayer &&
        !activeLocalPlayer.isDesktopFallback && (
          <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 z-10 px-4 py-2.5 rounded-full bg-white/94 backdrop-blur-md border-2 border-[#d5e0ec] text-xs font-extrabold text-[#162436] shadow-lg flex items-center gap-2.5">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: BALL_COLORS[activeLocalPlayer.color].primary }}
            />
            <Smartphone className="w-3.5 h-3.5 text-[#12b8a6] shrink-0" />
            <span>
              {activePhonePlayerCount > 1 && activeRollNumber === 1
                ? `Pass the phone to ${activeLocalPlayer.name} — Hold the pad and swing!`
                : `${activeLocalPlayer.name}'s Turn — Hold the pad on your phone and swing!`}
            </span>
          </div>
        )}

      {/* Keyboard & Mouse Control Dock */}
      {matchState.phase === 'playing' &&
        activeLocalPlayer &&
        activeLocalPlayer.isDesktopFallback && (
          <DesktopFallbackControls
            enabled={true}
            playerName={activeLocalPlayer.name}
            onAimChange={handleDesktopAim}
            onArmPose={handleDesktopArmPose}
            onThrow={handleDesktopThrow}
          />
        )}

      {/* In-Game How to Play Modal */}
      <HowToPlayModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        defaultMode={activeLocalPlayer?.isDesktopFallback ? 'keyboard' : 'phone'}
      />
    </div>
  );
};

export const App: React.FC = () => {
  const [route, setRoute] = useState<ActiveRoute>(getInitialRouteFromUrl);
  const [resolvedSport, setResolvedSport] = useState<SportId | null>(null);

  useEffect(() => {
    if (route.view === 'landing') {
      setResolvedSport(null);
      return;
    }

    if (route.view === 'display' && route.mode === 'host') {
      setResolvedSport(route.sport);
      return;
    }

    if (route.view === 'controller' && route.sport) {
      setResolvedSport(route.sport);
      return;
    }

    let active = true;
    setResolvedSport(null);
    void resolveRoomSport(route.roomCode, route.view === 'display' ? route.sport : 'bowling').then(
      (sport) => {
        if (active) setResolvedSport(sport);
      }
    );
    return () => {
      active = false;
    };
  }, [route]);

  const handleSelectEntry = (choice: AppEntryChoice) => {
    if (choice.mode === 'host') {
      setRoute({ view: 'display', sport: choice.sport, mode: 'host' });
    } else if (choice.mode === 'join-display') {
      setRoute({ view: 'display', sport: 'bowling', mode: 'join', roomCode: choice.roomCode });
    } else {
      setRoute({ view: 'controller', roomCode: choice.roomCode });
    }
  };

  const exitToPlaza = () => {
    window.history.replaceState({}, '', '/');
    setRoute({ view: 'landing' });
  };

  if (route.view === 'landing') {
    return <MainMenuView onSelect={handleSelectEntry} />;
  }

  if (resolvedSport === null) {
    return (
      <div className="h-full w-full spocco-plaza-bg flex items-center justify-center text-sm font-bold text-[#5b6d82]">
        Connecting to room...
      </div>
    );
  }

  if (route.view === 'controller') {
    if (resolvedSport === 'tennis') {
      return (
        <TennisPhoneControllerUI
          initialRoomCode={route.roomCode}
          initialDisplayId={route.displayId}
          onExit={exitToPlaza}
        />
      );
    }
    return (
      <PhoneControllerUI
        initialRoomCode={route.roomCode}
        initialDisplayId={route.displayId}
        onExit={exitToPlaza}
      />
    );
  }

  if (resolvedSport === 'tennis') {
    return (
      <TennisDisplayScreen
        mode={route.mode}
        joinRoomCode={route.roomCode}
        onExit={exitToPlaza}
      />
    );
  }

  return (
    <DisplayScreen
      mode={route.mode}
      joinRoomCode={route.roomCode}
      onExit={exitToPlaza}
    />
  );
};

export default App;
