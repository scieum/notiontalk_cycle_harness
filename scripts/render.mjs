// scripts/render.mjs — 장면 HTML 을 한 프레임씩 그려 mp4 로 만든다
// 쓰는 법:
//   node scripts/render.mjs <장면.html> <나갈.mp4> [--fps 30] [--from 0] [--to 끝]
//   node scripts/render.mjs <장면.html> --stills 0.5,5,12 <폴더>   (확인용 정지 화면만)
// 장면은 window.__seek(t) · window.__duration · window.__ready 를 내놓아야 한다 (src/scenes/micro-macro.html 참고)
// 필요한 것: playwright (chromium) · ffmpeg
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const fps = Number(opt("--fps", 30));
const stills = opt("--stills", null);
const from = Number(opt("--from", 0));
let to = opt("--to", null);
const [scene, out] = args;
if (!scene || !out) { console.error("쓰는 법: node scripts/render.mjs <장면.html> <나갈.mp4 | 폴더(--stills)>"); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => { console.error("장면 오류:", e.message); process.exit(1); });
await page.goto(pathToFileURL(resolve(scene)).href);
await page.evaluate(() => window.__ready);
const duration = await page.evaluate(() => window.__duration);
to = to === null ? duration : Number(to);

const draw = async (t) => {
  await page.evaluate((t) => window.__seek(t), t);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
};

if (stills) {
  mkdirSync(out, { recursive: true });
  for (const t of stills.split(",").map(Number)) {
    await draw(t);
    const file = join(out, `t${String(t).replace(".", "_")}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: 88 });
    console.log(file);
  }
  await browser.close();
  process.exit(0);
}

mkdirSync(dirname(resolve(out)), { recursive: true });
const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
const frames = Math.round((to - from) * fps);
const started = Date.now();
for (let f = 0; f < frames; f++) {
  await draw(from + f / fps);
  const buf = await page.screenshot({ type: "jpeg", quality: 92 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  if (f % (fps * 5) === 0) console.log(`${(f / fps + from).toFixed(1)}s / ${to}s  (${((Date.now() - started) / 1000).toFixed(0)}초 지남)`);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
await browser.close();
console.log("완료:", out);
