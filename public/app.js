const state = {
  route: "dashboard",
  dashboard: null,
  drafts: [],
  groups: [],
  runs: [],
  manualEvidence: [],
  groupScan: null,
  pendingCleanup: null,
  pendingScope: "known-pending",
  pendingCustomSearch: "",
  pendingCustomSelected: new Set(),
  pendingSelected: new Set(),
  pendingSelectionInitFor: null,
  pendingExpanded: new Set(),
  selectedGroups: new Set(),
  editingDraftId: null,
  pendingFiles: [],
  groupSearch: "",
  groupProvince: "",
  groupStatus: "all",
  evidenceTargetId: null,
  selectedRunTargets: new Set(),
  bulkMarkPosted: null,
  evidenceFilters: {
    query: "",
    dateBasis: "work",
    dateFrom: "",
    dateTo: "",
    slot: "all",
    runId: "all",
    groupId: "all",
    source: "all",
    status: "all",
    timeFrom: "",
    timeTo: "",
    view: "run",
    sort: "newest",
  },
};

const routes = {
  dashboard: ["ศูนย์ควบคุม", "ภาพรวมวันนี้"],
  compose: ["Content studio", "สร้างและเตรียมโพสต์"],
  groups: ["Audience workspace", "คลังกลุ่ม"],
  runs: ["Posting queue", "คิวและการทำงาน"],
  pending: ["Pending cleanup", "ล้างโพสต์ที่รออนุมัติ"],
  history: ["Evidence archive", "หลักฐานการโพสต์"],
  settings: ["Local security", "ตั้งค่าและ Session"],
};

const slotLabels = {
  morning: "เช้า",
  midday: "กลางวัน",
  evening: "เย็น",
};

const statusLabels = {
  queued: "รอเริ่ม",
  running: "กำลังทำงาน",
  awaiting_confirmation: "รอยืนยัน",
  paused: "พักชั่วคราว",
  completed: "เสร็จสิ้น",
  stopped: "หยุดแล้ว",
  failed: "ไม่สำเร็จ",
  interrupted: "ถูกขัดจังหวะ",
  opening: "กำลังเปิดกลุ่ม",
  preparing: "กำลังเตรียมโพสต์",
  submitting: "กำลังส่ง",
  published: "เผยแพร่แล้ว",
  pending_review: "รอแอดมินอนุมัติ",
  dry_run_ready: "Dry run ผ่าน",
  manual_action_required: "ต้องตรวจด้วยตนเอง",
  skipped: "ข้ามแล้ว",
};

