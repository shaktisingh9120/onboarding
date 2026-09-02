// ============================================================
//  FLABS – Lab Onboarding  |  Firebase Firestore + Storage
//  v2 — onboarding stages, daily logs, 6 PM report
// ============================================================

// ── Firebase init ──────────────────────────────────────────
firebase.initializeApp(firebaseConfig);
const db        = firebase.firestore();
const storage   = firebase.storage();
const labsCol   = db.collection("labs");
const logsCol   = db.collection("daily_logs");
const reportCol = db.collection("daily_reports");

// ── Onboarding pipeline: Assigned → Live ────────────────────
const STAGES = [
  "Assigned",
  "Kickoff & Requirements",
  "Data Migration",
  "Master Configuration",
  "Machine Interfacing",
  "Staff Training",
  "UAT / Trial Run",
  "Go-Live",
  "Live"
];

// ── Lab status: one list, drives every status dropdown ──────
// Ordered as a lifecycle. Add or reorder here and all three
// selects, the filter and the bulk importer follow automatically.
const STATUSES = [
  "Yet to start",
  "Pending",
  "Under Onboarding",
  "Active",
  "Hold",
  "Live",
  "Inactive",
  "Lost"
];

// CSS-safe slug: "Under Onboarding" → "under-onboarding"
const statusSlug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ── Blocker taxonomy: the tag decides who owns the blocker ──
const BLOCKERS = {
  system: ["LIS bug / error", "Machine interfacing failed", "Report format issue",
           "Data migration issue", "API integration pending"],
  client: ["Test master not shared", "Rate list pending", "Agreement / payment stuck",
           "Staff unavailable for training", "Hardware / network not ready",
           "Report approval pending"],
  internal: ["Dev queue", "Awaiting sales input", "Resource unavailable"]
};
const BLOCKER_OWNER = {};
Object.entries(BLOCKERS).forEach(([owner, tags]) => tags.forEach(t => BLOCKER_OWNER[t] = owner));

const LOG_STATUS = { done: "Completed", progress: "In Progress", blocked: "Blocked" };

// ── State ──────────────────────────────────────────────────
let labs            = [];
let logs            = [];
let pendingFiles    = [];
let selectedDocType = "PDF Report";
let editingLogId    = null;

// ── Date helpers (local time — no UTC drift) ────────────────
const ymd      = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const today    = () => ymd(new Date());
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate()+1); return ymd(d); };
const pretty   = s => s ? s.split("-").reverse().join("/") : "—";
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

// ── Boot ───────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  setupDropZone();
  setupBulkZone();
  buildStageSelects();
  buildStatusSelects();
  buildBlockerSelect();
  document.getElementById("trackDate").value = today();
  listenToLabs();
  listenToLogs();
  tickShiftBar();
  setInterval(tickShiftBar, 30000);
  setInterval(checkAssignedOverdue, 5 * 60000); // re-check every 5 min — a lab can cross 7 days with no data change
});

function logout() {
  sessionStorage.clear();
  window.location.href = "../index.html";
}

// ── Real-time listeners ─────────────────────────────────────
function listenToLabs() {
  setFbStatus("connecting");
  labsCol.orderBy("createdAt", "desc").onSnapshot(snapshot => {
    labs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    populateLabSelect();
    populateNameLists();
    updateStats();
    checkAssignedOverdue();
    renderDirectory();
    renderDocs();
    renderReport();
    setFbStatus("connected");
  }, err => {
    console.error(err);
    setFbStatus("error");
    showToast("Firebase error: " + err.message, "danger");
  });
}

function listenToLogs() {
  logsCol.orderBy("date", "desc").limit(800).onSnapshot(snapshot => {
    logs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    updateStats();
    renderTracker();
    renderReport();
    renderDirectory();
  }, err => {
    console.error(err);
    showToast("Daily log error: " + err.message, "danger");
  });
}

function setFbStatus(state) {
  const el = document.getElementById("fbStatus");
  const map = {
    connecting: { cls: "firebase-badge connecting", text: "Connecting..." },
    connected:  { cls: "firebase-badge connected",  text: "Firebase Live" },
    error:      { cls: "firebase-badge error",      text: "Connection Error" }
  };
  el.className = map[state].cls;
  el.innerHTML = `<i class="bi bi-circle-fill me-1" style="font-size:8px"></i> ${map[state].text}`;
}

// ── Derived helpers ─────────────────────────────────────────
const stageIndex   = lab => Math.max(0, STAGES.indexOf(lab.stage || "Assigned"));
const stagePercent = lab => Math.round(stageIndex(lab) / (STAGES.length - 1) * 100);
const isLive       = lab => (lab.stage || "") === "Live";
// "In Onboarding" means actively moving through the pipeline — a lab put on
// Hold or marked Lost has left that flow, so both are excluded here and
// counted only under their own stat (Hold / Lost).
const inOnboarding = lab => !isLive(lab) && lab.status !== "Hold" && lab.status !== "Lost";
const labById      = id  => labs.find(l => l.id === id);

// A lab is overdue when its target go-live date has passed and it isn't Live yet.
const labOverdue = lab => !isLive(lab) && lab.goLiveTarget && lab.goLiveTarget < today();

// A blocked log stays blocked until someone changes its status — not just for one day.
const openBlocked  = () => logs.filter(l => l.status === "blocked");
const openEscalated= () => logs.filter(l => l.escalated && l.status !== "done");
const logsOn       = date => logs.filter(l => l.date === date);
const overdueLogs  = () => logs.filter(l => l.status !== "done" && l.dueDate && l.dueDate < today());

// ── Stats ───────────────────────────────────────────────────
function updateStats() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("statTotal",     labs.length);
  set("statOnboard",   labs.filter(inOnboarding).length);
  set("statLive",      labs.filter(isLive).length);
  set("statHold",      labs.filter(l => l.status === "Hold").length);
  set("statLost",      labs.filter(l => l.status === "Lost").length);
  set("statOverdue",   labs.filter(labOverdue).length + overdueLogs().length);
  set("statEscalated", openEscalated().length);
}

// ── Assigned > 7 days notifications ─────────────────────────
// Labs still moving through the pipeline (not Live/Hold/Lost) whose
// assignedOn date is more than 7 days ago. Bell badge + dropdown always
// reflect the live count; a one-time toast pops per lab per session the
// first time it crosses the 7-day mark, so refreshes don't spam it.
const ASSIGNED_ALERT_DAYS = 7;
const notifSeen = new Set(JSON.parse(sessionStorage.getItem("notifSeen") || "[]"));

function getAssignedOverdueLabs() {
  return labs
    .filter(l => inOnboarding(l) && l.assignedOn && daysBetween(l.assignedOn, today()) > ASSIGNED_ALERT_DAYS)
    .map(l => ({ ...l, daysSince: daysBetween(l.assignedOn, today()) }))
    .sort((a, b) => b.daysSince - a.daysSince);
}

function checkAssignedOverdue() {
  const overdue = getAssignedOverdueLabs();
  const badge = document.getElementById("notifBadge");
  const bell  = document.getElementById("notifBell");
  const list  = document.getElementById("notifList");
  if (!badge || !bell || !list) return;

  bell.classList.toggle("has-alerts", overdue.length > 0);
  badge.classList.toggle("d-none", overdue.length === 0);
  badge.textContent = overdue.length > 9 ? "9+" : overdue.length;

  list.innerHTML = overdue.length
    ? overdue.map(l => `
        <div class="notif-item" onclick="toggleNotifPanel(false); showDetail('${l.id}')">
          <div>
            <div class="notif-item-name">${esc(l.name)}</div>
            <div class="notif-item-sub">Assigned ${pretty(l.assignedOn)} · ${esc(l.stage || "Assigned")}</div>
          </div>
          <span class="notif-item-days">${l.daysSince}d</span>
        </div>`).join("")
    : `<div class="notif-empty"><i class="bi bi-check2-circle" style="font-size:22px"></i><br>Nothing over ${ASSIGNED_ALERT_DAYS} days</div>`;

  // Toast for newly-crossed labs only, once per lab per session.
  const fresh = overdue.filter(l => !notifSeen.has(l.id));
  if (fresh.length === 1) {
    showToast(`⏰ ${fresh[0].name} was assigned ${fresh[0].daysSince} days ago — still not live`, "warning");
  } else if (fresh.length > 1) {
    showToast(`⏰ ${fresh.length} labs have been assigned for more than ${ASSIGNED_ALERT_DAYS} days`, "warning");
  }
  fresh.forEach(l => notifSeen.add(l.id));
  if (fresh.length) sessionStorage.setItem("notifSeen", JSON.stringify([...notifSeen]));
}

function toggleNotifPanel(force) {
  const panel = document.getElementById("notifPanel");
  if (!panel) return;
  const show = typeof force === "boolean" ? force : panel.classList.contains("d-none");
  panel.classList.toggle("d-none", !show);
}

document.addEventListener("click", e => {
  const wrap  = document.getElementById("notifBell")?.closest(".notif-wrap");
  const panel = document.getElementById("notifPanel");
  if (wrap && panel && !wrap.contains(e.target)) panel.classList.add("d-none");
});

// ── Dashboard card → pipeline quick filters ─────────────────
// "In Onboarding" has no single dropdown value (it means "stage != Live"),
// so it's tracked separately and combined into filteredLabs() below.
// Clicking any other filter control cancels it, so it never lingers
// and produces a result the visible dropdowns don't explain.
let onboardingQuickFilter = false;

function clearOnboardingQuickFilter() { onboardingQuickFilter = false; }

function applyDashboardFilter(type) {
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal("filterLabName", "");
  setVal("filterAssignee", "");
  setVal("filterSalesPerson", "");
  setVal("filterStage", "");
  setVal("filterStatus", "");
  setVal("filterPriority", "");
  onboardingQuickFilter = false;

  if (type === "live")        setVal("filterStage", "Live");
  else if (type === "hold")   setVal("filterStatus", "Hold");
  else if (type === "lost")   setVal("filterStatus", "Lost");
  else if (type === "onboarding") onboardingQuickFilter = true;
  // "total" leaves every filter cleared

  switchTab("directory");
  renderDirectory();
}

// ── Shift bar: 09:00 → 18:00 countdown to the report ────────
function tickShiftBar() {
  const now  = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = 9 * 60, end = 18 * 60;
  const pct   = Math.max(0, Math.min(1, (mins - start) / (end - start)));
  const fill  = document.getElementById("shiftFill");
  const msg   = document.getElementById("shiftMsg");
  if (!fill) return;
  fill.style.width = (pct * 100) + "%";
  fill.classList.toggle("is-late", pct > 0.85);
  const left = end - mins;
  msg.textContent = mins < start ? "Shift not started"
    : left <= 0 ? "Report due now"
    : `${Math.floor(left/60)}h ${String(left%60).padStart(2,"0")}m to 6 PM report`;
}

