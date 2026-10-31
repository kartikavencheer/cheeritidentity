import { compressVideo } from "/Volumes/MACDISK/kartik/WEBSITES/CheerIT-Score-cheer/frontend/src/lib/cheerVideo";
const post = (o: unknown) => fetch("/result", { method: "POST", body: JSON.stringify(o) });
(async () => {
  try {
    const canvas = document.createElement("canvas"); canvas.width = 1920; canvas.height = 1080; const g = canvas.getContext("2d")!;
    const stream = canvas.captureStream(30);
    const ac = new AudioContext(); const osc = ac.createOscillator(); const dest = ac.createMediaStreamDestination(); osc.connect(dest); osc.start(); dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m))!;
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 9_000_000, audioBitsPerSecond: 64000 });
    const chunks: Blob[] = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.start(250); const t0 = performance.now();
    const iv = setInterval(() => { const t = (performance.now() - t0) / 1000; for (let i = 0; i < 40; i++) { g.fillStyle = `hsl(${(t * 60 + i * 9) % 360},80%,${30 + (i % 5) * 8}%)`; g.fillRect(Math.random() * 1920, Math.random() * 1080, 300, 200); } g.fillStyle = "#fff"; g.font = "80px sans-serif"; g.fillText(`t=${t.toFixed(1)}`, 60, 120); }, 33);
    await new Promise((r) => setTimeout(r, 12000)); clearInterval(iv); rec.stop(); await stopped; osc.stop();
    const original = new File([new Blob(chunks, { type: "video/webm" })], "big.webm", { type: "video/webm" });
    const progress: number[] = [];
    const t1 = performance.now();
    const out = await compressVideo(original, { maxSeconds: 7, onProgress: (p) => progress.push(p) });
    const took = (performance.now() - t1) / 1000;
    if (!out) { await post({ ok: false, why: "returned null", originalMB: original.size / 1048576 }); return; }
    const v = document.createElement("video"); v.muted = true; v.src = URL.createObjectURL(out.blob);
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; setTimeout(() => rej(new Error("result not playable")), 8000); });
    await post({ ok: true, originalMB: +(original.size / 1048576).toFixed(2), outMB: +(out.blob.size / 1048576).toFixed(2), outMime: out.mime, reportedDuration: out.duration, width: v.videoWidth, height: v.videoHeight, tookSeconds: +took.toFixed(1), progressSteps: progress.length, lastProgress: progress[progress.length - 1], decodes: v.readyState >= 2 });
  } catch (e: any) { await post({ ok: false, why: String(e?.message || e) }); }
})();