const app = document.querySelector("#app");
const sessionPill = document.querySelector("#sessionPill");
const pageTitle = document.querySelector("#pageTitle");
const pageEyebrow = document.querySelector("#pageEyebrow");
const toastRegion = document.querySelector("#toastRegion");
const groupDialog = document.querySelector("#groupDialog");
const groupForm = document.querySelector("#groupForm");
const scanDialog = document.querySelector("#scanDialog");
const scanDialogContent = document.querySelector("#scanDialogContent");
const evidenceDialog = document.querySelector("#evidenceDialog");
const evidenceDialogContent = document.querySelector("#evidenceDialogContent");
let groupFilterFrame = 0;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value, withTime = false) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00+07:00` : value);
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function dateKeyBangkok(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function timeKeyBangkok(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function todayBangkok() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function currentSlot() {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date()),
  );
  if (hour < 12) return "morning";
  if (hour < 17) return "midday";
  return "evening";
}

function windowBatchSummary(total, limit = 30) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeLimit = Math.min(30, Math.max(1, Number(limit) || 30));
  const batches = [];
  for (let remaining = safeTotal; remaining > 0; remaining -= safeLimit) {
    batches.push(Math.min(safeLimit, remaining));
  }
  return {
    count: batches.length,
    batches,
    text: `${safeTotal.toLocaleString("th-TH")} กลุ่ม → ${batches.length.toLocaleString("th-TH")} หน้าต่าง (${batches.join(" + ") || "0"} แท็บ)`,
  };
}

function truncate(value, length = 70) {
  if (!value) return "ยังไม่มีข้อความ";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function findTargetContext(targetId) {
  for (const run of state.runs) {
    const target = (run.targets || []).find((item) => item.id === targetId);
    if (target) return { run, target };
  }
  return null;
}

function isBulkMarkable(run, target) {
  const active = ["running", "awaiting_confirmation", "paused"].includes(
    run.status,
  );
  return (
    active &&
    (target.status === "awaiting_confirmation" ||
      (run.workflow === "hybrid-windows" &&
        target.status === "manual_action_required"))
  );
}

function pruneRunTargetSelection() {
  const selectable = new Set(
    state.runs.flatMap((run) =>
      (run.targets || [])
        .filter((target) => isBulkMarkable(run, target))
        .map((target) => target.id),
    ),
  );
  for (const targetId of state.selectedRunTargets) {
    if (!selectable.has(targetId)) state.selectedRunTargets.delete(targetId);
  }
}

function manualEvidenceForTarget(targetId) {
  return state.manualEvidence.filter((item) => item.targetId === targetId);
}

function evidenceCountForTarget(target) {
  return Number(Boolean(target.evidencePath)) + manualEvidenceForTarget(target.id).length;
}

function statusClass(status) {
  if (["published", "completed", "dry_run_ready"].includes(status)) return "success";
  if (["failed", "stopped"].includes(status)) return "danger";
  if (["awaiting_confirmation", "pending_review", "paused", "manual_action_required"].includes(status)) {
    return "warning";
  }
  return "info";
}

function visualState(status) {
  if (["published", "completed", "dry_run_ready"].includes(status)) return "done";
  if (["failed"].includes(status)) return "failed";
  if (
    ["awaiting_confirmation", "pending_review", "paused", "manual_action_required"].includes(
      status,
    )
  ) {
    return "attention";
  }
  if (["running", "opening", "preparing", "submitting"].includes(status)) return "active";
  return "neutral";
}

function toast(message, type = "success") {
  const item = document.createElement("div");
  item.className = `toast ${type === "error" ? "error" : ""}`;
  item.textContent = message;
  toastRegion.append(item);
  window.setTimeout(() => item.remove(), 4500);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
  return body;
}

async function refreshAll() {
  const [dashboard, drafts, groups, runs, groupScan, manualEvidence, pendingCleanup] =
    await Promise.all([
      api("/api/dashboard"),
      api("/api/drafts"),
      api("/api/groups"),
      api("/api/runs"),
      api("/api/groups/scan"),
      api("/api/manual-evidence"),
      api("/api/pending-cleanup"),
    ]);
  state.dashboard = dashboard;
  state.drafts = drafts;
  state.groups = groups;
  state.runs = runs;
  pruneRunTargetSelection();
  state.groupScan = groupScan;
  state.manualEvidence = manualEvidence;
  state.pendingCleanup = pendingCleanup;
  renderSession(dashboard.session);
}

function renderSession(session) {
  sessionPill.className = "session-pill";
  if (session.authenticated) {
    sessionPill.classList.add("is-ready");
    sessionPill.innerHTML = `<span class="status-dot"></span><span>Facebook พร้อมใช้งาน</span>`;
  } else if (session.profileLocked && !session.browserOpen) {
    sessionPill.classList.add("is-warning");
    sessionPill.innerHTML = `<span class="status-dot"></span><span>Profile ใช้อยู่ใน PID ${escapeHtml(session.ownerPid || "อื่น")}</span>`;
  } else if (session.browserOpen) {
    sessionPill.classList.add("is-warning");
    sessionPill.innerHTML = `<span class="status-dot"></span><span>รอคุณล็อกอิน</span>`;
  } else {
    sessionPill.classList.add("is-warning");
    sessionPill.innerHTML = `<span class="status-dot"></span><span>ยังไม่เชื่อมต่อ</span>`;
  }
}

function navigate(route) {
  state.route = route;
  const [eyebrow, title] = routes[route] || routes.dashboard;
  pageEyebrow.textContent = eyebrow;
  pageTitle.textContent = title;
  document.querySelectorAll(".nav-item[data-route]").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.route === route);
  });
  render();
}

function render() {
  const renderer = {
    dashboard: renderDashboard,
    compose: renderCompose,
    groups: renderGroups,
    runs: renderRuns,
    pending: renderPendingCleanup,
    history: renderHistory,
    settings: renderSettings,
  }[state.route];
  app.innerHTML = renderer ? renderer() : renderDashboard();
  bindRouteEvents();
}

function metricCard(label, value, caption, icon) {
  return `
    <article class="metric-card">
      <div class="metric-top"><span>${escapeHtml(label)}</span><span class="metric-icon">${icon}</span></div>
      <div class="metric-value">${value}</div>
      <div class="metric-caption">${escapeHtml(caption)}</div>
    </article>
  `;
}

function renderDashboard() {
  const summary = state.dashboard?.summary || {
    today: todayBangkok(),
    draftCount: 0,
    groupCount: 0,
    runCount: 0,
    successCount: 0,
  };
  const todayDrafts = state.drafts.filter((draft) => draft.workDate === summary.today);
  const slots = ["morning", "midday", "evening"]
    .map((slot) => {
      const draft = todayDrafts.find((item) => item.slot === slot);
      const symbol = slot === "morning" ? "AM" : slot === "midday" ? "NO" : "PM";
      return `
        <div class="slot-row">
          <div class="slot-symbol ${slot}">${symbol}</div>
          <div class="slot-copy">
            <strong>${slotLabels[slot]}</strong>
            <span>${escapeHtml(truncate(draft?.text, 76))}</span>
          </div>
          <button class="button button-small ${draft ? "button-ghost" : "button-secondary"}"
            data-action="${draft ? "edit-draft" : "new-slot"}"
            data-id="${draft?.id || ""}" data-slot="${slot}">
            ${draft ? "แก้ไข" : "สร้างโพสต์"}
          </button>
        </div>
      `;
    })
    .join("");

  const activities = state.runs.slice(0, 5).length
    ? state.runs
        .slice(0, 5)
        .map(
          (run) => `
            <div class="activity-item">
              <strong>${slotLabels[run.draft?.slot] || "คิวโพสต์"} · ${run.targets?.length || 0} กลุ่ม</strong>
              <span>${statusLabels[run.status] || run.status} · ${formatDate(run.createdAt, true)}</span>
            </div>
          `,
        )
        .join("")
    : `<div class="empty-state" style="min-height:220px"><p>ยังไม่มีกิจกรรมวันนี้</p></div>`;

  return `
    <section class="metric-grid">
      ${metricCard("โพสต์วันนี้", summary.draftCount, "Draft เช้า กลางวัน และเย็น", "D")}
      ${metricCard("กลุ่มพร้อมใช้", summary.groupCount, "เฉพาะกลุ่มที่เปิดใช้งาน", "G")}
      ${metricCard("คิววันนี้", summary.runCount, "รวม Dry run และ Assisted", "Q")}
      ${metricCard("หลักฐานทั้งหมด", summary.successCount, "เผยแพร่หรือรออนุมัติ", "E")}
    </section>
    <section class="dashboard-grid">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>แผนโพสต์ประจำวัน</h2>
            <p>${formatDate(summary.today)} · เลือกหนึ่งช่วงเวลาเพื่อเริ่มเตรียมงาน</p>
          </div>
          <button class="button button-small button-ghost" data-action="go-compose">ดู Draft ทั้งหมด</button>
        </div>
        <div class="slot-list">${slots}</div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>กิจกรรมล่าสุด</h2>
            <p>สถานะจากคิวที่เพิ่งทำงาน</p>
          </div>
          <button class="button button-small button-ghost" data-action="go-runs">ดูคิว</button>
        </div>
        <div class="activity-list">${activities}</div>
      </div>
    </section>
  `;
}

function renderCompose() {
  const draft = state.editingDraftId
    ? state.drafts.find((item) => item.id === state.editingDraftId)
    : null;
  const workDate = draft?.workDate || todayBangkok();
  const slot = draft?.slot || currentSlot();
  const text = draft?.text || "";
  const existingMedia = (draft?.media || [])
    .map(
      (media) => `
        <div class="media-thumb">
          <img src="/api/media/${media.id}" alt="${escapeHtml(media.fileName)}" />
          <button type="button" class="media-remove" data-action="delete-media" data-id="${media.id}" aria-label="ลบรูป">×</button>
        </div>
      `,
    )
    .join("");

  return `
    <div class="page-header">
      <div>
        <h2>${draft ? "แก้ไข Draft" : "สร้าง Draft ใหม่"}</h2>
        <p class="muted">เตรียมข้อความและรูปให้เรียบร้อยก่อนเลือกกลุ่ม</p>
      </div>
      ${
        draft
          ? `<button class="button button-ghost" data-action="clear-draft">สร้าง Draft ใหม่</button>`
          : ""
      }
    </div>
    <div class="compose-layout">
      <form class="panel form-card" id="draftForm">
        <div class="form-grid">
          <label class="field">
            <span>วันที่ทำงาน</span>
            <input type="date" name="workDate" value="${workDate}" required />
          </label>
          <label class="field">
            <span>ช่วงเวลา</span>
            <select name="slot">
              ${Object.entries(slotLabels)
                .map(([value, label]) => `<option value="${value}" ${value === slot ? "selected" : ""}>${label}</option>`)
                .join("")}
            </select>
          </label>
          <label class="field field-wide">
            <span>ข้อความโพสต์</span>
            <textarea class="text-editor" name="text" id="draftText" required maxlength="20000"
              placeholder="ใส่รายละเอียดตำแหน่งงาน คุณสมบัติ วิธีสมัคร และข้อมูลติดต่อ…">${escapeHtml(text)}</textarea>
            <div class="field-meta"><span>ตรวจชื่อ ตำแหน่ง เบอร์โทร และลิงก์ก่อนบันทึก</span><span id="charCount">${text.length.toLocaleString("th-TH")} ตัวอักษร</span></div>
          </label>
          <div class="field field-wide">
            <span>รูปภาพ</span>
            <label class="dropzone">
              <input type="file" id="draftImages" accept="image/jpeg,image/png,image/webp,image/gif" multiple />
              <div><strong>เลือกหรือลากรูปมาวาง</strong><span>สูงสุด 10 รูป · รูปละไม่เกิน 20 MB</span></div>
            </label>
          </div>
          <div class="media-grid field-wide" id="mediaGrid">${existingMedia}</div>
        </div>
        <div class="form-actions">
          <button type="submit" class="button button-ghost" data-save-mode="stay">บันทึก Draft</button>
          <button type="submit" class="button button-primary" data-save-mode="groups">บันทึกแล้วเลือกกลุ่ม</button>
        </div>
      </form>
      <aside class="panel preview-card">
        <div class="preview-head">
          <div class="avatar">HR</div>
          <div><strong>ตัวอย่างโพสต์</strong><span>Preview ก่อนส่งไป Facebook</span></div>
        </div>
        <div class="preview-copy ${text ? "" : "preview-placeholder"}" id="previewCopy">${escapeHtml(text || "ข้อความที่กรอกจะแสดงตรงนี้…")}</div>
        <div class="preview-media" id="previewMedia">
          ${(draft?.media || []).slice(0, 4).map((media) => `<img src="/api/media/${media.id}" alt="" />`).join("")}
        </div>
      </aside>
    </div>
    ${
      state.drafts.length
        ? `
          <div class="panel" style="margin-top:20px">
            <div class="panel-header"><div><h2>Draft ล่าสุด</h2><p>เปิดแก้ไขงานที่บันทึกไว้</p></div></div>
            <div class="activity-list">
              ${state.drafts.slice(0, 6).map((item) => `
                <div class="slot-row">
                  <div class="slot-symbol ${item.slot}">${item.slot === "morning" ? "AM" : item.slot === "midday" ? "NO" : "PM"}</div>
                  <div class="slot-copy"><strong>${formatDate(item.workDate)} · ${slotLabels[item.slot]}</strong><span>${escapeHtml(truncate(item.text, 95))}</span></div>
                  <button class="button button-small button-ghost" data-action="edit-draft" data-id="${item.id}">เปิดแก้ไข</button>
                </div>
              `).join("")}
            </div>
          </div>
        `
        : ""
    }
  `;
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("th-TH")
    .replace(/[.,()[\]{}:;\\/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSearchQuery(value) {
  return String(value || "")
    .split("|")
    .map((clause) => {
      const terms = [];
      const matcher = /(-?)"([^"]+)"|(-?)(\S+)/g;
      let match;
      while ((match = matcher.exec(clause))) {
        const text = normalizeSearchText(match[2] || match[4]);
        if (!text) continue;
        terms.push({ exclude: (match[1] || match[3]) === "-", text });
      }
      return terms;
    })
    .filter((terms) => terms.length);
}

function matchesGroupSearch(group, query) {
  const clauses = parseSearchQuery(query);
  if (!clauses.length) return true;
  const haystack = normalizeSearchText([
    group.name,
    group.province,
    group.note,
    ...group.tags,
  ].join(" "));
  return clauses.some((terms) =>
    terms.every((term) =>
      term.exclude ? !haystack.includes(term.text) : haystack.includes(term.text),
    ),
  );
}

function filteredGroups() {
  return state.groups.filter((group) => {
    return (
      matchesGroupSearch(group, state.groupSearch) &&
      (!state.groupProvince || group.province === state.groupProvince) &&
      (state.groupStatus === "all" || group.canPost === state.groupStatus)
    );
  });
}

function renderGroupRows(groups) {
  if (!groups.length) {
    return `<tr><td colspan="6"><div class="empty-state"><p>ไม่พบกลุ่มที่ตรงกับตัวกรอง</p><button class="button button-primary" data-action="add-group">เพิ่มกลุ่มแรก</button></div></td></tr>`;
  }
  return groups
    .map((group) => {
      const canPost =
        group.canPost === "yes"
          ? ["โพสต์ได้", "success"]
          : group.canPost === "no"
            ? ["โพสต์ไม่ได้", "danger"]
            : ["ยังไม่ตรวจ", "warning"];
      return `
        <tr>
          <td class="col-check"><input type="checkbox" class="group-check" value="${group.id}" ${state.selectedGroups.has(group.id) ? "checked" : ""} /></td>
          <td>
            <div class="group-name">
              <div class="group-avatar">${escapeHtml(group.name.slice(0, 1).toUpperCase())}</div>
              <div style="min-width:0">
                <strong title="${escapeHtml(group.name)}">${escapeHtml(group.name)}</strong>
                <a href="${escapeHtml(group.url)}" target="_blank" rel="noreferrer">เปิด Facebook ↗</a>
                <span class="source-label">${
                  group.source === "automatic_scan"
                    ? `พบจาก Auto scan${group.scannedAt ? ` · ${formatDate(group.scannedAt, true)}` : ""}`
                    : group.source === "csv"
                      ? "นำเข้าจาก CSV"
                      : "เพิ่มด้วยตนเอง"
                }</span>
              </div>
            </div>
          </td>
          <td>${escapeHtml(group.province || "—")}</td>
          <td><div class="tag-list">${group.tags.length ? group.tags.slice(0, 4).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("") : '<span class="muted">—</span>'}</div></td>
          <td><span class="badge ${canPost[1]}">${canPost[0]}</span>${group.requiresApproval ? '<br><span class="badge warning" style="margin-top:4px">รออนุมัติ</span>' : ""}</td>
          <td class="nowrap">${group.lastPostedAt ? formatDate(group.lastPostedAt, true) : "ยังไม่เคย"}</td>
        </tr>
      `;
    })
    .join("");
}

function updateGroupResults() {
  const groups = filteredGroups();
  const resultCount = document.querySelector("#groupResultCount");
  const tableBody = document.querySelector("#groupTableBody");
  if (resultCount) {
    resultCount.textContent = `แสดง ${groups.length.toLocaleString("th-TH")} รายการ`;
  }
  if (tableBody) tableBody.innerHTML = renderGroupRows(groups);
  const selectAll = document.querySelector("#selectAllGroups");
  if (selectAll) {
    const selectedVisible = groups.filter((group) => state.selectedGroups.has(group.id)).length;
    selectAll.checked = groups.length > 0 && selectedVisible === groups.length;
    selectAll.indeterminate = selectedVisible > 0 && selectedVisible < groups.length;
  }
}

function scheduleGroupResultsUpdate() {
  window.cancelAnimationFrame(groupFilterFrame);
  groupFilterFrame = window.requestAnimationFrame(updateGroupResults);
}

function renderGroups() {
  const provinces = [...new Set(state.groups.map((group) => group.province).filter(Boolean))].sort();
  const groups = filteredGroups();
  const selected = state.selectedGroups.size;
  return `
    <div class="page-header">
      <div>
        <h2>คลังกลุ่มทั้งหมด</h2>
        <p class="muted">${state.groups.length.toLocaleString("th-TH")} กลุ่ม · เลือกได้หลายกลุ่มและสร้างคิวจากหน้านี้</p>
      </div>
      <div class="toolbar-end">
        <input type="file" id="csvInput" accept=".csv,text/csv" hidden />
        <button class="button button-secondary" data-action="open-scan">${
          ["running", "stopping"].includes(state.groupScan?.status)
            ? `กำลังสแกน ${state.groupScan.foundCount} กลุ่ม`
            : "สแกนจาก Facebook"
        }</button>
        <button class="button button-ghost" data-action="import-csv">นำเข้า CSV</button>
        <button class="button button-primary" data-action="add-group">เพิ่มกลุ่ม</button>
      </div>
    </div>
    <div class="toolbar">
      <div class="toolbar-start">
        <div class="group-search-wrap">
          <label class="search-box"><input id="groupSearch" type="search" autocomplete="off" placeholder="ค้นหาหลายคำ เช่น หางาน รปภ อยุธยา" value="${escapeHtml(state.groupSearch)}" /></label>
          <span class="search-guidance">เว้นวรรค = ต้องมีครบทุกคำ · | = หรือ · “...” = วลีตรงกัน · -คำ = ไม่เอาคำนี้</span>
        </div>
        <select id="provinceFilter" style="width:170px">
          <option value="">ทุกพื้นที่</option>
          ${provinces.map((province) => `<option ${state.groupProvince === province ? "selected" : ""}>${escapeHtml(province)}</option>`).join("")}
        </select>
        <select id="statusFilter" style="width:170px">
          <option value="all">ทุกสถานะ</option>
          <option value="yes" ${state.groupStatus === "yes" ? "selected" : ""}>โพสต์ได้</option>
          <option value="unknown" ${state.groupStatus === "unknown" ? "selected" : ""}>ยังไม่ตรวจสอบ</option>
          <option value="no" ${state.groupStatus === "no" ? "selected" : ""}>โพสต์ไม่ได้</option>
        </select>
      </div>
      <div class="toolbar-end"><span id="groupResultCount" class="muted" style="font-size:11px" aria-live="polite">แสดง ${groups.length.toLocaleString("th-TH")} รายการ</span></div>
    </div>
    ${
      selected
        ? `
          <div class="selection-bar">
            <strong>เลือกแล้ว ${selected.toLocaleString("th-TH")} กลุ่ม</strong>
            <div class="toolbar-end">
              <select id="runDraft" style="width:290px">
                <option value="">เลือก Draft สำหรับคิวนี้</option>
                ${state.drafts.map((draft) => `<option value="${draft.id}">${formatDate(draft.workDate)} · ${slotLabels[draft.slot]} · ${escapeHtml(truncate(draft.text, 38))}</option>`).join("")}
              </select>
              <select id="runMode" style="width:310px">
                <option value="assisted">โพสต์จริงแบบ Assisted — รอยืนยันทุกกลุ่ม</option>
                <option value="dry-run">Dry run — ตรวจกลุ่มเท่านั้น ไม่โพสต์</option>
              </select>
              <select id="runWorkflow" style="width:270px">
                <option value="hybrid-tabs">Hybrid แนะนำ — เติมงานต่อเนื่อง</option>
                <option value="hybrid-windows">หลายหน้าต่าง — ไม่ปิดแท็บเอง</option>
              </select>
              <select id="runTabLimit" style="width:190px" aria-label="จำนวนแท็บพร้อมกัน">
                <option value="8">พร้อมกัน 8 แท็บ</option>
                <option value="10" selected>พร้อมกัน 10 แท็บ (แนะนำ)</option>
                <option value="15">พร้อมกัน 15 แท็บ</option>
                <option value="20">พร้อมกัน 20 แท็บ</option>
                <option value="30">พร้อมกัน 30 แท็บ (ขั้นสูง)</option>
              </select>
              <label class="auto-confirm-label" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;margin-left:4px" title="เมื่อเปิดโหมดนี้ ระบบจะทยอยกดโพสต์ให้อัตโนมัติโดยไม่ต้องกด 'ยืนยันและโพสต์' เองทีละกลุ่ม">
                <input type="checkbox" id="runAutoConfirm" />
                <span>โพสต์อัตโนมัติ (Auto-confirm)</span>
              </label>
              <span id="runWindowPlan" class="muted" style="font-size:11px" hidden></span>
              <button class="button button-primary" data-action="create-run">สร้างคิวโพสต์</button>
              <button class="button button-danger" data-action="restart-draft-run" title="ลบทุกคิวเดิมของ Draft ที่เลือก แล้วสร้างคิวใหม่จากกลุ่มที่เลือกอยู่">
                ล้างคิวเดิมทั้งหมดและสร้างใหม่
              </button>
              <button class="button button-ghost" data-action="clear-selection">ล้างที่เลือก</button>
            </div>
          </div>
        `
        : ""
    }
    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th class="col-check"><input type="checkbox" id="selectAllGroups" aria-label="เลือกทั้งหมดในผลค้นหา" /></th>
            <th style="width:31%">ชื่อกลุ่ม</th>
            <th style="width:13%">พื้นที่</th>
            <th style="width:22%">แท็ก</th>
            <th style="width:14%">สิทธิ์โพสต์</th>
            <th>โพสต์ล่าสุด</th>
          </tr>
        </thead>
        <tbody id="groupTableBody">${renderGroupRows(groups)}</tbody>
      </table>
    </div>
  `;
}

function renderScanDialog() {
  const scan = state.groupScan || {
    status: "idle",
    foundCount: 0,
    newCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    scrollCount: 0,
    message: "พร้อมเริ่มสแกน",
  };
  const sessionReady = Boolean(state.dashboard?.session?.authenticated);
  const working = ["running", "stopping"].includes(scan.status);
  const metrics = `
    <div class="scan-metrics">
      <div class="scan-metric"><span>พบทั้งหมด</span><strong>${scan.foundCount || 0}</strong></div>
      <div class="scan-metric"><span>กลุ่มใหม่</span><strong>${scan.newCount || 0}</strong></div>
      <div class="scan-metric"><span>อัปเดต</span><strong>${scan.updatedCount || 0}</strong></div>
      <div class="scan-metric"><span>ข้อมูลเดิม</span><strong>${scan.unchangedCount || 0}</strong></div>
    </div>
  `;

  if (working) {
    scanDialogContent.innerHTML = `
      <div class="scan-intro">
        <strong>${scan.status === "stopping" ? "กำลังหยุดการสแกน" : "Playwright กำลังสแกน Joined Groups"}</strong>
        <span>คุณดูความคืบหน้าได้ในหน้าต่าง Chromium ระบบจะหยุดเองเมื่อเลื่อนแล้วไม่พบกลุ่มเพิ่ม</span>
      </div>
      <div class="scan-progress"></div>
      <div class="scan-message">${escapeHtml(scan.message)} · รอบที่ ${scan.scrollCount || 0}</div>
      ${metrics}
      <div class="modal-actions">
        <button class="button button-danger" data-action="stop-scan" ${scan.status === "stopping" ? "disabled" : ""}>หยุดและบันทึกที่พบ</button>
      </div>
    `;
    return;
  }

  const result =
    scan.status === "completed"
      ? `
        <div class="status-callout">
          <div>✓</div>
          <div>
            <strong>สแกนล่าสุดเสร็จแล้ว</strong>
            <span>${escapeHtml(scan.message)}${scan.finishedAt ? ` · ${formatDate(scan.finishedAt, true)}` : ""}</span>
          </div>
        </div>
        ${metrics}
      `
      : scan.status === "failed"
        ? `
          <div class="status-callout warning">
            <div>!</div>
            <div><strong>สแกนล่าสุดไม่สำเร็จ</strong><span>${escapeHtml(scan.error || "กรุณาตรวจหน้าต่าง Facebook")}</span></div>
          </div>
        `
        : "";

  scanDialogContent.innerHTML = `
    ${result}
    <div class="scan-intro" style="${result ? "margin-top:16px" : ""}">
      <strong>ดึงเฉพาะรายการกลุ่มที่บัญชีนี้เข้าถึงได้</strong>
      <span>ระบบจะเปิดหน้า Joined Groups, เลื่อนรายการอัตโนมัติ และบันทึกชื่อกลุ่ม, URL, Group ID และเวลาที่พบลง SQLite พร้อม JSON snapshot</span>
    </div>
    <div class="scan-scope">
      <div class="scan-scope-item"><strong>ไม่เก็บสมาชิก</strong><span>ไม่อ่านรายชื่อสมาชิกหรือข้อมูลโปรไฟล์</span></div>
      <div class="scan-scope-item"><strong>ไม่เก็บโพสต์</strong><span>ไม่อ่านหรือสำรองเนื้อหาในกลุ่ม</span></div>
      <div class="scan-scope-item"><strong>ไม่ทับข้อมูลคุณ</strong><span>จังหวัด แท็ก กฎ และหมายเหตุจะคงเดิม</span></div>
    </div>
    ${
      sessionReady
        ? `
          <label class="scan-consent">
            <input type="checkbox" id="scanAck" />
            <span>ฉันยืนยันว่าใช้บัญชีของตนเองและมีสิทธิ์เข้าถึงกลุ่มเหล่านี้ และต้องการสั่งสแกนครั้งนี้ด้วยตนเอง</span>
          </label>
        `
        : `
          <div class="status-callout warning">
            <div>!</div>
            <div><strong>Facebook Session ยังไม่พร้อม</strong><span>ไปที่ตั้งค่าและ Session แล้วล็อกอินใน Chromium ก่อนเริ่มสแกน</span></div>
          </div>
        `
    }
    <div class="modal-actions">
      ${scan.snapshotPath ? `<a class="button button-ghost" href="/api/groups/scan/snapshot">ดาวน์โหลด JSON ล่าสุด</a>` : ""}
      <button class="button button-ghost" data-action="close-scan">${scan.status === "completed" ? "ปิดและดูคลังกลุ่ม" : "ยกเลิก"}</button>
      <button class="button button-primary" data-action="start-scan" ${sessionReady ? "" : "disabled"}>${scan.status === "completed" || scan.status === "failed" ? "สแกนอีกครั้ง" : "เริ่มสแกน"}</button>
    </div>
  `;
}

const pendingScopeLabels = {
  "known-pending": "กลุ่มที่ระบบรู้ว่ามีของค้าง",
  posted: "กลุ่มที่เคยโพสต์",
  all: "ทุกกลุ่มในคลัง",
  custom: "เลือกเองจากคลังกลุ่ม",
};

const pendingGroupStatusLabels = {
  queued: "รอตรวจ",
  scanning: "กำลังตรวจ",
  scanned: "ตรวจแล้ว",
  deleting: "กำลังลบ",
  done: "ลบเสร็จ",
  failed: "ไม่สำเร็จ",
  skipped: "ข้าม",
};

const pendingPostStatusLabels = {
  found: "รอลบ",
  deleted: "ลบแล้ว",
  failed: "ไม่สำเร็จ",
  skipped: "ข้ามไว้",
};

function emptyPendingCleanup() {
  return {
    id: null,
    status: "idle",
    scope: "known-pending",
    deleteMode: "all",
    olderThanDays: 7,
    groupsTotal: 0,
    groupsScanned: 0,
    groupsWithPending: 0,
    pendingFound: 0,
    deleteGroupsTotal: 0,
    deleteGroupsDone: 0,
    deletedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    message: "พร้อมตรวจหาโพสต์ที่ค้างรออนุมัติ",
    snapshotPath: null,
    error: null,
    groups: [],
    scopeCounts: { knownPending: 0, posted: 0, all: 0 },
  };
}

/**
 * Seeds the checkbox selection from whatever the sweep marked, but only once per
 * cleanup run so a poll cannot undo the boxes the user just ticked.
 */
function syncPendingSelection(cleanup) {
  if (!cleanup.id || state.pendingSelectionInitFor === cleanup.id) return;
  if (!(cleanup.groups || []).length) return;
  state.pendingSelected = new Set(
    (cleanup.groups || [])
      .filter((group) => group.selected && group.pendingCount > 0)
      .map((group) => group.id),
  );
  state.pendingSelectionInitFor = cleanup.id;
}

function pendingCustomGroups() {
  const query = state.pendingCustomSearch.trim().toLowerCase();
  const pool = state.groups.filter((group) => group.externalId);
  if (!query) return pool.slice(0, 200);
  return pool
    .filter((group) =>
      `${group.name} ${group.province} ${(group.tags || []).join(" ")}`
        .toLowerCase()
        .includes(query),
    )
    .slice(0, 200);
}

function renderPendingSetup(cleanup, sessionReady) {
  const counts = cleanup.scopeCounts || { knownPending: 0, posted: 0, all: 0 };
  const scope = state.pendingScope;
  const scopeCount =
    scope === "known-pending"
      ? counts.knownPending
      : scope === "posted"
        ? counts.posted
        : scope === "all"
          ? counts.all
          : state.pendingCustomSelected.size;
  const minutes = Math.max(1, Math.round((scopeCount * 8) / 60));

  return `
    <section class="panel pending-setup">
      <div class="panel-head">
        <div>
          <h3>1 · เลือกขอบเขตแล้วตรวจหาโพสต์ค้าง</h3>
          <p class="muted">ระบบจะเปิดหน้า “โพสต์ของฉันที่รออนุมัติ” ของแต่ละกลุ่มเพื่อนับของค้าง ยังไม่ลบอะไรในขั้นนี้</p>
        </div>
      </div>
      <div class="pending-scope-grid">
        ${[
          ["known-pending", counts.knownPending, "เร็วที่สุด · ใช้ประวัติการโพสต์เป็นตัวตั้ง"],
          ["posted", counts.posted, "ครอบคลุมกว่า · รวมกลุ่มที่ระบบไม่ได้บันทึกสถานะ"],
          ["all", counts.all, "กวาดครบทุกกลุ่ม ไม่มีตกหล่น"],
          ["custom", state.pendingCustomSelected.size, "ค้นหาและติ๊กเลือกเอง"],
        ]
          .map(
            ([value, count, hint]) => `
              <label class="pending-scope-card ${state.pendingScope === value ? "is-active" : ""}">
                <input type="radio" name="pendingScope" value="${value}" ${
                  state.pendingScope === value ? "checked" : ""
                } />
                <div>
                  <strong>${escapeHtml(pendingScopeLabels[value])}</strong>
                  <span class="pending-scope-count">${Number(count).toLocaleString("th-TH")} กลุ่ม</span>
                  <span class="muted">${escapeHtml(hint)}</span>
                </div>
              </label>
            `,
          )
          .join("")}
      </div>
      ${
        scope === "custom"
          ? `
            <div class="pending-custom">
              <label class="search-box">
                <input id="pendingCustomSearch" type="search" autocomplete="off" placeholder="ค้นหากลุ่มที่ต้องการตรวจ" value="${escapeHtml(state.pendingCustomSearch)}" />
              </label>
              <div class="pending-custom-list">
                ${
                  pendingCustomGroups()
                    .map(
                      (group) => `
                        <label class="pending-custom-item">
                          <input type="checkbox" data-action="toggle-pending-custom" data-id="${group.id}" ${
                            state.pendingCustomSelected.has(group.id) ? "checked" : ""
                          } />
                          <span>${escapeHtml(group.name)}</span>
                          <span class="muted">${escapeHtml(group.province || "—")}</span>
                        </label>
                      `,
                    )
                    .join("") || `<p class="muted">ไม่พบกลุ่มที่ตรงกับคำค้น</p>`
                }
              </div>
              <p class="muted">เลือกแล้ว ${state.pendingCustomSelected.size.toLocaleString("th-TH")} กลุ่ม · แสดงสูงสุด 200 รายการต่อการค้นหา</p>
            </div>
          `
          : ""
      }
      <div class="pending-actions">
        <span class="muted">${
          scopeCount
            ? `จะเปิดตรวจ ${scopeCount.toLocaleString("th-TH")} กลุ่ม · ใช้เวลาประมาณ ${minutes} นาที`
            : "ยังไม่มีกลุ่มในขอบเขตนี้"
        }</span>
        <button class="button button-primary" data-action="start-pending-scan" ${
          sessionReady && scopeCount ? "" : "disabled"
        }>เริ่มตรวจหาโพสต์ค้าง</button>
      </div>
      ${sessionReady ? "" : `<p class="muted">ต้องเชื่อมต่อและล็อกอิน Facebook ก่อนจึงจะเริ่มตรวจได้</p>`}
    </section>
  `;
}

function renderPendingProgress(cleanup, mode) {
  const scanning = mode === "scan";
  const done = scanning ? cleanup.groupsScanned : cleanup.deleteGroupsDone;
  const total = scanning ? cleanup.groupsTotal : cleanup.deleteGroupsTotal;
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return `
    <section class="panel pending-progress">
      <div class="panel-head">
        <div>
          <h3>${scanning ? "กำลังตรวจหาโพสต์ค้าง" : "กำลังลบโพสต์ค้าง"}</h3>
          <p class="muted">${escapeHtml(cleanup.message)}</p>
        </div>
        <button class="button button-danger" data-action="${
          scanning ? "stop-pending-scan" : "stop-pending-delete"
        }" ${cleanup.status.startsWith("stopping") ? "disabled" : ""}>
          ${cleanup.status.startsWith("stopping") ? "กำลังหยุด…" : "หยุดหลังจบรายการปัจจุบัน"}
        </button>
      </div>
      <div class="pending-bar"><span style="width:${percent}%"></span></div>
      <div class="scan-metrics">
        <div class="scan-metric"><span>${scanning ? "ตรวจแล้ว" : "ลบแล้ว (กลุ่ม)"}</span><strong>${done}/${total}</strong></div>
        ${
          scanning
            ? `<div class="scan-metric"><span>กลุ่มที่มีของค้าง</span><strong>${cleanup.groupsWithPending}</strong></div>
               <div class="scan-metric"><span>โพสต์ค้างที่พบ</span><strong>${cleanup.pendingFound}</strong></div>`
            : `<div class="scan-metric"><span>ลบสำเร็จ</span><strong>${cleanup.deletedCount}</strong></div>
               <div class="scan-metric"><span>ข้ามไว้</span><strong>${cleanup.skippedCount}</strong></div>
               <div class="scan-metric"><span>ไม่สำเร็จ</span><strong>${cleanup.failedCount}</strong></div>`
        }
      </div>
    </section>
  `;
}

function renderPendingPostRows(group) {
  const posts = group.posts || [];
  if (!posts.length) {
    return `<p class="muted">ไม่มีรายละเอียดโพสต์ที่บันทึกไว้</p>`;
  }
  return `
    <ul class="pending-post-list">
      ${posts
        .map(
          (post) => `
            <li class="pending-post is-${post.status}">
              <div class="pending-post-main">
                <span class="pending-post-snippet">${escapeHtml(truncate(post.snippet || "(ไม่มีข้อความ)", 110))}</span>
                <span class="muted">${escapeHtml(post.rawDate || "อ่านวันที่ไม่ได้")}${
                  post.ageDays === null || post.ageDays === undefined
                    ? ""
                    : ` · อายุ ${Number(post.ageDays).toFixed(1)} วัน`
                }</span>
              </div>
              <div class="pending-post-side">
                <span class="pill pill-${post.status}">${escapeHtml(pendingPostStatusLabels[post.status] || post.status)}</span>
                ${
                  post.evidencePath
                    ? `<a class="button button-small button-ghost" href="/api/pending-cleanup/posts/${post.id}/evidence" target="_blank" rel="noopener">ดูหลักฐาน</a>`
                    : ""
                }
              </div>
              ${post.message ? `<span class="pending-post-message muted">${escapeHtml(post.message)}</span>` : ""}
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function renderPendingResults(cleanup, sessionReady) {
  const groups = (cleanup.groups || []).filter((group) => group.pendingCount > 0);
  const failedGroups = (cleanup.groups || []).filter((group) => group.status === "failed");
  const selectedIds = state.pendingSelected;
  const selectedGroups = groups.filter((group) => selectedIds.has(group.id));
  const selectedPosts = selectedGroups.reduce(
    (total, group) => total + group.pendingCount,
    0,
  );
  const deleting = ["deleting", "stopping-delete"].includes(cleanup.status);

  if (!groups.length) {
    return `
      <section class="panel">
        <div class="empty-state">
          <h2>ไม่พบโพสต์ค้างรออนุมัติ</h2>
          <p>ตรวจ ${cleanup.groupsScanned.toLocaleString("th-TH")} กลุ่มแล้วไม่มีของค้างให้ลบ</p>
        </div>
        ${
          failedGroups.length
            ? `<p class="muted">มี ${failedGroups.length} กลุ่มที่เปิดตรวจไม่สำเร็จ — ดูรายละเอียดใน JSON snapshot</p>`
            : ""
        }
      </section>
    `;
  }

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h3>2 · เลือกกลุ่มที่จะลบ</h3>
          <p class="muted">พบของค้าง ${cleanup.pendingFound.toLocaleString("th-TH")} โพสต์ ใน ${groups.length.toLocaleString("th-TH")} กลุ่ม${
            failedGroups.length ? ` · เปิดไม่สำเร็จ ${failedGroups.length} กลุ่ม` : ""
          }</p>
        </div>
        <button class="button button-ghost button-small" data-action="rescan-pending" ${deleting ? "disabled" : ""}>ตรวจใหม่</button>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th class="col-check"><input type="checkbox" data-action="toggle-pending-all" ${
                selectedGroups.length === groups.length ? "checked" : ""
              } ${deleting ? "disabled" : ""} aria-label="เลือกทุกกลุ่มที่มีของค้าง" /></th>
              <th style="width:44%">กลุ่ม</th>
              <th style="width:12%">ค้างอยู่</th>
              <th style="width:16%">สถานะ</th>
              <th>ผลการลบ</th>
            </tr>
          </thead>
          <tbody>
            ${groups
              .map(
                (group) => `
                  <tr>
                    <td class="col-check"><input type="checkbox" data-action="toggle-pending-group" data-id="${group.id}" ${
                      selectedIds.has(group.id) ? "checked" : ""
                    } ${deleting ? "disabled" : ""} /></td>
                    <td>
                      <button class="link-button" data-action="expand-pending-group" data-id="${group.id}">
                        ${state.pendingExpanded.has(group.id) ? "▾" : "▸"} ${escapeHtml(group.groupName)}
                      </button>
                      <a class="muted pending-group-link" href="${escapeHtml(group.groupUrl)}my_pending_content" target="_blank" rel="noopener">เปิดใน Facebook</a>
                    </td>
                    <td><strong>${group.pendingCount}</strong></td>
                    <td><span class="pill pill-${group.status}">${escapeHtml(pendingGroupStatusLabels[group.status] || group.status)}</span></td>
                    <td class="muted">${escapeHtml(group.message || "—")}</td>
                  </tr>
                  ${
                    state.pendingExpanded.has(group.id)
                      ? `<tr class="pending-detail-row"><td colspan="5">${renderPendingPostRows(group)}</td></tr>`
                      : ""
                  }
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel pending-danger">
      <div class="panel-head">
        <div>
          <h3>3 · ยืนยันและลบ</h3>
          <p class="muted">เลือกไว้ ${selectedGroups.length.toLocaleString("th-TH")} กลุ่ม รวมสูงสุด ${selectedPosts.toLocaleString("th-TH")} โพสต์</p>
        </div>
      </div>
      <div class="pending-delete-controls">
        <p class="muted">จะลบโพสต์ค้าง <strong>ทุกโพสต์</strong> ในกลุ่มที่เลือกไว้</p>
      </div>
      <div class="pending-warning">
        <strong>ลบแล้วกู้คืนไม่ได้</strong>
        <span>Facebook ไม่มีถังขยะสำหรับโพสต์ที่รออนุมัติ ระบบจะถ่ายภาพทุกโพสต์เก็บไว้ใน <code>data/pending-cleanup/</code> ก่อนกดลบเสมอ</span>
      </div>
      <label class="scan-consent">
        <input type="checkbox" id="pendingAck" ${deleting ? "disabled" : ""} />
        <span>ฉันเข้าใจว่าโพสต์ที่ลบจะหายถาวรและตรวจรายการที่เลือกแล้ว</span>
      </label>
      <div class="pending-actions">
        ${cleanup.snapshotPath ? `<a class="button button-ghost" href="/api/pending-cleanup/snapshot">ดาวน์โหลด JSON</a>` : ""}
        <button class="button button-danger" data-action="start-pending-delete" ${
          sessionReady && selectedGroups.length && !deleting ? "" : "disabled"
        }>เริ่มลบ (สูงสุด ${selectedPosts.toLocaleString("th-TH")} โพสต์)</button>
      </div>
    </section>
  `;
}

function renderPendingCleanup() {
  const cleanup = { ...emptyPendingCleanup(), ...(state.pendingCleanup || {}) };
  syncPendingSelection(cleanup);
  const sessionReady = Boolean(state.dashboard?.session?.authenticated);
  const scanning = ["scanning", "stopping-scan"].includes(cleanup.status);
  const deleting = ["deleting", "stopping-delete"].includes(cleanup.status);
  const hasResults = Boolean(cleanup.id) && (cleanup.groups || []).length > 0;

  return `
    <div class="page-header">
      <div>
        <h2>ล้างโพสต์ที่รออนุมัติ</h2>
        <p class="muted">ไล่เช็กทุกกลุ่มว่ามีโพสต์ค้างรอแอดมินอนุมัติกี่อัน แล้วเลือกลบทีเดียว</p>
      </div>
    </div>
    ${
      cleanup.error
        ? `<div class="alert alert-danger"><strong>ครั้งล่าสุดไม่สำเร็จ</strong><span>${escapeHtml(cleanup.error)}</span></div>`
        : ""
    }
    ${
      cleanup.status === "completed"
        ? `<div class="alert alert-success"><strong>ล้างเสร็จแล้ว</strong><span>${escapeHtml(cleanup.message)}</span></div>`
        : ""
    }
    ${scanning || deleting ? renderPendingProgress(cleanup, scanning ? "scan" : "delete") : ""}
    ${!scanning && !deleting ? renderPendingSetup(cleanup, sessionReady) : ""}
    ${hasResults && !scanning ? renderPendingResults(cleanup, sessionReady) : ""}
  `;
}

function renderRuns() {
  if (!state.runs.length) {
    return `
      <div class="empty-state">
        <h2>ยังไม่มีคิวโพสต์</h2>
        <p>เลือกกลุ่มจากคลังกลุ่ม แล้วเลือก Draft เพื่อสร้าง Dry run หรือ Assisted run</p>
        <button class="button button-primary" data-action="go-groups">ไปคลังกลุ่ม</button>
      </div>
    `;
  }
  return `
    <div class="page-header">
      <div><h2>คิวงานทั้งหมด</h2><p class="muted">Hybrid จะเติมงานต่อเนื่องตามเพดานแท็บ เมื่อคุณจัดการหนึ่งแท็บ ระบบจึงเตรียมกลุ่มถัดไป</p></div>
      <button class="button button-ghost" data-action="refresh">รีเฟรชสถานะ</button>
    </div>
    <div class="status-callout warning" style="margin-bottom:18px">
      <div>!</div>
      <div>
        <strong>ความหมายของปุ่มระหว่าง “รอยืนยัน”</strong>
        <span>ยืนยันและโพสต์ = ให้ระบบกด Post · ฉันโพสต์เองแล้ว = บันทึกผลและหลักฐานโดยไม่กดซ้ำ · ข้าม + หลักฐาน = แคปหน้าต่างก่อนปิดแท็บ</span>
        <span>ค่าแนะนำคือ 10 แท็บพร้อมกัน ระบบจะพักการเปิดแท็บใหม่เมื่อ RAM เหลือน้อย และลดเพดานเองเมื่อพบ timeout หรือ renderer crash</span>
      </div>
    </div>
    <div class="status-legend" aria-label="คำอธิบายสีสถานะ">
      <span class="status-legend-item done"><i></i>เสร็จแล้ว</span>
      <span class="status-legend-item active"><i></i>กำลังทำงาน</span>
      <span class="status-legend-item attention"><i></i>รอยืนยัน/ต้องตรวจ</span>
      <span class="status-legend-item failed"><i></i>ไม่สำเร็จ</span>
      <span class="status-legend-item neutral"><i></i>รอเริ่ม/ข้าม/หยุด</span>
    </div>
    ${state.runs.map(renderRunCard).join("")}
  `;
}

function renderRunCard(run) {
  const active = ["running", "awaiting_confirmation", "paused"].includes(run.status);
  const postedTargets = (run.targets || []).filter((target) =>
    ["published", "pending_review"].includes(target.status),
  );
  const submittingTargets = (run.targets || []).filter(
    (target) => target.status === "submitting",
  );
  const uncertainTargets = (run.targets || []).filter(
    (target) => target.status === "manual_action_required",
  );
  const canDeleteRun =
    !active &&
    (run.targets || []).length > 0 &&
    submittingTargets.length === 0;
  const counts = (run.targets || []).reduce((map, target) => {
    map[target.status] = (map[target.status] || 0) + 1;
    return map;
  }, {});
  const bulkMarkableTargets = (run.targets || []).filter((target) =>
    isBulkMarkable(run, target),
  );
  const selectedBulkTargets = bulkMarkableTargets.filter((target) =>
    state.selectedRunTargets.has(target.id),
  );
  const bulkJob =
    state.bulkMarkPosted?.runId === run.id ? state.bulkMarkPosted : null;
  const bulkFinished = bulkJob
    ? bulkJob.targetIds.filter((targetId) => {
        const target = (run.targets || []).find((item) => item.id === targetId);
        return target && target.status !== "awaiting_confirmation";
      }).length
    : 0;
  return `
    <article class="run-card run-state-${visualState(run.status)}">
      <div class="run-summary">
        <div>
          <div class="run-title">
            <h3>${formatDate(run.draft?.workDate)} · ${slotLabels[run.draft?.slot] || "ไม่ระบุช่วง"}</h3>
            <span class="badge ${statusClass(run.status)}">${
              run.mode === "dry-run" && run.status === "completed"
                ? "ตรวจสอบเสร็จ"
                : statusLabels[run.status] || run.status
            }</span>
            ${run.autoConfirm ? '<span class="badge info">AUTO-CONFIRM</span>' : ""}
            <span class="tag">${
              run.mode === "dry-run"
                ? "DRY RUN · ไม่โพสต์"
                : run.workflow === "hybrid-windows"
                  ? `หลายหน้าต่าง · ${run.tabLimit || 30} แท็บ/หน้าต่าง · ไม่ปิดเอง`
                  : run.workflow === "hybrid-tabs"
                  ? `HYBRID · เติมต่อเนื่องสูงสุด ${run.tabLimit || 10} แท็บ`
                  : "ทีละกลุ่ม · แท็บใหม่"
            }</span>
          </div>
          <div class="run-meta">
            <span>${run.targets?.length || 0} กลุ่ม</span>
            <span>เผยแพร่ ${counts.published || 0}</span>
            <span>รออนุมัติ ${counts.pending_review || 0}</span>
            <span>รอคุณ ${counts.awaiting_confirmation || 0}</span>
            <span>ข้าม ${counts.skipped || 0}</span>
            <span>สร้างเมื่อ ${formatDate(run.createdAt, true)}</span>
          </div>
        </div>
        <div class="run-actions">
          ${
            run.mode === "assisted" &&
            ["completed", "failed"].includes(run.status) &&
            (run.targets || []).some((target) => target.status === "failed")
              ? `<button class="button button-small button-primary" data-action="retry-failed-run" data-id="${run.id}">ลองใหม่รายการที่ไม่สำเร็จ</button>`
              : ""
          }
          ${
            run.mode === "dry-run" && run.status === "completed"
              ? `<button class="button button-small button-primary" data-action="clone-assisted-run" data-id="${run.id}">สร้างคิวโพสต์จริง</button>`
              : ""
          }
          ${
            run.mode === "assisted" &&
            ["queued", "interrupted", "stopped"].includes(run.status)
              ? `<button class="button button-small button-ghost" data-action="switch-workflow" data-id="${run.id}" data-workflow="${run.workflow === "hybrid-windows" ? "hybrid-tabs" : "hybrid-windows"}">${
                  run.workflow === "hybrid-windows" ? "เปลี่ยนเป็น Hybrid" : "เปลี่ยนเป็นหลายหน้าต่าง"
                }</button>`
              : ""
          }
          ${["queued", "interrupted", "stopped"].includes(run.status) ? `<button class="button button-small button-primary" data-action="start-run" data-id="${run.id}">เริ่มคิว</button>` : ""}
          ${active && run.status !== "paused" ? `<button class="button button-small button-ghost" data-action="pause-run" data-id="${run.id}">พัก</button>` : ""}
          ${run.status === "paused" ? `<button class="button button-small button-primary" data-action="resume-run" data-id="${run.id}">ทำต่อ</button>` : ""}
          ${active ? `<button class="button button-small button-danger" data-action="stop-run" data-id="${run.id}">หยุด</button>` : ""}
          ${
            canDeleteRun
              ? `<button class="button button-small button-danger" data-action="delete-run" data-id="${run.id}" data-uncertain="${uncertainTargets.length}" data-posted="${postedTargets.length}">ลบทั้งคิว</button>`
              : ""
          }
        </div>
      </div>
      ${
        bulkMarkableTargets.length || bulkJob
          ? `
            <div class="run-bulk-bar ${bulkJob ? "is-working" : ""}">
              <label class="bulk-select-all">
                <input
                  type="checkbox"
                  data-bulk-select-all="${run.id}"
                  ${bulkMarkableTargets.length > 0 && selectedBulkTargets.length === bulkMarkableTargets.length ? "checked" : ""}
                  ${bulkJob ? "disabled" : ""}
                />
                <span>เลือกที่รอยืนยันทั้งหมด (${bulkMarkableTargets.length.toLocaleString("th-TH")})</span>
              </label>
              <span class="bulk-help">ติ๊กกลุ่มที่คุณกด Post ใน Facebook แล้ว ระบบจะไล่แคปทีละแท็บ</span>
              <button
                class="button button-small button-secondary"
                data-action="bulk-mark-posted"
                data-run="${run.id}"
                ${selectedBulkTargets.length && !bulkJob ? "" : "disabled"}
              >
                ${
                  bulkJob
                    ? `กำลังเก็บหลักฐาน ${bulkFinished}/${bulkJob.targetIds.length}`
                    : `ฉันโพสต์เองแล้วที่เลือก (${selectedBulkTargets.length})`
                }
              </button>
            </div>
          `
          : ""
      }
      <div class="target-list">
        ${(run.targets || [])
          .map(
            (target, index) => `
              <div class="target-row target-state-${visualState(target.status)}">
                <div class="target-select">
                  ${
                    isBulkMarkable(run, target)
                      ? `<input
                          type="checkbox"
                          class="target-bulk-check"
                          data-run="${run.id}"
                          data-target="${target.id}"
                          aria-label="เลือก ${escapeHtml(target.group?.name || "กลุ่มนี้")} ว่าโพสต์เองแล้ว"
                          ${state.selectedRunTargets.has(target.id) ? "checked" : ""}
                          ${bulkJob ? "disabled" : ""}
                        />`
                      : ""
                  }
                </div>
                <div class="target-index">${String(index + 1).padStart(2, "0")}</div>
                <div class="target-main">
                  <strong>${escapeHtml(target.group?.name || "ไม่พบกลุ่ม")}</strong>
                  <span>${escapeHtml(target.message || "รอเริ่มทำงาน")}</span>
                </div>
                <div><span class="badge ${statusClass(target.status)}">${statusLabels[target.status] || target.status}</span></div>
                <div class="target-actions">
                  ${
                    target.status === "awaiting_confirmation"
                      ? `
                        <button class="button button-small button-ghost" data-action="focus-target" data-run="${run.id}" data-target="${target.id}">เปิดแท็บ</button>
                        <button class="button button-small button-ghost" data-action="target-action" data-run="${run.id}" data-target="${target.id}" data-value="skip">ข้าม + หลักฐาน</button>
                        <button class="button button-small button-secondary" data-action="target-action" data-run="${run.id}" data-target="${target.id}" data-value="mark-posted" title="คลิกปกติจะถามยืนยัน · คลิก 3 ครั้งติดกันเพื่อบันทึกทันที" ${bulkJob ? "disabled" : ""}>ฉันโพสต์เองแล้ว</button>
                        <button class="button button-small button-primary" data-action="target-action" data-run="${run.id}" data-target="${target.id}" data-value="confirm">ยืนยันและโพสต์</button>
                      `
                      : ""
                  }
                  ${
                    target.status === "manual_action_required"
                      ? run.workflow === "hybrid-windows" && active
                        ? `
                          <button class="button button-small button-ghost" data-action="focus-target" data-run="${run.id}" data-target="${target.id}">เปิดแท็บ</button>
                          <button class="button button-small button-ghost" data-action="target-action" data-run="${run.id}" data-target="${target.id}" data-value="skip">ข้าม + หลักฐาน</button>
                          <button class="button button-small button-secondary" data-action="target-action" data-run="${run.id}" data-target="${target.id}" data-value="mark-posted" title="คลิกปกติจะถามยืนยัน · คลิก 3 ครั้งติดกันเพื่อบันทึกทันที" ${bulkJob ? "disabled" : ""}>ฉันโพสต์เองแล้ว</button>
                        `
                        : `<button class="button button-small button-secondary" data-action="reconcile-posted" data-run="${run.id}" data-target="${target.id}">ยืนยันว่าโพสต์เองแล้ว</button>`
                      : ""
                  }
                  <button class="button button-small button-ghost" data-action="manage-evidence" data-target="${target.id}">จัดการหลักฐาน${
                    evidenceCountForTarget(target)
                      ? ` (${evidenceCountForTarget(target)})`
                      : ""
                  }</button>
                  ${target.evidencePath ? `<a class="button button-small button-ghost" href="/api/evidence/${target.id}" target="_blank">ดูหลักฐาน</a>` : ""}
                  ${target.permalink ? `<a class="button button-small button-ghost" href="${escapeHtml(target.permalink)}" target="_blank" rel="noreferrer">เปิดโพสต์</a>` : ""}
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </article>
  `;
}

async function refreshManualEvidence() {
  state.manualEvidence = await api("/api/manual-evidence");
}

function renderEvidenceDialog() {
  const context = findTargetContext(state.evidenceTargetId);
  if (!context) {
    evidenceDialogContent.innerHTML = `<div class="empty-state"><p>ไม่พบรายการกลุ่มนี้</p></div>`;
    return;
  }
  const { run, target } = context;
  const manual = manualEvidenceForTarget(target.id);
  evidenceDialogContent.innerHTML = `
    <div class="evidence-context">
      <strong>${escapeHtml(target.group?.name || "ไม่พบชื่อกลุ่ม")}</strong>
      <span>${formatDate(run.draft?.workDate)} · ${slotLabels[run.draft?.slot] || "—"} · ${statusLabels[target.status] || target.status}</span>
    </div>
    <form id="evidenceUploadForm" class="evidence-upload-form">
      <label class="field field-wide">
        <span>อัปโหลดรูปหลักฐานเอง (สูงสุดครั้งละ 5 รูป)</span>
        <input name="files" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple required />
      </label>
      <label class="field field-wide">
        <span>หมายเหตุสำหรับชุดนี้</span>
        <input name="note" maxlength="500" placeholder="เช่น แคปจากมือถือหลังโพสต์สำเร็จ" />
      </label>
      <button class="button button-primary" type="submit">อัปโหลดหลักฐาน</button>
    </form>
    <div class="evidence-section-head">
      <div>
        <strong>หลักฐานทั้งหมด</strong>
        <span>${Number(Boolean(target.evidencePath)) + manual.length} ไฟล์</span>
      </div>
    </div>
    <div class="evidence-grid">
      ${
        target.evidencePath
          ? `
            <article class="evidence-card">
              <a href="/api/evidence/${target.id}" target="_blank">
                <img src="/api/evidence/${target.id}" alt="หลักฐานจากระบบ" />
              </a>
              <div class="evidence-card-body">
                <span class="badge info">ระบบสร้าง</span>
                <strong>หลักฐานอัตโนมัติ</strong>
                <p>${escapeHtml(target.message || "ภาพจากการทำงานของระบบ")}</p>
                <small>อ่านอย่างเดียว เพื่อรักษาประวัติการทำงาน</small>
              </div>
            </article>
          `
          : ""
      }
      ${manual
        .map(
          (item) => `
            <article class="evidence-card" data-evidence-id="${item.id}">
              <a href="/api/manual-evidence/${item.id}/file" target="_blank">
                <img src="/api/manual-evidence/${item.id}/file?v=${encodeURIComponent(item.updatedAt)}" alt="${escapeHtml(item.fileName)}" />
              </a>
              <div class="evidence-card-body">
                <span class="badge success">อัปโหลดเอง</span>
                <strong title="${escapeHtml(item.fileName)}">${escapeHtml(item.fileName)}</strong>
                <textarea id="evidenceNote-${item.id}" maxlength="500" rows="2" placeholder="เพิ่มหมายเหตุ">${escapeHtml(item.note)}</textarea>
                <input class="evidence-replace-input" id="evidenceReplace-${item.id}" data-id="${item.id}" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
                <div class="evidence-card-actions">
                  <a class="button button-small button-ghost" href="/api/manual-evidence/${item.id}/file" target="_blank">เปิดภาพ</a>
                  <button class="button button-small button-ghost" data-action="save-evidence-note" data-id="${item.id}">บันทึกหมายเหตุ</button>
                  <button class="button button-small button-ghost" data-action="choose-evidence-replacement" data-id="${item.id}">เปลี่ยนรูป</button>
                  <button class="button button-small button-danger" data-action="delete-manual-evidence" data-id="${item.id}">ลบ</button>
                </div>
              </div>
            </article>
          `,
        )
        .join("")}
      ${
        !target.evidencePath && !manual.length
          ? `<div class="empty-state evidence-empty"><p>ยังไม่มีหลักฐานสำหรับกลุ่มนี้</p></div>`
          : ""
      }
    </div>
    <div class="modal-actions">
      <button type="button" class="button button-ghost" data-action="close-evidence">ปิด</button>
    </div>
  `;

  document.querySelector("#evidenceUploadForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await api(`/api/run-targets/${target.id}/evidence`, {
        method: "POST",
        body: data,
      });
      await refreshManualEvidence();
      renderEvidenceDialog();
      toast("อัปโหลดหลักฐานเรียบร้อย");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  document.querySelectorAll(".evidence-replace-input").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const data = new FormData();
      data.append("file", file);
      data.append(
        "note",
        document.querySelector(`#evidenceNote-${input.dataset.id}`)?.value || "",
      );
      try {
        await api(`/api/manual-evidence/${input.dataset.id}`, {
          method: "PUT",
          body: data,
        });
        await refreshManualEvidence();
        renderEvidenceDialog();
        toast("เปลี่ยนรูปหลักฐานแล้ว");
      } catch (error) {
        toast(error.message, "error");
      }
    });
  });
}