// ── Tabs ────────────────────────────────────────────────────
const TABS = ["register", "bulk", "directory", "tracker", "report", "docs"];
function switchTab(tab) {
  TABS.forEach(t => {
    const pane = document.getElementById("tab-" + t);
    const btn  = document.getElementById("tab-" + t + "-btn");
    if (pane) pane.style.display = t === tab ? "block" : "none";
    if (btn)  btn.classList.toggle("active", t === tab);
  });
  if (tab === "report")  renderReport();
  if (tab === "tracker") renderTracker();
}

// ── Select builders ─────────────────────────────────────────
function buildStatusSelects() {
  const opts = STATUSES.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  const lead = { labStatus: "Select status", eStatus: "—", filterStatus: "All Status" };
  Object.entries(lead).forEach(([id, placeholder]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `<option value="">${esc(placeholder)}</option>` + opts;
  });
}

function buildStageSelects() {
  const opts = STAGES.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  ["labStage", "logStage", "filterStage", "eStage"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = (id === "filterStage" ? `<option value="">All Stages</option>` : "") + opts;
    if (id === "labStage") el.value = "Assigned";
  });
}

function buildBlockerSelect() {
  const el = document.getElementById("logBlocker");
  if (!el) return;
  const label = { system: "⚙️ System side", client: "🏢 Client side", internal: "🏠 Internal" };
  el.innerHTML = `<option value="">— no blocker —</option>` +
    Object.entries(BLOCKERS).map(([grp, list]) =>
      `<optgroup label="${label[grp]}">` +
      list.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("") +
      `</optgroup>`).join("");
}

function populateLabSelect() {
  const el = document.getElementById("logLab");
  if (!el) return;
  const cur = el.value;
  el.innerHTML = `<option value="">Select lab</option>` +
    labs.map(l => `<option value="${l.id}"${l.id === cur ? " selected" : ""}>${esc(l.name)}${l.city ? " — " + esc(l.city) : ""}</option>`).join("");

  const f = document.getElementById("filterLogLab");
  if (f) {
    const fc = f.value;
    f.innerHTML = `<option value="">All Labs</option>` +
      labs.map(l => `<option value="${l.id}"${l.id === fc ? " selected" : ""}>${esc(l.name)}</option>`).join("");
  }
}

// Every name that has ever been put on a lab — powers the filter and the type-aheads.
const allAssignees   = () => [...new Set(labs.map(l => (l.assignee    || "").trim()).filter(Boolean))].sort();
const allSalesPeople = () => [...new Set(labs.map(l => (l.salesPerson || "").trim()).filter(Boolean))].sort();

function populateNameLists() {
  const names = allAssignees();

  const f = document.getElementById("filterAssignee");
  if (f) {
    const cur = f.value;
    f.innerHTML = `<option value="">All Assignees</option><option value="__none__">— Unassigned —</option>` +
      names.map(n => `<option value="${esc(n)}"${n === cur ? " selected" : ""}>${esc(n)}</option>`).join("");
    f.value = cur;
  }

  const salesNames = allSalesPeople();
  const spf = document.getElementById("filterSalesPerson");
  if (spf) {
    const cur = spf.value;
    spf.innerHTML = `<option value="">All Sales Persons</option><option value="__none__">— Unassigned —</option>` +
      salesNames.map(n => `<option value="${esc(n)}"${n === cur ? " selected" : ""}>${esc(n)}</option>`).join("");
    spf.value = cur;
  }

  // Shared type-aheads so the same person isn't typed three different ways.
  const dl = document.getElementById("assigneeList");
  if (dl) dl.innerHTML = names.map(n => `<option value="${esc(n)}">`).join("");

  const sl = document.getElementById("salesList");
  if (sl) sl.innerHTML = salesNames.map(n => `<option value="${esc(n)}">`).join("");
}

// When a lab is picked, default the stage to whatever that lab is currently on,
// and pre-fill the owner with whoever the lab is assigned to.
function onLogLabChange() {
  const lab = labById(document.getElementById("logLab").value);
  if (!lab) return;
  document.getElementById("logStage").value = lab.stage || "Assigned";
  const owner = document.getElementById("logOwner");
  if (owner && !owner.value.trim() && lab.assignee) owner.value = lab.assignee;
}

function onLogStatusChange() {
  const blocked = document.getElementById("logStatus").value === "blocked";
  const sel = document.getElementById("logBlocker");
  sel.disabled = !blocked;
  if (!blocked) sel.value = "";
  // A blocker has to be tagged or the 6 PM report can't file it — so open the panel for them.
  if (blocked) toggleLogAdvanced(true);
}

// ── Doc type selector ────────────────────────────────────────
function selectDocType(type) {
  selectedDocType = type;
  const map = { "PDF Report":"pdf", "Excel / CSV":"excel", "Doctor List":"drlist", "Other":"other" };
  Object.entries(map).forEach(([k,v]) => {
    document.getElementById("dtype-" + v).classList.toggle("selected", k === type);
  });
}

// ── File upload (local staging) ──────────────────────────────
function setupDropZone() {
  const zone = document.getElementById("dropZone");
  zone.addEventListener("dragover",  e => { e.preventDefault(); zone.style.background = "#d0eaff"; });
  zone.addEventListener("dragleave", () => { zone.style.background = ""; });
  zone.addEventListener("drop", e => { e.preventDefault(); zone.style.background = ""; handleFiles(e.dataTransfer.files); });
}

const MAX_FILE_MB = 25;

function handleFiles(fileList) {
  Array.from(fileList).forEach(file => {
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      showToast(`"${file.name}" is ${fmtSize(file.size)} — over the ${MAX_FILE_MB} MB limit`, "danger");
      return;
    }
    // Same name + same doc type twice is nearly always a double-click, not intent.
    if (pendingFiles.some(f => f.name === file.name && f.docType === selectedDocType)) {
      showToast(`"${file.name}" is already staged`, "warning");
      return;
    }
    pendingFiles.push({
      file, name: file.name, size: file.size,
      mimeType: file.type || "application/octet-stream",
      docType: selectedDocType
    });
  });
  renderPendingFiles();
  document.getElementById("fileInput").value = "";
}

function renderPendingFiles() {
  const el = document.getElementById("pendingFileList");
  if (!pendingFiles.length) { el.innerHTML = ""; return; }
  el.innerHTML = pendingFiles.map((f, i) => `
    <div class="file-item">
      <i class="bi ${fileIcon(f.name)}" style="font-size:20px;color:#0f4c81;flex-shrink:0"></i>
      <span class="file-name">${esc(f.name)}</span>
      <span class="file-size">${fmtSize(f.size)}</span>
      <span class="dtype-badge ${dtypeBadgeClass(f.docType)}">${esc(f.docType)}</span>
      <button class="btn-remove" onclick="removePending(${i})"><i class="bi bi-x-circle-fill"></i></button>
    </div>`).join("");
}

function removePending(i) { pendingFiles.splice(i,1); renderPendingFiles(); }

// Storage failures arrive as codes, not sentences. Translate them into
// something that actually says what to go and fix.
function storageErrorMessage(err) {
  switch (err && err.code) {
    case "storage/unauthorized":
      return "Firebase Storage refused the upload (storage/unauthorized).\n\n" +
             "The Storage security rules are blocking it. This tool has no Firebase login, so any rule " +
             "that requires request.auth will always fail here.\n\n" +
             "Fix: Firebase Console → Storage → Rules (see storage.rules).";
    case "storage/unauthenticated":
      return "Storage wants a signed-in user (storage/unauthenticated). The Storage rules need loosening.";
    case "storage/retry-limit-exceeded":
      return "The upload timed out (storage/retry-limit-exceeded) — usually a slow or dropping connection. Try again, or try a smaller file.";
    case "storage/quota-exceeded":
      return "The Storage bucket is out of quota (storage/quota-exceeded).";
    case "storage/canceled":
      return "The upload was cancelled.";
    case "storage/unknown":
      return "Storage rejected the request (storage/unknown).\n\n" +
             "This is almost always CORS — it happens when the page is opened straight from a file:// path. " +
             "Run it from Firebase Hosting or localhost instead.";
    case "storage/bucket-not-found":
    case "storage/project-not-found":
      return "Storage bucket not found. Check storageBucket in firebase-config.js, and that Storage is switched on for the project.";
    default:
      return "Upload failed" + (err && err.code ? ` (${err.code})` : "") + ": " + ((err && err.message) || err);
  }
}

