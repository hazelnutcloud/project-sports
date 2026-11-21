import React from 'react';
import type { SportId } from '../data/sports';

export const SpoccoLogoMark: React.FC<{ compact?: boolean }> = ({ compact = false }) => (
  <div className="inline-flex items-center gap-2.5 select-none">
    <svg
      viewBox="0 0 44 44"
      className={compact ? 'w-8 h-8 shrink-0' : 'w-10 h-10 shrink-0'}
      aria-hidden="true"
    >
      {/* Sunlit architectural plaza badge */}
      <rect x="2" y="2" width="40" height="40" rx="13" fill="#162436" />
      <path d="M2 27C13 22 25 22 42 15V31C42 37.627 36.627 42 30 42H14C7.373 42 2 36.627 2 30V27Z" fill="#12b8a6" />
      <path d="M10 13.5L34 8.5L32.5 16L8.5 21L10 13.5Z" fill="#ee5656" />
      <circle cx="30" cy="30.5" r="5" fill="#ffffff" />
      <circle cx="30" cy="30.5" r="2.1" fill="#162436" />
    </svg>
    <div className="leading-none">
      <div
        className={`font-display font-black tracking-tight text-[#162436] ${
          compact ? 'text-lg' : 'text-xl sm:text-2xl'
        }`}
      >
        SPOCCO <span className="text-[#ee5656]">SPORTS</span>
      </div>
      {!compact && (
        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#5b6d82] mt-0.5">
          Living Room Plaza
        </div>
      )}
    </div>
  </div>
);

export const BowlingArt: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => (
  <svg viewBox="0 0 360 220" fill="none" className={className} aria-hidden="true">
    {/* Sunlit sky atrium backdrop */}
    <rect width="360" height="220" rx="22" fill="#e9f5fc" />
    {/* Architectural window panes */}
    <path d="M56 0V125M128 0V125M232 0V125M304 0V125" stroke="#ffffff" strokeWidth="6" strokeOpacity="0.8" />
    {/* Floating coral ribbon inspired by the 3D bowling alley */}
    <path d="M46 28L318 46L302 68L36 48L46 28Z" fill="#ee5656" opacity="0.92" />
    {/* Lush greenery behind lane deck */}
    <circle cx="88" cy="108" r="22" fill="#77cf69" />
    <circle cx="114" cy="102" r="26" fill="#58b947" />
    <circle cx="256" cy="104" r="24" fill="#77cf69" />
    <circle cx="282" cy="110" r="20" fill="#58b947" />
    {/* Perspective sunlit maple bowling lane */}
    <path d="M126 112H234L316 220H44L126 112Z" fill="#f6dfb8" />
    <path d="M126 112H234L316 220H44L126 112Z" stroke="#e5c48e" strokeWidth="2" />
    {/* Gutters */}
    <path d="M114 112H126L44 220H24L114 112Z" fill="#cfdbe8" />
    <path d="M234 112H246L336 220H316L234 112Z" fill="#cfdbe8" />
    {/* Mint lane arrows */}
    <path d="M150 164L154 156L158 164H150Z" fill="#12b8a6" />
    <path d="M176 158L180 150L184 158H176Z" fill="#12b8a6" />
    <path d="M202 164L206 156L210 164H202Z" fill="#12b8a6" />
    {/* Curved motion trail */}
    <path
      d="M118 214C144 190 164 166 176 130"
      stroke="#12b8a6"
      strokeWidth="6"
      strokeLinecap="round"
      strokeDasharray="1 13"
      opacity="0.7"
    />
    {/* Crisp bowling pins */}
    {[
      { x: 162, y: 112, s: 0.92 },
      { x: 198, y: 112, s: 0.92 },
      { x: 171, y: 118, s: 0.98 },
      { x: 189, y: 118, s: 0.98 },
      { x: 180, y: 124, s: 1.04 },
    ].map((pin, idx) => (
      <g key={idx} transform={`translate(${pin.x}, ${pin.y}) scale(${pin.s})`}>
        <ellipse cx="0" cy="14" rx="5.5" ry="2.2" fill="#d4b37f" />
        <path
          d="M-3.5 -10C-3.5 -13.5 3.5 -13.5 3.5 -10C3.5 -7.5 2 -5.8 2.4 -3.2C4.5 1 5.2 6.8 3.8 12.2C2.6 13.4 -2.6 13.4 -3.8 12.2C-5.2 6.8 -4.5 1 -2.4 -3.2C-2 -5.8 -3.5 -7.5 -3.5 -10Z"
          fill="#ffffff"
          stroke="#162436"
          strokeWidth="1.6"
        />
        <rect x="-2.4" y="-4.6" width="4.8" height="2.2" rx="1" fill="#ee5656" />
      </g>
    ))}
    {/* Foreground glossy swirled bowling ball */}
    <g transform="translate(118, 174)">
      <ellipse cx="3" cy="28" rx="28" ry="8" fill="#c9a56e" opacity="0.55" />
      <circle cx="0" cy="0" r="27" fill="#7c3aed" stroke="#162436" strokeWidth="2.5" />
      <path d="M-19 -13C-8 -21 10 -20 19 -10" stroke="#c084fc" strokeWidth="5" strokeLinecap="round" opacity="0.8" />
      <path d="M-21 6C-9 14 7 15 19 8" stroke="#a855f7" strokeWidth="4.5" strokeLinecap="round" opacity="0.65" />
      <circle cx="-8" cy="-9" r="3.4" fill="#ffffff" opacity="0.5" />
      {/* Finger holes */}
      <circle cx="5" cy="-6" r="2.7" fill="#2e1065" />
      <circle cx="12" cy="-2" r="2.7" fill="#2e1065" />
      <circle cx="7" cy="4" r="3" fill="#2e1065" />
    </g>
  </svg>
);

