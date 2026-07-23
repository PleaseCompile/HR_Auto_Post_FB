import path from "node:path";
import { chromium } from "playwright";

process.env.HR_AUTO_DATA_DIR = path.resolve(
  "test-results",
  `extract-${Date.now()}`,
);
const { extractVisibleGroups } = await import("../dist/group-scanner.js");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(`
  <!doctype html>
  <html>
    <head><base href="https://www.facebook.com/" /></head>
    <body>
      <main>
        <article>
          <a href="https://www.facebook.com/groups/123456/">หางานกรุงเทพมหานคร</a>
        </article>
        <article>
          <div>งานอยุธยา</div>
          <div>เยี่ยมชมล่าสุด 2 ชั่วโมงที่แล้ว</div>
          <a href="/groups/ayutthaya-jobs/">ดูกลุ่ม</a>
        </article>
        <a href="/groups/feed/">Groups feed</a>
        <a href="/groups/123456/posts/999/">Post permalink</a>
      </main>
    </body>
  </html>
`);

const groups = await extractVisibleGroups(page);
if (groups.length !== 2) {
  throw new Error(`Expected 2 groups, found ${groups.length}: ${JSON.stringify(groups)}`);
}
if (
  !groups.some(
    (item) =>
      item.externalId === "123456" &&
      item.name === "หางานกรุงเทพมหานคร" &&
      item.url === "https://www.facebook.com/groups/123456/",
  )
) {
  throw new Error(`Numeric group was not normalized correctly: ${JSON.stringify(groups)}`);
}
if (
  !groups.some(
    (item) =>
      item.externalId === "ayutthaya-jobs" &&
      item.name === "งานอยุธยา",
  )
) {
  throw new Error(`Generic View Group card was not parsed correctly: ${JSON.stringify(groups)}`);
}

await browser.close();
console.log("Group scan extraction test passed");