// Uploads everything staged and reports progress on the Save button.
// Throws on the first failure — the caller decides what to do about it.
async function uploadPendingFiles(labId, btn) {
  const out = [];
  for (let i = 0; i < pendingFiles.length; i++) {
    const pf   = pendingFiles[i];
    const safe = pf.name.replace(/[#?[\]*\\]/g, "_");   // characters Storage paths choke on
    const path = `labs/${labId}/${pf.docType.replace(/\//g,"-").replace(/ /g,"_")}/${Date.now()}_${safe}`;
    const ref  = storage.ref(path);

    // contentType matters — without it PDFs download as octet-stream
    // instead of opening in the browser.
    const task = ref.put(pf.file, {
      contentType: pf.mimeType,
      customMetadata: { docType: pf.docType, originalName: pf.name }
    });

    await new Promise((resolve, reject) => {
      task.on("state_changed",
        snap => {
          const pct = snap.totalBytes ? Math.round(snap.bytesTransferred / snap.totalBytes * 100) : 0;
          btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Uploading ${i+1}/${pendingFiles.length} — ${pct}%`;
        },
        reject, resolve);
    });

    out.push({ name: pf.name, size: pf.size, mimeType: pf.mimeType, docType: pf.docType, path, url: await ref.getDownloadURL() });
  }
  return out;
}

// ── Save lab ────────────────────────────────────────────────
async function saveLab() {
  const name     = document.getElementById("labName").value.trim();
  const status   = document.getElementById("labStatus").value;
  const priority = document.getElementById("labPriority").value;
  if (!name)     { showToast("Lab name is required", "danger"); return; }
  if (!status)   { showToast("Please select a status", "danger"); return; }
  if (!priority) { showToast("Please select a priority", "danger"); return; }

  const btn = document.getElementById("saveBtn");
  const restore = () => {
    btn.disabled  = false;
    btn.innerHTML = `<i class="bi bi-save me-1"></i>Save Lab to Firebase`;
  };
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Saving to Firebase...`;

  const stage      = document.getElementById("labStage").value || "Assigned";
  const assignedOn = document.getElementById("labAssignedOn").value || today();

  // The ID is generated locally, so nothing is written to Firestore yet.
  // Files go up first; the lab document is written once, complete. If the
  // upload fails there is no half-saved lab left behind to duplicate.
  const docRef = labsCol.doc();
  let uploadedFiles = [];

  if (pendingFiles.length) {
    try {
      uploadedFiles = await uploadPendingFiles(docRef.id, btn);
    } catch (err) {
      console.error(err);
      const proceed = confirm(
        storageErrorMessage(err) +
        `\n\nSave "${name}" without its documents?\n\n` +
        `Cancel keeps the form exactly as it is so you can retry once Storage is sorted. ` +
        `Note that documents can only be attached while registering, so you'd have to re-register this lab to add them.`
      );
      if (!proceed) { restore(); return; }   // nothing written anywhere
      uploadedFiles = [];
    }
  }

  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Saving to Firebase...`;

  try {
    await docRef.set({
      name,
      code:         document.getElementById("labCode").value.trim(),
      status, priority,
      city:         document.getElementById("labCity").value.trim(),
      assignee:     document.getElementById("labAssignee").value.trim(),
      salesPerson:  document.getElementById("labSalesPerson").value.trim(),
      contact:      document.getElementById("labContact").value.trim(),
      email:        document.getElementById("labEmail").value.trim(),
      phone:        document.getElementById("labPhone").value.trim(),
      notes:        document.getElementById("labNotes").value.trim(),
      stage,
      assignedOn,
      goLiveTarget: document.getElementById("labGoLiveTarget").value || "",
      goLiveOn:     stage === "Live" ? today() : "",
      stageHistory: [{ stage, date: assignedOn }],
      files:        uploadedFiles,
      createdAt:    firebase.firestore.FieldValue.serverTimestamp()
    });

    showToast(uploadedFiles.length
      ? `✅ Lab saved with ${uploadedFiles.length} document${uploadedFiles.length === 1 ? "" : "s"}`
      : "✅ Lab saved to Firebase!");
    resetForm();
  } catch (err) {
    console.error(err);
    // The doc write failed after the files went up — don't leave them orphaned.
    for (const f of uploadedFiles) { try { await storage.ref(f.path).delete(); } catch (e) {} }
    showToast("❌ Could not save the lab: " + err.message, "danger");
  } finally {
    restore();
  }
}

function resetForm() {
  ["labName","labCode","labCity","labAssignee","labSalesPerson","labContact","labEmail","labPhone","labNotes","labGoLiveTarget"].forEach(id => {
    document.getElementById(id).value = "";
  });
  document.getElementById("labStatus").value     = "";
  document.getElementById("labPriority").value   = "";
  document.getElementById("labStage").value      = "Assigned";
  document.getElementById("labAssignedOn").value = today();
  pendingFiles = [];
  renderPendingFiles();
}

// ── Stage movement (writes the journey history) ──────────────
async function advanceStage(labId, direction) {
  const lab = labById(labId);
  if (!lab) return;
  const next = stageIndex(lab) + direction;
  if (next < 0 || next >= STAGES.length) return;
  const newStage = STAGES[next];

  const history = (lab.stageHistory || []).slice();
  if (direction > 0) history.push({ stage: newStage, date: today() });
  else history.pop();

  try {
    await labsCol.doc(labId).update({
      stage: newStage,
      stageHistory: history,
      goLiveOn: newStage === "Live" ? today() : "",
      status: newStage === "Live" ? "Live" : lab.status
    });
    showToast(`${lab.name} → ${newStage}`);
  } catch (err) {
    showToast("Error: " + err.message, "danger");
  }
}

// ══════════════════════════════════════════════════════════════
//  EDIT LAB
// ══════════════════════════════════════════════════════════════
let editingLabId = null;

function openEditLab(id) {
  const l = labById(id);
  if (!l) { showToast("Lab not found", "danger"); return; }
  editingLabId = id;

  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val ?? ""; };
  set("eName",         l.name);
  set("eCode",         l.code);
  set("eStatus",       l.status);
  set("ePriority",     l.priority);
  set("eCity",         l.city);
  set("eAssignee",     l.assignee);
  set("eSalesPerson",  l.salesPerson);
  set("eContact",      l.contact);
  set("eEmail",        l.email);
  set("ePhone",        l.phone);
  set("eNotes",        l.notes);
  set("eStage",        l.stage || "Assigned");
  set("eAssignedOn",   l.assignedOn);
  set("eGoLiveTarget", l.goLiveTarget);
  set("eGoLiveOn",     l.goLiveOn);

  document.getElementById("editModalTitle").textContent = "Edit — " + (l.name || "Lab");
  onEditStageChange();

  // Close the detail modal first if it's open, so the two don't stack.
  const detail = bootstrap.Modal.getInstance(document.getElementById("detailModal"));
  if (detail) detail.hide();

  new bootstrap.Modal(document.getElementById("editModal")).show();
}

// The "Went Live" date only makes sense once the lab is actually Live.
function onEditStageChange() {
  const live = document.getElementById("eStage").value === "Live";
  const box  = document.getElementById("eGoLiveOnWrap");
  if (box) box.style.display = live ? "block" : "none";
  if (live && !document.getElementById("eGoLiveOn").value) {
    document.getElementById("eGoLiveOn").value = today();
  }
}

// Keep stageHistory honest when the stage is changed by hand rather than by the arrows.
function reconcileHistory(lab, newStage, assignedOn) {
  const oldIdx = STAGES.indexOf(lab.stage || "Assigned");
  const newIdx = STAGES.indexOf(newStage);
  let hist = (lab.stageHistory || []).slice();

  if (newIdx > oldIdx) {
    // Jumped forward — stamp the new stage with today.
    if (!hist.some(h => h.stage === newStage)) hist.push({ stage: newStage, date: today() });
  } else if (newIdx < oldIdx) {
    // Rolled back — drop everything past the new stage.
    hist = hist.filter(h => STAGES.indexOf(h.stage) <= newIdx);
  }

  if (!hist.length) hist = [{ stage: newStage, date: assignedOn || today() }];
  else if (assignedOn) hist[0] = { ...hist[0], date: assignedOn };
  return hist;
}

// daily_logs store the lab name for speed, so a rename has to reach them too.
async function cascadeRename(labId, name, city) {
  const snap = await logsCol.where("labId", "==", labId).get();
  if (snap.empty) return 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {          // Firestore caps a batch at 500
    const batch = db.batch();
    docs.slice(i, i + 400).forEach(d => batch.update(d.ref, { labName: name, labCity: city }));
    await batch.commit();
  }
  return docs.length;
}

async function saveLabEdit() {
  if (!editingLabId) return;
  const lab = labById(editingLabId);
  if (!lab) { showToast("Lab not found", "danger"); return; }

  const val  = id => document.getElementById(id).value.trim();
  const name = val("eName");
  if (!name) { showToast("Lab name can't be empty", "danger"); document.getElementById("eName").focus(); return; }

  const btn = document.getElementById("eSaveBtn");
  btn.disabled  = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Saving...`;

  const newStage   = val("eStage") || "Assigned";
  const assignedOn = val("eAssignedOn");
  const city       = val("eCity");

  try {
    await labsCol.doc(editingLabId).update({
      name,
      code:         val("eCode"),
      status:       val("eStatus"),
      priority:     val("ePriority"),
      city,
      assignee:     val("eAssignee"),
      salesPerson:  val("eSalesPerson"),
      contact:      val("eContact"),
      email:        val("eEmail"),
      phone:        val("ePhone"),
      notes:        val("eNotes"),
      stage:        newStage,
      assignedOn,
      goLiveTarget: val("eGoLiveTarget"),
      goLiveOn:     newStage === "Live" ? (val("eGoLiveOn") || today()) : "",
      stageHistory: reconcileHistory(lab, newStage, assignedOn),
      updatedAt:    Date.now()
    });

    let touched = 0;
    if (name !== lab.name || city !== (lab.city || "")) {
      touched = await cascadeRename(editingLabId, name, city);
    }

    bootstrap.Modal.getInstance(document.getElementById("editModal")).hide();
    showToast(touched ? `✅ Updated — ${touched} log entr${touched === 1 ? "y" : "ies"} renamed too` : "✅ Lab updated");
    editingLabId = null;
  } catch (err) {
    console.error(err);
    showToast("❌ Error: " + err.message, "danger");
  } finally {
    btn.disabled  = false;
    btn.innerHTML = `<i class="bi bi-check-circle me-1"></i>Save changes`;
  }
}

// The pipeline's current filter, pulled out so the Excel export can reuse it.
function filteredLabs() {
  const sf = document.getElementById("filterStatus")?.value   || "";
  const pf = document.getElementById("filterPriority")?.value || "";
  const gf = document.getElementById("filterStage")?.value    || "";
  const af = document.getElementById("filterAssignee")?.value || "";
  const spf = document.getElementById("filterSalesPerson")?.value || "";
  const nf = (document.getElementById("filterLabName")?.value || "").trim().toLowerCase();
  return labs.filter(l =>
    (!sf || l.status === sf) && (!pf || l.priority === pf) && (!gf || (l.stage || "Assigned") === gf) &&
    (!af || (af === "__none__" ? !l.assignee : l.assignee === af)) &&
    (!spf || (spf === "__none__" ? !l.salesPerson : l.salesPerson === spf)) &&
    (!nf || (l.name || "").toLowerCase().includes(nf)) &&
    (!onboardingQuickFilter || inOnboarding(l)));
}

// ── Directory ────────────────────────────────────────────────
function renderDirectory() {
  const filtered = filteredLabs();

  const tbody = document.getElementById("labTableBody");
  if (!tbody) return;
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">No labs found</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((l, i) => {
    const pct     = stagePercent(l);
    const blocked = openBlocked().filter(x => x.labId === l.id).length;
    const days    = l.assignedOn ? daysBetween(l.assignedOn, isLive(l) && l.goLiveOn ? l.goLiveOn : today()) : null;
    // A future assigned date means onboarding hasn't started — a day count there is meaningless.
    const daysCell = days === null ? "—"
      : days < 0 ? `<span class="cell-sub">starts ${pretty(l.assignedOn)}</span>`
      : `<span class="days-pill">${days}d</span>`;
    return `
    <tr class="${[labOverdue(l) ? "row-overdue" : "", l.status === "Hold" ? "row-hold" : ""].filter(Boolean).join(" ")}">
      <td>${i+1}</td>
      <td>
        <strong>${esc(l.name)}</strong>
        <div class="cell-sub">${esc(l.city || "—")}${l.code ? " · " + esc(l.code) : ""}</div>
        <div class="mt-1">
          <span class="status-badge badge-status-${statusSlug(l.status)}">${l.status === "Hold" ? "⏸ " : ""}${esc(l.status || "—")}</span>
        </div>
        ${l.assignee
          ? `<span class="assignee-pill"><i class="bi bi-person-fill"></i>${esc(l.assignee)}</span>`
          : `<span class="assignee-pill is-none"><i class="bi bi-person-dash"></i>Unassigned</span>`}
      </td>
      <td style="min-width:170px">
        <div class="stage-name">${esc(l.stage || "Assigned")}</div>
        <div class="stage-track"><div class="stage-fill ${isLive(l) ? "is-live" : ""}" style="width:${pct}%"></div></div>
        <div class="cell-sub">${pct}% · step ${stageIndex(l)+1}/${STAGES.length}</div>
      </td>
      <td>
        <div class="btn-group btn-group-sm">
          <button class="btn btn-outline-secondary" onclick="advanceStage('${l.id}',-1)" title="Move back" ${stageIndex(l)===0?"disabled":""}><i class="bi bi-chevron-left"></i></button>
          <button class="btn btn-outline-success" onclick="advanceStage('${l.id}',1)" title="Move to next stage" ${isLive(l)?"disabled":""}><i class="bi bi-chevron-right"></i></button>
        </div>
      </td>
      <td>
        <div class="cell-sub">Assigned ${pretty(l.assignedOn)}</div>
        <div class="cell-sub ${labOverdue(l) ? "text-danger fw-bold" : ""}">
          ${isLive(l) ? "Live " + pretty(l.goLiveOn) : "Target " + pretty(l.goLiveTarget)}
        </div>
      </td>
      <td class="text-center">${daysCell}</td>
      <td><span class="priority-badge badge-priority-${esc(l.priority)}">${esc(l.priority)}</span></td>
      <td class="text-center">
        ${blocked ? `<span class="badge bg-danger">${blocked}</span>` : `<span class="text-muted">—</span>`}
      </td>
      <td>
        <div class="d-flex gap-1">
          <button class="btn btn-sm btn-outline-primary" onclick="showDetail('${l.id}')" title="Journey & documents"><i class="bi bi-eye"></i></button>
          <button class="btn btn-sm btn-outline-warning" onclick="openEditLab('${l.id}')" title="Edit lab details"><i class="bi bi-pencil-square"></i></button>
          <button class="btn btn-sm btn-outline-danger"  onclick="deleteLab('${l.id}')" title="Delete"><i class="bi bi-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

// ── Delete lab (and its logs) ────────────────────────────────
async function deleteLab(id) {
  if (!confirm("Delete this lab, its documents and its daily log history?")) return;
  try {
    const lab = labById(id);
    if (lab && lab.files) {
      for (const f of lab.files) { try { await storage.ref(f.path).delete(); } catch(e) {} }
    }
    const snap  = await logsCol.where("labId", "==", id).get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    await labsCol.doc(id).delete();
    showToast("Lab deleted");
  } catch(err) {
    showToast("Error: " + err.message, "danger");
  }
}

// ══════════════════════════════════════════════════════════════
//  DAILY TRACKER
// ══════════════════════════════════════════════════════════════

// The quick row covers most entries. Everything else lives behind this toggle.
function toggleLogAdvanced(force) {
  const box = document.getElementById("logAdvanced");
  const btn = document.getElementById("logMoreBtn");
  if (!box) return;
  const open = force !== undefined ? force : box.style.display === "none";
  box.style.display = open ? "flex" : "none";
  if (btn) btn.innerHTML = open
    ? `<i class="bi bi-chevron-up me-1"></i>Less`
    : `<i class="bi bi-sliders me-1"></i>More`;
}

async function saveLogEntry() {
  const labId    = document.getElementById("logLab").value;
  const activity = document.getElementById("logActivity").value.trim();
  const status   = document.getElementById("logStatus").value;
  if (!labId)    { showToast("Pick a lab first", "danger"); return; }
  if (!activity) { showToast("Write what happened", "danger"); return; }

  const lab = labById(labId);
  const entry = {
    labId,
    labName:   lab ? lab.name : "",
    labCity:   lab ? (lab.city || "") : "",
    date:      document.getElementById("trackDate").value || today(),
    activity,
    stage:     document.getElementById("logStage").value,
    owner:     document.getElementById("logOwner").value.trim(),
    status,
    blocker:   status === "blocked" ? document.getElementById("logBlocker").value : "",
    dueDate:   document.getElementById("logDue").value || "",
    escalated: document.getElementById("logEsc").checked,
    updatedAt: Date.now()
  };

  try {
    if (editingLogId) {
      await logsCol.doc(editingLogId).update(entry);
      showToast("Entry updated");
    } else {
      await logsCol.add({ ...entry, createdAt: Date.now() });
      showToast("✅ Logged");
    }
    resetLogForm();
  } catch (err) {
    showToast("Error: " + err.message, "danger");
  }
}

function resetLogForm() {
  editingLogId = null;
  ["logActivity","logOwner","logDue"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("logStatus").value = "done";
  document.getElementById("logEsc").checked  = false;
  document.getElementById("logBlocker").value = "";
  onLogStatusChange();
  toggleLogAdvanced(false);
  document.getElementById("logSaveBtn").innerHTML = `<i class="bi bi-plus-circle me-1"></i>Add entry`;
  document.getElementById("logCancelBtn").style.display = "none";
}

function editLog(id) {
  const l = logs.find(x => x.id === id);
  if (!l) return;
  editingLogId = id;
  document.getElementById("trackDate").value  = l.date;
  document.getElementById("logLab").value     = l.labId;
  document.getElementById("logActivity").value= l.activity;
  document.getElementById("logStage").value   = l.stage || "Assigned";
  document.getElementById("logOwner").value   = l.owner || "";
  document.getElementById("logStatus").value  = l.status;
  document.getElementById("logDue").value     = l.dueDate || "";
  document.getElementById("logEsc").checked   = !!l.escalated;
  onLogStatusChange();
  document.getElementById("logBlocker").value = l.blocker || "";
  // If the entry uses any of the extra fields, show them rather than hide the edit.
  toggleLogAdvanced(!!(l.blocker || l.dueDate || l.owner || l.escalated));
  document.getElementById("logSaveBtn").innerHTML = `<i class="bi bi-check-circle me-1"></i>Update entry`;
  document.getElementById("logCancelBtn").style.display = "inline-block";
  document.getElementById("logActivity").focus();
}

async function quickLogStatus(id, status) {
  try {
    await logsCol.doc(id).update({ status, blocker: status === "blocked" ? (logs.find(l=>l.id===id)?.blocker || "") : "" });
  } catch (err) { showToast("Error: " + err.message, "danger"); }
}

async function toggleLogEsc(id) {
  const l = logs.find(x => x.id === id);
  if (!l) return;
  try { await logsCol.doc(id).update({ escalated: !l.escalated }); }
  catch (err) { showToast("Error: " + err.message, "danger"); }
}

async function deleteLog(id) {
  if (!confirm("Remove this log entry?")) return;
  try { await logsCol.doc(id).delete(); showToast("Entry removed"); }
  catch (err) { showToast("Error: " + err.message, "danger"); }
}

function renderTracker() {
  const date  = document.getElementById("trackDate")?.value || today();
  const labF  = document.getElementById("filterLogLab")?.value || "";
  const box   = document.getElementById("trackerBody");
  if (!box) return;

  let list = logsOn(date).filter(l => !labF || l.labId === labF);
  const rank = { blocked: 0, progress: 1, done: 2 };
  list.sort((a,b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || (a.labName||"").localeCompare(b.labName||""));

  document.getElementById("trackCount").textContent =
    `${list.length} entr${list.length === 1 ? "y" : "ies"} on ${pretty(date)}`;

  if (!list.length) {
    box.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">
      Nothing logged for this date yet. Add the first entry above — the 6 PM report builds itself from these rows.
    </td></tr>`;
    return;
  }

  box.innerHTML = list.map(l => `
    <tr class="log-${esc(l.status)}">
      <td><strong>${esc(l.labName)}</strong><div class="cell-sub">${esc(l.labCity || "—")}</div></td>
      <td>${esc(l.activity)}</td>
      <td><span class="stage-pill">${esc(l.stage || "—")}</span></td>
      <td>${esc(l.owner || "—")}</td>
      <td style="min-width:130px">
        <select class="form-select form-select-sm" onchange="quickLogStatus('${l.id}', this.value)">
          ${Object.entries(LOG_STATUS).map(([k,v]) => `<option value="${k}"${l.status===k?" selected":""}>${v}</option>`).join("")}
        </select>
      </td>
      <td>${l.blocker ? `<span class="blk-pill blk-${BLOCKER_OWNER[l.blocker] || "internal"}">${esc(l.blocker)}</span>` : "—"}</td>
      <td class="${l.dueDate && l.dueDate < today() && l.status !== "done" ? "text-danger fw-bold" : ""}">${pretty(l.dueDate)}</td>
      <td>
        <div class="d-flex gap-1">
          <button class="btn btn-sm ${l.escalated ? "btn-danger" : "btn-outline-secondary"}" onclick="toggleLogEsc('${l.id}')" title="Escalate">🚨</button>
          <button class="btn btn-sm btn-outline-primary" onclick="editLog('${l.id}')" title="Edit"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteLog('${l.id}')" title="Delete"><i class="bi bi-trash"></i></button>
        </div>
      </td>
    </tr>`).join("");
}

function shiftTrackDate(days) {
  const el = document.getElementById("trackDate");
  const d  = new Date(el.value || today());
  d.setDate(d.getDate() + days);
  el.value = ymd(d);
  renderTracker();
}

// ══════════════════════════════════════════════════════════════
//  6 PM REPORT
// ══════════════════════════════════════════════════════════════
function labTag(x) {
  const city = x.labCity || x.city;
  return `${x.labName || x.name}${city ? ` (${city})` : ""}`;
}

function buildReport() {
  const D    = today();
  const dayLogs = logsOn(D);
  const none = "   • None";
  const join = arr => arr.length ? arr.join("\n") : none;

  // 🟢 Completed — today's finished work + any lab that moved a stage today
  const done = dayLogs.filter(l => l.status === "done")
    .map(l => `   • ${labTag(l)}: ${l.activity}${l.owner ? ` — ${l.owner}` : ""}`);
  const moved = labs.filter(l => (l.stageHistory || []).some(h => h.date === D))
    .map(l => {
      const h = (l.stageHistory || []).filter(x => x.date === D).pop();
      return `   • ${labTag(l)}: stage moved → ${h.stage}`;
    });

  // 🟡 In Progress
  const running = dayLogs.filter(l => l.status === "progress")
    .map(l => `   • ${labTag(l)}: ${l.activity}${l.owner ? ` — ${l.owner}` : ""}`);

  // 🔴 Blocked — every open blocker, not only today's
  const blocked = openBlocked()
    .map(l => `   • ${labTag(l)}: ${l.activity} [${l.blocker || "reason not tagged"}${l.date !== D ? `, since ${pretty(l.date)}` : ""}]`);

  // ⏳ Overdue — labs past go-live target + log items past their due date
  const overdue = [
    ...labs.filter(labOverdue).map(l =>
      `   • ${labTag(l)}: go-live target was ${pretty(l.goLiveTarget)}, still at ${l.stage || "Assigned"} (${daysBetween(l.goLiveTarget, D)}d late)`),
    ...overdueLogs().map(l => `   • ${labTag(l)}: ${l.activity} — due ${pretty(l.dueDate)}`)
  ];

  // 👤 Team performance — everyone who owns a lab or logged work
  const owners = [...new Set([...logs.map(l => l.owner), ...labs.map(l => l.assignee)].filter(Boolean))].sort();
  const perf = owners.map(o => {
    const closed  = dayLogs.filter(l => l.owner === o && l.status === "done").length;
    const open    = logs.filter(l => l.owner === o && l.status !== "done").length;
    const myLabs  = labs.filter(l => l.assignee === o && inOnboarding(l)).length;
    return `   • ${o}: ${closed} closed today, ${open} still open${myLabs ? `, ${myLabs} lab${myLabs===1?"":"s"} in onboarding` : ""}`;
  });
  const unassigned = labs.filter(l => !l.assignee && inOnboarding(l)).length;
  if (unassigned) perf.push(`   • Unassigned: ${unassigned} lab${unassigned===1?"":"s"} with no owner yet`);
  const teamNote = document.getElementById("rTeam")?.value.trim() || "";

  // ⚙️ / 🏢 — the blocker tag decides which bucket it lands in
  const bucket = own => openBlocked().filter(l => BLOCKER_OWNER[l.blocker] === own)
    .map(l => `   • ${l.blocker} — ${labTag(l)}`);

  // 🚨 Escalations
  const escalations = openEscalated()
    .map(l => `   • ${labTag(l)}: ${l.activity}${l.blocker ? ` — ${l.blocker}` : ""}`);

  // 🎯 Tomorrow
  const T = tomorrow();
  const nextDay = [
    ...logs.filter(l => l.dueDate === T && l.status !== "done").map(l => `   • ${labTag(l)}: ${l.activity}`),
    ...labs.filter(l => l.goLiveTarget === T && !isLive(l)).map(l => `   • ${labTag(l)}: go-live scheduled`)
  ];

  const extra = document.getElementById("rExtra")?.value.trim() || "";
  const dateStr = new Date().toLocaleDateString("en-IN", { weekday:"short", day:"2-digit", month:"short", year:"numeric" });

  let out =
`Enterprise Onboarding — 6 PM
${dateStr}

🟢 Completed:
${join([...done, ...moved])}

🟡 In Progress:
${join(running)}

🔴 Blocked:
${join(blocked)}

⏳ Overdue:
${join(overdue)}

👤 Team performance:
${join(perf)}${teamNote ? "\n   • " + teamNote.replace(/\n/g, "\n   • ") : ""}

⚙️ System issues:
${join(bucket("system"))}

🏢 Client-side issues:
${join(bucket("client"))}

🚨 Escalations required:
${join(escalations)}

🎯 Tomorrow's priorities:
${join(nextDay)}`;

  if (extra) out += `\n\n📝 Notes:\n   • ${extra.replace(/\n/g, "\n   • ")}`;

  out += `\n\n📊 Pipeline: ${labs.filter(inOnboarding).length} labs in onboarding · ${labs.filter(isLive).length} live`;
  return out;
}

function renderReport() {
  const el = document.getElementById("rOut");
  if (el) el.textContent = buildReport();
  renderPatterns();
}

async function copyReport() {
  const text = buildReport();
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove();
  }
  showToast("📋 Report copied — paste it into WhatsApp or Slack");
}

async function saveReport() {
  const D = today();
  try {
    await reportCol.doc(D).set({
      date: D,
      teamNote:  document.getElementById("rTeam").value.trim(),
      extraNote: document.getElementById("rExtra").value.trim(),
      text:      buildReport(),
      savedAt:   Date.now()
    });
    showToast("✅ Report archived for " + pretty(D));
  } catch (err) {
    showToast("Error: " + err.message, "danger");
  }
}

function downloadReport() {
  const blob = new Blob([buildReport()], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `onboarding_report_${today()}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Blocker patterns (why go-lives actually slip) ────────────
function renderPatterns() {
  const box = document.getElementById("patternBox");
  if (!box) return;
  const blocked = openBlocked().filter(l => l.blocker);
  const total   = blocked.length;

  if (!total) {
    box.innerHTML = `<p class="text-muted small mb-0">No open blockers right now. Tag every blocker with a reason — after a month this panel tells you which onboarding step to fix in the SOP.</p>`;
    return;
  }

  const byTag = {};
  blocked.forEach(l => byTag[l.blocker] = (byTag[l.blocker] || 0) + 1);
  const rows = Object.entries(byTag).sort((a,b) => b[1] - a[1]);
  const max  = rows[0][1];

  const sys = blocked.filter(l => BLOCKER_OWNER[l.blocker] === "system").length;
  const cli = blocked.filter(l => BLOCKER_OWNER[l.blocker] === "client").length;

  box.innerHTML = rows.map(([tag, n]) => `
    <div class="pat-bar">
      <div class="pat-top"><span>${esc(tag)}</span><span class="pat-n">${n} · ${Math.round(n/total*100)}%</span></div>
      <div class="pat-track"><div class="pat-fill pat-${BLOCKER_OWNER[tag] || "internal"}" style="width:${n/max*100}%"></div></div>
    </div>`).join("") +
    `<p class="pat-note">${total} open blockers — ${sys} on us, ${cli} on the client, ${total-sys-cli} internal.</p>`;
}

// ── Detail modal: the full journey, Assigned → Live ──────────
let viewingLabId = null;

function showDetail(id) {
  const l = labById(id);
  if (!l) return;
  viewingLabId = id;
  const created = l.createdAt?.toDate ? l.createdAt.toDate().toLocaleDateString("en-IN") : "—";
  const history = (l.stageHistory || []).slice();
  const curIdx  = stageIndex(l);

  // Stage timeline with days spent in each stage
  const timeline = STAGES.map((s, i) => {
    const hit  = history.find(h => h.stage === s);
    const next = history.find(h => STAGES.indexOf(h.stage) === i + 1);
    const state = hit ? (i === curIdx ? "current" : "done") : "todo";
    let meta = "Not reached";
    if (hit) {
      const endDate = next ? next.date : (i === curIdx ? today() : "");
      const d = endDate ? daysBetween(hit.date, endDate) : 0;
      meta = `${pretty(hit.date)}${i === curIdx && !isLive(l) ? ` · ${d}d here` : next ? ` · took ${d}d` : ""}`;
    }
    return `<div class="tl-item tl-${state}">
      <div class="tl-dot"></div>
      <div><div class="tl-stage">${esc(s)}</div><div class="tl-meta">${meta}</div></div>
    </div>`;
  }).join("");

  // Daily log grouped by date, newest first
  const mine = logs.filter(x => x.labId === id).sort((a,b) => b.date.localeCompare(a.date));
  const byDate = {};
  mine.forEach(x => (byDate[x.date] = byDate[x.date] || []).push(x));
  const logHtml = Object.keys(byDate).length
    ? Object.entries(byDate).map(([d, items]) => `
        <div class="day-block">
          <div class="day-head">${pretty(d)} <span class="text-muted">· ${items.length} entr${items.length===1?"y":"ies"}</span></div>
          ${items.map(x => `
            <div class="day-row day-${esc(x.status)}">
              <span class="day-status">${LOG_STATUS[x.status]}</span>
              <span class="day-act">${esc(x.activity)}</span>
              ${x.blocker ? `<span class="blk-pill blk-${BLOCKER_OWNER[x.blocker]||"internal"}">${esc(x.blocker)}</span>` : ""}
              ${x.owner ? `<span class="day-owner">${esc(x.owner)}</span>` : ""}
            </div>`).join("")}
        </div>`).join("")
    : `<p class="text-muted text-center py-3">No daily entries logged for this lab yet.</p>`;

  const totalDays = l.assignedOn ? daysBetween(l.assignedOn, isLive(l) && l.goLiveOn ? l.goLiveOn : today()) : "—";

  document.getElementById("modalLabName").textContent = l.name;
  document.getElementById("modalBody").innerHTML = `
    <div class="modal-detail-grid">
      <div class="modal-field"><label>Lab Code</label><span>${esc(l.code || "—")}</span></div>
      <div class="modal-field"><label>Current Stage</label><span>${esc(l.stage || "Assigned")} · ${stagePercent(l)}%</span></div>
      <div class="modal-field"><label>Assigned On</label><span>${pretty(l.assignedOn)}</span></div>
      <div class="modal-field"><label>${isLive(l) ? "Went Live" : "Go-Live Target"}</label>
        <span class="${labOverdue(l) ? "text-danger" : ""}">${pretty(isLive(l) ? l.goLiveOn : l.goLiveTarget)}</span></div>
      <div class="modal-field"><label>Days in Onboarding</label><span>${totalDays}${typeof totalDays === "number" ? " days" : ""}</span></div>
      <div class="modal-field"><label>Status</label>
        <span class="status-badge badge-status-${statusSlug(l.status)}">${esc(l.status || "—")}</span></div>
      <div class="modal-field"><label>Priority</label><span class="priority-badge badge-priority-${esc(l.priority)}">${esc(l.priority)}</span></div>
      <div class="modal-field"><label>City</label><span>${esc(l.city || "—")}</span></div>
      <div class="modal-field"><label>Assignee</label><span>${esc(l.assignee || "Unassigned")}</span></div>
      <div class="modal-field"><label>Sales Person</label><span>${esc(l.salesPerson || "—")}</span></div>
      <div class="modal-field"><label>Contact</label><span>${esc(l.contact || "—")}</span></div>
      <div class="modal-field"><label>Email</label><span>${esc(l.email || "—")}</span></div>
      <div class="modal-field"><label>Registered</label><span>${created}</span></div>
    </div>
    ${l.notes ? `<div class="alert alert-light border mb-3" style="font-size:13px"><strong>Notes:</strong> ${esc(l.notes)}</div>` : ""}

    <h6 class="modal-sec"><i class="bi bi-signpost-split me-1"></i>Onboarding journey</h6>
    <div class="timeline">${timeline}</div>

    <h6 class="modal-sec"><i class="bi bi-calendar3 me-1"></i>Daily record (${mine.length} entries)</h6>
    ${logHtml}

    <h6 class="modal-sec"><i class="bi bi-cloud me-1"></i>Documents (${(l.files||[]).length})</h6>
    ${(l.files||[]).length ? (l.files||[]).map(f => `
      <div class="doc-row">
        <i class="bi ${fileIcon(f.name)} doc-icon"></i>
        <div class="doc-info">
          <div class="doc-name">${esc(f.name)}</div>
          <div class="doc-lab">${esc(f.docType)} · ${fmtSize(f.size)}</div>
        </div>
        <a href="${esc(f.url)}" target="_blank" class="btn btn-sm btn-outline-primary"><i class="bi bi-download"></i></a>
      </div>`).join("") : `<p class="text-muted text-center py-3">No documents attached</p>`}
  `;
  new bootstrap.Modal(document.getElementById("detailModal")).show();
}

// ── Docs tab ─────────────────────────────────────────────────
function renderDocs() {
  const tf  = document.getElementById("filterDocType")?.value || "";
  const all = labs.flatMap(l => (l.files||[]).map(f => ({ ...f, labName: l.name })))
                  .filter(f => !tf || f.docType === tf);
  const el = document.getElementById("docsContainer");
  if (!el) return;
  if (!all.length) { el.innerHTML = `<p class="text-muted text-center py-4">No documents found</p>`; return; }
  el.innerHTML = all.map(f => `
    <div class="doc-row">
      <i class="bi ${fileIcon(f.name)} doc-icon"></i>
      <div class="doc-info">
        <div class="doc-name">${esc(f.name)}</div>
        <div class="doc-lab">${esc(f.labName)} · ${fmtSize(f.size)}</div>
      </div>
      <span class="dtype-badge ${dtypeBadgeClass(f.docType)}">${esc(f.docType)}</span>
      <a href="${esc(f.url)}" target="_blank" class="btn btn-sm btn-outline-primary"><i class="bi bi-download"></i></a>
    </div>`).join("");
}

// ── Export ZIP ───────────────────────────────────────────────
async function exportZip() {
  if (!labs.length) { showToast("No labs to export", "warning"); return; }
  showToast("⏳ Building ZIP from Firebase...");
  const zip = new JSZip();
  const manifest = [];

  for (const l of labs) {
    const folder = zip.folder(l.name.replace(/[^a-zA-Z0-9_\-]/g, "_"));
    const mine   = logs.filter(x => x.labId === l.id).sort((a,b) => a.date.localeCompare(b.date));
    const meta = {
      id: l.id, name: l.name, code: l.code, status: l.status, priority: l.priority,
      city: l.city, assignee: l.assignee || "", salesPerson: l.salesPerson || "", contact: l.contact, email: l.email, phone: l.phone, notes: l.notes,
      stage: l.stage, assignedOn: l.assignedOn, goLiveTarget: l.goLiveTarget, goLiveOn: l.goLiveOn,
      stageHistory: l.stageHistory || [],
      files: (l.files||[]).map(f => ({ name: f.name, type: f.docType, size: f.size, url: f.url }))
    };
    folder.file("lab_info.json", JSON.stringify(meta, null, 2));

    // per-lab day-by-day record, Assigned → Live
    const journey = [
      ["Date","Stage","Activity","Owner","Status","Blocker","Due","Escalated"],
      ...mine.map(x => [x.date, x.stage, x.activity, x.owner, LOG_STATUS[x.status], x.blocker, x.dueDate, x.escalated ? "Yes" : ""])
    ];
    folder.file("daily_record.csv", toCsv(journey));

    for (const f of (l.files||[])) {
      try {
        const arr = await (await fetch(f.url)).arrayBuffer();
        folder.folder(f.docType.replace(/\//g,"-").replace(/ /g,"_")).file(f.name, arr);
      } catch(e) { console.warn("Could not fetch:", f.name); }
    }
    manifest.push(meta);
  }

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("labs_summary.csv", toCsv([
    ["Lab Name","Code","Stage","% Complete","Assigned On","Go-Live Target","Went Live","Days","Priority","City","Assignee","Sales Person","Contact","Phone","Files"],
    ...labs.map(l => [
      l.name, l.code, l.stage || "Assigned", stagePercent(l) + "%",
      l.assignedOn, l.goLiveTarget, l.goLiveOn,
      l.assignedOn ? daysBetween(l.assignedOn, isLive(l) && l.goLiveOn ? l.goLiveOn : today()) : "",
      l.priority, l.city, l.assignee || "", l.salesPerson || "", l.contact, l.phone, (l.files||[]).length
    ])
  ]));
  zip.file("all_daily_logs.csv", toCsv([
    ["Date","Lab","City","Stage","Activity","Owner","Status","Blocker","Blocker Side","Due","Escalated"],
    ...logs.slice().sort((a,b) => a.date.localeCompare(b.date)).map(x => [
      x.date, x.labName, x.labCity, x.stage, x.activity, x.owner,
      LOG_STATUS[x.status], x.blocker, BLOCKER_OWNER[x.blocker] || "", x.dueDate, x.escalated ? "Yes" : ""
    ])
  ]));
  zip.file(`report_${today()}.txt`, buildReport());

  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "flabs_onboarding_" + today() + ".zip";
  a.click();
  URL.revokeObjectURL(a.href);
  showToast("✅ ZIP exported!");
}

const toCsv = rows => rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(",")).join("\n");

// ── Toast ────────────────────────────────────────────────────
function showToast(msg, type = "primary") {
  const el = document.getElementById("liveToast");
  document.getElementById("toastMsg").textContent = msg;
  el.className = `toast align-items-center text-bg-${type} border-0`;
  bootstrap.Toast.getOrCreateInstance(el, { delay: 3500 }).show();
}

// ── Helpers ──────────────────────────────────────────────────
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

function fmtSize(b) {
  if (!b) return "—";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b/1024).toFixed(1) + " KB";
  return (b/1048576).toFixed(1) + " MB";
}
function fileIcon(name) {
  const ext = (name||"").split(".").pop().toLowerCase();
  if (ext === "pdf") return "bi-file-earmark-pdf";
  if (["xls","xlsx"].includes(ext)) return "bi-file-earmark-spreadsheet";
  if (ext === "csv") return "bi-filetype-csv";
  if (["doc","docx"].includes(ext)) return "bi-file-earmark-word";
  return "bi-file-earmark";
}
function dtypeBadgeClass(type) {
  if (type === "PDF Report")  return "badge-dtype-pdf";
  if (type === "Excel / CSV") return "badge-dtype-excel";
  if (type === "Doctor List") return "badge-dtype-drlist";
  return "badge-dtype-other";
}

// ══════════════════════════════════════════════════════════════
//  BULK IMPORT — labs from an Excel / CSV sheet
// ══════════════════════════════════════════════════════════════

// Column → field. Every alias is matched lowercase with spaces/underscores stripped,
// so "Lab Name", "lab_name" and "LABNAME" all land on the same field.
const IMPORT_COLS = [
  { key: "name",         label: "Lab Name",       required: true,
    aliases: ["labname", "name", "lab", "centrename", "labtitle"] },
  { key: "code",         label: "Lab Code",
    aliases: ["labcode", "code", "labid", "centrecode"] },
  { key: "status",       label: "Status",
    aliases: ["status", "labstatus"] },
  { key: "priority",     label: "Priority",
    aliases: ["priority", "labpriority"] },
  { key: "city",         label: "City",
    aliases: ["city", "location", "cityname", "citylocation"] },
  { key: "assignee",     label: "Assignee",
    aliases: ["assignee", "assigneename", "assignedto", "owner", "implementationengineer", "engineer"] },
  { key: "salesPerson",  label: "Sales Person",
    aliases: ["salesperson", "sales", "salespersonname", "soldby", "saleslead", "salesexecutive",
              "bde", "businessdevelopment", "accountmanager", "salesowner"] },
  { key: "contact",      label: "Contact Person",
    aliases: ["contact", "contactperson", "incharge", "inchargename", "contactname"] },
  { key: "email",        label: "Contact Email",
    aliases: ["email", "contactemail", "mail", "emailid"] },
  { key: "phone",        label: "Phone",
    aliases: ["phone", "phonenumber", "mobile", "contactnumber", "contactno", "mobileno"] },
  { key: "stage",        label: "Stage",
    aliases: ["stage", "currentstage", "onboardingstage"] },
  { key: "assignedOn",   label: "Assigned On",
    aliases: ["assignedon", "assigneddate", "startdate", "kickoffdate"] },
  { key: "goLiveTarget", label: "Go-Live Target",
    aliases: ["golivetarget", "golivedate", "targetdate", "targetgolive", "golive"] },
  { key: "notes",        label: "Notes",
    aliases: ["notes", "remarks", "comment", "comments", "note"] }
];

let importRows = [];   // parsed + validated rows awaiting import
let importFileName = "";

// Strips everything that isn't a letter or digit, so "Lab Name *", "lab_name" and
// "LAB NAME" all collapse to the same key — and re-importing our own template works.
const normHead = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// ── Template ─────────────────────────────────────────────────
function downloadImportTemplate() {
  const headers = IMPORT_COLS.map(c => c.label + (c.required ? " *" : ""));
  const sample = [
    "Central Diagnostics Lab", "CDL-001", "Active", "High", "New Delhi", "Shivam", "Ankit",
    "Dr. Mehta", "lab@central.com", "9876543210", "Kickoff & Requirements",
    today(), "", "Sample row — delete before importing"
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
  ws["!cols"] = headers.map(h => ({ wch: Math.max(14, h.length + 4) }));

  // Second sheet spells out what each column will accept.
  const help = [
    ["Column", "Accepted values"],
    ["Lab Name *", "Required. Anything — this is the only must-fill column."],
    ["Status", STATUSES.join("  ·  ") + "   — blank becomes Pending"],
    ["Priority", "High / Medium / Low — blank becomes Medium"],
    ["Stage", STAGES.join("  ·  ") + "   — blank becomes Assigned"],
    ["Assigned On", "DD/MM/YYYY or a real Excel date — blank becomes today"],
    ["Go-Live Target", "DD/MM/YYYY or a real Excel date — can stay blank"],
    ["Assignee", "Who owns this onboarding. Auto-fills the Owner field in Daily Tracker."],
    ["Sales Person", "Who closed the account. Reference only — it doesn't affect the pipeline."],
    ["", ""],
    ["Note", "Column order does not matter. Extra columns are ignored."]
  ];
  const wsHelp = XLSX.utils.aoa_to_sheet(help);
  wsHelp["!cols"] = [{ wch: 18 }, { wch: 70 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Labs");
  XLSX.utils.book_append_sheet(wb, wsHelp, "How to fill");
  XLSX.writeFile(wb, "flabs_lab_import_template.xlsx");
  showToast("📄 Template downloaded — fill the Labs sheet");
}

// ── Drop zone ────────────────────────────────────────────────
function setupBulkZone() {
  const zone = document.getElementById("bulkZone");
  if (!zone) return;
  zone.addEventListener("dragover",  e => { e.preventDefault(); zone.style.background = "#d0eaff"; });
  zone.addEventListener("dragleave", () => { zone.style.background = ""; });
  zone.addEventListener("drop", e => {
    e.preventDefault(); zone.style.background = "";
    if (e.dataTransfer.files.length) readImportFile(e.dataTransfer.files[0]);
  });
}

// ── Value coercion ───────────────────────────────────────────
// Excel hands dates over as serial numbers, Date objects or plain text
// depending on how the cell was typed. All three end up as YYYY-MM-DD.
function parseDateCell(v) {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date && !isNaN(v)) return ymd(v);

  if (typeof v === "number") {
    const p = XLSX.SSF.parse_date_code(v);
    if (!p) return "";
    return `${p.y}-${String(p.m).padStart(2,"0")}-${String(p.d).padStart(2,"0")}`;
  }

  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/YYYY and DD-MM-YYYY — the way dates actually get typed here.
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = "20" + y;
    return `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }

  const parsed = new Date(s);
  return isNaN(parsed) ? "" : ymd(parsed);
}

// Match sheet text to a fixed option list without punishing case or spacing.
function matchOption(v, options) {
  const n = normHead(v);
  if (!n) return "";
  return options.find(o => normHead(o) === n) || "";
}

// ── Read + parse ─────────────────────────────────────────────
function handleImportPick(input) {
  if (input.files.length) readImportFile(input.files[0]);
  input.value = "";
}

function readImportFile(file) {
  importFileName = file.name;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      // blankrows stays true so the row numbers shown in the preview match the
      // row numbers in their sheet — empty rows get dropped by the name check below.
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: "" });
      parseImportRows(rows);
    } catch (err) {
      console.error(err);
      showToast("Could not read that file: " + err.message, "danger");
    }
  };
  reader.onerror = () => showToast("Could not read that file", "danger");
  reader.readAsArrayBuffer(file);
}

function parseImportRows(rows) {
  if (!rows.length) { showToast("That sheet is empty", "warning"); return; }

  // Header row = the first row that matches at least one known column.
  let headerIdx = rows.findIndex(r =>
    (r || []).some(c => IMPORT_COLS.some(col => col.aliases.includes(normHead(c)))));
  if (headerIdx === -1) headerIdx = 0;

  const header = (rows[headerIdx] || []).map(normHead);
  const map = {};                                   // field key → column index
  IMPORT_COLS.forEach(col => {
    const i = header.findIndex(h => col.aliases.includes(h));
    if (i !== -1) map[col.key] = i;
  });

  if (map.name === undefined) {
    document.getElementById("bulkPreview").innerHTML =
      `<div class="alert alert-danger mb-0">
         <strong>No “Lab Name” column found.</strong> The sheet needs a header row with a
         lab-name column. Download the template above and paste your data into it.
       </div>`;
    document.getElementById("bulkActions").style.display = "none";
    return;
  }

  const existingNames = new Set(labs.map(l => normHead(l.name)));
  const existingCodes = new Set(labs.map(l => normHead(l.code)).filter(Boolean));
  const seenInFile    = new Set();

  importRows = rows.slice(headerIdx + 1).map((raw, i) => {
    const r   = raw || [];
    const get = k => map[k] === undefined ? "" : String(r[map[k]] ?? "").trim();
    const name = get("name");
    if (!name) return null;                          // skip genuinely empty rows

    const stage      = matchOption(get("stage"), STAGES) || "Assigned";
    const assignedOn = parseDateCell(map.assignedOn   !== undefined ? r[map.assignedOn]   : "") || today();
    const goLive     = parseDateCell(map.goLiveTarget !== undefined ? r[map.goLiveTarget] : "");

    const row = {
      rowNo: headerIdx + i + 2,                      // 1-based sheet row, for error messages
      name,
      code:         get("code"),
      status:       matchOption(get("status"),   STATUSES)              || "Pending",
      priority:     matchOption(get("priority"), ["High","Medium","Low"])         || "Medium",
      city:         get("city"),
      assignee:     get("assignee"),
      salesPerson:  get("salesPerson"),
      contact:      get("contact"),
      email:        get("email"),
      phone:        get("phone"),
      notes:        get("notes"),
      stage,
      assignedOn,
      goLiveTarget: goLive,
      issues: [],
      dupe:   false,
      skip:   false
    };

    // Already in Firestore, or repeated inside this same sheet?
    const nk = normHead(name), ck = normHead(row.code);
    if (existingNames.has(nk) || (ck && existingCodes.has(ck))) {
      row.dupe = true; row.skip = true;
      row.issues.push("Already registered — skipped by default");
    } else if (seenInFile.has(nk)) {
      row.dupe = true; row.skip = true;
      row.issues.push("Repeated in this sheet");
    }
    seenInFile.add(nk);

    if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) row.issues.push("Email looks wrong");
    if (goLive && goLive < assignedOn) row.issues.push("Go-live target is before the assigned date");

    return row;
  }).filter(Boolean);

  renderImportPreview();
}