export const TennisArt: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => (
  <svg viewBox="0 0 240 130" fill="none" className={className} aria-hidden="true">
    <rect width="240" height="130" rx="18" fill="#eef9ec" />
    {/* Court lines */}
    <path d="M0 92H240" stroke="#ffffff" strokeWidth="5" />
    <path d="M36 92L68 130M204 92L172 130" stroke="#ffffff" strokeWidth="4" />
    <rect x="0" y="92" width="240" height="38" fill="#58b947" opacity="0.18" />
    {/* Tennis racket */}
    <g transform="translate(108, 62) rotate(-32)">
      <ellipse cx="0" cy="-14" rx="26" ry="33" fill="#ffffff" stroke="#162436" strokeWidth="3.5" />
      <ellipse cx="0" cy="-14" rx="20" ry="27" stroke="#58b947" strokeWidth="2.2" />
      <path d="M-12 -36V8M0 -41V13M12 -36V8M-19 -24H19M-20 -12H20M-18 0H18" stroke="#c8d8c5" strokeWidth="1.5" />
      <path d="M-5 19L0 32L5 19" stroke="#162436" strokeWidth="3.2" strokeLinejoin="round" />
      <rect x="-4" y="30" width="8" height="28" rx="3.5" fill="#162436" />
      <rect x="-4" y="46" width="8" height="7" fill="#58b947" />
    </g>
    {/* Optic yellow tennis ball with motion arc */}
    <path d="M138 30C156 26 174 34 184 52" stroke="#58b947" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="5 6" />
    <g transform="translate(174, 48)">
      <circle cx="0" cy="0" r="14" fill="#d9f942" stroke="#162436" strokeWidth="2.5" />
      <path d="M-10 -8C-4 -2 -4 6 -10 10M10 -8C4 -2 4 6 10 10" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
    </g>
  </svg>
);

export const GolfArt: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => (
  <svg viewBox="0 0 240 130" fill="none" className={className} aria-hidden="true">
    <rect width="240" height="130" rx="18" fill="#ebf9f3" />
    {/* Rolling fairway hills */}
    <path d="M0 90C55 68 115 74 172 90C202 98 224 94 240 88V130H0V90Z" fill="#77d4a6" opacity="0.4" />
    <path d="M0 102C65 86 140 88 240 106V130H0V102Z" fill="#18a374" opacity="0.28" />
    {/* Putting cup & flag */}
    <ellipse cx="152" cy="96" rx="14" ry="4.5" fill="#162436" opacity="0.85" />
    <path d="M152 95V28" stroke="#162436" strokeWidth="3.2" strokeLinecap="round" />
    <path d="M154 28L196 40L154 53V28Z" fill="#ee5656" stroke="#162436" strokeWidth="2" strokeLinejoin="round" />
    {/* Golf ball & tee arc */}
    <path d="M62 88C84 44 118 40 144 82" stroke="#18a374" strokeWidth="3" strokeLinecap="round" strokeDasharray="4 6" />
    <g transform="translate(64, 88)">
      <path d="M0 12V22M-5 12H5" stroke="#162436" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="0" cy="0" r="12.5" fill="#ffffff" stroke="#162436" strokeWidth="2.5" />
      <circle cx="-4" cy="-3" r="1.4" fill="#cbd5e1" />
      <circle cx="2" cy="-5" r="1.4" fill="#cbd5e1" />
      <circle cx="4" cy="1" r="1.4" fill="#cbd5e1" />
      <circle cx="-2" cy="3" r="1.4" fill="#cbd5e1" />
    </g>
  </svg>
);

export const BadmintonArt: React.FC<{ className?: string }> = ({ className = 'w-full h-full' }) => (
  <svg viewBox="0 0 240 130" fill="none" className={className} aria-hidden="true">
    <rect width="240" height="130" rx="18" fill="#ecf6ff" />
    {/* Net silhouette across lower edge */}
    <path d="M0 98H240" stroke="#162436" strokeWidth="3" />
    <path d="M24 98V130M54 98V130M84 98V130M114 98V130M144 98V130M174 98V130M204 98V130M0 114H240" stroke="#9ec5e8" strokeWidth="1.8" />
    {/* Arc trail */}
    <path d="M46 78C84 26 146 22 184 56" stroke="#2b90e8" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="5 6" />
    {/* Feathered shuttlecock */}
    <g transform="translate(152, 56) rotate(32)">
      <path d="M-16 -24L-7 6H7L16 -24L8 -20L0 -26L-8 -20L-16 -24Z" fill="#ffffff" stroke="#162436" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M-8 -20L-3 6M0 -26V6M8 -20L3 6" stroke="#94a3b8" strokeWidth="1.6" />
      <rect x="-7.5" y="4" width="15" height="5" fill="#2b90e8" />
      <path d="M-7 9C-7 15.5 7 15.5 7 9H-7Z" fill="#ee5656" stroke="#162436" strokeWidth="2.4" />
    </g>
  </svg>
);

