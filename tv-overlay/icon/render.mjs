// Renders icon.html to the 1024px master and the 180px apple-touch-icon the
// control server hands an iPhone. Needs Playwright with Chromium available:
//   node tv-overlay/icon/render.mjs
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const here = dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
for (const [size, file] of [
  [1024, join(here, "icon-1024.png")],
  [180, join(here, "../app/src/main/assets/apple-touch-icon.png")],
]) {
  const ctx = await browser.newContext({
    viewport: { width: 1024, height: 1024 },
    deviceScaleFactor: size / 1024,
  });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(join(here, "icon.html")).href);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: file });
  await ctx.close();
  console.log(file);
}
await browser.close();
