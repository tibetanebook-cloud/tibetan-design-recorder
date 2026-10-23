/**
 * Hidden capture window: opens each input as its own MediaStream and records it
 * with its own MediaRecorder, so screen, webcam, mic and system audio always end
 * up as separate files. Chunks stream to main once a second.
 *
 * On Windows, Chromium's desktop capture uses Windows Graphics Capture and system
 * audio comes from WASAPI loopback (both requested through getDisplayMedia, which
 * main answers with the chosen source).
 */
import { wallNow } from "@shared/recording/clock";
import type { CaptureBeginPayload } from "@shared/recording/ipc";
import type { TrackFileKind } from "@shared/recording/types";

const VIDEO_TYPES = ["video/webm;codecs=h264", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
const AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/webm"];
const pick = (types: string[]) => types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";

interface Running {
  kind: TrackFileKind;
  recorder: MediaRecorder;
  stream: MediaStream;
  stoppedAt?: number;
  finished: Promise<void>;
  bytes: number;
  /** Resolves once the recorder has started (and been paused) during the countdown. */
  warm: Promise<void>;
}

const running: Running[] = [];
const api = window.tdr.capture;

function videoBitrate(track: MediaStreamTrack): number {
  const s = track.getSettings();
  const pixels = (s.width ?? 1920) * (s.height ?? 1080);
  const fps = s.frameRate ?? 30;
  return Math.min(40_000_000, Math.max(2_000_000, Math.round(pixels * fps * 0.15)));
}

function record(kind: TrackFileKind, stream: MediaStream): void {
  const video = stream.getVideoTracks()[0];
  const mimeType = pick(video ? VIDEO_TYPES : AUDIO_TYPES);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    ...(video ? { videoBitsPerSecond: videoBitrate(video) } : { audioBitsPerSecond: kind === "mic" ? 160_000 : 192_000 }),
  });
  let sending: Promise<void> = Promise.resolve();
  recorder.ondataavailable = (e) => {
    if (!e.data.size) return;
    entry.bytes += e.data.size;
    // Keep chunk order: each send waits for the previous arrayBuffer().
    sending = sending.then(async () => api.chunk(kind, new Uint8Array(await e.data.arrayBuffer())));
  };
  // Warm start: the recorder is started and paused at once during the countdown
  // (encoders take up to ~0.7 s to start); "go" resumes everyone together and the
  // resume moment is this file's start on the take clock.
  let warmed: () => void = () => {};
  const warm = new Promise<void>((resolve) => (warmed = resolve));
  recorder.onstart = () => {
    recorder.pause();
    warmed();
  };
  let announced = false;
  recorder.onresume = () => {
    if (announced) return;
    announced = true;
    const s = video?.getSettings();
    api.trackStarted({ kind, mimeType, wallMs: wallNow(), width: s?.width, height: s?.height });
  };
  recorder.onerror = (e) => api.warning(`${kind}: recorder error ${String((e as ErrorEvent).error ?? e.type)}`);
  const finished = new Promise<void>((resolve) => {
    recorder.onstop = () => void sending.then(resolve);
  });
  const entry: Running = { kind, recorder, stream, finished, bytes: 0, warm };
  running.push(entry);
}

/** Name the input in the error so the user knows which permission/device failed. */
async function open<T>(input: TrackFileKind, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const e = error as DOMException;
    throw new Error(`${input}: ${e.name ?? "Error"}: ${e.message ?? String(error)}`);
  }
}

/**
 * Inputs open independently: if the webcam or mic is blocked or busy, the other
 * inputs still record and the failure is reported as a warning. Only a screen
 * failure stops the take.
 */
async function begin(p: CaptureBeginPayload): Promise<void> {
  const screenReq = p.screen;
  const webcamReq = p.webcam;
  const micReq = p.mic;
  const [display, cam, mic] = await Promise.allSettled([
    screenReq
      ? open("screen", () =>
          navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: screenReq.fps, max: screenReq.fps } }, audio: p.systemAudio }),
        )
      : Promise.resolve(null),
    webcamReq
      ? open("webcam", () =>
          navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: webcamReq.deviceId },
              width: { ideal: webcamReq.width },
              height: { ideal: webcamReq.height },
              frameRate: { ideal: webcamReq.fps },
            },
          }),
        )
      : Promise.resolve(null),
    micReq
      ? open("mic", () =>
          // Raw voice: no browser processing, so noise removal/leveling stay editable later.
          navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: micReq.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          }),
        )
      : Promise.resolve(null),
  ]);

  if (display.status === "rejected") {
    for (const r of [cam, mic]) if (r.status === "fulfilled") r.value?.getTracks().forEach((t) => t.stop());
    return api.error(String(display.reason));
  }
  const streams: [TrackFileKind, MediaStream][] = [];
  if (display.value) {
    const [screenTrack] = display.value.getVideoTracks();
    if (screenTrack) {
      screenTrack.contentHint = "detail";
      streams.push(["screen", new MediaStream([screenTrack])]);
    }
    const [systemTrack] = display.value.getAudioTracks();
    if (systemTrack) streams.push(["system", new MediaStream([systemTrack])]);
    else if (p.systemAudio) api.warning("system: no system audio track was provided");
  }
  if (cam.status === "fulfilled" && cam.value) streams.push(["webcam", cam.value]);
  else if (cam.status === "rejected") api.warning(`webcam: ${String(cam.reason)}`);
  if (mic.status === "fulfilled" && mic.value) streams.push(["mic", mic.value]);
  else if (mic.status === "rejected") api.warning(`mic: ${String(mic.reason)}`);

  for (const [kind, stream] of streams) record(kind, stream);
  // Start (and immediately pause) every recorder; one failing never blocks the others.
  for (const r of [...running]) {
    try {
      r.recorder.start(1000);
    } catch (error) {
      api.warning(`${r.kind}: could not start recording (${String(error)})`);
      r.stream.getTracks().forEach((t) => t.stop());
      running.splice(running.indexOf(r), 1);
    }
  }
  // Encoders are warm: main starts the take clock, then says go.
  await Promise.race([Promise.all(running.map((r) => r.warm)), new Promise((r) => setTimeout(r, 5000))]);
  api.prepared();
}

api.onGo(() => {
  // Resume everyone in the same task so their start times are as close as possible.
  for (const r of running) if (r.recorder.state === "paused") r.recorder.resume();
});

api.onBegin((p) => void begin(p));
api.onPause(() => running.forEach((r) => r.recorder.state === "recording" && r.recorder.pause()));
api.onResume(() => running.forEach((r) => r.recorder.state === "paused" && r.recorder.resume()));
api.onEnd(() => {
  void (async () => {
    for (const r of running) {
      if (r.recorder.state !== "inactive") {
        r.stoppedAt = wallNow();
        r.recorder.stop();
      }
    }
    await Promise.all(running.map((r) => r.finished));
    // An input that opened but delivered nothing (muted by a hardware switch,
    // disabled driver…) is reported instead of silently disappearing.
    for (const r of running) {
      if (r.bytes > 0) continue;
      const track = r.stream.getTracks()[0];
      api.warning(`${r.kind}: no data recorded (track ${track?.readyState ?? "missing"}${track?.muted ? ", muted by the system" : ""}, label "${track?.label ?? ""}")`);
    }
    for (const r of running) r.stream.getTracks().forEach((t) => t.stop());
    api.done({ stoppedWallMs: Object.fromEntries(running.map((r) => [r.kind, r.stoppedAt ?? wallNow()])) });
  })();
});
api.ready();
