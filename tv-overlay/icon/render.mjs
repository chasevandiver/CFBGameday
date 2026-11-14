// Renders icon.html to every size the overlay ships:
//   icon-1024.png                      the master
//   assets/apple-touch-icon.png        the phone remote's home-screen icon
//   res/mipmap-*/ic_launcher.png       the Fire TV launcher icon
//   res/drawable-xhdpi/banner.png      the Fire TV home-row banner (16:9)
// Needs Playwright with Chromium available:
//   node tv-overlay/icon/render.mjs
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const here = dirname(fileURLToPath(import.meta.url));
const main = join(here, "../app/src/main");
const page = pathToFileURL(join(here, "icon.html")).href;

// [output, source width, source height, output width, url hash]
const cuts = [
  [join(here, "icon-1024.png"), 1024, 1024, 1024, ""],
  [join(main, "assets/apple-touch-icon.png"), 1024, 1024, 180, ""],
  [join(main, "res/mipmap-xhdpi/ic_launcher.png"), 1024, 1024, 96, ""],
  [join(main, "res/mipmap-xxhdpi/ic_launcher.png"), 1024, 1024, 144, ""],
  [join(main, "res/mipmap-xxxhdpi/ic_launcher.png"), 1024, 1024, 192, ""],
  [join(main, "res/drawable-xhdpi/banner.png"), 1820, 1024, 640, "#banner"],
];

const browser = await chromium.launch();
for (const [file, w, h, outW, hash] of cuts) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: outW / w,
  });
  const tab = await ctx.newPage();
  await tab.goto(page + hash);
  await tab.waitForLoadState("networkidle");
  await tab.screenshot({ path: file });
  await ctx.close();
  console.log(file);
}
await browser.close();