// ── Preview ──────────────────────────────────────────────────
function renderImportPreview() {
  const box = document.getElementById("bulkPreview");
  const act = document.getElementById("bulkActions");
  if (!box) return;

  if (!importRows.length) {
    box.innerHTML = `<div class="alert alert-warning mb-0">No rows with a lab name found in <strong>${esc(importFileName)}</strong>.</div>`;
    act.style.display = "none";
    return;
  }

  const ready = importRows.filter(r => !r.skip).length;
  const dupes = importRows.filter(r => r.dupe).length;

  box.innerHTML = `
    <div class="bulk-summary">
      <span class="bulk-chip bulk-chip-file"><i class="bi bi-file-earmark-spreadsheet"></i> ${esc(importFileName)}</span>
      <span class="bulk-chip bulk-chip-ok">${ready} ready to import</span>
      ${dupes ? `<span class="bulk-chip bulk-chip-dup">${dupes} duplicate${dupes===1?"":"s"}</span>` : ""}
      <span class="bulk-chip">${importRows.length} row${importRows.length===1?"":"s"} read</span>
    </div>
    <div class="table-responsive bulk-table-wrap">
      <table class="table table-bordered table-hover align-middle mb-0">
        <thead class="table-primary">
          <tr>
            <th style="width:60px">Import</th><th>Row</th><th>Lab</th><th>Stage</th>
            <th>Assignee</th><th>Sales</th><th>Priority</th><th>Dates</th><th>Notes on this row</th>
          </tr>
        </thead>
        <tbody>
          ${importRows.map((r, i) => `
            <tr class="${r.skip ? "bulk-row-skip" : ""}">
              <td class="text-center">
                <input class="form-check-input" type="checkbox" ${r.skip ? "" : "checked"}
                       onchange="toggleImportRow(${i}, this.checked)">
              </td>
              <td class="cell-sub">#${r.rowNo}</td>
              <td>
                <strong>${esc(r.name)}</strong>
                <div class="cell-sub">${esc(r.city || "—")}${r.code ? " · " + esc(r.code) : ""}</div>
              </td>
              <td><span class="stage-pill">${esc(r.stage)}</span></td>
              <td>${esc(r.assignee || "—")}</td>
              <td>${esc(r.salesPerson || "—")}</td>
              <td><span class="priority-badge badge-priority-${esc(r.priority)}">${esc(r.priority)}</span></td>
              <td class="cell-sub">
                Assigned ${pretty(r.assignedOn)}<br>${r.goLiveTarget ? "Target " + pretty(r.goLiveTarget) : "No target"}
              </td>
              <td>${r.issues.length
                    ? r.issues.map(m => `<span class="bulk-issue">${esc(m)}</span>`).join(" ")
                    : `<span class="text-success small"><i class="bi bi-check-circle"></i> Looks clean</span>`}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  act.style.display = "flex";
  document.getElementById("bulkImportBtn").innerHTML =
    `<i class="bi bi-cloud-upload me-1"></i>Import ${ready} lab${ready===1?"":"s"}`;
  document.getElementById("bulkImportBtn").disabled = ready === 0;
}