function evidenceRunOrdinalMap() {
  return new Map(
    [...state.runs]
      .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))
      .map((run, index) => [run.id, index + 1]),
  );
}

function evidenceRunLabel(run, ordinalMap = evidenceRunOrdinalMap()) {
  return `รอบ ${ordinalMap.get(run.id) || "—"} · ${formatDate(run.draft?.workDate)} · ${
    slotLabels[run.draft?.slot] || "ไม่ระบุช่วง"
  } · สร้าง ${formatTime(run.createdAt)} · ${run.id.slice(0, 8)}`;
}

function buildEvidenceItems() {
  const targets = state.runs
    .flatMap((run) =>
      (run.targets || []).map((target) => ({
        ...target,
        run,
      })),
    );
  const targetMap = new Map(targets.map((target) => [target.id, target]));
  const evidenceItems = [
    ...targets
      .filter((target) => target.evidencePath)
      .map((target) => ({
        id: `system-${target.id}`,
        target,
        source: "ระบบสร้าง",
        sourceKey: "system",
        note: target.message,
        url: `/api/evidence/${target.id}`,
        capturedAt: target.updatedAt,
      })),
    ...state.manualEvidence
      .map((item) => {
        const target = targetMap.get(item.targetId);
        return target
          ? {
              id: item.id,
              target,
              source: "อัปโหลดเอง",
              sourceKey: "manual",
              note: item.note || item.fileName,
              url: `/api/manual-evidence/${item.id}/file`,
              capturedAt: item.createdAt,
            }
          : null;
      })
      .filter(Boolean),
  ];
  return evidenceItems;
}

