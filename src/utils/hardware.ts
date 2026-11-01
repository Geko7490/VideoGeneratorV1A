import type { HardwareInfo, HardwareTier } from '../types';

async function canEncode(codec: string, w = 1280, h = 720): Promise<boolean> {
  try {
    if (!('VideoEncoder' in window)) return false;
    const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate: 5_000_000, framerate: 30 });
    return !!r.supported;
  } catch {
    return false;
  }
}

async function canEncodeAudio(codec: string): Promise<boolean> {
  try {
    if (!('AudioEncoder' in window)) return false;
    const r = await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128_000 });
    return !!r.supported;
  } catch {
    return false;
  }
}

export async function detectHardware(): Promise<HardwareInfo> {
  const nav = navigator as Navigator & { deviceMemory?: number; gpu?: GPU };
  let webgpu = false;
  let adapterName: string | null = null;
  let maxBufferMB: number | null = null;
  try {
    if (nav.gpu) {
      const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        webgpu = true;
        const info = (adapter as GPUAdapter & { info?: { vendor?: string; architecture?: string; device?: string; description?: string } }).info;
        if (info) adapterName = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || null;
        maxBufferMB = Math.round(adapter.limits.maxBufferSize / 1024 / 1024);
      }
    }
  } catch {
    webgpu = false;
  }
  let storageQuotaGB: number | null = null;
  let storageUsedGB: number | null = null;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota) storageQuotaGB = +(est.quota / 1e9).toFixed(1);
    if (est?.usage !== undefined) storageUsedGB = +(est.usage / 1e9).toFixed(2);
  } catch {
    /* ignore */
  }
  const h264 = await canEncode('avc1.42001f');
  const vp9 = await canEncode('vp09.00.10.08');
  const aac = await canEncodeAudio('mp4a.40.2');
  const deviceMemoryGB = nav.deviceMemory ?? null;
  const cpuCores = navigator.hardwareConcurrency ?? null;

  let tier: HardwareTier = 'medium';
  if (!webgpu) tier = 'low';
  else if ((deviceMemoryGB ?? 8) >= 8 && (maxBufferMB ?? 0) >= 2048 && (cpuCores ?? 4) >= 8) tier = 'high';
  else if ((deviceMemoryGB ?? 4) <= 4) tier = 'low';

  return {
    webgpu,
    webgpuAdapter: adapterName,
    deviceMemoryGB,
    cpuCores,
    storageQuotaGB,
    storageUsedGB,
    webcodecs: 'VideoEncoder' in window && (h264 || vp9),
    h264,
    aac,
    fsAccess: 'showSaveFilePicker' in window,
    tier,
    maxBufferMB,
  };
}

/** Last detected hardware, cached so non-async callers (renderer) can resolve AUTO quality. */
let cachedHardware: HardwareInfo | null = null;
export function setCachedHardware(h: HardwareInfo) {
  cachedHardware = h;
}
export function detectHardwareSync(): HardwareInfo | null {
  return cachedHardware;
}

export const TIER_DESCRIPTIONS: Record<HardwareTier, string> = {
  low: 'CPU / weak GPU: small LLM (1–3B), FAST image preset, 512px images.',
  medium: '≈6–10 GB VRAM: 7B/8B Q4 LLM, BALANCED image preset, sequential model loading.',
  high: '≥10 GB VRAM: 7B/8B Q4 LLM, QUALITY preset available, larger image sizes.',
};