function toggleImportRow(i, checked) {
  importRows[i].skip = !checked;
  const ready = importRows.filter(r => !r.skip).length;
  const btn = document.getElementById("bulkImportBtn");
  btn.innerHTML = `<i class="bi bi-cloud-upload me-1"></i>Import ${ready} lab${ready===1?"":"s"}`;
  btn.disabled  = ready === 0;
}

function selectAllImportRows(state) {
  importRows.forEach(r => r.skip = !state);
  renderImportPreview();
}

function clearImport() {
  importRows = [];
  importFileName = "";
  document.getElementById("bulkPreview").innerHTML = "";
  document.getElementById("bulkActions").style.display = "none";
}

// ── Write to Firestore ───────────────────────────────────────
async function runBulkImport() {
  const picked = importRows.filter(r => !r.skip);
  if (!picked.length) { showToast("Nothing ticked to import", "warning"); return; }
  if (!confirm(`Import ${picked.length} lab${picked.length===1?"":"s"} into Firebase?`)) return;

  const btn = document.getElementById("bulkImportBtn");
  btn.disabled  = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Importing...`;

  let saved = 0;
  try {
    // Firestore caps a batch at 500 writes — 400 leaves room to breathe.
    for (let i = 0; i < picked.length; i += 400) {
      const batch = db.batch();
      picked.slice(i, i + 400).forEach(r => {
        const ref = labsCol.doc();
        batch.set(ref, {
          name: r.name, code: r.code, status: r.status, priority: r.priority,
          city: r.city, assignee: r.assignee, salesPerson: r.salesPerson,
          contact: r.contact, email: r.email,
          phone: r.phone, notes: r.notes,
          stage: r.stage,
          assignedOn:   r.assignedOn,
          goLiveTarget: r.goLiveTarget,
          goLiveOn:     r.stage === "Live" ? r.assignedOn : "",
          stageHistory: [{ stage: r.stage, date: r.assignedOn }],
          files:        [],
          importedFrom: importFileName,
          createdAt:    firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      await batch.commit();
      saved += Math.min(400, picked.length - i);
      btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>${saved}/${picked.length} saved...`;
    }

    showToast(`✅ ${saved} lab${saved===1?"":"s"} imported`);
    clearImport();
    switchTab("directory");
  } catch (err) {
    console.error(err);
    showToast("❌ Import failed after " + saved + " labs: " + err.message, "danger");
  } finally {
    btn.disabled = false;
    renderImportPreview();
  }
}

