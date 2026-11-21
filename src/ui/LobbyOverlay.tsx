import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  Check,
  Copy,
  HelpCircle,
  Keyboard,
  Play,
  QrCode,
  Smartphone,
  Trash2,
  UserPlus,
  Wifi,
} from 'lucide-react';
import {
  BALL_COLORS,
  BALL_COLOR_ORDER,
  type BallColorId,
  type MatchState,
} from '../types/game';
import type { PeerConnectionStatus } from '../types/network';
import { HowToPlayContent } from './HowToPlayGuide';

interface LobbyOverlayProps {
  matchState: MatchState;
  localDisplayId: string;
  isHost: boolean;
  peerStatuses: Record<string, PeerConnectionStatus>;
  onAddDesktopPlayer: () => void;
  onAddPhonePlayer: (controllerPeerId: string) => void;
  onRemovePlayer: (playerId: string) => void;
  onRenamePlayer: (playerId: string, name: string) => void;
  onChangePlayerColor: (playerId: string, color: BallColorId) => void;
  onStartMatch: () => void;
  onLeave: () => void;
}

interface NetworkInfo {
  lanIps: string[];
  primaryIp: string;
  port: number;
  protocol: string;
}

function friendlyPhoneStatus(status?: PeerConnectionStatus): string {
  switch (status) {
    case 'connected':
      return 'Phone Ready';
    case 'connecting':
    case 'new':
      return 'Connecting...';
    case 'disconnected':
    case 'failed':
      return 'Reconnecting...';
    default:
      return 'Phone Ready';
  }
}

