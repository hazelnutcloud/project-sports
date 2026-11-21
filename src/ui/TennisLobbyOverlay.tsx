import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  ArrowLeftRight,
  Bot,
  Check,
  Copy,
  HelpCircle,
  Keyboard,
  Play,
  QrCode,
  Trash2,
  UserPlus,
  Wifi,
} from 'lucide-react';
import { BALL_COLORS, BALL_COLOR_ORDER, type BallColorId } from '../types/game';
import type { PeerConnectionStatus } from '../types/network';
import type {
  TennisCourtMode,
  TennisDifficulty,
  TennisFormat,
  TennisMatchConfig,
  TennisMatchState,
  TennisTeamId,
} from '../types/tennis';
import { HowToPlayContent } from './HowToPlayGuide';

interface TennisLobbyOverlayProps {
  matchState: TennisMatchState;
  localDisplayId: string;
  isHost: boolean;
  peerStatuses: Record<string, PeerConnectionStatus>;
  onUpdateConfig: (patch: Partial<TennisMatchConfig>) => void;
  onAddDesktopPlayer: () => void;
  onRemovePlayer: (playerId: string) => void;
  onRenamePlayer: (playerId: string, name: string) => void;
  onChangePlayerColor: (playerId: string, color: BallColorId) => void;
  onAssignTeam: (playerId: string, team: TennisTeamId) => void;
  onStartMatch: () => void;
  onLeave: () => void;
}

interface NetworkInfo {
  lanIps: string[];
  primaryIp: string;
  port: number;
  protocol: string;
}

