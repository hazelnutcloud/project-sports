import type { HapticPattern } from '../types/network';
import type { OrientEulerDeg, RawImuSample, Vec3 } from './ThrowTraceRecorder';

export type SensorPermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported';

type MotionPermissionApi = {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Raw hardware sensor bridge forwarding full 3-axis DeviceOrientation & DeviceMotion
 * readings cleanly into the orientation-agnostic SwingDetector and debug trace recorder.
 */
export class SensorBridge {
  private onSample: (sample: RawImuSample) => void;
  private active = false;
  private hasReceivedData = false;
  private latestOrient: OrientEulerDeg | null = null;
  private wakeLock: WakeLockSentinel | null = null;

  private motionHandler: ((e: DeviceMotionEvent) => void) | null = null;
  private orientHandler: ((e: DeviceOrientationEvent) => void) | null = null;

  constructor(onSample: (sample: RawImuSample) => void) {
    this.onSample = onSample;
  }

  public isSupported(): boolean {
    return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
  }

  public hasSensorSignal(): boolean {
    return this.hasReceivedData;
  }

  public async requestPermissionAndStart(): Promise<SensorPermissionState> {
    if (!this.isSupported()) {
      return 'unsupported';
    }

    try {
      const dm = DeviceMotionEvent as unknown as MotionPermissionApi;
      if (typeof dm.requestPermission === 'function') {
        const res = await dm.requestPermission();
        if (res !== 'granted') return 'denied';
      }

      const dorient = DeviceOrientationEvent as unknown as MotionPermissionApi;
      if (typeof dorient.requestPermission === 'function') {
        const res = await dorient.requestPermission();
        if (res !== 'granted') return 'denied';
      }
    } catch {
      return 'denied';
    }

    this.startListening();
    void this.acquireWakeLock();
    return 'granted';
  }

  public startListening(): void {
    if (this.active) return;
    this.active = true;

    this.orientHandler = (e: DeviceOrientationEvent) => {
      if (isFiniteNum(e.beta) && isFiniteNum(e.gamma)) {
        this.latestOrient = {
          alpha: isFiniteNum(e.alpha) ? e.alpha : 0,
          beta: e.beta,
          gamma: e.gamma,
        };
        this.hasReceivedData = true;
      }
    };

    this.motionHandler = (e: DeviceMotionEvent) => {
      const rr = e.rotationRate;
      const acc = e.acceleration;
      const accG = e.accelerationIncludingGravity;

      // W3C mapping to standard right-handed phone local axes (X=right, Y=top, Z=out-of-screen):
      // rotationRate.beta -> around X, rotationRate.gamma -> around Y, rotationRate.alpha -> around Z
      const gyroDeg: Vec3 | null =
        rr && (isFiniteNum(rr.beta) || isFiniteNum(rr.gamma) || isFiniteNum(rr.alpha))
          ? {
              x: isFiniteNum(rr.beta) ? rr.beta : 0,
              y: isFiniteNum(rr.gamma) ? rr.gamma : 0,
              z: isFiniteNum(rr.alpha) ? rr.alpha : 0,
            }
          : null;

      const accel: Vec3 | null =
        acc && (isFiniteNum(acc.x) || isFiniteNum(acc.y) || isFiniteNum(acc.z))
          ? {
              x: isFiniteNum(acc.x) ? acc.x : 0,
              y: isFiniteNum(acc.y) ? acc.y : 0,
              z: isFiniteNum(acc.z) ? acc.z : 0,
            }
          : null;

      const accelG: Vec3 | null =
        accG && (isFiniteNum(accG.x) || isFiniteNum(accG.y) || isFiniteNum(accG.z))
          ? {
              x: isFiniteNum(accG.x) ? accG.x : 0,
              y: isFiniteNum(accG.y) ? accG.y : 0,
              z: isFiniteNum(accG.z) ? accG.z : 0,
            }
          : null;

      if (gyroDeg || accel || accelG) {
        this.hasReceivedData = true;
      }

      this.onSample({
        timestampMs: performance.now(),
        orient: this.latestOrient ? { ...this.latestOrient } : null,
        gyroDeg,
        accel,
        accelG,
      });
    };

    window.addEventListener('deviceorientation', this.orientHandler, true);
    window.addEventListener('devicemotion', this.motionHandler, true);
  }

  public stop(): void {
    this.active = false;
    if (this.orientHandler) {
      window.removeEventListener('deviceorientation', this.orientHandler, true);
      this.orientHandler = null;
    }
    if (this.motionHandler) {
      window.removeEventListener('devicemotion', this.motionHandler, true);
      this.motionHandler = null;
    }
    void this.releaseWakeLock();
  }

  public triggerHaptic(pattern: HapticPattern): void {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
      return;
    }
    switch (pattern) {
      case 'tick':
        navigator.vibrate(14);
        break;
      case 'release':
        navigator.vibrate([25, 15, 45]);
        break;
      case 'pin-hit':
        navigator.vibrate(35);
        break;
      case 'strike':
        navigator.vibrate([50, 40, 70, 40, 120]);
        break;
      case 'spare':
        navigator.vibrate([40, 35, 70]);
        break;
      case 'gutter':
        navigator.vibrate([120, 60, 80]);
        break;
      case 'your-turn':
        navigator.vibrate([30, 30, 30]);
        break;
      case 'racket-hit':
        navigator.vibrate([18, 10, 28]);
        break;
      case 'smash-hit':
        navigator.vibrate([40, 20, 65]);
        break;
      case 'serve-toss':
        navigator.vibrate(22);
        break;
      case 'point-won':
        navigator.vibrate([35, 30, 60]);
        break;
      case 'fault':
        navigator.vibrate([85, 45, 55]);
        break;
    }
  }

  private async acquireWakeLock(): Promise<void> {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch {
      // Wake lock is optional
    }
  }

  private async releaseWakeLock(): Promise<void> {
    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
      } catch {
        // ignore
      }
      this.wakeLock = null;
    }
  }
}