export const SportArtwork: React.FC<{ sportId: SportId; className?: string }> = ({
  sportId,
  className,
}) => {
  switch (sportId) {
    case 'bowling':
      return <BowlingArt className={className} />;
    case 'tennis':
      return <TennisArt className={className} />;
    case 'golf':
      return <GolfArt className={className} />;
    case 'badminton':
      return <BadmintonArt className={className} />;
  }
};

export const SwingStepIllustration: React.FC<{ step: 1 | 2 | 3; mode: 'phone' | 'keyboard' }> = ({
  step,
  mode,
}) => {
  if (mode === 'keyboard') {
    if (step === 1) {
      return (
        <svg viewBox="0 0 120 72" fill="none" className="w-24 h-14 mx-auto" aria-hidden="true">
          <rect x="14" y="18" width="28" height="28" rx="8" fill="#ffffff" stroke="#162436" strokeWidth="2.4" />
          <text x="28" y="37" textAnchor="middle" fill="#162436" fontWeight="800" fontSize="14">A</text>
          <rect x="78" y="18" width="28" height="28" rx="8" fill="#ffffff" stroke="#162436" strokeWidth="2.4" />
          <text x="92" y="37" textAnchor="middle" fill="#162436" fontWeight="800" fontSize="14">D</text>
          <path d="M48 32H72M48 32L54 27M48 32L54 37M72 32L66 27M72 32L66 37" stroke="#12b8a6" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    if (step === 2) {
      return (
        <svg viewBox="0 0 120 72" fill="none" className="w-24 h-14 mx-auto" aria-hidden="true">
          <path d="M22 54C36 22 68 18 96 28" stroke="#12b8a6" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="4 5" />
          <circle cx="96" cy="28" r="10" fill="#ee5656" stroke="#162436" strokeWidth="2.2" />
          <rect x="18" y="48" width="32" height="14" rx="5" fill="#ffffff" stroke="#162436" strokeWidth="2" />
          <text x="34" y="59" textAnchor="middle" fill="#162436" fontWeight="800" fontSize="9">Z / C</text>
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 120 72" fill="none" className="w-24 h-14 mx-auto" aria-hidden="true">
        <rect x="16" y="12" width="88" height="12" rx="6" fill="#e2ecf5" />
        <rect x="16" y="12" width="66" height="12" rx="6" fill="#ee5656" />
        <rect x="18" y="34" width="84" height="26" rx="8" fill="#ffffff" stroke="#162436" strokeWidth="2.4" />
        <text x="60" y="51" textAnchor="middle" fill="#162436" fontWeight="800" fontSize="12">SPACE</text>
      </svg>
    );
  }

  if (step === 1) {
    return (
      <svg viewBox="0 0 120 72" fill="none" className="w-24 h-14 mx-auto" aria-hidden="true">
        <rect x="44" y="10" width="32" height="52" rx="8" fill="#ffffff" stroke="#162436" strokeWidth="2.5" />
        <rect x="50" y="24" width="20" height="12" rx="4" fill="#12b8a6" opacity="0.25" />
        <path d="M22 36H36M22 36L28 31M22 36L28 41" stroke="#12b8a6" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M98 36H84M98 36L92 31M98 36L92 41" stroke="#12b8a6" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (step === 2) {
    return (
      <svg viewBox="0 0 120 72" fill="none" className="w-24 h-14 mx-auto" aria-hidden="true">
        <path d="M26 24C34 52 72 56 94 26" stroke="#ee5656" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="4 5" />
        <path d="M88 26L96 24L94 33" stroke="#ee5656" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <g transform="translate(58, 42) rotate(-25)">
          <rect x="-11" y="-18" width="22" height="36" rx="6" fill="#ffffff" stroke="#162436" strokeWidth="2.4" />
          <circle cx="0" cy="4" r="5" fill="#ee5656" />
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 120 72" fill="none" className="w-24 h-14 mx-auto" aria-hidden="true">
      <g transform="translate(60, 38)">
        <rect x="-13" y="-22" width="26" height="44" rx="7" fill="#ffffff" stroke="#162436" strokeWidth="2.5" />
        <circle cx="0" cy="4" r="5" fill="#12b8a6" />
      </g>
      <path d="M34 24C26 32 26 46 36 52" stroke="#12b8a6" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M30 22L36 23L34 29" stroke="#12b8a6" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M86 24C94 32 94 46 84 52" stroke="#12b8a6" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M90 22L84 23L86 29" stroke="#12b8a6" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};
