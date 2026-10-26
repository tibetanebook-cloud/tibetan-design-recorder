/**
 * Demo video recorder (`--smoke-test --demo-video --demo-dir=<folder>`): plays the
 * scripted tour in smoke/demo.page.js frame by frame (virtual time, 30 fps) and pipes
 * each 4K frame into ffmpeg. The narration plan (plan.json) and the voice/music are
 * made outside the app; see the demo folder's README.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { app, type BrowserWindow } from "electron";
import demoScript from "./smoke/demo.page.js?raw";
import showcaseScript from "./smoke/showcase.page.js?raw";
import trainingScenes from "./smoke/training.page.js?raw";

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

export async function runDemoVideo(win: BrowserWindow, page: <T>(code: string) => Promise<T>, wait: (ms: number) => Promise<void>, appRoot: string): Promise<void> {
  const dir = arg("demo-dir");
  if (!dir) throw new Error("--demo-dir=<folder> is required");
  const fps = 30;
  const plan = JSON.parse(await fs.readFile(join(dir, "plan.json"), "utf8")) as { total: number };
  const from = Number(arg("demo-from") ?? 0);
  const to = Math.min(plan.total, Number(arg("demo-to") ?? plan.total));
  const probe = process.argv.includes("--demo-probe");

  // CSS viewport 1920×1080 drawn at 2× = 3840×2160.
  win.setContentSize(1920, 1080);
  await wait(500);

  const asset = async (rel: string) => `data:image/png;base64,${(await fs.readFile(join(appRoot, rel))).toString("base64")}`;
  const assets = {
    icon: await asset("build/icon.png"),
    lesson: await asset("docs/showcase/lesson.png"),
    presenter: await asset("docs/showcase/presenter.png"),
    editor: await asset("docs/images/screenshots/01-editor.png"),
    banner: await asset("docs/images/social-preview.png"),
  };
  await page(showcaseScript.replaceAll("__SHOWCASE_DIR__", join(appRoot, "docs", "showcase").replaceAll("\\", "\\\\")));
  // Scene set: the short tour (default) or the full training video.
  if (arg("demo-scenes") === "training") await page(trainingScenes);
  const showcaseDir = join(appRoot, "docs", "showcase").replaceAll("\\", "\\\\");
  await page(demoScript.replace("__PLAN__", JSON.stringify(plan)).replace("__ASSETS__", JSON.stringify(assets)).replaceAll("__SHOWCASE_DIR__", showcaseDir));
  await page("window.__demo.setup()");
  await wait(1500);

  const first = Math.round((from / 1000) * fps);
  const last = Math.round((to / 1000) * fps);
  // Frames as Chromium paints them; subscribing also keeps the hidden window painting.
  let latest: Electron.NativeImage | null = null;
  let painted = 0;
  win.webContents.beginFrameSubscription(false, (image) => {
    latest = image;
    painted++;
  });
  /** The frame marker's colour as the page draws it (see demo.page.js). */
  const markerOk = (img: Electron.NativeImage, index: number) => {
    const px = img.crop({ x: 0, y: 0, width: 2, height: 2 }).toBitmap(); // BGRA
    const r = (index % 8) * 32 + 16, g = (Math.floor(index / 8) % 8) * 32 + 16;
    return Math.abs(px[2]! - r) <= 10 && Math.abs(px[1]! - g) <= 10 && Math.abs(px[0]! - 90) <= 10;
  };
  const capture = async (index: number, redraw: () => Promise<unknown>) => {
    // Heavy moments (loading the lesson at 4K) can take a while to paint: keep nudging,
    // redraw the frame every few seconds, and only give up after a minute.
    const started = Date.now();
    let nudged = started;
    for (;;) {
      if (latest && markerOk(latest, index)) return latest as Electron.NativeImage;
      if (Date.now() - started > 60000) throw new Error(`frame ${index} never painted`);
      if (Date.now() - nudged > 4000) {
        nudged = Date.now();
        await redraw();
      }
      win.webContents.invalidate();
      await wait(10);
    }
  };

  if (probe) {
    for (let f = first; f < first + 4; f++) {
      const info = await page(`window.__demo.frame(${(f * 1000) / fps}, ${f})`);
      console.log("probe state", JSON.stringify(info));
      const t0 = Date.now();
      const img = await capture(f, () => page(`window.__demo.frame(${(f * 1000) / fps}, ${f})`));
      await fs.writeFile(join(dir, `probe-${f}.png`), img.toPNG());
      if (f === first) {
        const dom = await page(`(() => { const c = document.getElementById("demo-cursor").getBoundingClientRect(); const s = document.getElementById("demo-sub"); const cv = document.querySelector("[data-preview-host] canvas"); return { cursor: [Math.round(c.left), Math.round(c.top), getComputedStyle(document.getElementById("demo-cursor")).display], sub: s.style.display + " " + s.textContent.slice(0, 20), canvas: cv ? [cv.width, cv.height] : null, ov: !!document.getElementById("demo-ov")?.isConnected }; })()`);
        console.log("probe dom", JSON.stringify(dom));
        for (let i = 0; i < 40; i++) { win.webContents.invalidate(); await wait(40); }
        await fs.writeFile(join(dir, `probe-${f}-late.png`), (latest as Electron.NativeImage | null)!.toPNG());
      }
      console.log(`probe frame ${f}: ${img.getSize().width}×${img.getSize().height} in ${Date.now() - t0} ms`);
    }
    return;
  }

  win.webContents.on("render-process-gone", (_e, d) => console.log("demo: renderer gone", JSON.stringify(d)));
  const out = join(dir, arg("demo-out") ?? "video-only.mp4");
  const ffmpeg = arg("ffmpeg");
  if (!ffmpeg) throw new Error("--ffmpeg=<path> is required");
  let size: { width: number; height: number } | null = null;
  let enc: ReturnType<typeof spawn> | null = null;
  const started = Date.now();
  for (let f = first; f < last; f++) {
    const draw = () => page(`window.__demo.frame(${(f * 1000) / fps}, ${f})`);
    await draw();
    const img = await capture(f, draw);
    const s = img.getSize();
    if (!size) {
      size = s;
      enc = spawn(ffmpeg, ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", `${s.width}x${s.height}`, "-r", String(fps), "-i", "-",
        "-vf", `drawbox=x=0:y=0:w=6:h=6:color=0x15161d:t=fill,scale=${arg("demo-size") ?? "3840:2160"}:flags=lanczos`,
        "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
    } else if (s.width !== size.width || s.height !== size.height) {
      throw new Error(`frame ${f} is ${s.width}×${s.height}, expected ${size.width}×${size.height}`);
    }
    const ok = enc!.stdin!.write(img.toBitmap());
    if (!ok) await new Promise((r) => enc!.stdin!.once("drain", r));
    if (f % Number(arg("demo-log-every") ?? 90) === 0) {
      const done = f - first + 1, per = (Date.now() - started) / done;
      const mem = app.getAppMetrics().map((m) => `${m.type}:${Math.round((m.memory?.workingSetSize ?? 0) / 1024)}MB`).join(" ");
      const heap = await page<{ used: number }>("({ used: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576) })").catch(() => ({ used: -1 }));
      console.log(`demo: memory ${mem} · page heap ${heap.used}MB`);
      console.log(`demo: frame ${f}/${last} (${((f * 1000) / fps / 1000).toFixed(1)} s) · ${per.toFixed(0)} ms/frame · ~${(((last - f) * per) / 60000).toFixed(1)} min left`);
    }
  }
  enc!.stdin!.end();
  await new Promise<void>((resolve, reject) => enc!.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
  console.log(`demo: wrote ${out} (${size?.width}×${size?.height}, ${((last - first) / fps).toFixed(1)} s)`);
}