function matchesEvidenceSearch(item, query, ordinalMap) {
  const clauses = parseSearchQuery(query);
  if (!clauses.length) return true;
  const haystack = normalizeSearchText(
    [
      item.target.group?.name,
      item.note,
      item.source,
      statusLabels[item.target.status] || item.target.status,
      evidenceRunLabel(item.target.run, ordinalMap),
      item.target.run.id,
    ].join(" "),
  );
  return clauses.some((terms) =>
    terms.every((term) =>
      term.exclude ? !haystack.includes(term.text) : haystack.includes(term.text),
    ),
  );
}

function timeFallsWithin(value, from, to) {
  if (!from && !to) return true;
  if (!value) return false;
  if (from && to && from > to) return value >= from || value <= to;
  return (!from || value >= from) && (!to || value <= to);
}

function filteredEvidenceItems(allItems = buildEvidenceItems()) {
  const filters = state.evidenceFilters;
  const ordinalMap = evidenceRunOrdinalMap();
  const filtered = allItems.filter((item) => {
    const run = item.target.run;
    const workDate = run.draft?.workDate || "";
    const evidenceDate = dateKeyBangkok(item.capturedAt);
    const selectedDate = filters.dateBasis === "captured" ? evidenceDate : workDate;
    return (
      matchesEvidenceSearch(item, filters.query, ordinalMap) &&
      (!filters.dateFrom || selectedDate >= filters.dateFrom) &&
      (!filters.dateTo || selectedDate <= filters.dateTo) &&
      (filters.slot === "all" || run.draft?.slot === filters.slot) &&
      (filters.runId === "all" || run.id === filters.runId) &&
      (filters.groupId === "all" || item.target.groupId === filters.groupId) &&
      (filters.source === "all" || item.sourceKey === filters.source) &&
      (filters.status === "all" || item.target.status === filters.status) &&
      timeFallsWithin(
        timeKeyBangkok(item.capturedAt),
        filters.timeFrom,
        filters.timeTo,
      )
    );
  });
  return filtered.sort((left, right) => {
    if (filters.sort === "oldest") {
      return new Date(left.capturedAt) - new Date(right.capturedAt);
    }
    if (filters.sort === "group") {
      return String(left.target.group?.name || "").localeCompare(
        String(right.target.group?.name || ""),
        "th",
      );
    }
    return new Date(right.capturedAt) - new Date(left.capturedAt);
  });
}