export const TennisLobbyOverlay: React.FC<TennisLobbyOverlayProps> = ({
  matchState,
  localDisplayId,
  isHost,
  peerStatuses,
  onUpdateConfig,
  onAddDesktopPlayer,
  onRemovePlayer,
  onRenamePlayer,
  onChangePlayerColor,
  onAssignTeam,
  onStartMatch,
  onLeave,
}) => {
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [selectedHost, setSelectedHost] = useState<string>(window.location.host);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [showNetworkSwitch, setShowNetworkSwitch] = useState(false);
  const [activeTab, setActiveTab] = useState<'setup' | 'howto'>('setup');
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/network-info')
      .then((r) => r.json())
      .then((info: NetworkInfo) => {
        if (!active) return;
        setNetworkInfo(info);
        if (
          (window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1') &&
          info.primaryIp &&
          info.primaryIp !== 'localhost'
        ) {
          setSelectedHost(`${info.primaryIp}:${info.port}`);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const controllerUrl = matchState.roomCode
    ? `${window.location.protocol}//${selectedHost}/?mode=controller&sport=tennis&room=${encodeURIComponent(
        matchState.roomCode
      )}&display=${encodeURIComponent(localDisplayId)}`
    : '';

  useEffect(() => {
    if (!controllerUrl) return;
    let active = true;
    QRCode.toDataURL(controllerUrl, {
      width: 220,
      margin: 2,
      color: { dark: '#162436', light: '#ffffff' },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [controllerUrl]);

  const localDesktopCount = matchState.players.filter(
    (p) => p.displayId === localDisplayId && p.isDesktopFallback
  ).length;
  const nearCount = matchState.players.filter((p) => p.team === 'near').length;
  const farCount = matchState.players.filter((p) => p.team === 'far').length;
  const singlesAllowed = matchState.players.length <= 2 && nearCount <= 1 && farCount <= 1;

  const handleCopy = async (text: string, which: 'code' | 'link') => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'code') {
        setCopiedCode(true);
        window.setTimeout(() => setCopiedCode(false), 1800);
      } else {
        setCopiedLink(true);
        window.setTimeout(() => setCopiedLink(false), 1800);
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-3 sm:p-6 bg-[#162436]/22 backdrop-blur-[2px] overflow-y-auto">
      <div className="w-full max-w-4xl rounded-[28px] bg-white/95 backdrop-blur-md border-2 border-white shadow-[0_24px_60px_-18px_rgba(22,36,54,0.34)] overflow-hidden text-[#162436] my-auto animate-modal-in">
        {/* Header */}
        <div className="px-5 sm:px-7 py-4 bg-[#f2fbf1] border-b border-[#d5eed0] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onLeave}
              className="btn-tactile btn-surface px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Plaza
            </button>
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#3d9230]">
                Tennis · {isHost ? 'Court Host' : 'Joined Screen'}
              </div>
              <h2 className="font-display text-xl sm:text-2xl font-black tracking-tight text-[#162436]">
                Spocco Tennis Court
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="inline-flex rounded-xl bg-[#e3f4e0] p-1 border border-[#cdecc7]">
              <button
                type="button"
                onClick={() => setActiveTab('setup')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeTab === 'setup'
                    ? 'bg-white text-[#162436] shadow-2xs'
                    : 'text-[#4d6b52] hover:text-[#162436]'
                }`}
              >
                Match Setup
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('howto')}
                className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition cursor-pointer ${
                  activeTab === 'howto'
                    ? 'bg-white text-[#162436] shadow-2xs'
                    : 'text-[#4d6b52] hover:text-[#162436]'
                }`}
              >
                <HelpCircle className="w-3.5 h-3.5 text-[#3d9230]" />
                How to Play
              </button>
            </div>

            <button
              type="button"
              onClick={() => void handleCopy(matchState.roomCode, 'code')}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-2xl bg-white border-2 border-[#cdecc7] hover:border-[#58b947] transition cursor-pointer"
              title="Copy room code"
            >
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#5b6d82]">
                Room
              </span>
              <span className="font-display text-lg font-black tracking-[0.2em] tabular-nums">
                {matchState.roomCode || '....'}
              </span>
              {copiedCode ? (
                <Check className="w-3.5 h-3.5 text-[#58b947]" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-[#7c8fa4]" />
              )}
            </button>
          </div>
        </div>

        {/* Body */}
        {activeTab === 'howto' ? (
          <div className="p-6 space-y-5">
            <HowToPlayContent sport="tennis" defaultMode="phone" />
            <div className="flex items-center justify-between pt-3 border-t border-[#e7eff7]">
              <button
                type="button"
                onClick={() => setActiveTab('setup')}
                className="btn-tactile btn-surface px-4 py-2.5 rounded-2xl text-xs font-bold cursor-pointer"
              >
                Back to Setup
              </button>
              {isHost && (
                <button
                  type="button"
                  onClick={onStartMatch}
                  className="btn-tactile btn-tennis px-6 py-3 rounded-2xl font-display font-extrabold text-sm flex items-center gap-2 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  {matchState.players.length === 0 ? 'Play Solo vs CPU' : 'Start Match'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6">
            {/* Left Column: QR Pairing */}
            <div className="md:col-span-4 rounded-3xl bg-[#f5fbf4] border border-[#d5eed0] p-4 flex flex-col items-center text-center gap-3">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-[#3d9230]">
                  <QrCode className="w-3.5 h-3.5" />
                  Pair Motion Rackets
                </div>
                <p className="text-[11px] text-[#5b6d82] leading-snug">
                  Scan with 1–4 phones to swing like a real tennis racket!
                </p>
              </div>

              <div className="bg-white p-2.5 rounded-2xl border-2 border-[#d5eed0] shadow-xs">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="Scan to pair phone racket"
                    className="w-36 h-36 rounded-lg"
                  />
                ) : (
                  <div className="w-36 h-36 flex items-center justify-center text-[#7c8fa4] text-xs font-semibold">
                    Preparing...
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => void handleCopy(controllerUrl, 'link')}
                className="btn-tactile btn-surface w-full py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#58b947]" />
                    Link Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-[#5b6d82]" />
                    Copy Racket Link
                  </>
                )}
              </button>

              {networkInfo && networkInfo.lanIps.length > 1 && (
                <div className="w-full">
                  <button
                    type="button"
                    onClick={() => setShowNetworkSwitch((v) => !v)}
                    className="text-[11px] font-bold text-[#5b6d82] hover:text-[#162436] underline cursor-pointer"
                  >
                    {showNetworkSwitch ? 'Hide network switch' : 'Phone not opening link?'}
                  </button>
                  {showNetworkSwitch && (
                    <select
                      value={selectedHost}
                      onChange={(e) => setSelectedHost(e.target.value)}
                      className="mt-1.5 w-full rounded-xl bg-white border border-[#cddae8] px-2.5 py-1.5 text-xs"
                    >
                      {networkInfo.lanIps.map((ip) => (
                        <option key={ip} value={`${ip}:${networkInfo.port}`}>
                          Wi-Fi: {ip}
                        </option>
                      ))}
                      <option value={window.location.host}>Current browser host</option>
                    </select>
                  )}
                </div>
              )}
            </div>

            {/* Right Column: Match Config + Players & CPU Lineup */}
            <div className="md:col-span-8 flex flex-col justify-between gap-4">
              {/* Match Settings Pills */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 rounded-2xl bg-[#f7fafd] border border-[#dce6f1] p-3">
                <div className="space-y-1">
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#5b6d82]">
                    Court Mode
                  </div>
                  <div className="grid grid-cols-2 gap-1 bg-[#e8f0f8] p-0.5 rounded-xl">
                    {(['singles', 'doubles'] as TennisCourtMode[]).map((mode) => {
                      const disabled = !isHost || (mode === 'singles' && !singlesAllowed);
                      return (
                        <button
                          key={mode}
                          type="button"
                          disabled={disabled}
                          onClick={() => onUpdateConfig({ courtMode: mode })}
                          className={`py-1.5 rounded-lg text-[11px] font-extrabold transition cursor-pointer disabled:opacity-45 ${
                            matchState.config.courtMode === mode
                              ? 'bg-white text-[#162436] shadow-2xs'
                              : 'text-[#5b6d82]'
                          }`}
                        >
                          {mode === 'singles' ? '1v1 Singles' : '2v2 Doubles'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#5b6d82]">
                    Match Length
                  </div>
                  <div className="grid grid-cols-2 gap-1 bg-[#e8f0f8] p-0.5 rounded-xl">
                    {(
                      [
                        ['best-of-3', 'Best of 3'],
                        ['1-game', '1 Game'],
                      ] as Array<[TennisFormat, string]>
                    ).map(([fmt, label]) => (
                      <button
                        key={fmt}
                        type="button"
                        disabled={!isHost}
                        onClick={() => onUpdateConfig({ format: fmt })}
                        className={`py-1.5 rounded-lg text-[11px] font-extrabold transition cursor-pointer disabled:opacity-45 ${
                          matchState.config.format === fmt
                            ? 'bg-white text-[#162436] shadow-2xs'
                            : 'text-[#5b6d82]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#5b6d82]">
                    CPU Difficulty
                  </div>
                  <div className="grid grid-cols-3 gap-1 bg-[#e8f0f8] p-0.5 rounded-xl">
                    {(['rookie', 'pro', 'champion'] as TennisDifficulty[]).map((diff) => (
                      <button
                        key={diff}
                        type="button"
                        disabled={!isHost}
                        onClick={() => onUpdateConfig({ difficulty: diff })}
                        className={`py-1.5 rounded-lg text-[11px] font-extrabold capitalize transition cursor-pointer disabled:opacity-45 ${
                          matchState.config.difficulty === diff
                            ? 'bg-white text-[#162436] shadow-2xs'
                            : 'text-[#5b6d82]'
                        }`}
                      >
                        {diff === 'champion' ? 'Champ' : diff}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Players & Teams */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-base font-black text-[#162436]">
                    Court Lineup{' '}
                    <span className="text-[#5b6d82] font-bold tabular-nums">
                      ({matchState.players.length}/4 Humans)
                    </span>
                  </h3>
                  {matchState.players.length < 4 && localDesktopCount < 2 && (
                    <button
                      type="button"
                      onClick={onAddDesktopPlayer}
                      className="btn-tactile btn-surface px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <UserPlus className="w-3.5 h-3.5 text-[#58b947]" />
                      Add Keyboard Player {localDesktopCount === 1 ? '(P2)' : ''}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(['near', 'far'] as TennisTeamId[]).map((team) => {
                    const teamSlots = matchState.slots.filter((s) => s.team === team);
                    return (
                      <div
                        key={team}
                        className="rounded-2xl bg-[#f7fafd] border border-[#dce6f1] p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`text-[11px] font-extrabold uppercase tracking-wider ${
                              team === 'near' ? 'text-[#0c8c7e]' : 'text-[#ee5656]'
                            }`}
                          >
                            {team === 'near' ? 'Near Court' : 'Far Court'}
                          </span>
                          <span className="text-[10px] font-bold text-[#7c8fa4]">
                            {matchState.config.courtMode === 'doubles' ? '2 Players' : '1 Player'}
                          </span>
                        </div>

                        {teamSlots.map((slot) => {
                          const human = slot.playerId
                            ? matchState.players.find((p) => p.id === slot.playerId)
                            : null;
                          const spec = BALL_COLORS[slot.color];

                          if (!human) {
                            return (
                              <div
                                key={slot.slotId}
                                className="rounded-xl bg-white/70 border border-dashed border-[#cddae8] px-3 py-2 flex items-center justify-between gap-2"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className="w-7 h-7 rounded-full flex items-center justify-center text-white shrink-0"
                                    style={{ backgroundColor: spec.primary }}
                                  >
                                    <Bot className="w-3.5 h-3.5" />
                                  </span>
                                  <div className="min-w-0">
                                    <div className="text-xs font-bold text-[#5b6d82] truncate">
                                      {slot.name}
                                    </div>
                                    <div className="text-[10px] font-semibold text-[#8a9cb0] capitalize">
                                      {matchState.config.difficulty} AI · {slot.role}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          const isLocal = human.displayId === localDisplayId;
                          const otherTeam: TennisTeamId = team === 'near' ? 'far' : 'near';
                          const canSwap =
                            matchState.players.filter((p) => p.team === otherTeam).length < 2;
                          const nameVal =
                            editingId === human.id ? (nameDrafts[human.id] ?? human.name) : human.name;

                          return (
                            <div
                              key={human.id}
                              className="rounded-xl bg-white border border-[#dce6f1] px-2.5 py-2 space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span
                                    className="w-7 h-7 rounded-full border-2 border-white shadow-xs shrink-0"
                                    style={{ backgroundColor: spec.primary }}
                                  />
                                  {isLocal ? (
                                    <input
                                      type="text"
                                      maxLength={14}
                                      value={nameVal}
                                      onFocus={() => {
                                        setEditingId(human.id);
                                        setNameDrafts((prev) => ({
                                          ...prev,
                                          [human.id]: human.name,
                                        }));
                                      }}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setNameDrafts((prev) => ({ ...prev, [human.id]: val }));
                                        if (val.trim()) onRenamePlayer(human.id, val);
                                      }}
                                      onBlur={() => setEditingId(null)}
                                      className="font-display font-bold text-xs text-[#162436] bg-[#f7fafd] focus:bg-white border border-transparent focus:border-[#58b947] rounded-md px-1.5 py-0.5 min-w-0 w-24 focus:outline-none"
                                    />
                                  ) : (
                                    <span className="font-display font-bold text-xs truncate">
                                      {human.name}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  {canSwap && (isHost || isLocal) && (
                                    <button
                                      type="button"
                                      onClick={() => onAssignTeam(human.id, otherTeam)}
                                      className="p-1 rounded-lg bg-[#f1f6fb] hover:bg-[#e3edf7] text-[#5b6d82] hover:text-[#162436] cursor-pointer"
                                      title={`Move to ${otherTeam === 'near' ? 'Near' : 'Far'} Court`}
                                    >
                                      <ArrowLeftRight className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  {human.isDesktopFallback && (isHost || isLocal) && (
                                    <button
                                      type="button"
                                      onClick={() => onRemovePlayer(human.id)}
                                      className="p-1 rounded-lg hover:bg-[#fee2e2] text-[#7c8fa4] hover:text-[#dc2626] cursor-pointer"
                                      title="Remove player"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center justify-between gap-2">
                                <div className="text-[10px] font-semibold text-[#5b6d82] flex items-center gap-1">
                                  {human.isDesktopFallback ? (
                                    <>
                                      <Keyboard className="w-3 h-3 text-[#ee5656]" />
                                      <span>
                                        Key {human.desktopSlot === 2 ? 'P2 (Arrows)' : 'P1 (WASD)'}
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <Wifi className="w-3 h-3 text-[#58b947]" />
                                      <span>
                                        {human.controllerPeerId &&
                                        peerStatuses[human.controllerPeerId] === 'connected'
                                          ? 'Racket Ready'
                                          : 'Phone Paired'}
                                      </span>
                                    </>
                                  )}
                                </div>

                                <div className="flex items-center gap-1">
                                  {BALL_COLOR_ORDER.map((cid) => (
                                    <button
                                      key={cid}
                                      type="button"
                                      onClick={() => onChangePlayerColor(human.id, cid)}
                                      className={`w-4 h-4 rounded-full border-2 cursor-pointer ${
                                        human.color === cid
                                          ? 'border-[#162436] scale-110'
                                          : 'border-white opacity-60'
                                      }`}
                                      style={{ backgroundColor: BALL_COLORS[cid].primary }}
                                      aria-label={`Select ${BALL_COLORS[cid].label}`}
                                    />
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Footer Start CTA */}
              <div className="pt-3 border-t border-[#e7eff7] flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-semibold text-[#5b6d82]">
                  {matchState.config.courtMode === 'doubles' ? '2v2 Doubles' : '1v1 Singles'} ·{' '}
                  {matchState.config.format === '1-game' ? '1-Game Quick' : 'Best of 3 Games'} ·{' '}
                  15–30–40 Scoring
                </div>
                {isHost ? (
                  <button
                    type="button"
                    onClick={onStartMatch}
                    className="btn-tactile btn-tennis px-6 py-3 rounded-2xl font-display font-extrabold text-sm flex items-center gap-2 cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    {matchState.players.length === 0 ? 'Play Solo vs CPU' : 'Start Tennis'}
                  </button>
                ) : (
                  <div className="px-4 py-2.5 rounded-2xl bg-[#f2fbf1] border border-[#cdecc7] text-xs font-bold text-[#3d9230]">
                    Waiting for host to start the match...
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
