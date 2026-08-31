import http from "node:http";
import { chromium } from "playwright";
import {
  ageInDays,
  deletePendingCard,
  markPendingCards,
  parsePendingDate,
} from "../dist/pending-cleaner.js";

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}`);
    return;
  }
  failures += 1;
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

/* ------------------------------------------------------------------ *
 * Date parsing
 * ------------------------------------------------------------------ */

const now = new Date("2026-08-11T12:00:00+07:00");
const days = (value) => ageInDays(parsePendingDate(value, now), now);
const near = (actual, expected, tolerance = 0.6) =>
  actual !== null && Math.abs(actual - expected) <= tolerance;

console.log("Pending date parsing");
check("relative days", Math.round(days("3d")) === 3, String(days("3d")));
check("relative days with space", Math.round(days("14 days")) === 14);
check("relative hours stay under a day", days("6h") < 1 && days("6h") > 0);
check("relative minutes", days("45 minutes") < 0.05);
check("relative weeks", Math.round(days("2w")) === 14);
check("thai days", Math.round(days("5 วัน")) === 5);
check("thai hours", days("3 ชม.") < 1);
check("yesterday", Math.round(days("Yesterday")) === 1);
check("thai yesterday", Math.round(days("เมื่อวาน")) === 1);
// "25 August" with no year, read on 11 August, must resolve to LAST year: Facebook
// never shows a pending post dated in the future.
const AUGUST_25_LAST_YEAR = 351.1;
const MARCH_5_THIS_YEAR = 159.5;

check(
  "english long form",
  near(days("25 August at 08:33"), AUGUST_25_LAST_YEAR),
  String(days("25 August at 08:33")),
);
check(
  "english abbreviation",
  near(days("25 Aug at 08:33"), AUGUST_25_LAST_YEAR),
  String(days("25 Aug at 08:33")),
);
check(
  "month-first form",
  near(days("August 25 at 08:33"), AUGUST_25_LAST_YEAR),
  String(days("August 25 at 08:33")),
);
check(
  "explicit year matches the inferred one",
  near(days("25 August 2025 at 08:33"), AUGUST_25_LAST_YEAR),
  String(days("25 August 2025 at 08:33")),
);
check(
  "thai month",
  near(days("25 สิงหาคม"), AUGUST_25_LAST_YEAR, 0.6),
  String(days("25 สิงหาคม")),
);
check(
  "thai short month",
  near(days("25 ส.ค."), AUGUST_25_LAST_YEAR, 0.6),
  String(days("25 ส.ค.")),
);
check(
  "buddhist era year is converted",
  near(days("25 สิงหาคม 2568"), AUGUST_25_LAST_YEAR, 0.6),
  String(days("25 สิงหาคม 2568")),
);
// The regression this guards: "5 March" must not be read as "5 minutes ago".
check(
  "a month name is never read as a relative unit",
  near(days("5 March"), MARCH_5_THIS_YEAR),
  `5 March -> ${days("5 March")} days`,
);
check(
  "thai month name is never read as a relative unit",
  near(days("5 มีนาคม"), MARCH_5_THIS_YEAR),
  `5 มีนาคม -> ${days("5 มีนาคม")} days`,
);
check(
  "a date with no year never lands in the future",
  days("25 December") > 0,
  String(days("25 December")),
);
check("unreadable text returns null", parsePendingDate("???") === null);
check("empty text returns null", parsePendingDate("") === null);
check("null age for unparsed date", ageInDays(null, now) === null);

/* ------------------------------------------------------------------ *
 * Card extraction against a mock my_pending_content page
 * ------------------------------------------------------------------ */

function card(index, dateLabel, text) {
  return `
    <div class="feed-item">
      <div class="wrapper">
        <div class="story">
          <div class="header">
            <span class="author">Lomnuer Code</span>
            <a role="link" href="/groups/123/posts/${index}/">${dateLabel}</a>
          </div>
          <div class="body"><p>${text}</p></div>
          <div class="actions">
            <div role="button" tabindex="0">Edit</div>
            <div role="button" tabindex="0">Delete</div>
          </div>
        </div>
      </div>
    </div>`;
}

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
    <html lang="en">
      <body>
        <nav role="navigation"><a href="#">Pending<br />4 posts</a></nav>
        <h2 role="heading">Pending · 4</h2>
        <div id="feed">
          ${card(1, "25 August at 08:33", "รับสมัคร รปภ. ด่วน! ชาย - หญิง หน่วยงานเปิดใหม่")}
          ${card(2, "3d", "รับสมัคร รปภ. ประจำวิภาวดี 16 เริ่มงานทันที")}
          ${card(3, "25 สิงหาคม", "หางาน แม่บ้าน ประจำสำนักงาน รายได้ดี")}
          ${card(4, "10 August at 19:02", "รับสมัครพนักงานรักษาความปลอดภัย ด่วนมาก")}
        </div>
        <script>
          // Mirrors the real "Delete post?" modal: it renders a beat late and offers
          // Cancel before Delete, so a non-waiting visibility check misses it.
          document.querySelector("#feed").addEventListener("click", (event) => {
            const button = event.target.closest('[role="button"]');
            if (!button || button.textContent.trim() !== "Delete") return;
            const item = button.closest(".feed-item");
            window.setTimeout(() => {
              const dialog = document.createElement("div");
              dialog.setAttribute("role", "dialog");
              dialog.innerHTML = "<h2>Delete post?</h2><p>Delete this post?</p>";
              const cancel = document.createElement("div");
              cancel.setAttribute("role", "button");
              cancel.textContent = "Cancel";
              cancel.addEventListener("click", () => dialog.remove());
              const confirm = document.createElement("div");
              confirm.setAttribute("role", "button");
              confirm.innerHTML = "<span>Delete</span>";
              confirm.addEventListener("click", () => {
                item.remove();
                dialog.remove();
              });
              dialog.append(cancel, confirm);
              document.body.append(dialog);
            }, 700);
          });
        </script>
      </body>
    </html>`);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Mock server did not start");