export const LobbyOverlay: React.FC<LobbyOverlayProps> = ({
  matchState,
  localDisplayId,
  isHost,
  peerStatuses,
  onAddDesktopPlayer,
  onAddPhonePlayer,
  onRemovePlayer,
  onRenamePlayer,
  onChangePlayerColor,
  onStartMatch,
  onLeave,
}) => {
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [selectedHost, setSelectedHost] = useState<string>(window.location.host);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [showNetworkSwitch, setShowNetworkSwitch] = useState(false);
  const [activeTab, setActiveTab] = useState<'setup' | 'howto'>('setup');
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);

  const phonePlayerCounts = new Map<string, number>();
  const phoneNumbers = new Map<string, number>();
  const localPhonePeerIds: string[] = [];
  for (const p of matchState.players) {
    if (!p.isDesktopFallback && p.controllerPeerId) {
      phonePlayerCounts.set(
        p.controllerPeerId,
        (phonePlayerCounts.get(p.controllerPeerId) ?? 0) + 1
      );
      if (!phoneNumbers.has(p.controllerPeerId)) {
        phoneNumbers.set(p.controllerPeerId, phoneNumbers.size + 1);
      }
      if (p.displayId === localDisplayId && !localPhonePeerIds.includes(p.controllerPeerId)) {
        localPhonePeerIds.push(p.controllerPeerId);
      }
    }
  }

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
    ? `${window.location.protocol}//${selectedHost}/?mode=controller&room=${encodeURIComponent(
        matchState.roomCode
      )}&display=${encodeURIComponent(localDisplayId)}`
    : '';

  useEffect(() => {
    if (!controllerUrl) return;
    let active = true;
    QRCode.toDataURL(controllerUrl, {
      width: 240,
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

  const handleCopyLink = async () => {
    if (!controllerUrl) return;
    try {
      await navigator.clipboard.writeText(controllerUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // ignore
    }
  };

  const handleCopyCode = async () => {
    if (!matchState.roomCode) return;
    try {
      await navigator.clipboard.writeText(matchState.roomCode);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-3 sm:p-6 bg-[#162436]/20 backdrop-blur-[2px] overflow-y-auto">
      <div className="w-full max-w-4xl rounded-[28px] bg-white/95 backdrop-blur-md border-2 border-white shadow-[0_24px_60px_-18px_rgba(22,36,54,0.32)] overflow-hidden text-[#162436] my-auto animate-modal-in">
        {/* Top Lobby Header */}
        <div className="px-5 sm:px-7 py-4 bg-[#f5f9fd] border-b border-[#e2ebf4] flex flex-wrap items-center justify-between gap-3">
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
              <div className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#ee5656]">
                Bowling · {isHost ? 'Room Host' : 'Joined Screen'}
              </div>
              <h2 className="font-display text-xl sm:text-2xl font-black tracking-tight text-[#162436]">
                Get Ready to Bowl
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Segmented Setup / How-to-Play Switch */}
            <div className="inline-flex rounded-xl bg-[#e7eff7] p-1 border border-[#d6e2ee]">
              <button
                type="button"
                onClick={() => setActiveTab('setup')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeTab === 'setup'
                    ? 'bg-white text-[#162436] shadow-2xs'
                    : 'text-[#5b6d82] hover:text-[#162436]'
                }`}
              >
                Players
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('howto')}
                className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition cursor-pointer ${
                  activeTab === 'howto'
                    ? 'bg-white text-[#162436] shadow-2xs'
                    : 'text-[#5b6d82] hover:text-[#162436]'
                }`}
              >
                <HelpCircle className="w-3.5 h-3.5 text-[#12b8a6]" />
                How to Play
              </button>
            </div>

            {/* Room Code Pill */}
            <button
              type="button"
              onClick={() => void handleCopyCode()}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-2xl bg-white border-2 border-[#d5e0ec] hover:border-[#12b8a6] transition cursor-pointer"
              title="Copy room code"
            >
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#5b6d82]">
                Room
              </span>
              <span className="font-display text-lg font-black tracking-[0.2em] text-[#162436] tabular-nums">
                {matchState.roomCode || '....'}
              </span>
              {copiedCode ? (
                <Check className="w-3.5 h-3.5 text-[#12b8a6]" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-[#7c8fa4]" />
              )}
            </button>
          </div>
        </div>

        {/* Body */}
        {activeTab === 'howto' ? (
          <div className="p-6 space-y-5">
            <HowToPlayContent defaultMode="phone" />
            <div className="flex items-center justify-between pt-3 border-t border-[#e7eff7]">
              <button
                type="button"
                onClick={() => setActiveTab('setup')}
                className="btn-tactile btn-surface px-4 py-2.5 rounded-2xl text-xs font-bold cursor-pointer"
              >
                Back to Players
              </button>
              {isHost && (
                <button
                  type="button"
                  onClick={onStartMatch}
                  className="btn-tactile btn-coral px-6 py-3 rounded-2xl font-display font-extrabold text-sm flex items-center gap-2 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  {matchState.players.length === 0 ? 'Play Solo Now' : 'Start Bowling'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6">
            {/* Left Column: Connect Phones via QR */}
            <div className="md:col-span-5 rounded-3xl bg-[#f5f9fd] border border-[#dce6f1] p-5 flex flex-col items-center text-center gap-3.5">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-[#0c8c7e]">
                  <QrCode className="w-3.5 h-3.5" />
                  Play with Your Phone
                </div>
                <p className="text-xs text-[#5b6d82]">
                  Point your phone&apos;s camera here to turn it into a motion controller — or pass
                  one phone around for up to 4 players!
                </p>
              </div>

              <div className="bg-white p-3 rounded-2xl border-2 border-[#dce6f1] shadow-xs">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="Scan to connect your phone controller"
                    className="w-40 h-40 rounded-lg"
                  />
                ) : (
                  <div className="w-40 h-40 flex items-center justify-center text-[#7c8fa4] text-xs font-semibold">
                    Preparing code...
                  </div>
                )}
              </div>

              <div className="w-full flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyLink()}
                  className="btn-tactile btn-surface flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#12b8a6]" />
                      Invite Link Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-[#5b6d82]" />
                      Copy Phone Invite Link
                    </>
                  )}
                </button>
              </div>

              <p className="text-[11px] text-[#6d7f94] leading-snug">
                Keep your phone on the same Wi-Fi. If your browser asks to confirm this private
                page, tap Continue to allow motion swing.
              </p>

              {/* Tucked-away network switcher only when multiple addresses are present */}
              {networkInfo && networkInfo.lanIps.length > 1 && (
                <div className="w-full pt-1">
                  <button
                    type="button"
                    onClick={() => setShowNetworkSwitch((v) => !v)}
                    className="text-[11px] font-bold text-[#5b6d82] hover:text-[#162436] underline cursor-pointer"
                  >
                    {showNetworkSwitch ? 'Hide connection options' : 'Phone not opening link?'}
                  </button>
                  {showNetworkSwitch && (
                    <select
                      value={selectedHost}
                      onChange={(e) => setSelectedHost(e.target.value)}
                      className="mt-2 w-full rounded-xl bg-white border border-[#cddae8] px-2.5 py-1.5 text-xs text-[#162436]"
                    >
                      {networkInfo.lanIps.map((ip) => (
                        <option key={ip} value={`${ip}:${networkInfo.port}`}>
                          Wi-Fi address: {ip}
                        </option>
                      ))}
                      <option value={window.location.host}>This browser address</option>
                    </select>
                  )}
                </div>
              )}
            </div>

            {/* Right Column: Players Roster & Start CTA */}
            <div className="md:col-span-7 flex flex-col justify-between gap-4">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-base font-black text-[#162436]">
                    Players{' '}
                    <span className="text-[#5b6d82] font-bold tabular-nums">
                      ({matchState.players.length}/4)
                    </span>
                  </h3>
                  {matchState.players.length < 4 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {localPhonePeerIds.length === 1 && (
                        <button
                          type="button"
                          onClick={() => onAddPhonePlayer(localPhonePeerIds[0])}
                          className="btn-tactile btn-mint px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <Smartphone className="w-3.5 h-3.5" />
                          Add Player to Phone
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={onAddDesktopPlayer}
                        className="btn-tactile btn-surface px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <UserPlus className="w-3.5 h-3.5 text-[#12b8a6]" />
                        Add Keyboard Player
                      </button>
                    </div>
                  )}
                </div>

                {matchState.players.length === 0 ? (
                  <div className="rounded-3xl border-2 border-dashed border-[#cddae8] bg-[#f8fbfe] px-6 py-8 text-center space-y-2.5">
                    <div className="w-12 h-12 rounded-2xl bg-[#e6faf7] text-[#0c8c7e] flex items-center justify-center mx-auto">
                      <Smartphone className="w-6 h-6" />
                    </div>
                    <div className="font-display font-bold text-base text-[#162436]">
                      Ready when you are!
                    </div>
                    <p className="text-xs text-[#5b6d82] max-w-xs mx-auto leading-relaxed">
                      Scan the QR code with 1–4 phones (one phone can be shared by up to 4
                      players!), add keyboard players, or hit{' '}
                      <strong className="text-[#162436]">Play Solo Now</strong> to jump right in.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {matchState.players.map((p, idx) => {
                      const spec = BALL_COLORS[p.color];
                      const p2pState = p.controllerPeerId
                        ? peerStatuses[p.controllerPeerId]
                        : undefined;
                      const isLocal = p.displayId === localDisplayId;
                      const sharedCount =
                        !p.isDesktopFallback && p.controllerPeerId
                          ? phonePlayerCounts.get(p.controllerPeerId) ?? 1
                          : 1;
                      const phoneNum =
                        !p.isDesktopFallback && p.controllerPeerId
                          ? phoneNumbers.get(p.controllerPeerId) ?? 1
                          : null;
                      const isFirstOfPhone =
                        !p.isDesktopFallback &&
                        p.controllerPeerId !== null &&
                        matchState.players.findIndex(
                          (other) =>
                            !other.isDesktopFallback &&
                            other.controllerPeerId === p.controllerPeerId
                        ) === idx;
                      const canRemove =
                        (isHost || isLocal) &&
                        (p.isDesktopFallback || sharedCount > 1);
                      const displayNameValue =
                        editingPlayerId === p.id ? (nameDrafts[p.id] ?? p.name) : p.name;

                      return (
                        <div
                          key={p.id}
                          className="rounded-2xl bg-[#f7fafd] border border-[#dce6f1] px-3.5 py-2.5 flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {/* Glossy Bowling Ball Badge */}
                            <div
                              className="w-10 h-10 rounded-full border-2 border-white shadow-sm shrink-0 relative"
                              style={{
                                background: `radial-gradient(circle at 32% 28%, ${spec.swirl}, ${spec.primary})`,
                              }}
                            >
                              <span className="absolute top-2 left-2.5 w-2 h-2 rounded-full bg-white/45" />
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                {isLocal ? (
                                  <input
                                    type="text"
                                    maxLength={14}
                                    value={displayNameValue}
                                    onFocus={() => {
                                      setEditingPlayerId(p.id);
                                      setNameDrafts((prev) => ({ ...prev, [p.id]: p.name }));
                                    }}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setNameDrafts((prev) => ({ ...prev, [p.id]: val }));
                                      if (val.trim()) {
                                        onRenamePlayer(p.id, val);
                                      }
                                    }}
                                    onBlur={() => {
                                      const draft = (nameDrafts[p.id] ?? '').trim();
                                      if (draft && draft !== p.name) {
                                        onRenamePlayer(p.id, draft);
                                      }
                                      setEditingPlayerId(null);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        (e.currentTarget as HTMLInputElement).blur();
                                      }
                                    }}
                                    aria-label="Player name"
                                    className="font-display font-bold text-sm text-[#162436] bg-white/80 hover:bg-white focus:bg-white border border-transparent focus:border-[#12b8a6] rounded-lg px-1.5 py-0.5 -ml-1.5 w-32 focus:outline-none"
                                  />
                                ) : (
                                  <span className="font-display font-bold text-sm text-[#162436] truncate">
                                    {p.name}
                                  </span>
                                )}
                                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-[#e6faf7] text-[#0c8c7e] shrink-0">
                                  Lane {p.laneIndex + 1}
                                </span>
                                {sharedCount > 1 && (
                                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-[#eef6ff] text-[#1d6bb8] shrink-0">
                                    Shared Phone{phoneNumbers.size > 1 && phoneNum ? ` ${phoneNum}` : ''}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] font-semibold text-[#5b6d82] flex items-center gap-1.5 mt-0.5">
                                {p.isDesktopFallback ? (
                                  <>
                                    <Keyboard className="w-3 h-3 text-[#ee5656]" />
                                    <span>
                                      {isLocal ? 'Keyboard & Mouse' : 'Other Screen'}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <Wifi className="w-3 h-3 text-[#12b8a6]" />
                                    <span>
                                      {friendlyPhoneStatus(p2pState)}
                                      {phoneNumbers.size > 1 && phoneNum
                                        ? ` · Phone ${phoneNum}`
                                        : ''}
                                      {!isLocal ? ' · Other Screen' : ''}
                                    </span>
                                    {isLocal &&
                                      localPhonePeerIds.length > 1 &&
                                      isFirstOfPhone &&
                                      matchState.players.length < 4 &&
                                      p.controllerPeerId && (
                                        <button
                                          type="button"
                                          onClick={() => onAddPhonePlayer(p.controllerPeerId!)}
                                          className="ml-1 px-2 py-0.5 rounded-full bg-[#e6faf7] hover:bg-[#ccf5ee] text-[#0c8c7e] font-extrabold text-[10px] transition cursor-pointer"
                                        >
                                          + Share Phone
                                        </button>
                                      )}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Ball Color Picker & Remove */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            {BALL_COLOR_ORDER.map((cid) => (
                              <button
                                key={cid}
                                type="button"
                                onClick={() => onChangePlayerColor(p.id, cid)}
                                className={`w-5 h-5 rounded-full border-2 transition cursor-pointer ${
                                  p.color === cid
                                    ? 'border-[#162436] scale-115 shadow-xs'
                                    : 'border-white opacity-65 hover:opacity-100'
                                }`}
                                style={{ backgroundColor: BALL_COLORS[cid].primary }}
                                title={BALL_COLORS[cid].label}
                                aria-label={`Select ${BALL_COLORS[cid].label}`}
                              />
                            ))}
                            {canRemove && (
                              <button
                                type="button"
                                onClick={() => onRemovePlayer(p.id)}
                                className="ml-1 p-1.5 rounded-lg hover:bg-[#fee2e2] text-[#7c8fa4] hover:text-[#dc2626] transition cursor-pointer"
                                title="Remove player"
                                aria-label="Remove player"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer Start Row */}
              <div className="pt-3.5 border-t border-[#e7eff7] flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-semibold text-[#5b6d82]">
                  10 Frames · 1–4 Players
                </div>
                {isHost ? (
                  <button
                    type="button"
                    onClick={onStartMatch}
                    className="btn-tactile btn-coral px-6 py-3 rounded-2xl font-display font-extrabold text-sm flex items-center gap-2 cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    {matchState.players.length === 0 ? 'Play Solo Now' : 'Start Bowling'}
                  </button>
                ) : (
                  <div className="px-4 py-2.5 rounded-2xl bg-[#eff5fb] border border-[#dce6f1] text-xs font-bold text-[#0c8c7e]">
                    Waiting for host to start the game...
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
