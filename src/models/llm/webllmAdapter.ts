import type { LLMAdapter, ModelInfo } from '../../types';
import { memoryManager } from '../../utils/memoryManager';

/**
 * MODE A — BROWSER LOCAL LLM via WebLLM (MLC). Runs fully in the browser on WebGPU.
 * Model weights are downloaded once (only after the user clicks DOWNLOAD) and cached in the browser Cache storage.
 */

type WebLLM = typeof import('@mlc-ai/web-llm');
let webllmMod: WebLLM | null = null;
async function lib(): Promise<WebLLM> {
  if (!webllmMod) webllmMod = await import('@mlc-ai/web-llm');
  return webllmMod;
}

// Curated families; the actual list is intersected with WebLLM's prebuilt list at runtime.
const PREFERRED = [
  { match: /^Qwen2\.5-7B-Instruct-q4f16_1-MLC$/, family: 'Qwen', tier: 'high' },
  { match: /^Llama-3\.1-8B-Instruct-q4f16_1-MLC$/, family: 'Llama', tier: 'high' },
  { match: /^Qwen2\.5-3B-Instruct-q4f16_1-MLC$/, family: 'Qwen', tier: 'medium' },
  { match: /^Phi-3\.5-mini-instruct-q4f16_1-MLC$/, family: 'Phi', tier: 'medium' },
  { match: /^gemma-2-2b-it-q4f16_1-MLC$/, family: 'Gemma', tier: 'medium' },
  { match: /^Llama-3\.2-3B-Instruct-q4f16_1-MLC$/, family: 'Llama', tier: 'medium' },
  { match: /^Qwen2\.5-1\.5B-Instruct-q4f16_1-MLC$/, family: 'Qwen', tier: 'low' },
  { match: /^Llama-3\.2-1B-Instruct-q4f16_1-MLC$/, family: 'Llama', tier: 'low' },
  { match: /^Qwen2\.5-0\.5B-Instruct-q4f16_1-MLC$/, family: 'Qwen', tier: 'low' },
];

export async function listWebLLMModels(): Promise<ModelInfo[]> {
  const w = await lib();
  const list = w.prebuiltAppConfig.model_list;
  const out: ModelInfo[] = [];
  for (const pref of PREFERRED) {
    const rec = list.find((m) => pref.match.test(m.model_id));
    if (!rec) continue;
    let installed = false;
    try {
      installed = await w.hasModelInCache(rec.model_id, w.prebuiltAppConfig);
    } catch {
      installed = false;
    }
    const vram = rec.vram_required_MB ? Math.round(rec.vram_required_MB * 1024 * 1024) : null;
    out.push({
      id: 'webllm:' + rec.model_id,
      name: rec.model_id.replace(/-MLC$/, ''),
      category: 'llm',
      backend: 'webgpu',
      sizeBytes: vram ? Math.round(vram * 0.85) : null,
      vramBytes: vram,
      installed,
      loaded: webllmAdapter.currentModel === rec.model_id,
      downloadable: true,
      description: `${pref.family} · q4f16 quantized · runs in-browser on WebGPU (${pref.tier.toUpperCase()} tier)`,
      languages: ['en', 'tr'],
      quant: 'q4f16_1',
      family: pref.family,
    });
  }
  return out;
}

/** Authoritative cache check straight from the WebLLM runtime (used by model verification). */
export async function hasWebLLMInCache(runtimeId: string): Promise<boolean> {
  try {
    const w = await lib();
    return await w.hasModelInCache(runtimeId, w.prebuiltAppConfig);
  } catch {
    return false;
  }
}

export async function deleteWebLLMModel(id: string) {
  const w = await lib();
  await w.deleteModelAllInfoInCache(id.replace(/^webllm:/, ''), w.prebuiltAppConfig);
}

class WebLLMAdapter implements LLMAdapter {
  id = 'webllm';
  locality = 'LOCAL' as const;
  engine: import('@mlc-ai/web-llm').MLCEngine | null = null;
  currentModel: string | null = null;

  isLoaded() {
    return !!this.engine;
  }

  async load(modelId: string, onProgress?: (p: number, text: string) => void) {
    const raw = modelId.replace(/^webllm:/, '');
    if (this.engine && this.currentModel === raw) return;
    if (this.engine) await this.unload();
    const w = await lib();
    const rec = w.prebuiltAppConfig.model_list.find((m) => m.model_id === raw);
    await memoryManager.acquire('llm', modelId, raw, rec?.vram_required_MB ? rec.vram_required_MB * 1024 * 1024 : null);
    memoryManager.setStatus(`Loading LLM ${raw}`);
    this.engine = await w.CreateMLCEngine(raw, {
      initProgressCallback: (r) => onProgress?.(r.progress, r.text),
    });
    this.currentModel = raw;
  }

  async unload() {
    if (this.engine) {
      try {
        await this.engine.unload();
      } catch {
        /* ignore */
      }
    }
    this.engine = null;
    this.currentModel = null;
  }

  async complete(system: string, user: string, opts?: { json?: boolean; maxTokens?: number; onToken?: (t: string) => void }) {
    if (!this.engine) throw new Error('WebLLM engine not loaded.');

    const runCall = async (useGrammarFormat: boolean) => {
      // Not: WebLLM C++ grammar derleyicisi response_format: { type: 'json_object' } gönderildiğinde
      // şema string'i verilmezse 'Cannot pass non-string to std::string' hatası fırlatır.
      // Bu nedenle formatı güvenli hale getiriyoruz veya hata durumunda düz metin üzerinden extractJSON kullanıyoruz.
      const requestPayload: Parameters<typeof this.engine.chat.completions.create>[0] = {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.7,
        max_tokens: opts?.maxTokens ?? 4096,
        stream: true,
        ...(opts?.json && useGrammarFormat ? { response_format: { type: 'json_object' as const } } : {}),
      };

      const stream = await this.engine!.chat.completions.create({
        ...requestPayload,
        stream: true,
      });
      let text = '';
      for await (const chunk of stream) {
        const d = chunk.choices[0]?.delta?.content ?? '';
        if (d) {
          text += d;
          opts?.onToken?.(text);
        }
      }
      return text;
    };

    try {
      // Grammar hatasını önlemek için JSON zorlamasını prompt seviyesinde tutup grammar matcher'a takılmamasını sağlıyoruz
      return await runCall(false);
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      if (msg.includes('grammar matcher') || msg.includes('std::string')) {
        return await runCall(false);
      }
      throw e;
    }
  }
}

export const webllmAdapter = new WebLLMAdapter();
memoryManager.registerUnloader('llm', () => webllmAdapter.unload());