function historyActiveFilterCount() {
  const filters = state.evidenceFilters;
  return [
    filters.query,
    filters.dateBasis !== "work",
    filters.dateFrom,
    filters.dateTo,
    filters.slot !== "all",
    filters.runId !== "all",
    filters.groupId !== "all",
    filters.source !== "all",
    filters.status !== "all",
    filters.timeFrom,
    filters.timeTo,
  ].filter(Boolean).length;
}

function renderEvidenceItemRow(item, options = {}) {
  const ordinalMap = options.ordinalMap || evidenceRunOrdinalMap();
  const run = item.target.run;
  const runLabel = evidenceRunLabel(run, ordinalMap);
  return `
    <tr class="evidence-result-row">
      <td>
        ${
          options.showRun
            ? `<strong class="evidence-run-inline">${escapeHtml(runLabel)}</strong>`
            : `<span>${formatDate(run.draft?.workDate)} · ${slotLabels[run.draft?.slot] || "—"}</span>`
        }
      </td>
      <td>
        <strong>${formatTime(item.capturedAt)}</strong>
        <small>${formatDate(dateKeyBangkok(item.capturedAt))}</small>
      </td>
      <td><strong>${escapeHtml(item.target.group?.name || "—")}</strong></td>
      <td>
        <div class="evidence-status-stack">
          <span class="badge ${statusClass(item.target.status)}">${statusLabels[item.target.status] || item.target.status}</span>
          <span class="badge ${item.sourceKey === "system" ? "info" : "success"}">${item.source}</span>
        </div>
      </td>
      <td class="evidence-note-cell">${escapeHtml(item.note)}</td>
      <td>
        <div class="toolbar-start">
          <a class="button button-small button-ghost" href="${item.url}" target="_blank">เปิดภาพ</a>
          <button class="button button-small button-ghost" data-action="manage-evidence" data-target="${item.target.id}">จัดการ</button>
        </div>
      </td>
    </tr>
  `;
}

function renderEvidenceRows(items) {
  if (!items.length) {
    return `<tr><td colspan="6"><div class="empty-state"><p>ไม่พบหลักฐานที่ตรงกับตัวกรอง ลองล้างตัวกรองหรือขยายช่วงวันที่</p></div></td></tr>`;
  }
  const ordinalMap = evidenceRunOrdinalMap();
  if (state.evidenceFilters.view !== "run") {
    return items
      .map((item) => renderEvidenceItemRow(item, { showRun: true, ordinalMap }))
      .join("");
  }
  const grouped = new Map();
  for (const item of items) {
    const runId = item.target.run.id;
    if (!grouped.has(runId)) grouped.set(runId, []);
    grouped.get(runId).push(item);
  }
  const runEntries = [...grouped.entries()].sort((left, right) => {
    const leftDate = new Date(left[1][0].target.run.createdAt);
    const rightDate = new Date(right[1][0].target.run.createdAt);
    return state.evidenceFilters.sort === "oldest"
      ? leftDate - rightDate
      : rightDate - leftDate;
  });
  return runEntries
    .map(([runId, runItems]) => {
      const run = runItems[0].target.run;
      const groups = new Set(runItems.map((item) => item.target.groupId)).size;
      const statusCounts = runItems.reduce((counts, item) => {
        counts[item.target.status] = (counts[item.target.status] || 0) + 1;
        return counts;
      }, {});
      const statusSummary = Object.entries(statusCounts)
        .map(
          ([status, count]) =>
            `${statusLabels[status] || status} ${count.toLocaleString("th-TH")}`,
        )
        .join(" · ");
      return `
        <tr class="evidence-run-divider">
          <td colspan="6">
            <div class="evidence-run-divider-content">
              <div>
                <strong>${escapeHtml(evidenceRunLabel(run, ordinalMap))}</strong>
                <span>${runItems.length.toLocaleString("th-TH")} ไฟล์ · ${groups.toLocaleString("th-TH")} กลุ่ม · ${escapeHtml(statusSummary)}</span>
              </div>
              <code title="${runId}">${runId.slice(0, 8)}</code>
            </div>
          </td>
        </tr>
        ${runItems
          .map((item) => renderEvidenceItemRow(item, { showRun: false, ordinalMap }))
          .join("")}
      `;
    })
    .join("");
}

function historyResultSummary(items, allItems) {
  const runs = new Set(items.map((item) => item.target.run.id)).size;
  const groups = new Set(items.map((item) => item.target.groupId)).size;
  return `แสดง ${items.length.toLocaleString("th-TH")} จาก ${allItems.length.toLocaleString("th-TH")} ไฟล์ · ${runs.toLocaleString("th-TH")} รอบ · ${groups.toLocaleString("th-TH")} กลุ่ม`;
}

function updateHistoryResults() {
  const allItems = buildEvidenceItems();
  const items = filteredEvidenceItems(allItems);
  const body = document.querySelector("#evidenceTableBody");
  const summary = document.querySelector("#historyResultSummary");
  const filterCount = document.querySelector("#historyFilterCount");
  if (body) body.innerHTML = renderEvidenceRows(items);
  if (summary) summary.textContent = historyResultSummary(items, allItems);
  if (filterCount) {
    const count = historyActiveFilterCount();
    filterCount.textContent = count ? `ใช้ ${count} ตัวกรอง` : "ยังไม่ใช้ตัวกรอง";
    filterCount.className = `badge ${count ? "warning" : "info"}`;
  }
}