// ══════════════════════════════════════════════════════════════
//  EXCEL EXPORT — every registered lab, its remarks and its log
// ══════════════════════════════════════════════════════════════

const BLOCKER_SIDE = { system: "System", client: "Client", internal: "Internal" };

// A YYYY-MM-DD string becomes a real Excel date so the column can be sorted
// and filtered properly. Blanks stay blank rather than becoming 1970.
const xlDate = s => (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) ? new Date(s + "T00:00:00") : "";

// Build a sheet from an array-of-arrays: widths, autofilter, and dd/mm/yyyy or
// percent formatting applied by column so nothing shows up as a serial number.
function makeSheet(rows, widths, fmt = {}) {
  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  ws["!cols"] = widths.map(w => ({ wch: w }));

  const range = XLSX.utils.decode_range(ws["!ref"]);
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r:0, c:0 }, e: { r: range.e.r, c: range.e.c } }) };

  Object.entries(fmt).forEach(([col, z]) => {
    const c = Number(col);
    for (let r = 1; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && (cell.t === "d" || cell.t === "n")) cell.z = z;
    }
  });
  return ws;
}

function openExcelExport() {
  const shown = filteredLabs().length;
  document.getElementById("xlScopeFiltered").parentElement.querySelector(".xl-scope-count").textContent =
    `${shown} lab${shown === 1 ? "" : "s"} currently showing in the pipeline`;
  document.getElementById("xlScopeAll").parentElement.querySelector(".xl-scope-count").textContent =
    `${labs.length} lab${labs.length === 1 ? "" : "s"} registered in total`;
  new bootstrap.Modal(document.getElementById("excelModal")).show();
}