const baseUrl = `http://127.0.0.1:${address.port}/`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  console.log("Pending card extraction");
  const cards = await markPendingCards(page);
  check("finds every pending card", cards.length === 4, `got ${cards.length}`);
  check(
    "markers are sequential",
    cards.every((item, index) => item.marker === index),
  );
  check(
    "reads the timestamp off each card",
    cards[0]?.rawDate === "25 August at 08:33" && cards[1]?.rawDate === "3d",
    JSON.stringify(cards.map((item) => item.rawDate)),
  );
  check(
    "reads a snippet of the post body",
    (cards[0]?.snippet || "").includes("รับสมัคร รปภ"),
    cards[0]?.snippet,
  );
  check(
    "snippet drops the action-row labels",
    cards.every((item) => !/^(Edit|Delete)$/.test(item.snippet.trim())),
  );

  // One card per Delete button: the whole feed must never collapse into one card.
  const markerCount = await page.locator("[data-hrauto-pending]").count();
  check("stamps one marker per card", markerCount === 4, `got ${markerCount}`);

  console.log("Pending deletion flow");
  // deletePendingCard is the code path the sweep actually runs, so the delayed modal
  // above is what regressed when confirmation used a non-waiting visibility check.
  const first = await deletePendingCard(page, 1);
  check("confirms the delayed Delete post? modal", first.removed, first.note);
  check(
    "removes exactly one card",
    (await page.locator(".feed-item").count()) === 3,
  );
  check("leaves no modal open", (await page.locator('[role="dialog"]').count()) === 0);

  const remaining = await markPendingCards(page);
  check("re-marking renumbers the survivors", remaining.length === 3);
  check(
    "the deleted card is gone from the list",
    !remaining.some((item) => item.rawDate === "3d"),
    JSON.stringify(remaining.map((item) => item.rawDate)),
  );
  check(
    "markers stay sequential after a delete",
    remaining.every((item, index) => item.marker === index),
  );

  // A modal left open must never be mistaken for a pending card: its Delete button has
  // no Edit sibling, so an unguarded climb would claim <body> as one giant card.
  await page.locator('[data-hrauto-pending-delete="0"]').click();
  await page.locator('[role="dialog"]').waitFor({ state: "visible", timeout: 5_000 });
  const withDialogOpen = await markPendingCards(page);
  check(
    "a stray modal is not counted as a card",
    withDialogOpen.length === 3,
    `got ${withDialogOpen.length}`,
  );
  check(
    "no card swallows the whole page",
    await page.evaluate(
      () => !document.body.hasAttribute("data-hrauto-pending"),
    ),
  );
  await page.locator('[role="dialog"] [role="button"]').first().click();

  const missing = await deletePendingCard(page, 99);
  check("reports a card that is no longer on the page", !missing.removed, missing.note);

} finally {
  await browser.close();
  server.close();
}

if (failures) {
  console.error(`\nPending cleanup test failed (${failures} check${failures > 1 ? "s" : ""})`);
  process.exit(1);
}
console.log("\nPending cleanup test passed");
