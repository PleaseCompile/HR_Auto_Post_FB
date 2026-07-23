import http from "node:http";
import { chromium } from "playwright";
import { preparePost } from "../dist/facebook.js";

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
    <html lang="en">
      <body>
        <button id="composer">Write something</button>
        <script>
          document.querySelector("#composer").addEventListener("click", () => {
            window.setTimeout(() => {
              const dialog = document.createElement("div");
              dialog.setAttribute("role", "dialog");
              dialog.innerHTML = "<h2>Create post</h2>";
              document.body.append(dialog);
              window.setTimeout(() => {
                const editor = document.createElement("div");
                editor.setAttribute("role", "textbox");
                editor.setAttribute("contenteditable", "true");
                editor.setAttribute("data-lexical-editor", "true");
                editor.setAttribute("aria-placeholder", "Create a public post...");
                dialog.append(editor);
                const post = document.createElement("button");
                post.textContent = "Post";
                dialog.append(post);
              }, 700);
            }, 250);
          });
        </script>
      </body>
    </html>`);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Mock server did not start");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const text = "Delayed Facebook editor test";
  const prepared = await preparePost(
    page,
    {
      id: "draft",
      workDate: "2026-07-23",
      slot: "morning",
      text,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      media: [],
    },
    {
      id: "group",
      name: "Mock group",
      url: `http://127.0.0.1:${address.port}/`,
      province: "",
      tags: [],
      canPost: "unknown",
      requiresApproval: false,
      note: "",
      active: true,
      lastPostedAt: null,
      source: "manual",
      externalId: null,
      scannedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  );
  const editorText = await prepared.dialog.getByRole("textbox").textContent();
  if (editorText !== text) {
    throw new Error(`Expected delayed editor to contain draft text, got ${editorText}`);
  }
  if (await prepared.postButton.isDisabled()) {
    throw new Error("Mock Post button should be enabled");
  }
  console.log("Facebook composer timing test passed");
} finally {
  await browser.close();
  server.close();
}
