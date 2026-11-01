import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { modelManager, runtimeIdOf } from '../models/modelManager';
import { formatSize, STATUS_LABEL, type ModelState, type ModelStatus } from '../models/registry';
import { Badge, Btn, Modal } from './common';
import { TIER_DESCRIPTIONS } from '../utils/hardware';
import { cn } from '../utils/cn';

const TONE: Record<ModelStatus, 'zinc' | 'green' | 'red' | 'amber' | 'blue'> = {
  NOT_INSTALLED: 'zinc',
  DOWNLOADING: 'blue',
  PAUSED: 'amber',
  VERIFYING: 'blue',
  READY: 'green',
  CORRUPTED: 'red',
  FAILED: 'red',
  UPDATING: 'amber',
};

export function ModelManagerPanel({ onClose }: { onClose: () => void }) {
  const { models, hardware, memory, busy, log, project, updateSettings } = useStore();
  const [states, setStates] = useState<ModelState[]>(modelManager.stateList());
  const [working, setWorking] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ModelState | null>(null);
  const storage = modelManager.storage;

  useEffect(() => {
    const off = modelManager.subscribe(() => setStates(modelManager.stateList()));
    void modelManager.scanAll();
    return () => {
      off();
    };
  }, []);

  const run = async (st: ModelState, action: 'download' | 'verify' | 'delete' | 'load' | 'unload') => {
    try {
      setWorking(st.id);
      if (action === 'download') await modelManager.download(st.id);
      if (action === 'verify') await modelManager.verify(st.id);
      if (action === 'delete') await modelManager.delete(st.id);
      if (action === 'load') await modelManager.load(st.id);
      if (action === 'unload') await modelManager.unload(runtimeIdOf(st));
      log(`${action} ${st.name}: ok`);
    } catch (e) {
      log(`${action} ${st.name} failed: ${(e as Error).message}`, 'error');
    } finally {
      setWorking(null);
      setStates(modelManager.stateList());
    }
  };

  const use = (st: ModelState) => {
    const rid = runtimeIdOf(st);
    if (st.category === 'llm') updateSettings({ llmModelId: rid });
    if (st.category === 'tts') updateSettings({ ttsModelId: rid });
    log(`Selected ${st.category.toUpperCase()}: ${st.name}`);
  };
  const isSelected = (st: ModelState) => [project.settings.llmModelId, project.settings.ttsModelId].includes(runtimeIdOf(st));

  const startDownload = (st: ModelState) => setConfirm(st);

  const Card = ({ st }: { st: ModelState }) => {
    const busyHere = working === st.id;
    const downloading = st.status === 'DOWNLOADING' || st.status === 'VERIFYING';
    const ready = st.status === 'READY' || st.status === 'UPDATING';
    return (
      <div className={cn('rounded-md border px-3 py-2 text-[11px]', isSelected(st) ? 'border-emerald-700 bg-emerald-950/20' : 'border-zinc-800 bg-zinc-900/50')}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-zinc-100">{st.name}</span>
          <Badge tone={TONE[st.status]}>
            {st.status === 'READY' ? '✓ Installed · Ready' : STATUS_LABEL[st.status]}
          </Badge>
          <Badge tone="green">{st.backend === 'webgpu' ? 'LOCAL · WEBGPU' : 'LOCAL · CPU'}</Badge>
          {st.loaded && <Badge tone="blue">In memory</Badge>}
        </div>

        <div className="mt-0.5 text-zinc-500">
          {st.description}
          <br />
          Size: {formatSize(st.sizeBytes)}
          {ready && st.bytesOnDisk > 0 && <> · on device {formatSize(st.bytesOnDisk)} ({st.fileCount} files)</>}
          {st.install?.verifiedAt ? <> · verified {new Date(st.install.verifiedAt).toLocaleDateString()}</> : null}
        </div>

        {st.issue && <div className="mt-1 text-[10px] text-amber-400">{st.issue}</div>}

        {downloading && (
          <div className="mt-1">
            <div className="h-1 w-full overflow-hidden rounded bg-zinc-800">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round((st.progress ?? 0) * 100)}%` }} />
            </div>
            <div className="truncate text-[10px] text-zinc-500">{st.progressText}</div>
          </div>
        )}
        {!downloading && st.progressText && st.status === 'PAUSED' && <div className="mt-1 text-[10px] text-amber-400">{st.progressText}</div>}

        <div className="mt-1.5 flex flex-wrap gap-1">
          {ready && (
            <>
              <Btn size="sm" variant={isSelected(st) ? 'primary' : 'default'} onClick={() => use(st)}>
                {isSelected(st) ? 'In use' : 'Use'}
              </Btn>
              {st.loaded ? (
                <Btn size="sm" disabled={busy || busyHere} onClick={() => void run(st, 'unload')}>Unload</Btn>
              ) : (
                <Btn size="sm" disabled={busy || busyHere} onClick={() => void run(st, 'load')}>Load</Btn>
              )}
              <Btn size="sm" disabled={busy || busyHere} onClick={() => void run(st, 'verify')}>Verify</Btn>
              <Btn size="sm" variant="danger" disabled={busy || busyHere} onClick={() => void run(st, 'delete')}>Delete</Btn>
            </>
          )}
          {(st.status === 'NOT_INSTALLED' || st.status === 'FAILED') && (
            <Btn size="sm" disabled={busy || !!modelManager.activeDownload} onClick={() => startDownload(st)}>
              {st.status === 'FAILED' ? 'Retry download' : 'Download'}
            </Btn>
          )}
          {st.status === 'PAUSED' && (
            <>
              <Btn size="sm" disabled={busy || !!modelManager.activeDownload} onClick={() => startDownload(st)}>Resume</Btn>
              <Btn size="sm" variant="danger" disabled={busy} onClick={() => void run(st, 'delete')}>Discard</Btn>
            </>
          )}
          {(st.status === 'CORRUPTED' || st.status === 'UPDATING') && (
            <>
              <Btn size="sm" disabled={busy || busyHere} onClick={() => void run(st, 'verify')}>Re-verify</Btn>
              <Btn size="sm" disabled={busy || !!modelManager.activeDownload} onClick={() => startDownload(st)}>Repair / re-download</Btn>
              <Btn size="sm" variant="danger" disabled={busy} onClick={() => void run(st, 'delete')}>Delete</Btn>
            </>
          )}
          {downloading && (
            <>
              <Btn size="sm" onClick={() => modelManager.pauseDownload()}>Pause</Btn>
              <Btn size="sm" variant="danger" onClick={() => modelManager.cancelDownload()}>Cancel</Btn>
            </>
          )}
        </div>
      </div>
    );
  };

  const llms = states.filter((s) => s.category === 'llm');
  const ttss = states.filter((s) => s.category === 'tts');
  const engine = models.find((m) => m.category === 'visual');
  const installedCount = states.filter((s) => s.status === 'READY').length;

  return (
    <Modal title="Local Models" onClose={onClose} wide>
      <div className="mb-4 grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] md:grid-cols-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Device</div>
          <div className="text-zinc-200">
            🖥️ Desktop · WebGPU {hardware?.webgpu ? <span className="text-emerald-400">yes</span> : <span className="text-red-400">no</span>}
          </div>
          <div className="text-zinc-500">{hardware ? TIER_DESCRIPTIONS[hardware.tier] : ''}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Persistent storage</div>
          <div className="text-zinc-200">
            {storage.persisted ? <span className="text-emerald-400">✓ Granted — models survive restarts</span> : <span className="text-amber-400">Best-effort (browser may evict)</span>}
          </div>
          <div className="text-zinc-500">Used {storage.usedGB ?? '?'} GB of {storage.quotaGB ?? '?'} GB · {installedCount} model(s) installed</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Downloads</div>
          <div className="text-zinc-500">Progress, pause / resume and cancel are built into every download.</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Btn size="sm" onClick={() => void modelManager.scanAll()}>Rescan storage</Btn>
            <Btn size="sm" disabled={busy} onClick={() => void modelManager.unloadAll()}>Free memory</Btn>
          </div>
        </div>
      </div>

      <p className="mb-3 text-[11px] text-zinc-400">
        Models are downloaded <b>once</b> and kept on this device. On every start the app scans local storage, verifies the files and loads them directly — nothing is downloaded again.
        {memory?.currentModel ? ` Currently in memory: ${memory.currentModel.name}.` : ''}
      </p>

      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">LLM · scene planner</h3>
      {!hardware?.webgpu && <p className="mb-2 rounded border border-amber-900/50 bg-amber-950/20 p-2 text-[11px] text-amber-300">⚠️ WebGPU is unavailable, so in-browser LLMs cannot run on this device.</p>}
      <div className="mb-5 space-y-1.5">{llms.map((s) => <Card key={s.id} st={s} />)}</div>

      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">TTS · narration</h3>
      <div className="mb-5 space-y-1.5">{ttss.map((s) => <Card key={s.id} st={s} />)}</div>

      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Video / visual engine</h3>
      <div className="rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-zinc-100">{engine?.name}</span>
          <Badge tone="green">✓ Built in</Badge>
          <Badge tone="blue">NO AI IMAGE GENERATION</Badge>
        </div>
        <div className="text-zinc-500">{engine?.description} Nothing to download.</div>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={() => setConfirm(null)}>
          <div className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-5" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-sm font-semibold text-zinc-100">{confirm.name} is required for this feature.</h4>
            <p className="mt-2 text-xs text-zinc-400">
              This model is <b>not installed</b> on your device.
              <br />
              Download size: <b>{formatSize(confirm.sizeBytes)}</b> · stays on this device for future runs.
            </p>
            {confirm.heavyForMobile && (
              <p className="mt-2 rounded border border-amber-900/50 bg-amber-950/20 p-2 text-[11px] text-amber-300">
                This is a large model ({formatSize(confirm.sizeBytes)}). On a 10 GB GPU prefer Qwen 7B or smaller.
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Btn onClick={() => setConfirm(null)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() => {
                  const st = confirm;
                  setConfirm(null);
                  void run(st, 'download');
                }}
              >
                Download {formatSize(confirm.sizeBytes)}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