function renderHistory() {
  const evidenceItems = buildEvidenceItems();
  const filteredItems = filteredEvidenceItems(evidenceItems);
  const filters = state.evidenceFilters;
  const ordinalMap = evidenceRunOrdinalMap();
  const runOptions = [...state.runs]
    .filter((run) => (run.targets || []).some((target) => evidenceItems.some((item) => item.target.id === target.id)))
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  const groupOptions = [
    ...new Map(
      evidenceItems
        .filter((item) => item.target.group)
        .map((item) => [item.target.groupId, item.target.group]),
    ).values(),
  ].sort((left, right) => left.name.localeCompare(right.name, "th"));
  const statuses = [
    ...new Set(evidenceItems.map((item) => item.target.status)),
  ].sort((left, right) =>
    String(statusLabels[left] || left).localeCompare(String(statusLabels[right] || right), "th"),
  );
  return `
    <div class="page-header">
      <div><h2>คลังหลักฐาน</h2><p class="muted">กรองตามรอบคิว วันที่ ช่วงเวลา กลุ่ม และผลลัพธ์ เพื่อทบทวนงานแต่ละรอบได้ชัดเจน</p></div>
      <div class="toolbar-end">
        <span id="historyFilterCount" class="badge ${historyActiveFilterCount() ? "warning" : "info"}">${historyActiveFilterCount() ? `ใช้ ${historyActiveFilterCount()} ตัวกรอง` : "ยังไม่ใช้ตัวกรอง"}</span>
        <span class="badge info">${evidenceItems.length.toLocaleString("th-TH")} ไฟล์ทั้งหมด</span>
      </div>
    </div>
    <section class="evidence-filter-panel">
      <div class="evidence-filter-intro">
        <div>
          <strong>ตัวกรองหลักฐานแบบละเอียด</strong>
          <span>แนะนำ: จัดกลุ่มตามรอบคิว · ยึดวันที่งาน · เรียงล่าสุดก่อน</span>
        </div>
        <button class="button button-small button-ghost" type="button" data-history-clear>ล้างตัวกรองทั้งหมด</button>
      </div>
      <div class="evidence-presets" aria-label="ช่วงวันที่ด่วน">
        <span>ช่วงด่วน</span>
        <button type="button" data-history-preset="all">ทั้งหมด</button>
        <button type="button" data-history-preset="today">วันนี้</button>
        <button type="button" data-history-preset="7days">7 วันล่าสุด</button>
        <button type="button" data-history-preset="month">เดือนนี้</button>
      </div>
      <div class="evidence-filter-grid">
        <label class="field evidence-filter-search">
          <span>ค้นหาหลายคำ</span>
          <input id="historyQuery" type="search" autocomplete="off" value="${escapeHtml(filters.query)}" placeholder='ชื่อกลุ่ม หมายเหตุ เลขคิว · ใช้ | หรือ และ -คำได้' />
        </label>
        <label class="field">
          <span>ยึดวันที่จาก</span>
          <select id="historyDateBasis">
            <option value="work" ${filters.dateBasis === "work" ? "selected" : ""}>วันที่งานของรอบ</option>
            <option value="captured" ${filters.dateBasis === "captured" ? "selected" : ""}>วันที่เก็บหลักฐานจริง</option>
          </select>
        </label>
        <label class="field">
          <span>ตั้งแต่วันที่</span>
          <input id="historyDateFrom" type="date" value="${filters.dateFrom}" />
        </label>
        <label class="field">
          <span>ถึงวันที่</span>
          <input id="historyDateTo" type="date" value="${filters.dateTo}" />
        </label>
        <label class="field">
          <span>ช่วงโพสต์</span>
          <select id="historySlot">
            <option value="all">ทุกช่วง</option>
            ${Object.entries(slotLabels).map(([value, label]) => `<option value="${value}" ${filters.slot === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
        <label class="field evidence-filter-wide">
          <span>รอบคิว</span>
          <select id="historyRun">
            <option value="all">ทุกรอบคิว</option>
            ${runOptions.map((run) => `<option value="${run.id}" ${filters.runId === run.id ? "selected" : ""}>${escapeHtml(evidenceRunLabel(run, ordinalMap))}</option>`).join("")}
          </select>
        </label>
        <label class="field evidence-filter-wide">
          <span>กลุ่ม</span>
          <select id="historyGroup">
            <option value="all">ทุกกลุ่ม</option>
            ${groupOptions.map((group) => `<option value="${group.id}" ${filters.groupId === group.id ? "selected" : ""}>${escapeHtml(group.name)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>สถานะโพสต์</span>
          <select id="historyStatus">
            <option value="all">ทุกสถานะ</option>
            ${statuses.map((status) => `<option value="${status}" ${filters.status === status ? "selected" : ""}>${escapeHtml(statusLabels[status] || status)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>ที่มาหลักฐาน</span>
          <select id="historySource">
            <option value="all">ทุกที่มา</option>
            <option value="system" ${filters.source === "system" ? "selected" : ""}>ระบบสร้าง</option>
            <option value="manual" ${filters.source === "manual" ? "selected" : ""}>อัปโหลดเอง</option>
          </select>
        </label>
        <label class="field">
          <span>เก็บหลังเวลา</span>
          <input id="historyTimeFrom" type="time" value="${filters.timeFrom}" />
        </label>
        <label class="field">
          <span>เก็บก่อนเวลา</span>
          <input id="historyTimeTo" type="time" value="${filters.timeTo}" />
        </label>
        <label class="field">
          <span>มุมมอง</span>
          <select id="historyView">
            <option value="run" ${filters.view === "run" ? "selected" : ""}>จัดกลุ่มตามรอบคิว</option>
            <option value="list" ${filters.view === "list" ? "selected" : ""}>รายการรวมทั้งหมด</option>
          </select>
        </label>
        <label class="field">
          <span>เรียงลำดับ</span>
          <select id="historySort">
            <option value="newest" ${filters.sort === "newest" ? "selected" : ""}>ล่าสุดก่อน</option>
            <option value="oldest" ${filters.sort === "oldest" ? "selected" : ""}>เก่าสุดก่อน</option>
            <option value="group" ${filters.sort === "group" ? "selected" : ""}>ชื่อกลุ่ม ก–ฮ</option>
          </select>
        </label>
      </div>
      <div class="evidence-filter-summary">
        <strong id="historyResultSummary">${historyResultSummary(filteredItems, evidenceItems)}</strong>
        <span>เวลาที่เก็บหลักฐานใช้เขตเวลา Asia/Bangkok · หากเวลาเริ่มมากกว่าเวลาสิ้นสุด ระบบจะตีความเป็นช่วงข้ามเที่ยงคืน</span>
      </div>
    </section>
    <div class="data-table-wrap">
      <table class="data-table evidence-table">
        <thead><tr><th style="width:20%">วันที่งาน/รอบ</th><th style="width:10%">เวลาเก็บ</th><th style="width:21%">กลุ่ม</th><th style="width:14%">สถานะ/ที่มา</th><th>หมายเหตุ</th><th style="width:190px">จัดการ</th></tr></thead>
        <tbody id="evidenceTableBody">${renderEvidenceRows(filteredItems)}</tbody>
      </table>
    </div>
  `;
}

function renderSettings() {
  const session = state.dashboard?.session || {};
  return `
    <div class="page-header">
      <div><h2>Session และความปลอดภัย</h2><p class="muted">Browser profile ถูกเก็บไว้ในเครื่องและไม่แสดง token บนหน้าจอ</p></div>
    </div>
    <div class="settings-grid">
      <section class="panel settings-card">
        <h3>Facebook Browser Session</h3>
        <p>เปิด Chromium เฉพาะของ HR Auto แล้วล็อกอินและทำ 2FA ด้วยตนเอง หน้าต่างนี้จะถูกใช้เตรียมโพสต์ระหว่างทำงาน</p>
        <div class="session-detail">
          <div><span>Browser</span><strong>${session.browserOpen ? "เปิดอยู่" : "ปิดอยู่"}</strong></div>
          <div><span>Authentication</span><strong>${session.authenticated ? "พร้อมใช้งาน" : "ยังไม่พร้อม"}</strong></div>
          <div><span>Account cookie</span><strong>${escapeHtml(session.accountIdMasked || "ไม่พบ")}</strong></div>
          <div><span>Current URL</span><strong>${escapeHtml(truncate(session.url || "—", 55))}</strong></div>
          <div><span>แท็บที่ระบบดูแล</span><strong>${Number(session.pageCount || 0).toLocaleString("th-TH")}</strong></div>
          <div><span>Profile owner</span><strong>${session.profileLocked ? `PID ${escapeHtml(session.ownerPid || "อื่น")}` : "ว่าง"}</strong></div>
          <div><span>Renderer crash</span><strong>${Number(session.crashCount || 0).toLocaleString("th-TH")} ครั้ง</strong></div>
          <div><span>Page/Web error</span><strong>${Number(session.pageErrorCount || 0).toLocaleString("th-TH")} ครั้ง</strong></div>
        </div>
        ${
          session.lastError
            ? `<div class="status-callout warning" style="margin:14px 0"><div>!</div><div><strong>เหตุการณ์ล่าสุด</strong><span>${escapeHtml(session.lastError)}</span></div></div>`
            : ""
        }
        <div class="toolbar-start">
          <button class="button button-primary" data-action="connect-session">${session.browserOpen ? "เปิดหน้าต่าง Facebook" : "เชื่อมต่อ Facebook"}</button>
          ${session.browserOpen ? `<button class="button button-ghost" data-action="check-session">ตรวจ Session</button><button class="button button-danger" data-action="close-session">ปิด Browser</button>` : ""}
        </div>
      </section>
      <section class="panel settings-card">
        <h3>ค่าเริ่มต้นด้านความปลอดภัย</h3>
        <p>รุ่น MVP ล็อกค่าเหล่านี้ไว้เพื่อป้องกันการโพสต์โดยไม่ตั้งใจ และลดความเสียหายเมื่อหน้าจอ Facebook เปลี่ยน</p>
        <div class="session-detail">
          <div><span>Network binding</span><strong>127.0.0.1 เท่านั้น</strong></div>
          <div><span>Default run</span><strong>Dry run</strong></div>
          <div><span>Assisted confirmation</span><strong>ยืนยันทุกกลุ่ม</strong></div>
          <div><span>Parallel posting</span><strong>ปิด</strong></div>
          <div><span>Automatic retry after submit</span><strong>ปิด</strong></div>
        </div>
      </section>
    </div>
    <div class="status-callout warning" style="margin-top:18px">
      <div>!</div>
      <div><strong>browser-profile มีสิทธิ์เทียบเท่าการล็อกอิน</strong><span>ห้ามส่งโฟลเดอร์ data/browser-profile ให้ผู้อื่น ห้ามเก็บใน Git หรือ Cloud Drive และควรเปิด BitLocker/LUKS บนเครื่องที่ใช้งาน</span></div>
    </div>
  `;
}

function bindRouteEvents() {
  if (state.route === "compose") bindComposeEvents();
  if (state.route === "groups") bindGroupEvents();
  if (state.route === "history") bindHistoryEvents();
  if (state.route === "pending") bindPendingEvents();
}

function bindPendingEvents() {
  document.querySelectorAll('input[name="pendingScope"]').forEach((input) => {
    input.addEventListener("change", (event) => {
      state.pendingScope = event.target.value;
      render();
    });
  });
  const search = document.querySelector("#pendingCustomSearch");
  search?.addEventListener("input", (event) => {
    state.pendingCustomSearch = event.target.value;
    render();
    const restored = document.querySelector("#pendingCustomSearch");
    restored?.focus();
    restored?.setSelectionRange(restored.value.length, restored.value.length);
  });
}

function bindComposeEvents() {
  const text = document.querySelector("#draftText");
  const count = document.querySelector("#charCount");
  const preview = document.querySelector("#previewCopy");
  text?.addEventListener("input", () => {
    count.textContent = `${text.value.length.toLocaleString("th-TH")} ตัวอักษร`;
    preview.textContent = text.value || "ข้อความที่กรอกจะแสดงตรงนี้…";
    preview.classList.toggle("preview-placeholder", !text.value);
  });
  document.querySelector("#draftImages")?.addEventListener("change", (event) => {
    state.pendingFiles = [...event.target.files].slice(0, 10);
    renderPendingImages();
  });
  document.querySelector("#draftForm")?.addEventListener("submit", saveDraft);
}

function renderPendingImages() {
  const grid = document.querySelector("#mediaGrid");
  const preview = document.querySelector("#previewMedia");
  if (!grid || !preview) return;
  grid.querySelectorAll(".pending-media").forEach((item) => item.remove());
  preview.querySelectorAll(".pending-media").forEach((item) => item.remove());
  state.pendingFiles.forEach((file, index) => {
    const url = URL.createObjectURL(file);
    grid.insertAdjacentHTML(
      "beforeend",
      `<div class="media-thumb pending-media"><img src="${url}" alt="${escapeHtml(file.name)}" /><button type="button" class="media-remove" data-action="remove-pending" data-index="${index}">×</button></div>`,
    );
    if (index < 4) preview.insertAdjacentHTML("beforeend", `<img class="pending-media" src="${url}" alt="" />`);
  });
}

async function saveDraft(event) {
  event.preventDefault();
  const submitter = event.submitter;
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const draft = state.editingDraftId
      ? await api(`/api/drafts/${state.editingDraftId}`, {
          method: "PUT",
          body: JSON.stringify({ workDate: data.workDate, slot: data.slot, text: data.text }),
        })
      : await api("/api/drafts", {
          method: "POST",
          body: JSON.stringify({ workDate: data.workDate, slot: data.slot, text: data.text }),
        });
    if (state.pendingFiles.length) {
      const media = new FormData();
      state.pendingFiles.forEach((file) => media.append("images", file));
      await api(`/api/drafts/${draft.id}/media`, { method: "POST", body: media });
    }
    state.pendingFiles = [];
    state.editingDraftId = draft.id;
    await refreshAll();
    toast("บันทึก Draft และรูปเรียบร้อย");
    if (submitter?.dataset.saveMode === "groups") navigate("groups");
    else render();
  } catch (error) {
    toast(error.message, "error");
  }
}

function bindGroupEvents() {
  const runMode = document.querySelector("#runMode");
  const runWorkflow = document.querySelector("#runWorkflow");
  const runTabLimit = document.querySelector("#runTabLimit");
  const runWindowPlan = document.querySelector("#runWindowPlan");
  const syncRunWorkflowControls = () => {
    if (!runMode || !runWorkflow || !runTabLimit) return;
    const assisted = runMode.value === "assisted";
    const windowed = runWorkflow.value === "hybrid-windows";
    const hybrid = runWorkflow.value === "hybrid-tabs";
    const currentValue = runTabLimit.value;
    runWorkflow.disabled = !assisted;
    runTabLimit.disabled = !assisted || (!windowed && !hybrid);
    if (windowed || hybrid) {
      const unitLabel = windowed ? "แท็บต่อหน้าต่าง" : "พร้อมกัน";
      const suffix = (value, note) =>
        windowed ? `${value} แท็บต่อหน้าต่าง${note ? ` (${note})` : ""}` : `${unitLabel} ${value} แท็บ${note ? ` (${note})` : ""}`;
      const allowed = ["4", "8", "10", "15", "20", "30", "50", "100"];
      const recommendedValue = windowed ? "30" : "10";
      let optionsHtml = allowed
        .map(
          (value) =>
            `<option value="${value}">${suffix(value, value === recommendedValue ? "แนะนำ" : "")}</option>`,
        )
        .join("");
      optionsHtml += `<option value="custom">กำหนดเอง…</option>`;
      if (currentValue && !allowed.includes(currentValue) && currentValue !== "custom") {
        optionsHtml = `<option value="${currentValue}" selected>${suffix(currentValue, "กำหนดเอง")}</option>` + optionsHtml;
      }
      runTabLimit.innerHTML = optionsHtml;
      if (currentValue && (allowed.includes(currentValue) || currentValue === "custom")) {
        runTabLimit.value = currentValue;
      } else {
        runTabLimit.value = recommendedValue;
      }
    }
    if (runWindowPlan) {
      runWindowPlan.hidden = !assisted || !windowed;
      runWindowPlan.textContent = windowBatchSummary(
        state.selectedGroups.size,
        Number(runTabLimit.value || 30),
      ).text;
    }
  };
  runMode?.addEventListener("change", syncRunWorkflowControls);
  runWorkflow?.addEventListener("change", syncRunWorkflowControls);
  runTabLimit?.addEventListener("change", () => {
    if (runTabLimit.value === "custom") {
      const windowed = runWorkflow?.value === "hybrid-windows";
      const promptLabel = windowed ? "จำนวนแท็บต่อหน้าต่าง" : "จำนวนแท็บพร้อมกัน";
      const fallback = windowed ? "30" : "10";
      const inputVal = window.prompt(`ระบุ${promptLabel} (1-250):`, "50");
      const num = parseInt(inputVal || "", 10);
      if (num && num >= 1 && num <= 250) {
        const customOpt = document.createElement("option");
        customOpt.value = String(num);
        customOpt.textContent = windowed
          ? `${num} แท็บต่อหน้าต่าง (กำหนดเอง)`
          : `พร้อมกัน ${num} แท็บ (กำหนดเอง)`;
        customOpt.selected = true;
        runTabLimit.appendChild(customOpt);
        runTabLimit.value = String(num);
      } else {
        runTabLimit.value = fallback;
      }
    }
    syncRunWorkflowControls();
  });
  syncRunWorkflowControls();

  document.querySelector("#groupSearch")?.addEventListener("input", (event) => {
    state.groupSearch = event.target.value;
    scheduleGroupResultsUpdate();
  });
  document.querySelector("#provinceFilter")?.addEventListener("change", (event) => {
    state.groupProvince = event.target.value;
    scheduleGroupResultsUpdate();
  });
  document.querySelector("#statusFilter")?.addEventListener("change", (event) => {
    state.groupStatus = event.target.value;
    scheduleGroupResultsUpdate();
  });
  document.querySelector("#selectAllGroups")?.addEventListener("change", (event) => {
    filteredGroups().forEach((group) => {
      if (event.target.checked) state.selectedGroups.add(group.id);
      else state.selectedGroups.delete(group.id);
    });
    render();
  });
  document.querySelector("#groupTableBody")?.addEventListener("change", (event) => {
    const checkbox = event.target.closest?.(".group-check");
    if (checkbox) {
      if (checkbox.checked) state.selectedGroups.add(checkbox.value);
      else state.selectedGroups.delete(checkbox.value);
      render();
    }
  });
  document.querySelector("#csvInput")?.addEventListener("change", importCsv);
}

function bindHistoryEvents() {
  const filters = state.evidenceFilters;
  document.querySelector("#historyQuery")?.addEventListener("input", (event) => {
    filters.query = event.target.value;
    updateHistoryResults();
  });
  const controls = {
    historyDateBasis: "dateBasis",
    historyDateFrom: "dateFrom",
    historyDateTo: "dateTo",
    historySlot: "slot",
    historyRun: "runId",
    historyGroup: "groupId",
    historyStatus: "status",
    historySource: "source",
    historyTimeFrom: "timeFrom",
    historyTimeTo: "timeTo",
    historyView: "view",
    historySort: "sort",
  };
  Object.entries(controls).forEach(([id, key]) => {
    document.querySelector(`#${id}`)?.addEventListener("change", (event) => {
      filters[key] = event.target.value;
      render();
    });
  });
  document.querySelectorAll("[data-history-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const today = todayBangkok();
      const shiftedDate = (days) => {
        const date = new Date(`${today}T12:00:00Z`);
        date.setUTCDate(date.getUTCDate() + days);
        return date.toISOString().slice(0, 10);
      };
      filters.dateBasis = "work";
      filters.dateTo = button.dataset.historyPreset === "all" ? "" : today;
      filters.dateFrom =
        button.dataset.historyPreset === "today"
          ? today
          : button.dataset.historyPreset === "7days"
            ? shiftedDate(-6)
            : button.dataset.historyPreset === "month"
              ? `${today.slice(0, 7)}-01`
              : "";
      render();
    });
  });
  document.querySelector("[data-history-clear]")?.addEventListener("click", () => {
    state.evidenceFilters = {
      query: "",
      dateBasis: "work",
      dateFrom: "",
      dateTo: "",
      slot: "all",
      runId: "all",
      groupId: "all",
      source: "all",
      status: "all",
      timeFrom: "",
      timeTo: "",
      view: "run",
      sort: "newest",
    };
    render();
  });
}

