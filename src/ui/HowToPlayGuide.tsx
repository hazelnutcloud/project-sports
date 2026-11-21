import React, { useState } from 'react';
import { Keyboard, Smartphone, X } from 'lucide-react';
import type { SportId } from '../data/sports';
import { SwingStepIllustration } from './SportArtwork';

interface HowToPlayContentProps {
  sport?: SportId;
  defaultMode?: 'phone' | 'keyboard';
  compact?: boolean;
}

const BOWLING_PHONE_STEPS = [
  {
    step: 1 as const,
    title: 'Line Up Your Shot',
    body: 'Tap Left or Right on your phone to slide across the lane or adjust your aim angle.',
  },
  {
    step: 2 as const,
    title: 'Hold & Swing Through',
    body: 'Rest your arm at your side, press and hold the swing pad, swing back, then sweep smoothly forward.',
  },
  {
    step: 3 as const,
    title: 'Twist for Hook Spin',
    body: 'Gently turn your wrist inward as you swing forward to curve the ball right into the pocket.',
  },
];

const BOWLING_KEYBOARD_STEPS = [
  {
    step: 1 as const,
    title: 'Position & Angle',
    body: 'Use A / D (or Arrow keys) to slide along the approach, and Q / E to dial in your aim angle.',
  },
  {
    step: 2 as const,
    title: 'Set Your Curve',
    body: 'Tap Z / C or drag the Curve slider to add left or right spin before you roll.',
  },
  {
    step: 3 as const,
    title: 'Charge & Release',
    body: 'Hold Space (or the Bowl button) to build power, then release at the sweet spot!',
  },
];

const TENNIS_PHONE_STEPS = [
  {
    step: 1 as const,
    title: 'Toss & Power Serve',
    body: 'Flick your phone upward (or tap Toss), then swing overhead right at the peak for a blazing Rocket Serve!',
  },
  {
    step: 2 as const,
    title: 'Free-Swing Rallies',
    body: 'Characters auto-run to the ball — no button needed! Swing early to pull cross-court or late to go down the line.',
  },
  {
    step: 3 as const,
    title: 'Topspin, Slice & Lob',
    body: 'Brush upward for dipping Topspin, chop downward for a skidding Slice, or scoop up high for a Lob over the net!',
  },
];

const TENNIS_KEYBOARD_STEPS = [
  {
    step: 1 as const,
    title: 'Toss & Serve',
    body: 'Press Space to toss the ball, then tap Space right in the green apex zone for a Rocket Serve (P2 uses Enter).',
  },
  {
    step: 2 as const,
    title: 'Aim & Timing',
    body: 'Your player auto-tracks the ball. Hold A / D (or ← / →) to aim left or right and time your strike with the court ring.',
  },
  {
    step: 3 as const,
    title: 'Master Every Shot',
    body: 'Press Space (or J) for Topspin, S (or K) for Slice, and W (or L) for a high Lob. High net balls become Smashes!',
  },
];

export const HowToPlayContent: React.FC<HowToPlayContentProps> = ({
  sport = 'bowling',
  defaultMode = 'phone',
  compact = false,
}) => {
  const [mode, setMode] = useState<'phone' | 'keyboard'>(defaultMode);
  const steps =
    sport === 'tennis'
      ? mode === 'phone'
        ? TENNIS_PHONE_STEPS
        : TENNIS_KEYBOARD_STEPS
      : mode === 'phone'
        ? BOWLING_PHONE_STEPS
        : BOWLING_KEYBOARD_STEPS;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center">
        <div className="inline-flex rounded-2xl bg-[#eaf1f8] p-1 border border-[#d5e0ec]">
          <button
            type="button"
            onClick={() => setMode('phone')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
              mode === 'phone'
                ? 'bg-white text-[#162436] shadow-sm'
                : 'text-[#5b6d82] hover:text-[#162436]'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5 text-[#12b8a6]" />
            Phone Motion
          </button>
          <button
            type="button"
            onClick={() => setMode('keyboard')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
              mode === 'keyboard'
                ? 'bg-white text-[#162436] shadow-sm'
                : 'text-[#5b6d82] hover:text-[#162436]'
            }`}
          >
            <Keyboard className="w-3.5 h-3.5 text-[#ee5656]" />
            Keyboard &amp; Mouse
          </button>
        </div>
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-3 ${compact ? 'gap-2.5' : 'gap-3.5'}`}>
        {steps.map((item) => (
          <div
            key={`${mode}-${item.step}`}
            className="rounded-2xl bg-[#f7fafd] border border-[#dce6f1] p-3.5 text-center flex flex-col items-center gap-2"
          >
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#162436] text-white font-display font-bold text-xs">
              {item.step}
            </span>
            <SwingStepIllustration step={item.step} mode={mode} />
            <div className="font-display font-bold text-sm text-[#162436]">
              {item.title}
            </div>
            <p className="text-xs text-[#5b6d82] leading-relaxed">{item.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

interface HowToPlayModalProps {
  sport?: SportId;
  open: boolean;
  onClose: () => void;
  defaultMode?: 'phone' | 'keyboard';
}

export const HowToPlayModal: React.FC<HowToPlayModalProps> = ({
  sport = 'bowling',
  open,
  onClose,
  defaultMode = 'phone',
}) => {
  if (!open) return null;
  const isTennis = sport === 'tennis';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#162436]/35 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-3xl bg-white border border-[#d5e0ec] shadow-2xl p-6 space-y-5 animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <div
              className={`text-[11px] font-extrabold uppercase tracking-[0.2em] ${
                isTennis ? 'text-[#3d9230]' : 'text-[#12b8a6]'
              }`}
            >
              {isTennis ? 'Tennis Guide' : 'Bowling Guide'}
            </div>
            <h2 className="font-display text-2xl font-black text-[#162436]">
              How to Play {isTennis ? 'Tennis' : 'Bowling'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[#eff4f9] hover:bg-[#e2ecf6] text-[#162436] flex items-center justify-center transition cursor-pointer"
            aria-label="Close guide"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <HowToPlayContent sport={sport} defaultMode={defaultMode} />

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className={`btn-tactile px-6 py-2.5 rounded-2xl font-display font-bold text-sm cursor-pointer ${
              isTennis ? 'btn-tennis' : 'btn-coral'
            }`}
          >
            Got It!
          </button>
        </div>
      </div>
    </div>
  );
};
