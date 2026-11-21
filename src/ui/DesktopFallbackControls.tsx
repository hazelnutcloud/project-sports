import React, { useEffect, useRef, useState } from 'react';
import type { AimState, ArmPoseState, ThrowParams } from '../types/game';

interface DesktopFallbackControlsProps {
  enabled: boolean;
  playerName: string;
  onAimChange: (aim: AimState) => void;
  onArmPose: (pose: ArmPoseState, aim: AimState) => void;
  onThrow: (params: ThrowParams) => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export const DesktopFallbackControls: React.FC<DesktopFallbackControlsProps> = ({
  enabled,
  playerName,
  onAimChange,
  onArmPose,
  onThrow,
}) => {
  const [aim, setAim] = useState<AimState>({ xOffset: 0, aimAngle: 0 });
  const [spin, setSpin] = useState(-0.22);
  const [charging, setCharging] = useState(false);
  const [power, setPower] = useState(0);

  const aimRef = useRef(aim);
  const spinRef = useRef(spin);
  const chargingRef = useRef(false);
  const powerDirRef = useRef(1);
  const powerRef = useRef(0);

  useEffect(() => {
    aimRef.current = aim;
  }, [aim]);

  useEffect(() => {
    spinRef.current = spin;
  }, [spin]);

  useEffect(() => {
    if (enabled) {
      const fresh = { xOffset: 0, aimAngle: 0 };
      setAim(fresh);
      setCharging(false);
      chargingRef.current = false;
      setPower(0);
      powerRef.current = 0;
    }
  }, [enabled, playerName]);

  useEffect(() => {
    if (!enabled || !charging) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      let next = powerRef.current + powerDirRef.current * dt * 1.45;
      if (next >= 1) {
        next = 1;
        powerDirRef.current = -1;
      } else if (next <= 0.15) {
        next = 0.15;
        powerDirRef.current = 1;
      }
      powerRef.current = next;
      setPower(next);
      onArmPose(
        {
          pitch: -0.95 * next,
          roll: spinRef.current * 0.7,
          holdingGrip: true,
          phase: 'backswing',
        },
        aimRef.current
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, charging, onArmPose]);

  const releaseThrow = () => {
    if (!chargingRef.current) return;
    chargingRef.current = false;
    setCharging(false);

    const p = powerRef.current;
    const speed = 7.4 + p * 6.4;
    onThrow({
      xOffset: aimRef.current.xOffset,
      aimAngle: aimRef.current.aimAngle,
      speed: Number(speed.toFixed(2)),
      spin: Number(spinRef.current.toFixed(3)),
      loft: 0.26,
    });
    powerRef.current = 0;
    setPower(0);
  };

  const startCharge = () => {
    if (!enabled || chargingRef.current) return;
    chargingRef.current = true;
    powerDirRef.current = 1;
    powerRef.current = 0.25;
    setPower(0.25);
    setCharging(true);
  };

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        setAim((prev) => {
          const next = { ...prev, xOffset: clamp(prev.xOffset - 0.03, -0.4, 0.4) };
          onAimChange(next);
          return next;
        });
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        setAim((prev) => {
          const next = { ...prev, xOffset: clamp(prev.xOffset + 0.03, -0.4, 0.4) };
          onAimChange(next);
          return next;
        });
      } else if (e.code === 'KeyQ') {
        setAim((prev) => {
          const next = { ...prev, aimAngle: clamp(prev.aimAngle - 0.015, -0.17, 0.17) };
          onAimChange(next);
          return next;
        });
      } else if (e.code === 'KeyE') {
        setAim((prev) => {
          const next = { ...prev, aimAngle: clamp(prev.aimAngle + 0.015, -0.17, 0.17) };
          onAimChange(next);
          return next;
        });
      } else if (e.code === 'KeyZ') {
        setSpin((s) => clamp(Number((s - 0.12).toFixed(2)), -1, 1));
      } else if (e.code === 'KeyC') {
        setSpin((s) => clamp(Number((s + 0.12).toFixed(2)), -1, 1));
      } else if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        startCharge();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        releaseThrow();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-[94%] max-w-xl rounded-3xl bg-white/94 backdrop-blur-md border-2 border-[#d5e0ec] px-4 py-3 text-[#162436] shadow-[0_14px_34px_-12px_rgba(22,36,54,0.28)]">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
        <span className="font-display font-black text-xs text-[#0c8c7e] uppercase tracking-wider">
          {playerName}&apos;s Turn
        </span>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-[#5b6d82]">
          <span className="inline-flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded-md bg-[#eef4fa] border border-[#cddae8] font-bold text-[#162436] text-[10px]">
              A/D
            </kbd>
            Move
          </span>
          <span className="text-[#c5d3e2]">·</span>
          <span className="inline-flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded-md bg-[#eef4fa] border border-[#cddae8] font-bold text-[#162436] text-[10px]">
              Q/E
            </kbd>
            Aim
          </span>
          <span className="text-[#c5d3e2]">·</span>
          <span className="inline-flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded-md bg-[#eef4fa] border border-[#cddae8] font-bold text-[#162436] text-[10px]">
              Z/C
            </kbd>
            Curve
          </span>
          <span className="text-[#c5d3e2]">·</span>
          <span className="inline-flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded-md bg-[#eef4fa] border border-[#cddae8] font-bold text-[#162436] text-[10px]">
              Space
            </kbd>
            Bowl
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 shrink-0 bg-[#f4f8fc] border border-[#dce6f1] rounded-xl px-2.5 py-1.5">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#5b6d82]">
            Curve
          </span>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={spin}
            onChange={(e) => setSpin(Number(e.target.value))}
            aria-label="Curve spin"
            className="w-20 sm:w-24 accent-[#12b8a6]"
          />
        </div>

        <div className="flex-1 h-3.5 rounded-full bg-[#e6eef6] overflow-hidden border border-[#d5e0ec] p-0.5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#12b8a6] via-[#f59e0b] to-[#ee5656] transition-[width] duration-75"
            style={{ width: `${Math.round(power * 100)}%` }}
          />
        </div>

        <button
          type="button"
          onPointerDown={startCharge}
          onPointerUp={releaseThrow}
          onPointerLeave={() => {
            if (chargingRef.current) releaseThrow();
          }}
          className="btn-tactile btn-coral px-4 py-2 rounded-2xl font-display font-extrabold text-xs uppercase tracking-wider shrink-0 cursor-pointer"
        >
          {charging ? 'Release!' : 'Hold to Bowl'}
        </button>
      </div>
    </div>
  );
};