async function importCsv(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const body = new FormData();
  body.append("file", file);
  try {
    const result = await api("/api/groups/import", { method: "POST", body });
    await refreshAll();
    render();
    toast(`นำเข้า ${result.imported} กลุ่ม${result.errors.length ? ` · ผิดพลาด ${result.errors.length} แถว` : ""}`);
  } catch (error) {
    toast(error.message, "error");
  }
}

async function handleAction(button, options = {}) {
  const action = button.dataset.action;
  try {
    if (action === "new-draft" || action === "go-compose") {
      state.editingDraftId = null;
      state.pendingFiles = [];
      navigate("compose");
    } else if (action === "new-slot") {
      state.editingDraftId = null;
      state.pendingFiles = [];
      navigate("compose");
      document.querySelector('[name="slot"]').value = button.dataset.slot;
    } else if (action === "edit-draft") {
      state.editingDraftId = button.dataset.id;
      state.pendingFiles = [];
      navigate("compose");
    } else if (action === "clear-draft") {
      state.editingDraftId = null;
      state.pendingFiles = [];
      render();
    } else if (action === "go-runs") {
      navigate("runs");
    } else if (action === "go-groups") {
      navigate("groups");
    } else if (action === "go-pending") {
      navigate("pending");
    } else if (action === "toggle-pending-custom") {
      if (button.checked) state.pendingCustomSelected.add(button.dataset.id);
      else state.pendingCustomSelected.delete(button.dataset.id);
      render();
    } else if (action === "toggle-pending-group") {
      if (button.checked) state.pendingSelected.add(button.dataset.id);
      else state.pendingSelected.delete(button.dataset.id);
      render();
    } else if (action === "toggle-pending-all") {
      const groups = (state.pendingCleanup?.groups || []).filter(
        (group) => group.pendingCount > 0,
      );
      if (button.checked) for (const group of groups) state.pendingSelected.add(group.id);
      else for (const group of groups) state.pendingSelected.delete(group.id);
      render();
    } else if (action === "expand-pending-group") {
      const id = button.dataset.id;
      if (state.pendingExpanded.has(id)) state.pendingExpanded.delete(id);
      else state.pendingExpanded.add(id);
      render();
    } else if (action === "start-pending-scan" || action === "rescan-pending") {
      const scope = action === "rescan-pending" ? state.pendingCleanup?.scope || state.pendingScope : state.pendingScope;
      await api("/api/pending-cleanup/scan/start", {
        method: "POST",
        body: JSON.stringify({
          scope,
          groupIds: scope === "custom" ? [...state.pendingCustomSelected] : [],
          deleteMode: "all",
          olderThanDays: 0,
        }),
      });
      state.pendingSelectionInitFor = null;
      state.pendingExpanded.clear();
      await refreshAll();
      render();
      toast("เริ่มตรวจหาโพสต์ค้างแล้ว");
    } else if (action === "stop-pending-scan") {
      await api("/api/pending-cleanup/scan/stop", { method: "POST" });
      await refreshAll();
      render();
      toast("จะหยุดหลังตรวจกลุ่มปัจจุบันเสร็จ");
    } else if (action === "stop-pending-delete") {
      await api("/api/pending-cleanup/delete/stop", { method: "POST" });
      await refreshAll();
      render();
      toast("จะหยุดหลังลบโพสต์ปัจจุบันเสร็จ");
    } else if (action === "start-pending-delete") {
      if (!document.querySelector("#pendingAck")?.checked) {
        toast("กรุณาติ๊กยืนยันว่าเข้าใจว่าลบแล้วกู้คืนไม่ได้", "error");
        return;
      }
      const selected = [...state.pendingSelected];
      const groups = (state.pendingCleanup?.groups || []).filter((group) =>
        state.pendingSelected.has(group.id),
      );
      const posts = groups.reduce((total, group) => total + group.pendingCount, 0);
      const typed = window.prompt(
        `จะลบโพสต์ค้างสูงสุด ${posts} โพสต์ ใน ${groups.length} กลุ่ม และกู้คืนไม่ได้
พิมพ์ ลบ เพื่อยืนยัน:`,
        "",
      );
      if ((typed || "").trim() !== "ลบ") {
        toast("ยกเลิกการลบแล้ว");
        return;
      }
      await api("/api/pending-cleanup/select", {
        method: "POST",
        body: JSON.stringify({ groupIds: selected }),
      });
      await api("/api/pending-cleanup/delete/start", {
        method: "POST",
        body: JSON.stringify({
          // Facebook scrambles the timestamp text on this page, so an age filter
          // cannot be honoured; the sweep always deletes every pending post.
          deleteMode: "all",
          olderThanDays: 0,
          acknowledged: true,
        }),
      });
      await refreshAll();
      render();
      toast("เริ่มลบโพสต์ค้างแล้ว");
    } else if (action === "delete-media") {
      await api(`/api/media/${button.dataset.id}`, { method: "DELETE" });
      await refreshAll();
      render();
      toast("ลบรูปแล้ว");
    } else if (action === "remove-pending") {
      state.pendingFiles.splice(Number(button.dataset.index), 1);
      renderPendingImages();
    } else if (action === "add-group") {
      groupForm.reset();
      groupDialog.showModal();
    } else if (action === "close-group") {
      groupForm.reset();
      groupDialog.close();
    } else if (action === "open-scan") {
      renderScanDialog();
      scanDialog.showModal();
    } else if (action === "close-scan") {
      scanDialog.close();
      await refreshAll();
      render();
    } else if (action === "manage-evidence") {
      state.evidenceTargetId = button.dataset.target;
      renderEvidenceDialog();
      evidenceDialog.showModal();
    } else if (action === "close-evidence") {
      evidenceDialog.close();
      state.evidenceTargetId = null;
      await refreshAll();
      render();
    } else if (action === "save-evidence-note") {
      const note = document.querySelector(`#evidenceNote-${button.dataset.id}`)?.value || "";
      const data = new FormData();
      data.append("note", note);
      await api(`/api/manual-evidence/${button.dataset.id}`, {
        method: "PUT",
        body: data,
      });
      await refreshManualEvidence();
      renderEvidenceDialog();
      toast("บันทึกหมายเหตุแล้ว");
    } else if (action === "choose-evidence-replacement") {
      document.querySelector(`#evidenceReplace-${button.dataset.id}`)?.click();
    } else if (action === "delete-manual-evidence") {
      const accepted = window.confirm(
        "ลบหลักฐานที่อัปโหลดนี้ใช่ไหม?\n\nไฟล์จะถูกลบออกจากเครื่องและไม่สามารถกู้คืนจากแอปได้",
      );
      if (!accepted) return;
      await api(`/api/manual-evidence/${button.dataset.id}`, { method: "DELETE" });
      await refreshManualEvidence();
      renderEvidenceDialog();
      toast("ลบหลักฐานแล้ว");
    } else if (action === "start-scan") {
      const acknowledged = document.querySelector("#scanAck")?.checked;
      if (!acknowledged) {
        throw new Error("กรุณาติ๊กยืนยันสิทธิ์ก่อนเริ่มสแกน");
      }
      await api("/api/groups/scan/start", {
        method: "POST",
        body: JSON.stringify({ acknowledged: true }),
      });
      await refreshAll();
      renderScanDialog();
      toast("เริ่มสแกนแล้ว ดูความคืบหน้าได้ใน Chromium และหน้าต่างนี้");
    } else if (action === "stop-scan") {
      await api("/api/groups/scan/stop", { method: "POST" });
      await refreshAll();
      renderScanDialog();
      toast("ระบบจะหยุดหลังจบรอบปัจจุบันและบันทึกกลุ่มที่พบ");
    } else if (action === "import-csv") {
      document.querySelector("#csvInput")?.click();
    } else if (action === "clear-selection") {
      state.selectedGroups.clear();
      render();
    } else if (action === "create-run") {
      const draftId = document.querySelector("#runDraft")?.value;
      const mode = document.querySelector("#runMode")?.value;
      const workflow =
        mode === "dry-run"
          ? "sequential"
          : document.querySelector("#runWorkflow")?.value || "hybrid-tabs";
      const tabLimitValue = document.querySelector("#runTabLimit")?.value;
      const tabLimit =
        workflow === "hybrid-windows"
          ? Number(tabLimitValue || 30)
          : Number(tabLimitValue || 10);
      const autoConfirm = Boolean(document.querySelector("#runAutoConfirm")?.checked);
      if (!draftId) throw new Error("กรุณาเลือก Draft");
      if (autoConfirm && mode === "assisted") {
        const confirmed = window.confirm(
          "คุณกำลังสร้างคิวโหมดโพสต์อัตโนมัติ (Auto-confirm)\n\nกรุณายืนยันว่า:\n1. ได้ตรวจข้อความ รูปภาพ และรายชื่อกลุ่มทั้งหมดแล้ว\n2. บัญชี Facebook ปัจจุบันไม่ได้ติด Security Check/CAPTCHA\n\nระบบจะทยอยกดโพสต์ให้อัตโนมัติและหยุดทันทีหากพบปัญหา\n\nกด OK เพื่อยืนยันและเริ่มงาน",
        );
        if (!confirmed) return;
      }
      await api("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          draftId,
          mode,
          workflow,
          tabLimit,
          autoConfirm,
          groupIds: [...state.selectedGroups],
        }),
      });
      state.selectedGroups.clear();
      await refreshAll();
      toast(
        mode === "assisted"
          ? autoConfirm
            ? "สร้างคิวโพสต์อัตโนมัติสำเร็จ กดเริ่มคิวเพื่อทำงาน"
            : "สร้างคิวโพสต์จริงแล้ว กดเริ่มคิวเพื่อเตรียมโพสต์และยืนยันทีละกลุ่ม"
          : "สร้าง Dry run แล้ว โหมดนี้ตรวจกลุ่มเท่านั้นและจะไม่โพสต์",
      );
      navigate("runs");
    } else if (action === "restart-draft-run") {
      const draftSelect = document.querySelector("#runDraft");
      const draftId = draftSelect?.value;
      const mode = document.querySelector("#runMode")?.value;
      const workflow =
        mode === "dry-run"
          ? "sequential"
          : document.querySelector("#runWorkflow")?.value || "hybrid-tabs";
      const tabLimitValue = document.querySelector("#runTabLimit")?.value;
      const tabLimit =
        workflow === "hybrid-windows"
          ? Number(tabLimitValue || 30)
          : Number(tabLimitValue || 10);
      const autoConfirm = Boolean(document.querySelector("#runAutoConfirm")?.checked);
      if (!draftId) throw new Error("กรุณาเลือก Draft");
      const draftLabel =
        draftSelect?.selectedOptions?.[0]?.textContent?.trim() || "Draft ที่เลือก";
      const typed = window.prompt(
        `เริ่มใหม่ทั้งหมดสำหรับ ${draftLabel}\n\nระบบจะลบ “ทุกคิวเดิม” ที่อ้าง Draft นี้ รวมสถานะไม่สำเร็จ ต้องตรวจ เผยแพร่แล้ว และหลักฐานของคิว จากนั้นสร้างคิวใหม่ด้วย ${state.selectedGroups.size.toLocaleString("th-TH")} กลุ่มที่เลือกอยู่\n\nDraft ข้อความ รูปต้นฉบับ และคลังกลุ่มจะไม่ถูกลบ แต่มีความเสี่ยงโพสต์ซ้ำหากรายการเดิมเคยถูกส่งจริง\n\nหากตรวจ Facebook แล้วและต้องการทำต่อ ให้พิมพ์: เริ่มใหม่ทั้งหมด`,
        "",
      );
      if (typed === null) return;
      if (typed.trim() !== "เริ่มใหม่ทั้งหมด") {
        toast("ยกเลิกการเริ่มใหม่ เพราะคำยืนยันไม่ถูกต้อง", "error");
        return;
      }
      if (autoConfirm && mode === "assisted") {
        const confirmed = window.confirm(
          "คุณกำลังสร้างคิวโหมดโพสต์อัตโนมัติ (Auto-confirm)\n\nกรุณายืนยันว่าได้ตรวจข้อความ รูปภาพ และกลุ่มทั้งหมดแล้ว\n\nกด OK เพื่อยืนยันและเริ่มงาน",
        );
        if (!confirmed) return;
      }
      const restarted = await api("/api/runs/restart-draft", {
        method: "POST",
        body: JSON.stringify({
          draftId,
          mode,
          workflow,
          tabLimit,
          autoConfirm,
          groupIds: [...state.selectedGroups],
          acknowledgedUncertain: true,
          acknowledgedPosted: true,
        }),
      });
      state.selectedGroups.clear();
      await refreshAll();
      toast(
        `ล้างคิวเดิม ${restarted.reset?.deletedRunCount || 0} คิวแล้ว และสร้างคิวใหม่ ${restarted.targets?.length || 0} กลุ่มสำเร็จ`,
      );
      navigate("runs");
    } else if (action === "clone-assisted-run") {
      const sourceRun = state.runs.find((run) => run.id === button.dataset.id);
      const groupIds = (sourceRun?.targets || [])
        .map((target) => target.groupId)
        .filter(Boolean);
      if (!sourceRun?.draftId || !groupIds.length) {
        throw new Error("ข้อมูล Dry run ไม่ครบ จึงสร้างคิวโพสต์จริงไม่ได้");
      }
      await api("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          draftId: sourceRun.draftId,
          mode: "assisted",
          workflow: "hybrid-tabs",
          tabLimit: 10,
          groupIds,
        }),
      });
      await refreshAll();
      render();
      toast("สร้างคิวโพสต์จริงจาก Dry run แล้ว กดเริ่มคิวเพื่อทำงานต่อ");
    } else if (action === "retry-failed-run") {
      const sourceRun = state.runs.find((run) => run.id === button.dataset.id);
      const groupIds = (sourceRun?.targets || [])
        .filter((target) => target.status === "failed")
        .map((target) => target.groupId)
        .filter(Boolean);
      if (!sourceRun?.draftId || !groupIds.length) {
        throw new Error("ไม่พบรายการที่ไม่สำเร็จสำหรับลองใหม่");
      }
      await api("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          draftId: sourceRun.draftId,
          mode: "assisted",
          workflow: "hybrid-tabs",
          tabLimit: 10,
          groupIds,
        }),
      });
      await refreshAll();
      render();
      toast("สร้างคิวลองใหม่แล้ว กดเริ่มคิวเพื่อเตรียมโพสต์อีกครั้ง");
    } else if (action === "delete-run") {
      const sourceRun = state.runs.find((run) => run.id === button.dataset.id);
      if (!sourceRun) throw new Error("ไม่พบคิวที่ต้องการลบ");
      const uncertainCount = Number(button.dataset.uncertain || 0);
      const postedCount = Number(button.dataset.posted || 0);
      let acknowledgedPosted = false;
      if (postedCount > 0) {
        const typed = window.prompt(
          `คิวนี้มี ${postedCount} รายการที่เผยแพร่แล้วหรือรอแอดมิน\n\nการลบจะลบประวัติและหลักฐานทั้งคิว และอาจทำให้โพสต์ซ้ำเมื่อเริ่มใหม่\n\nหากตรวจ Facebook แล้วและต้องการลบจริง ให้พิมพ์: ลบทั้งคิว`,
          "",
        );
        if (typed === null) return;
        if (typed.trim() !== "ลบทั้งคิว") {
          toast("ยกเลิกการลบ เพราะคำยืนยันไม่ถูกต้อง", "error");
          return;
        }
        acknowledgedPosted = true;
      } else {
        const message = uncertainCount
          ? `คิวนี้มี ${uncertainCount} รายการที่ต้องตรวจด้วยตนเอง\n\nคุณตรวจ Facebook แล้วว่าไม่มีรายการใดถูกโพสต์จริงใช่ไหม?\n\nเมื่อลบ ระบบจะลบทั้งคิวและหลักฐาน แล้วคุณสามารถเลือกกลุ่มเดิมทั้งหมดเพื่อเริ่มใหม่`
          : "ลบทั้งคิวและหลักฐานของคิวนี้หรือไม่?\n\nDraft รูปต้นฉบับ และคลังกลุ่มจะยังอยู่ คุณสามารถเลือกกลุ่มเดิมทั้งหมดแล้วสร้างคิวใหม่ได้";
        if (!window.confirm(message)) return;
      }
      await api(`/api/runs/${sourceRun.id}`, {
        method: "DELETE",
        body: JSON.stringify({
          acknowledgedUncertain: uncertainCount > 0,
          acknowledgedPosted,
        }),
      });
      await refreshAll();
      render();
      toast("ลบทั้งคิวแล้ว สามารถเลือกกลุ่มเดิมทั้งหมดและสร้างคิวโพสต์ใหม่ได้");
    } else if (action === "start-run") {
      const sourceRun = state.runs.find((run) => run.id === button.dataset.id);
      await api(`/api/runs/${button.dataset.id}/start`, { method: "POST" });
      toast(
        sourceRun?.workflow === "hybrid-windows"
          ? `เริ่มคิวแล้ว ระบบจะแบ่งสูงสุด ${sourceRun.tabLimit || 30} แท็บต่อหน้าต่าง และจะไม่ปิดแท็บเอง`
          : "เริ่มคิวแล้ว ระบบจะเปิดแท็บ Facebook ใหม่ตามรูปแบบของคิว",
      );
      await refreshAll();
      render();
    } else if (action === "switch-workflow") {
      const workflow = button.dataset.workflow;
      await api(`/api/runs/${button.dataset.id}/workflow`, {
        method: "POST",
        body: JSON.stringify({
          workflow,
          tabLimit: workflow === "hybrid-windows" ? 30 : 10,
        }),
      });
      await refreshAll();
      render();
      toast(
        workflow === "hybrid-windows"
          ? "เปลี่ยนเป็นหลายหน้าต่าง สูงสุด 30 แท็บต่อหน้าต่าง และไม่ปิดแท็บเองแล้ว"
          : "เปลี่ยนเป็น Hybrid เติมงานต่อเนื่องแล้ว",
      );
    } else if (action === "pause-run" || action === "resume-run" || action === "stop-run") {
      const endpoint = action.split("-")[0];
      const sourceRun = state.runs.find((run) => run.id === button.dataset.id);
      await api(`/api/runs/${button.dataset.id}/${endpoint}`, { method: "POST" });
      await refreshAll();
      render();
      if (action === "stop-run" && sourceRun?.workflow === "hybrid-windows") {
        toast("หยุดคิวแล้ว แท็บและหน้าต่าง Facebook ยังคงเปิดอยู่ คุณเป็นผู้ปิดเอง");
      }
    } else if (action === "bulk-mark-posted") {
      const runId = button.dataset.run;
      const targetIds = [...state.selectedRunTargets].filter((targetId) => {
        const context = findTargetContext(targetId);
        return context?.run.id === runId && isBulkMarkable(context.run, context.target);
      });
      if (!targetIds.length) {
        throw new Error("กรุณาติ๊กอย่างน้อยหนึ่งกลุ่มที่คุณโพสต์เองแล้ว");
      }
      const accepted = window.confirm(
        `คุณกด Post ใน Facebook เองและเห็นโพสต์ของทั้ง ${targetIds.length.toLocaleString("th-TH")} กลุ่มแล้วใช่ไหม?\n\nระบบจะไล่เก็บหลักฐานทีละแท็บและจะไม่กด Post ซ้ำ`,
      );
      if (!accepted) return;
      state.bulkMarkPosted = {
        runId,
        targetIds: [...targetIds],
      };
      render();
      try {
        let result = await api(`/api/runs/${runId}/targets/mark-posted-bulk`, {
          method: "POST",
          body: JSON.stringify({ targetIds }),
        });
        // A server process started before the bulk endpoint was added returns
        // index.html from its SPA fallback. Preserve the active Facebook tabs
        // and temporarily use the existing per-target endpoint instead.
        if (
          !result ||
          typeof result.succeeded !== "number" ||
          typeof result.failed !== "number"
        ) {
          const results = [];
          for (const targetId of targetIds) {
            try {
              await api(`/api/runs/${runId}/targets/${targetId}/action`, {
                method: "POST",
                body: JSON.stringify({ action: "mark-posted" }),
              });
              results.push({ targetId, ok: true });
            } catch (error) {
              results.push({
                targetId,
                ok: false,
                message: error instanceof Error ? error.message : String(error),
              });
            }
            await refreshAll();
            render();
          }
          const succeeded = results.filter((item) => item.ok).length;
          result = {
            total: results.length,
            succeeded,
            failed: results.length - succeeded,
            results,
          };
        }
        toast(
          result.failed
            ? `บันทึกสำเร็จ ${result.succeeded}/${result.total} รายการ · มี ${result.failed} รายการต้องตรวจ`
            : `บันทึกว่าโพสต์เองแล้วและเก็บหลักฐานครบ ${result.succeeded} รายการ`,
          result.failed ? "error" : "success",
        );
      } finally {
        targetIds.forEach((targetId) => state.selectedRunTargets.delete(targetId));
        state.bulkMarkPosted = null;
        await refreshAll();
        render();
      }
    } else if (action === "target-action") {
      if (button.dataset.value === "confirm") {
        const accepted = window.confirm(
          "ตรวจข้อความ รูป และชื่อกลุ่มในแท็บ Facebook แล้วใช่ไหม?\n\nกดตกลงเพื่อให้ระบบคลิกปุ่ม Post จริงในแท็บนี้",
        );
        if (!accepted) return;
      } else if (
        button.dataset.value === "mark-posted" &&
        !options.skipMarkPostedConfirmation
      ) {
        const accepted = window.confirm(
          "คุณกด Post ใน Facebook เองและเห็นโพสต์ปรากฏแล้วใช่ไหม?\n\nระบบจะไม่กด Post ซ้ำ แต่จะเก็บหลักฐานและบันทึกว่าเผยแพร่แล้ว",
        );
        if (!accepted) return;
      }
      const reason =
        button.dataset.value === "skip"
          ? window.prompt("เหตุผลที่ข้าม (เว้นว่างได้)", "")
          : undefined;
      if (button.dataset.value === "skip" && reason === null) return;
      await api(`/api/runs/${button.dataset.run}/targets/${button.dataset.target}/action`, {
        method: "POST",
        body: JSON.stringify({ action: button.dataset.value, reason }),
      });
      const sourceRun = state.runs.find((run) => run.id === button.dataset.run);
      const keepOpenMessage =
        sourceRun?.workflow === "hybrid-windows"
          ? " แท็บจะยังเปิดอยู่จนกว่าคุณจะปิดเอง"
          : "";
      toast(
        button.dataset.value === "confirm"
          ? `ระบบกด Post แล้วและกำลังเก็บหลักฐาน${keepOpenMessage}`
          : button.dataset.value === "mark-posted"
            ? `${options.skipMarkPostedConfirmation ? "ทางลัด 3 คลิก · " : ""}บันทึกว่าโพสต์เองแล้วและเก็บหลักฐานเรียบร้อย${keepOpenMessage}`
            : `ข้ามกลุ่มนี้พร้อมเก็บหลักฐานแล้ว${keepOpenMessage}`,
      );
      window.setTimeout(pollAndRender, 1000);
    } else if (action === "focus-target") {
      await api(
        `/api/runs/${button.dataset.run}/targets/${button.dataset.target}/focus`,
        { method: "POST" },
      );
      toast("เปิดแท็บ Facebook ของกลุ่มนี้แล้ว");
    } else if (action === "reconcile-posted") {
      const accepted = window.confirm(
        "คุณตรวจแล้วว่าโพสต์นี้เผยแพร่ใน Facebook จริงใช่ไหม?\n\nระบบจะเปิดกลุ่มเพื่อเก็บหลักฐานย้อนหลังและจะไม่กด Post ซ้ำ",
      );
      if (!accepted) return;
      await api(
        `/api/runs/${button.dataset.run}/targets/${button.dataset.target}/reconcile-posted`,
        { method: "POST" },
      );
      await refreshAll();
      render();
      toast("กระทบยอดเป็นเผยแพร่แล้วและเก็บหลักฐานย้อนหลังเรียบร้อย");
    } else if (action === "connect-session") {
      toast("กำลังเปิด Chromium กรุณาล็อกอินในหน้าต่างที่เปิดขึ้น");
      await api("/api/session/connect", { method: "POST" });
      await refreshAll();
      render();
    } else if (action === "check-session" || action === "refresh") {
      await refreshAll();
      render();
      toast("อัปเดตสถานะแล้ว");
    } else if (action === "close-session") {
      await api("/api/session/close", { method: "POST" });
      await refreshAll();
      render();
      toast("ปิด Browser แล้ว");
    }
  } catch (error) {
    toast(error.message, "error");
  }
}

groupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(groupForm));
  try {
    await api("/api/groups", {
      method: "POST",
      body: JSON.stringify({
        name: values.name,
        url: values.url,
        province: values.province,
        tags: String(values.tags || "")
          .split("|")
          .map((item) => item.trim())
          .filter(Boolean),
        canPost: values.canPost,
        requiresApproval: values.requiresApproval === "on",
        note: values.note,
      }),
    });
    groupDialog.close();
    await refreshAll();
    render();
    toast("เพิ่มกลุ่มแล้ว");
  } catch (error) {
    toast(error.message, "error");
  }
});

const markPostedClickState = new WeakMap();

function scheduleMarkPostedAction(button, event) {
  event.preventDefault();
  const previous = markPostedClickState.get(button);
  if (previous?.timer) window.clearTimeout(previous.timer);
  const count = (previous?.count || 0) + 1;
  if (count >= 3 || event.detail >= 3) {
    markPostedClickState.delete(button);
    void handleAction(button, { skipMarkPostedConfirmation: true });
    return;
  }
  const timer = window.setTimeout(() => {
    markPostedClickState.delete(button);
    void handleAction(button);
  }, 550);
  markPostedClickState.set(button, { count, timer });
}

document.addEventListener("change", (event) => {
  const targetCheckbox = event.target.closest(".target-bulk-check");
  if (targetCheckbox) {
    if (targetCheckbox.checked) state.selectedRunTargets.add(targetCheckbox.dataset.target);
    else state.selectedRunTargets.delete(targetCheckbox.dataset.target);
    render();
    return;
  }
  const selectAll = event.target.closest("[data-bulk-select-all]");
  if (selectAll) {
    const run = state.runs.find((item) => item.id === selectAll.dataset.bulkSelectAll);
    for (const target of run?.targets || []) {
      if (!isBulkMarkable(run, target)) continue;
      if (selectAll.checked) state.selectedRunTargets.add(target.id);
      else state.selectedRunTargets.delete(target.id);
    }
    render();
  }
});

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-route]");
  if (nav) navigate(nav.dataset.route);
  const action = event.target.closest("[data-action]");
  if (
    action?.dataset.action === "target-action" &&
    action.dataset.value === "mark-posted"
  ) {
    scheduleMarkPostedAction(action, event);
    return;
  }
  if (action) void handleAction(action);
});

async function pollAndRender() {
  try {
    await refreshAll();
    const editingHistoryFilter =
      (state.route === "history" &&
        document.activeElement?.closest?.(".evidence-filter-panel")) ||
      (state.route === "pending" &&
        document.activeElement?.closest?.(".panel") &&
        ["INPUT", "SELECT"].includes(document.activeElement?.tagName));
    if (
      ["dashboard", "runs", "history", "settings", "pending"].includes(state.route) &&
      !editingHistoryFilter
    ) {
      render();
    }
    if (scanDialog.open) renderScanDialog();
  } catch {
    // The local server may be restarting; the next poll will recover.
  }
}

await refreshAll()
  .then(() => render())
  .catch((error) => {
    app.innerHTML = `<div class="empty-state"><h2>เปิดแอปไม่สำเร็จ</h2><p>${escapeHtml(error.message)}</p></div>`;
  });

window.setInterval(pollAndRender, 3000);
