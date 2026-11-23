import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { Modal } from '../pages/ui';
import { Icon } from './icon';

/**
 * Scan barcode / QR lewat kamera (HP) atau webcam (komputer) — setara BarcodeScannerScreen aplikasi.
 * Mesin: BarcodeDetector bawaan browser (Chrome Android/macOS/ChromeOS: cepat, tanpa unduhan);
 * selain itu ZXing (JS murni, lolos CSP, dimuat hanya saat dipakai).
 */

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code'];

interface DetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
type DetectorCtor = { new (o?: { formats?: string[] }): DetectorLike; getSupportedFormats?: () => Promise<string[]> };

async function nativeDetector(): Promise<DetectorLike | null> {
  const D = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!D) return null;
  try {
    const supported = (await D.getSupportedFormats?.()) ?? FORMATS;
    const formats = FORMATS.filter((f) => supported.includes(f));
    return formats.length ? new D({ formats }) : null;
  } catch {
    return null;
  }
}

/** Bunyi "bip" singkat + getar (bila didukung) saat kode terbaca. */
function beep() {
  try {
    navigator.vibrate?.(60);
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 1800;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.09);
    o.onended = () => void ctx.close();
  } catch {
    /* tanpa suara */
  }
}

function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (!window.isSecureContext) return 'Kamera hanya bisa dipakai lewat HTTPS.';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Izin kamera ditolak. Izinkan kamera untuk situs ini di pengaturan browser, lalu coba lagi.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Kamera/webcam tidak ditemukan di perangkat ini.';
  if (name === 'NotReadableError') return 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi.';
  return 'Kamera tidak bisa dibuka.';
}

export function ScannerDialog(props: { title?: string; onCode: (code: string) => void; onClose: () => void }) {
  let video!: HTMLVideoElement;
  let stream: MediaStream | null = null;
  let stopped = false;
  let zxingControls: { stop: () => void } | null = null;
  const [error, setError] = createSignal('');
  const [ready, setReady] = createSignal(false);
  const [cams, setCams] = createSignal<MediaDeviceInfo[]>([]);
  const [camIdx, setCamIdx] = createSignal(-1);

  const stop = () => {
    zxingControls?.stop();
    zxingControls = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };
  const done = (code: string) => {
    if (stopped) return;
    stopped = true;
    beep();
    stop();
    props.onCode(code.trim());
  };

  const start = async () => {
    stop();
    setError('');
    setReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(window.isSecureContext ? 'Browser ini tidak mendukung kamera.' : 'Kamera hanya bisa dipakai lewat HTTPS.');
      return;
    }
    const dev = cams()[camIdx()];
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: dev ? { deviceId: { exact: dev.deviceId } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (e) {
      setError(cameraError(e));
      return;
    }
    if (stopped) return stop();
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    setReady(true);
    // Daftar kamera baru lengkap (berlabel) setelah izin diberikan.
    if (!cams().length) {
      const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      setCams(list);
      const active = stream.getVideoTracks()[0]?.getSettings().deviceId;
      setCamIdx(Math.max(0, list.findIndex((d) => d.deviceId === active)));
    }

    const native = await nativeDetector();
    if (native) {
      const loop = async () => {
        if (stopped || !stream) return;
        try {
          if (video.readyState >= 2) {
            const found = await native.detect(video);
            if (found[0]?.rawValue) return done(found[0].rawValue);
          }
        } catch {
          /* frame belum siap */
        }
        setTimeout(() => void loop(), 120);
      };
      void loop();
      return;
    }
    // Cadangan: ZXing (Chrome Windows, Firefox, Safari lama).
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      if (stopped || !stream) return;
      const reader = new BrowserMultiFormatReader();
      zxingControls = await reader.decodeFromStream(stream, video, (res) => {
        if (res) done(res.getText());
      });
    } catch {
      setError('Pemindai tidak bisa dimuat. Periksa koneksi lalu coba lagi.');
    }
  };

  const switchCam = () => {
    if (cams().length < 2) return;
    setCamIdx((camIdx() + 1) % cams().length);
    void start();
  };

  onMount(() => void start());
  onCleanup(() => {
    stopped = true;
    stop();
  });

  return (
    <Modal title={props.title ?? 'Scan barcode'} onClose={props.onClose}>
      <div class="scan-view">
        <video ref={video} muted playsinline autoplay />
        <Show when={ready()}><div class="scan-frame" aria-hidden="true" /></Show>
        <Show when={!ready() && !error()}><div class="scan-msg">Membuka kamera…</div></Show>
        <Show when={error()}><div class="scan-msg err">{error()}</div></Show>
      </div>
      <p class="small mut scan-hint">Arahkan barcode ke dalam kotak. Kode terbaca otomatis.</p>
      <div class="row-btns">
        <Show when={cams().length > 1}>
          <button type="button" class="btn" onClick={switchCam}><Icon name="cameraSwitch" size={18} />Ganti kamera</button>
        </Show>
        <Show when={error()}><button type="button" class="btn" onClick={() => void start()}>Coba lagi</button></Show>
        <span class="spacer" />
        <button type="button" class="btn text" onClick={props.onClose}>Batal</button>
      </div>
    </Modal>
  );
}

/** Tombol ikon scan (IconButton qr_code_scanner) yang membuka pemindai. */
export function ScanButton(props: { onCode: (code: string) => void; title?: string; class?: string }) {
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <button type="button" class={`m-icon-btn ${props.class ?? ''}`} title={props.title ?? 'Scan barcode'} onClick={() => setOpen(true)}>
        <Icon name="qrCodeScanner" />
      </button>
      <Show when={open()}>
        <ScannerDialog
          title={props.title}
          onClose={() => setOpen(false)}
          onCode={(c) => {
            setOpen(false);
            props.onCode(c);
          }}
        />
      </Show>
    </>
  );
}