async function exportExcel() {
  const chosen = document.querySelector('input[name="xlScope"]:checked')?.value || "all";
  const scope = labs.length ? (chosen === "filtered" ? filteredLabs() : labs) : [];
  if (!scope.length) { showToast("No labs to export", "warning"); return; }

  const want = id => document.getElementById(id)?.checked;
  const btn = document.getElementById("xlBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Building...`;

  try {
    const ids = new Set(scope.map(l => l.id));
    const scopedLogs = logs.filter(x => ids.has(x.labId));
    const wb = XLSX.utils.book_new();
    const D  = today();

    // ── Sheet 1: every lab on one row, remarks included ──────
    const labRows = [[
      "#","Lab Name","Lab Code","City","Assignee","Sales Person","Status","Priority",
      "Current Stage","Step","% Complete",
      "Assigned On","Go-Live Target","Went Live","Days in Onboarding","Days Overdue",
      "Open Blockers","Blocker Reasons","Open Escalations",
      "Log Entries","Last Activity On","Latest Remark",
      "Contact Person","Email","Phone","Documents","Notes / Remarks"
    ]];

    scope.forEach((l, i) => {
      const mine    = scopedLogs.filter(x => x.labId === l.id);
      const blocked = mine.filter(x => x.status === "blocked");
      const last    = mine.slice().sort((a,b) => b.date.localeCompare(a.date))[0];
      const days    = l.assignedOn ? daysBetween(l.assignedOn, isLive(l) && l.goLiveOn ? l.goLiveOn : D) : "";

      labRows.push([
        i + 1,
        l.name || "",
        l.code || "",
        l.city || "",
        l.assignee || "Unassigned",
        l.salesPerson || "",
        l.status || "",
        l.priority || "",
        l.stage || "Assigned",
        `${stageIndex(l) + 1} of ${STAGES.length}`,
        stagePercent(l) / 100,
        xlDate(l.assignedOn),
        xlDate(l.goLiveTarget),
        xlDate(l.goLiveOn),
        days === "" ? "" : days,
        labOverdue(l) ? daysBetween(l.goLiveTarget, D) : "",
        blocked.length,
        [...new Set(blocked.map(x => x.blocker).filter(Boolean))].join("; "),
        mine.filter(x => x.escalated && x.status !== "done").length,
        mine.length,
        last ? xlDate(last.date) : "",
        last ? `${LOG_STATUS[last.status]} — ${last.activity}` : "",
        l.contact || "",
        l.email || "",
        l.phone || "",
        (l.files || []).length,
        l.notes || ""
      ]);
    });

    XLSX.utils.book_append_sheet(wb, makeSheet(labRows,
      [5,30,12,16,16,16,10,10,24,10,12,13,14,13,17,13,14,34,16,11,15,46,20,26,15,11,50],
      { 11:"dd/mm/yyyy", 12:"dd/mm/yyyy", 13:"dd/mm/yyyy", 20:"dd/mm/yyyy", 10:"0%" }), "Labs");

    // ── Sheet 2: the daily remarks behind those numbers ──────
    if (want("xlLogs")) {
      const rows = [[
        "Date","Lab","Lab Code","City","Assignee","Stage","Remark / Activity",
        "Owner","Status","Blocker","Blocker Side","Due Date","Days Overdue","Escalated"
      ]];
      scopedLogs.slice().sort((a,b) => b.date.localeCompare(a.date) || (a.labName||"").localeCompare(b.labName||""))
        .forEach(x => {
          const lab = labById(x.labId);
          rows.push([
            xlDate(x.date),
            x.labName || "", lab?.code || "", x.labCity || "", lab?.assignee || "",
            x.stage || "", x.activity || "", x.owner || "",
            LOG_STATUS[x.status] || "",
            x.blocker || "",
            x.blocker ? (BLOCKER_SIDE[BLOCKER_OWNER[x.blocker]] || "Internal") : "",
            xlDate(x.dueDate),
            (x.dueDate && x.dueDate < D && x.status !== "done") ? daysBetween(x.dueDate, D) : "",
            x.escalated ? "Yes" : ""
          ]);
        });
      if (rows.length === 1) rows.push(["", "No log entries for the labs exported", "", "", "", "", "", "", "", "", "", "", "", ""]);
      XLSX.utils.book_append_sheet(wb, makeSheet(rows,
        [12,28,12,16,16,24,52,16,14,30,13,12,13,10],
        { 0:"dd/mm/yyyy", 11:"dd/mm/yyyy" }), "Daily Remarks");
    }

    // ── Sheet 3: what's still stuck, oldest first ────────────
    if (want("xlBlockers")) {
      const rows = [["Lab","City","Assignee","Blocker","Side","Blocked Since","Days Open","Activity","Owner","Due Date","Escalated"]];
      scopedLogs.filter(x => x.status === "blocked")
        .sort((a,b) => a.date.localeCompare(b.date))
        .forEach(x => {
          const lab = labById(x.labId);
          rows.push([
            x.labName || "", x.labCity || "", lab?.assignee || "",
            x.blocker || "Not tagged",
            x.blocker ? (BLOCKER_SIDE[BLOCKER_OWNER[x.blocker]] || "Internal") : "",
            xlDate(x.date),
            daysBetween(x.date, D),
            x.activity || "", x.owner || "",
            xlDate(x.dueDate),
            x.escalated ? "Yes" : ""
          ]);
        });
      if (rows.length === 1) rows.push(["Nothing blocked right now", "", "", "", "", "", "", "", "", "", ""]);
      XLSX.utils.book_append_sheet(wb, makeSheet(rows,
        [28,16,16,30,12,14,11,50,16,12,10],
        { 5:"dd/mm/yyyy", 9:"dd/mm/yyyy" }), "Open Blockers");
    }

    // ── Sheet 4: assigned → live, stage by stage ─────────────
    if (want("xlJourney")) {
      const rows = [["Lab","Assignee","Stage","Step","Reached On","Days in Stage","State"]];
      scope.forEach(l => {
        const history = l.stageHistory || [];
        const curIdx  = stageIndex(l);
        STAGES.forEach((s, i) => {
          const hit  = history.find(h => h.stage === s);
          const next = history.find(h => STAGES.indexOf(h.stage) === i + 1);
          const endDate = hit ? (next ? next.date : (i === curIdx ? D : "")) : "";
          rows.push([
            l.name || "", l.assignee || "", s, `${i + 1} of ${STAGES.length}`,
            hit ? xlDate(hit.date) : "",
            hit && endDate ? daysBetween(hit.date, endDate) : "",
            hit ? (i === curIdx ? "Current" : "Completed") : "Not reached"
          ]);
        });
      });
      XLSX.utils.book_append_sheet(wb, makeSheet(rows, [28,16,24,10,13,14,13], { 4:"dd/mm/yyyy" }), "Stage Journey");
    }

    // ── Sheet 5: what's on file, with the download links ─────
    if (want("xlDocs")) {
      const rows = [["Lab","Assignee","Document Type","File Name","Size (KB)","Link"]];
      scope.forEach(l => (l.files || []).forEach(f => rows.push([
        l.name || "", l.assignee || "", f.docType || "", f.name || "",
        f.size ? Math.round(f.size / 1024) : "", f.url || ""
      ])));
      if (rows.length === 1) rows.push(["No documents uploaded yet", "", "", "", "", ""]);
      XLSX.utils.book_append_sheet(wb, makeSheet(rows, [28,16,16,44,11,60], { 4:"#,##0" }), "Documents");
    }

    const tag = chosen === "filtered" ? "filtered" : "all";
    XLSX.writeFile(wb, `flabs_labs_${tag}_${D}.xlsx`);

    bootstrap.Modal.getInstance(document.getElementById("excelModal"))?.hide();
    showToast(`✅ ${scope.length} lab${scope.length === 1 ? "" : "s"} exported to Excel`);
  } catch (err) {
    console.error(err);
    showToast("❌ Export failed: " + err.message, "danger");
  } finally {
    btn.disabled  = false;
    btn.innerHTML = `<i class="bi bi-file-earmark-excel me-1"></i>Download .xlsx`;
  }
}
