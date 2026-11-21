import React, { useEffect, useState } from 'react';
import { ArrowRight, Monitor, Smartphone, X } from 'lucide-react';

export type JoinModalTab = 'controller' | 'join-display';

interface JoinRoomModalProps {
  open: boolean;
  initialTab: JoinModalTab;
  onClose: () => void;
  onConnectPhone: (roomCode: string) => void;
  onJoinScreen: (roomCode: string) => void;
}

export const JoinRoomModal: React.FC<JoinRoomModalProps> = ({
  open,
  initialTab,
  onClose,
  onConnectPhone,
  onJoinScreen,
}) => {
  const [tab, setTab] = useState<JoinModalTab>(initialTab);
  const [roomCode, setRoomCode] = useState('');

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setRoomCode('');
    }
  }, [open, initialTab]);

  if (!open) return null;

  const cleaned = roomCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4);
  const canSubmit = cleaned.length === 4;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (tab === 'controller') {
      onConnectPhone(cleaned);
    } else {
      onJoinScreen(cleaned);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#162436]/35 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white border border-[#d5e0ec] shadow-2xl p-6 space-y-5 animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#12b8a6]">
              Join a Game
            </div>
            <h2 className="font-display text-2xl font-black text-[#162436]">
              Enter Room Code
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[#eff4f9] hover:bg-[#e2ecf6] text-[#162436] flex items-center justify-center transition cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-[#edf3f9] p-1.5 border border-[#dce6f1]">
          <button
            type="button"
            onClick={() => setTab('controller')}
            className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              tab === 'controller'
                ? 'bg-white text-[#162436] shadow-sm'
                : 'text-[#5b6d82] hover:text-[#162436]'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5 text-[#12b8a6]" />
            Phone Controller
          </button>
          <button
            type="button"
            onClick={() => setTab('join-display')}
            className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              tab === 'join-display'
                ? 'bg-white text-[#162436] shadow-sm'
                : 'text-[#5b6d82] hover:text-[#162436]'
            }`}
          >
            <Monitor className="w-3.5 h-3.5 text-[#ee5656]" />
            Join Friend&apos;s Room
          </button>
        </div>

        {/* Contextual Helper */}
        <p className="text-xs text-[#5b6d82] leading-relaxed">
          {tab === 'controller'
            ? 'Turn this phone into a motion controller for the 4-letter room shown on the TV or computer.'
            : 'Open the lanes on this second screen to bowl side-by-side with a friend in the same room.'}
        </p>

        {/* Code Input Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            autoFocus
            maxLength={4}
            value={cleaned}
            onChange={(e) => setRoomCode(e.target.value)}
            placeholder="ABCD"
            className="w-full rounded-2xl bg-[#f5f9fd] border-2 border-[#d5e0ec] focus:border-[#12b8a6] px-4 py-3.5 text-center font-display text-3xl font-black tracking-[0.42em] uppercase text-[#162436] placeholder:text-[#b5c4d4] focus:outline-none transition tabular-nums"
          />

          <button
            type="submit"
            disabled={!canSubmit}
            className={`btn-tactile w-full py-3.5 rounded-2xl font-display font-bold text-base flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
              tab === 'controller' ? 'btn-mint' : 'btn-coral'
            }`}
          >
            {tab === 'controller' ? 'Connect This Phone' : 'Join Room'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
