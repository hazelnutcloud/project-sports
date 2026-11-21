import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  HelpCircle,
  KeyRound,
  Play,
  Smartphone,
  Sparkles,
  Users,
} from 'lucide-react';
import { SPORTS_CATALOG, type SportDefinition, type SportId } from '../data/sports';
import { SpoccoLogoMark, SportArtwork } from './SportArtwork';
import { JoinRoomModal, type JoinModalTab } from './JoinRoomModal';
import { HowToPlayModal } from './HowToPlayGuide';

export type AppEntryChoice =
  | { mode: 'host'; sport: SportId }
  | { mode: 'join-display'; roomCode: string }
  | { mode: 'controller'; roomCode: string };

interface MainMenuViewProps {
  onSelect: (choice: AppEntryChoice) => void;
}

function detectTouchPhone(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const narrow = window.innerWidth < 768;
  return coarse && narrow;
}

export const MainMenuView: React.FC<MainMenuViewProps> = ({ onSelect }) => {
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinTab, setJoinTab] = useState<JoinModalTab>('controller');
  const [howToSport, setHowToSport] = useState<SportId | null>(null);
  const [previewToast, setPreviewToast] = useState<{
    sport: string;
    message: string;
    accent: string;
  } | null>(null);
  const [isMobileDevice, setIsMobileDevice] = useState<boolean>(detectTouchPhone);

  useEffect(() => {
    const onResize = () => setIsMobileDevice(detectTouchPhone());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!previewToast) return;
    const id = window.setTimeout(() => setPreviewToast(null), 3400);
    return () => window.clearTimeout(id);
  }, [previewToast]);

  const openJoinModal = (tab: JoinModalTab) => {
    setJoinTab(tab);
    setJoinOpen(true);
  };

  const playableSports = SPORTS_CATALOG.filter((s) => s.status === 'playable');
  const upcomingSports = SPORTS_CATALOG.filter((s) => s.status !== 'playable');

  const handleUpcomingClick = (sport: SportDefinition) => {
    setPreviewToast({
      sport: sport.name,
      message: sport.comingSoonNote ?? `${sport.name} is coming soon!`,
      accent: sport.accentHex,
    });
  };

  return (
    <div className="h-full w-full spocco-plaza-bg overflow-y-auto">
      <div className="min-h-full max-w-6xl mx-auto px-4 sm:px-8 py-5 sm:py-7 flex flex-col justify-between gap-7">
        {/* Top Navigation Bar */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <SpoccoLogoMark />

          <div className="flex items-center gap-2 sm:gap-2.5">
            <button
              type="button"
              onClick={() => openJoinModal('controller')}
              className="btn-tactile btn-surface px-3.5 sm:px-4 py-2 rounded-2xl text-xs sm:text-sm font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Smartphone className="w-4 h-4 text-[#12b8a6]" />
              <span>Pair Phone</span>
            </button>
            <button
              type="button"
              onClick={() => openJoinModal('join-display')}
              className="btn-tactile btn-surface px-3.5 sm:px-4 py-2 rounded-2xl text-xs sm:text-sm font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <KeyRound className="w-4 h-4 text-[#ee5656]" />
              <span>Join Room</span>
            </button>
          </div>
        </header>

        {/* Smart Mobile Shortcut Banner (when opened on a phone) */}
        {isMobileDevice && (
          <div className="rounded-3xl bg-white border-2 border-[#12b8a6]/45 shadow-md p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-[#e6faf7] text-[#0c8c7e] flex items-center justify-center shrink-0">
                <Smartphone className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="font-display font-extrabold text-sm text-[#162436]">
                  Playing on a TV or computer?
                </div>
                <p className="text-xs text-[#5b6d82] leading-snug">
                  Turn this phone into your motion controller in seconds.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => openJoinModal('controller')}
              className="btn-tactile btn-mint px-4 py-2.5 rounded-2xl font-display font-bold text-xs shrink-0 cursor-pointer"
            >
              Connect
            </button>
          </div>
        )}

        {/* Main Content: Sports Plaza */}
        <main className="space-y-6">
          {/* Plaza Intro Heading */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-[#dce6f1] text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#0c8c7e] shadow-2xs">
                <Sparkles className="w-3.5 h-3.5" />
                Pick a Sport
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-black tracking-tight text-[#162436]">
                Welcome to the Plaza
              </h1>
            </div>
            <p className="text-sm text-[#5b6d82] max-w-md">
              Jump into a match on this screen solo or with up to 4 friends — swing with your
              phone or play right away with keyboard &amp; mouse.
            </p>
          </div>

          {/* Playable Sports Grid: Bowling & Tennis */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {playableSports.map((sport) => {
              const isTennis = sport.id === 'tennis';
              return (
                <div
                  key={sport.id}
                  className="rounded-[28px] bg-white border-2 border-[#dce6f1] shadow-[0_14px_36px_-16px_rgba(22,36,54,0.16)] overflow-hidden flex flex-col justify-between"
                >
                  <div
                    className="p-4 sm:p-5 flex items-center justify-center"
                    style={{ backgroundColor: sport.surfaceTint }}
                  >
                    <div
                      className="w-full aspect-[18/10] rounded-[22px] overflow-hidden border shadow-xs"
                      style={{ borderColor: sport.borderTint }}
                    >
                      <SportArtwork sportId={sport.id} className="w-full h-full object-cover" />
                    </div>
                  </div>

                  <div className="p-5 sm:p-6 flex flex-col justify-between gap-5 flex-1">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold"
                          style={{
                            backgroundColor: isTennis ? '#eef9ec' : '#e6faf7',
                            color: isTennis ? '#3d9230' : '#0c8c7e',
                          }}
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: isTennis ? '#58b947' : '#12b8a6' }}
                          />
                          Playable Now
                        </span>
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#f1f6fb] text-[#5b6d82] text-xs font-bold">
                          <Users className="w-3.5 h-3.5" />
                          {sport.players}
                        </span>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#f1f6fb] text-[#5b6d82] text-xs font-bold">
                          {sport.format}
                        </span>
                      </div>

                      <div>
                        <h2 className="font-display text-2xl sm:text-3xl font-black tracking-tight text-[#162436]">
                          {sport.name}
                        </h2>
                        <p className="text-sm text-[#5b6d82] mt-1 leading-relaxed">
                          {sport.tagline}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => onSelect({ mode: 'host', sport: sport.id })}
                        className={`btn-tactile px-6 py-3 rounded-2xl font-display font-extrabold text-sm sm:text-base flex items-center gap-2 cursor-pointer ${
                          isTennis ? 'btn-tennis' : 'btn-coral'
                        }`}
                      >
                        <Play className="w-4 h-4 fill-current" />
                        Play {sport.name}
                        <ArrowRight className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setHowToSport(sport.id)}
                        className="btn-tactile btn-surface px-4 py-3 rounded-2xl font-display font-bold text-xs sm:text-sm flex items-center gap-1.5 cursor-pointer"
                      >
                        <HelpCircle
                          className="w-4 h-4"
                          style={{ color: isTennis ? '#3d9230' : '#12b8a6' }}
                        />
                        How to Play
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>

          {/* Upcoming Sports Row */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.16em] text-[#5b6d82]">
                More Sports Coming to the Plaza
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {upcomingSports.map((sport) => (
                <button
                  key={sport.id}
                  type="button"
                  onClick={() => handleUpcomingClick(sport)}
                  className="group text-left rounded-3xl bg-white/95 hover:bg-white border-2 border-[#dce6f1] hover:border-[#bfd0e2] p-4 shadow-[0_8px_20px_-14px_rgba(22,36,54,0.2)] transition flex flex-col gap-3.5 cursor-pointer"
                >
                  <div className="relative rounded-2xl overflow-hidden border border-[#e3edf6] aspect-[24/13]">
                    <SportArtwork
                      sportId={sport.id}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                    <span className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-full bg-white/95 border border-[#dce6f1] text-[10px] font-extrabold uppercase tracking-wider text-[#5b6d82] shadow-2xs">
                      Coming Soon
                    </span>
                  </div>

                  <div className="space-y-1 px-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-xl font-black text-[#162436]">
                        {sport.name}
                      </span>
                      <span
                        className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: sport.surfaceTint,
                          color: sport.accentHex,
                        }}
                      >
                        {sport.players}
                      </span>
                    </div>
                    <p className="text-xs text-[#5b6d82] leading-relaxed">{sport.tagline}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </main>

        {/* Compact 3-Step Onboarding Strip */}
        <footer className="rounded-3xl bg-white/80 border border-[#dce6f1] px-5 py-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-xl bg-[#fff0f0] text-[#ee5656] font-display font-black text-sm flex items-center justify-center shrink-0">
                1
              </span>
              <div>
                <div className="font-bold text-[#162436]">Choose a Sport</div>
                <div className="text-[#5b6d82]">Open the alley for solo or group play.</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-xl bg-[#e6faf7] text-[#0c8c7e] font-display font-black text-sm flex items-center justify-center shrink-0">
                2
              </span>
              <div>
                <div className="font-bold text-[#162436]">Grab Your Phone (Optional)</div>
                <div className="text-[#5b6d82]">
                  Scan the QR code to swing for real, or use your keyboard.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-xl bg-[#eef6ff] text-[#2b90e8] font-display font-black text-sm flex items-center justify-center shrink-0">
                3
              </span>
              <div>
                <div className="font-bold text-[#162436]">Swing &amp; Compete</div>
                <div className="text-[#5b6d82]">
                  Take turns on one screen or bowl side-by-side with friends.
                </div>
              </div>
            </div>
          </div>
        </footer>
      </div>

      {/* Cheerful Coming-Soon Toast */}
      {previewToast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 px-4 py-3 rounded-2xl bg-white border-2 border-[#dce6f1] shadow-xl flex items-center gap-3 max-w-md w-[92%] animate-modal-in">
          <span
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: previewToast.accent }}
          />
          <div className="text-xs sm:text-sm font-semibold text-[#162436]">
            {previewToast.message}
          </div>
        </div>
      )}

      {/* Join Room / Connect Phone Modal */}
      <JoinRoomModal
        open={joinOpen}
        initialTab={joinTab}
        onClose={() => setJoinOpen(false)}
        onConnectPhone={(roomCode) => {
          setJoinOpen(false);
          onSelect({ mode: 'controller', roomCode });
        }}
        onJoinScreen={(roomCode) => {
          setJoinOpen(false);
          onSelect({ mode: 'join-display', roomCode });
        }}
      />

      {/* How to Play Guide Modal */}
      <HowToPlayModal
        sport={howToSport ?? 'bowling'}
        open={howToSport !== null}
        onClose={() => setHowToSport(null)}
      />
    </div>
  );
};
