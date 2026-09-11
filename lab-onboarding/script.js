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
const usersCol  = db.collection("users");

// ── Who's logged in, and what can they do? ──────────────────
// The login page (outside this app) is responsible for setting these two
// keys in sessionStorage after checking the person's credentials against
// Firebase Auth + their role doc in the "users" collection. If a session
// was started before roles existed (the old shared-password flow), there's
// no role recorded — that's treated as Admin so nobody already using the
// tool gets locked out; every account created from here on does get a role.
const CURRENT_ROLE  = sessionStorage.getItem("userRole")  || "Admin";
const CURRENT_EMAIL = sessionStorage.getItem("userEmail") || "";
const IS_ADMIN = CURRENT_ROLE === "Admin";
// Custom accounts carry a JSON permissions object set at login; Admin implicitly has all of it.
const CURRENT_PERMS = (() => {
  try { return JSON.parse(sessionStorage.getItem("userPerms") || "null"); }
  catch { return null; }
})();
const can = key => IS_ADMIN || (CURRENT_PERMS && CURRENT_PERMS[key] === true);
let users = [];

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
  initTheme();
  applyRoleRestrictions();
  setupDropZone();
  setupBulkZone();
  buildStageSelects();
  buildStatusSelects();
  buildBlockerSelect();
  document.getElementById("trackDate").value = today();
  listenToLabs();
  listenToLogs();
  if (IS_ADMIN) listenToUsers();
  tickShiftBar();
  setInterval(tickShiftBar, 30000);
  setInterval(checkAssignedOverdue, 5 * 60000); // re-check every 5 min — a lab can cross 7 days with no data change
});

// ── Role-based access ────────────────────────────────────────
// Two levels for now: Admin (everything) and Staff (day-to-day work —
// register, bulk import, daily tracker, 6 PM report — but no deleting
// labs, no exports, and the Manage Users tab doesn't exist for them at all).
function applyRoleRestrictions() {
  // Admin-only bits (Manage Users tab) — never granted via Custom permissions,
  // deliberately, so a Custom user can never make themselves an Admin from the UI.
  document.querySelectorAll(".admin-only").forEach(el => {
    el.style.display = IS_ADMIN ? "" : "none";
  });

  // Tab-level access: hide whole nav items the account isn't permitted to open.
  let firstAllowedTab = null;
  document.querySelectorAll("[data-perm]").forEach(li => {
    const key = li.getAttribute("data-perm");
    const allowed = can(key);
    li.style.display = allowed ? "" : "none";
    if (allowed && !firstAllowedTab) firstAllowedTab = key;
  });
  // If Register Lab (the default landing tab) isn't allowed, land on whatever they do have.
  if (!can("register") && firstAllowedTab) switchTab(firstAllowedTab);

  // Action-level access, independent of which tabs are visible.
  if (!can("export")) {
    document.querySelectorAll(".btn-export").forEach(el => el.style.display = "none");
  }
  const modalEditBtn = document.getElementById("modalEditBtn");
  if (modalEditBtn) modalEditBtn.style.display = can("editLab") ? "" : "none";

  const pill = document.getElementById("whoamiPill");
  if (pill) {
    const label = sessionStorage.getItem("userName") || CURRENT_EMAIL || "Admin";
    pill.innerHTML = `<i class="bi bi-person-circle me-1"></i>${esc(label)} <span class="whoami-role">${esc(CURRENT_ROLE)}</span>`;
  }
}

// ── Dark / Light theme ───────────────────────────────────────
// Preference lives in localStorage so it survives across sessions
// (sessionStorage is used for login only). Charts re-render on
// toggle since Chart.js bakes text/grid colours in at draw time.
function initTheme() {
  const saved = localStorage.getItem("flabsTheme")
    || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(saved, false);
}

function applyTheme(theme, animate = true) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("flabsTheme", theme);
  const btn = document.getElementById("themeToggleBtn");
  if (btn) btn.innerHTML = theme === "dark"
    ? `<i class="bi bi-sun-fill"></i>`
    : `<i class="bi bi-moon-stars-fill"></i>`;
  if (typeof Chart !== "undefined") {
    Chart.defaults.color = theme === "dark" ? "#92a1b3" : "#4a5a68";
    Chart.defaults.borderColor = theme === "dark" ? "#2a3442" : "#e8eef5";
    if (animate) renderAnalysis(); // repaint charts with the new palette
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  applyTheme(current === "dark" ? "light" : "dark");
}

// ══════════════════════════════════════════════════════════════
//  USER MANAGEMENT (admin-only)
// ══════════════════════════════════════════════════════════════
// Creating a user with the client SDK normally signs YOU out and signs you
// in as the new person — Firebase's default auth() instance can only hold
// one session. The standard workaround is a second, throwaway Firebase
// "app" instance that does the create-and-sign-out, while your own session
// on the main app instance is never touched.
let secondaryApp = null;
function getSecondaryAuth() {
  if (!secondaryApp) {
    secondaryApp = firebase.apps.find(a => a.name === "Secondary")
      || firebase.initializeApp(firebaseConfig, "Secondary");
  }
  return secondaryApp.auth();
}

// Every permission key maps 1:1 to a tab or an action button elsewhere in the app.
const PERM_KEYS = ["register","bulk","directory","tracker","report","docs","editLab","deleteLab","export"];

function toggleCustomPerms() {
  const isAdmin = document.getElementById("uRole").value === "Admin";
  const block = document.getElementById("customPermsBlock");
  block.style.opacity = isAdmin ? "0.4" : "1";
  document.querySelectorAll(".perm-check").forEach(cb => cb.disabled = isAdmin);
}

function generateTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$";
  let pw = "";
  for (let i = 0; i < 10; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  document.getElementById("uPassword").value = pw;
}

async function createStaffUser() {
  if (!IS_ADMIN) { showToast("Only Admins can create users", "danger"); return; }

  const name     = document.getElementById("uName").value.trim();
  const email    = document.getElementById("uEmail").value.trim();
  const role     = document.getElementById("uRole").value; // "Admin" or "Custom"
  const password = document.getElementById("uPassword").value;

  if (!name)  { showToast("Enter their name", "danger"); return; }
  if (!email) { showToast("Enter their email", "danger"); return; }
  if (!password || password.length < 6) { showToast("Password needs at least 6 characters", "danger"); return; }

  // Admin gets every permission implicitly; Custom stores exactly what's ticked.
  const permissions = {};
  PERM_KEYS.forEach(key => {
    permissions[key] = role === "Admin" ? true : document.getElementById(`perm-${key}`).checked;
  });

  const btn = document.getElementById("createUserBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Creating...`;

  try {
    const secAuth = getSecondaryAuth();
    const cred = await secAuth.createUserWithEmailAndPassword(email, password);
    await usersCol.doc(cred.user.uid).set({
      name, email, role, permissions,
      createdAt: Date.now(),
      createdBy: CURRENT_EMAIL || "admin"
    });
    await secAuth.signOut(); // tidy up the throwaway session — doesn't touch your own login

    const grantedLabel = role === "Admin"
      ? "Everything (Admin)"
      : PERM_KEYS.filter(k => permissions[k]).map(k => PERM_LABELS[k]).join(", ") || "Nothing yet — edit their access below";

    document.getElementById("newUserResult").style.display = "block";
    document.getElementById("newUserResult").innerHTML = `
      <div class="content-card" style="background:#f0fff4;border:1px solid #c3ecd0">
        <h6 class="mb-2"><i class="bi bi-check-circle-fill text-success me-1"></i>User created — share these with them</h6>
        <div class="row g-2">
          <div class="col-md-4"><strong>Name:</strong> ${esc(name)}</div>
          <div class="col-md-4"><strong>Login ID:</strong> ${esc(email)}</div>
          <div class="col-md-4"><strong>Password:</strong> ${esc(password)}</div>
        </div>
        <div class="mt-2"><strong>Access granted:</strong> ${esc(grantedLabel)}</div>
        <button class="btn btn-sm btn-outline-secondary mt-2" onclick="copyCreds('${esc(name)}','${esc(email)}','${esc(password)}','${esc(grantedLabel)}')">
          <i class="bi bi-clipboard me-1"></i>Copy to share
        </button>
        <p class="form-hint mt-2 mb-0">Send this over a private channel (WhatsApp/Slack DM, not a public channel) and ask them to change the password after their first login.</p>
      </div>`;

    ["uName","uEmail","uPassword"].forEach(id => document.getElementById(id).value = "");
    showToast("✅ User created");
  } catch (err) {
    console.error(err);
    let msg = err.message;
    if (err.code === "auth/email-already-in-use") msg = "That email already has an account.";
    if (err.code === "auth/operation-not-allowed") msg = "Email/Password sign-in isn't enabled yet — turn it on in Firebase Console → Authentication → Sign-in method.";
    if (err.code === "auth/configuration-not-found") msg = "Authentication isn't turned on for this Firebase project yet — open Firebase Console → Authentication and click \"Get started\" first.";
    showToast("❌ " + msg, "danger");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="bi bi-person-check me-1"></i>Create User`;
  }
}

const PERM_LABELS = {
  register: "Register Lab", bulk: "Bulk Import", directory: "Onboarding Pipeline",
  tracker: "Daily Tracker", report: "6 PM Report", docs: "Documents",
  editLab: "Edit labs", deleteLab: "Delete labs", export: "Export files"
};

function copyCreds(name, email, password, grantedLabel) {
  const text = `Flabs Lab Onboarding — your login\nName: ${name}\nLogin ID: ${email}\nPassword: ${password}\nAccess: ${grantedLabel}\n\nPlease log in and change your password.`;
  navigator.clipboard.writeText(text).then(() => showToast("Copied — paste it wherever you're sending it"));
}

function listenToUsers() {
  usersCol.orderBy("createdAt", "desc").onSnapshot(snapshot => {
    users = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderUsersTable();
  }, err => console.error(err));
}

function renderUsersTable() {
  const tbody = document.getElementById("usersTableBody");
  if (!tbody) return;
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No users added yet — create the first one above.</td></tr>`;
    return;
  }
  tbody.innerHTML = users.map(u => {
    const chips = u.role === "Admin"
      ? `<span class="perm-chip perm-chip-admin">Everything</span>`
      : (PERM_KEYS.filter(k => u.permissions && u.permissions[k])
          .map(k => `<span class="perm-chip">${esc(PERM_LABELS[k])}</span>`).join("") || `<span class="text-muted">No access granted</span>`);
    return `
    <tr>
      <td>${esc(u.name)}</td>
      <td>${esc(u.email)}</td>
      <td>
        <span class="status-badge ${u.role === "Admin" ? "badge-status-active" : "badge-status-under-onboarding"} mb-1 d-inline-block">${esc(u.role)}</span>
        <div class="d-flex flex-wrap gap-1">${chips}</div>
      </td>
      <td class="cell-sub">${u.createdAt ? new Date(u.createdAt).toLocaleDateString("en-GB") : "—"}</td>
      <td class="d-flex gap-1">
        <button class="btn btn-sm btn-outline-primary" onclick="openEditPerms('${u.id}')" title="Change access"><i class="bi bi-sliders"></i></button>
        <button class="btn btn-sm btn-outline-danger" onclick="removeUserAccess('${u.id}','${esc(u.name)}')" title="Remove access"><i class="bi bi-person-dash"></i></button>
      </td>
    </tr>`;
  }).join("");
}

// Quick in-place access editor — same checkbox set as create, pre-filled from their current doc.
function openEditPerms(uid) {
  const u = users.find(x => x.id === uid);
  if (!u) return;
  const isAdmin = u.role === "Admin";
  const rowsHtml = PERM_KEYS.map(k => `
    <div class="col-6 col-md-4">
      <div class="form-check">
        <input class="form-check-input" type="checkbox" id="ep-${k}" ${((u.permissions && u.permissions[k]) || isAdmin) ? "checked" : ""} ${isAdmin ? "disabled" : ""}>
        <label class="form-check-label" for="ep-${k}">${esc(PERM_LABELS[k])}</label>
      </div>
    </div>`).join("");

  document.getElementById("newUserResult").style.display = "block";
  document.getElementById("newUserResult").innerHTML = `
    <div class="content-card" style="border:1px solid var(--border-card)">
      <h6 class="mb-3"><i class="bi bi-sliders me-1"></i>Access for ${esc(u.name)}</h6>
      <div class="mb-3">
        <select class="form-select w-auto d-inline-block" id="ep-role" onchange="document.querySelectorAll('#newUserResult .form-check-input').forEach(c=>c.disabled=this.value==='Admin')">
          <option value="Custom" ${!isAdmin ? "selected" : ""}>Custom</option>
          <option value="Admin" ${isAdmin ? "selected" : ""}>Admin — full access</option>
        </select>
      </div>
      <div class="row g-2">${rowsHtml}</div>
      <div class="d-flex gap-2 mt-3">
        <button class="btn btn-sm btn-primary" onclick="savePerms('${uid}')"><i class="bi bi-check2 me-1"></i>Save changes</button>
        <button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById('newUserResult').style.display='none'">Cancel</button>
      </div>
    </div>`;
  document.getElementById("newUserResult").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function savePerms(uid) {
  const role = document.getElementById("ep-role").value;
  const permissions = {};
  PERM_KEYS.forEach(k => { permissions[k] = role === "Admin" ? true : !!document.getElementById(`ep-${k}`).checked; });
  try {
    await usersCol.doc(uid).update({ role, permissions });
    document.getElementById("newUserResult").style.display = "none";
    showToast("✅ Access updated — it'll apply next time they log in (or on refresh if they're online now)");
  } catch (err) {
    showToast("❌ Error: " + err.message, "danger");
  }
}

async function removeUserAccess(uid, name) {
  if (!confirm(`Remove ${name}'s access to this app?`)) return;
  try {
    await usersCol.doc(uid).delete();
    showToast("Access removed — remember to also disable their login in Firebase Console → Authentication if they should never sign in again.");
  } catch (err) {
    showToast("❌ Error: " + err.message, "danger");
  }
}

function logout() {
  if (firebase.auth) { firebase.auth().signOut().catch(() => {}); }
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
    renderAnalysis();
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

// ── Onboarding health: stalled stages & upcoming go-lives ────
// A lab is "stalled" when it's sat in its current stage longer than usual —
// this is often a better early-warning signal than "assigned > 7 days",
// since a lab can be moving fine right up until one stage quietly stalls.
const STALL_ALERT_DAYS = 5;
const DUE_SOON_DAYS    = 3;

function stageEnteredOn(lab) {
  const hist = lab.stageHistory || [];
  const entry = [...hist].reverse().find(h => h.stage === (lab.stage || "Assigned"));
  return (entry && entry.date) || lab.assignedOn || null;
}

function daysInStage(lab) {
  const since = stageEnteredOn(lab);
  return since ? daysBetween(since, today()) : 0;
}

const isStalled = lab => inOnboarding(lab) && daysInStage(lab) > STALL_ALERT_DAYS;

// Go-live is coming up in the next few days and hasn't happened yet.
const isDueSoon = lab => !isLive(lab) && lab.goLiveTarget
  && lab.goLiveTarget >= today()
  && daysBetween(today(), lab.goLiveTarget) <= DUE_SOON_DAYS;

// ── Notes history ─────────────────────────────────────────────
// The Notes field used to just overwrite itself. Now every distinct save
// is kept as its own timestamped entry, so the detail modal can show the
// full trail ("Rate list pending" on Monday, "Rate list received" on
// Thursday) instead of only ever seeing the latest line.
function appendNoteIfChanged(lab, newText) {
  const hist = (lab.notesHistory || []).slice();
  const last = hist[hist.length - 1];
  if (newText && (!last || last.text !== newText)) {
    hist.push({ text: newText, ts: Date.now() });
  }
  return hist;
}

// Matches the DD/MM/YYYY style pretty() already uses elsewhere, plus a time.
function fmtTs(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const date = d.toLocaleDateString("en-GB");
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date}, ${time}`;
}

// A blocked log stays blocked until someone changes its status — not just for one day.
const openBlocked  = () => logs.filter(l => l.status === "blocked");
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
  set("statStalled",   labs.filter(isStalled).length);
  set("statDueSoon",   labs.filter(isDueSoon).length);
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
let stalledQuickFilter    = false;
let dueSoonQuickFilter    = false;
let overdueQuickFilter    = false;

function clearOnboardingQuickFilter() {
  onboardingQuickFilter = false;
  stalledQuickFilter    = false;
  dueSoonQuickFilter    = false;
  overdueQuickFilter    = false;
}

function applyDashboardFilter(type) {
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal("filterLabName", "");
  setVal("filterAssignee", "");
  setVal("filterSalesPerson", "");
  setVal("filterStage", "");
  setVal("filterStatus", "");
  setVal("filterPriority", "");
  clearOnboardingQuickFilter();

  if (type === "live")        setVal("filterStage", "Live");
  else if (type === "hold")   setVal("filterStatus", "Hold");
  else if (type === "lost")   setVal("filterStatus", "Lost");
  else if (type === "onboarding") onboardingQuickFilter = true;
  else if (type === "stalled")    stalledQuickFilter    = true;
  else if (type === "duesoon")    dueSoonQuickFilter    = true;
  else if (type === "overdue")    overdueQuickFilter    = true;
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
const TABS = ["register", "bulk", "directory", "tracker", "report", "docs", "users"];
function switchTab(tab) {
  TABS.forEach(t => {
    const pane = document.getElementById("tab-" + t);
    const btn  = document.getElementById("tab-" + t + "-btn");
    if (pane) pane.style.display = t === tab ? "block" : "none";
    if (btn)  btn.classList.toggle("active", t === tab);
  });
  if (tab === "report")  renderReport();
  if (tab === "tracker") renderTracker();
  if (tab === "users")   renderUsersTable();
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

  const notesText = document.getElementById("labNotes").value.trim();

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
      notes:        notesText,
      notesHistory: notesText ? [{ text: notesText, ts: Date.now() }] : [],
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
  if (!can("editLab")) { showToast("You don't have edit access — ask your Admin", "danger"); return; }
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
  const notesText  = val("eNotes");

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
      notes:        notesText,
      notesHistory: appendNoteIfChanged(lab, notesText),
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
    (!onboardingQuickFilter || inOnboarding(l)) &&
    (!stalledQuickFilter    || isStalled(l)) &&
    (!dueSoonQuickFilter    || isDueSoon(l)) &&
    (!overdueQuickFilter    || labOverdue(l)));
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
    const stalled = isStalled(l);
    const dueSoon = isDueSoon(l);
    return `
    <tr class="${[labOverdue(l) ? "row-overdue" : "", l.status === "Hold" ? "row-hold" : "", stalled ? "row-stalled" : ""].filter(Boolean).join(" ")}">
      <td>${i+1}</td>
      <td>
        <strong>${esc(l.name)}</strong>
        <div class="cell-sub">${esc(l.city || "—")}${l.code ? " · " + esc(l.code) : ""}</div>
        <div class="mt-1">
          <span class="status-badge badge-status-${statusSlug(l.status)}">${l.status === "Hold" ? "⏸ " : ""}${esc(l.status || "—")}</span>
          ${dueSoon ? `<span class="due-soon-pill" title="Go-live target is close"><i class="bi bi-flag-fill"></i>Due ${pretty(l.goLiveTarget)}</span>` : ""}
        </div>
        ${l.assignee
          ? `<span class="assignee-pill"><i class="bi bi-person-fill"></i>${esc(l.assignee)}</span>`
          : `<span class="assignee-pill is-none"><i class="bi bi-person-dash"></i>Unassigned</span>`}
      </td>
      <td style="min-width:170px">
        <div class="stage-name">${esc(l.stage || "Assigned")}${stalled ? `<span class="stalled-pill" title="No stage movement in ${daysInStage(l)} days"><i class="bi bi-exclamation-triangle-fill"></i>Stuck ${daysInStage(l)}d</span>` : ""}</div>
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
          ${can("editLab")   ? `<button class="btn btn-sm btn-outline-warning" onclick="openEditLab('${l.id}')" title="Edit lab details"><i class="bi bi-pencil-square"></i></button>` : ""}
          ${can("deleteLab") ? `<button class="btn btn-sm btn-outline-danger" onclick="deleteLab('${l.id}')" title="Delete"><i class="bi bi-trash"></i></button>` : ""}
        </div>
      </td>
    </tr>`;
  }).join("");
}

// ── Delete lab (and its logs) ────────────────────────────────
async function deleteLab(id) {
  if (!can("deleteLab")) { showToast("You don't have delete access — ask your Admin", "danger"); return; }
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
  onLogStatusChange();
  document.getElementById("logBlocker").value = l.blocker || "";
  // If the entry uses any of the extra fields, show them rather than hide the edit.
  toggleLogAdvanced(!!(l.blocker || l.dueDate || l.owner));
  document.getElementById("logSaveBtn").innerHTML = `<i class="bi bi-check-circle me-1"></i>Update entry`;
  document.getElementById("logCancelBtn").style.display = "inline-block";
  document.getElementById("logActivity").focus();
}

async function quickLogStatus(id, status) {
  try {
    await logsCol.doc(id).update({ status, blocker: status === "blocked" ? (logs.find(l=>l.id===id)?.blocker || "") : "" });
  } catch (err) { showToast("Error: " + err.message, "danger"); }
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

    <h6 class="modal-sec"><i class="bi bi-sticky me-1"></i>Notes (${(l.notesHistory||[]).length} ${((l.notesHistory||[]).length===1)?"entry":"entries"})</h6>
    <div id="notesListWrap">
      ${(l.notesHistory && l.notesHistory.length)
        ? l.notesHistory.map((n, idx) => ({ ...n, idx })).slice().reverse().map(n => `
            <div class="day-row day-note" id="noteRow-${n.idx}">
              <span class="day-status" style="min-width:auto">
                ${fmtTs(n.ts)}${n.editedTs ? `<i class="bi bi-pencil-fill ms-1" style="font-size:9px;opacity:0.6" title="Edited ${fmtTs(n.editedTs)}"></i>` : ""}
              </span>
              <span class="day-act">${esc(n.text)}</span>
              ${can("editLab")   ? `<button class="btn btn-sm btn-link p-0 note-edit-btn" onclick="startEditNote('${l.id}', ${n.idx})" title="Edit this note"><i class="bi bi-pencil"></i></button>` : ""}
              ${can("deleteLab") ? `<button class="btn btn-sm btn-link p-0 note-delete-btn" onclick="deleteNote('${l.id}', ${n.idx})" title="Delete this note"><i class="bi bi-trash"></i></button>` : ""}
            </div>`).join("")
        : `<p class="text-muted text-center py-3">No notes added yet.</p>`}
    </div>

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

// ── Edit a single note entry in place ───────────────────────
// Swaps that one row for a small inline textarea + Save/Cancel,
// rather than reopening the whole edit-lab modal for one line.
function startEditNote(labId, idx) {
  if (!can("editLab")) { showToast("You don't have edit access — ask your Admin", "danger"); return; }
  const lab = labById(labId);
  const row = document.getElementById(`noteRow-${idx}`);
  if (!lab || !row) return;
  const entry = (lab.notesHistory || [])[idx];
  if (!entry) return;

  row.outerHTML = `
    <div class="day-row day-note-editing" id="noteRow-${idx}">
      <div class="w-100">
        <textarea class="form-control form-control-sm mb-2" id="noteEditBox-${idx}" rows="2">${esc(entry.text)}</textarea>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-primary" onclick="saveEditNote('${labId}', ${idx})"><i class="bi bi-check-circle me-1"></i>Save</button>
          <button class="btn btn-sm btn-outline-secondary" onclick="showDetail('${labId}')">Cancel</button>
        </div>
      </div>
    </div>`;
  document.getElementById(`noteEditBox-${idx}`)?.focus();
}

async function saveEditNote(labId, idx) {
  const lab = labById(labId);
  const box = document.getElementById(`noteEditBox-${idx}`);
  if (!lab || !box) return;
  const newText = box.value.trim();
  if (!newText) { showToast("Note can't be empty", "danger"); return; }

  const history = (lab.notesHistory || []).slice();
  if (!history[idx]) return;
  history[idx] = { ...history[idx], text: newText, editedTs: Date.now() };

  // Mutate the local copy first so the modal re-render below doesn't have to
  // race the Firestore listener — it just reflects what we're about to save.
  lab.notesHistory = history;
  lab.notes = history[history.length - 1].text;

  try {
    await labsCol.doc(labId).update({
      notesHistory: history,
      notes: lab.notes
    });
    showToast("✅ Note updated");
    showDetail(labId);
  } catch (err) {
    showToast("❌ Error: " + err.message, "danger");
  }
}

async function deleteNote(labId, idx) {
  if (!can("deleteLab")) { showToast("You don't have delete access — ask your Admin", "danger"); return; }
  const lab = labById(labId);
  if (!lab) return;
  const history = (lab.notesHistory || []).slice();
  if (!history[idx]) return;
  if (!confirm("Delete this note? This can't be undone.")) return;

  history.splice(idx, 1);

  // Mutate the local copy first so the re-render below is instant, same
  // reasoning as saveEditNote — don't wait on the Firestore listener.
  lab.notesHistory = history;
  lab.notes = history.length ? history[history.length - 1].text : "";

  try {
    await labsCol.doc(labId).update({
      notesHistory: history,
      notes: lab.notes
    });
    showToast("🗑️ Note deleted");
    showDetail(labId);
  } catch (err) {
    showToast("❌ Error: " + err.message, "danger");
  }
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
      ["Date","Stage","Activity","Owner","Status","Blocker","Due"],
      ...mine.map(x => [x.date, x.stage, x.activity, x.owner, LOG_STATUS[x.status], x.blocker, x.dueDate])
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
    ["Date","Lab","City","Stage","Activity","Owner","Status","Blocker","Blocker Side","Due"],
    ...logs.slice().sort((a,b) => a.date.localeCompare(b.date)).map(x => [
      x.date, x.labName, x.labCity, x.stage, x.activity, x.owner,
      LOG_STATUS[x.status], x.blocker, BLOCKER_OWNER[x.blocker] || "", x.dueDate
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
      "Open Blockers","Blocker Reasons",
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
      [5,30,12,16,16,16,10,10,24,10,12,13,14,13,17,13,14,34,11,15,46,20,26,15,11,50],
      { 11:"dd/mm/yyyy", 12:"dd/mm/yyyy", 13:"dd/mm/yyyy", 19:"dd/mm/yyyy", 10:"0%" }), "Labs");

    // ── Sheet 2: the daily remarks behind those numbers ──────
    if (want("xlLogs")) {
      const rows = [[
        "Date","Lab","Lab Code","City","Assignee","Stage","Remark / Activity",
        "Owner","Status","Blocker","Blocker Side","Due Date","Days Overdue"
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
            (x.dueDate && x.dueDate < D && x.status !== "done") ? daysBetween(x.dueDate, D) : ""
          ]);
        });
      if (rows.length === 1) rows.push(["", "No log entries for the labs exported", "", "", "", "", "", "", "", "", "", "", ""]);
      XLSX.utils.book_append_sheet(wb, makeSheet(rows,
        [12,28,12,16,16,24,52,16,14,30,13,12,13],
        { 0:"dd/mm/yyyy", 11:"dd/mm/yyyy" }), "Daily Remarks");
    }

    // ── Sheet 3: what's still stuck, oldest first ────────────
    if (want("xlBlockers")) {
      const rows = [["Lab","City","Assignee","Blocker","Side","Blocked Since","Days Open","Activity","Owner","Due Date"]];
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
            xlDate(x.dueDate)
          ]);
        });
      if (rows.length === 1) rows.push(["Nothing blocked right now", "", "", "", "", "", "", "", "", ""]);
      XLSX.utils.book_append_sheet(wb, makeSheet(rows,
        [28,16,16,30,12,14,11,50,16,12],
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

// ============================================================
//  ONBOARDING ANALYSIS DASHBOARD
//  Sales Person-wise / Assignee-wise MIS view.
//  Reuses the existing labs[] data and the isLive/inOnboarding
//  helpers already used by the top stat cards — no dummy data,
//  no duplicate status logic.
// ============================================================
let anCharts = {};

function openAnalysis() {
  populateAnalysisFilters();
  renderAnalysis();
  const modalEl = document.getElementById("analysisModal");
  if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function resetAnalysisFilters() {
  ["anFilterSales", "anFilterAssignee", "anFilterStatus", "anFilterFrom", "anFilterTo", "anFilterSearch"]
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  renderAnalysis();
}

// Populate dropdowns once (skip if already built, so a user's mid-selection
// filter isn't wiped out every time labs[] updates in real time).
function populateAnalysisFilters() {
  const sp = document.getElementById("anFilterSales");
  const as = document.getElementById("anFilterAssignee");
  const st = document.getElementById("anFilterStatus");
  if (sp && sp.dataset.built !== "1") {
    sp.innerHTML = `<option value="">All Sales Persons</option>` +
      allSalesPeople().map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
    sp.dataset.built = "1";
  }
  if (as && as.dataset.built !== "1") {
    as.innerHTML = `<option value="">All Assignees</option>` +
      allAssignees().map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
    as.dataset.built = "1";
  }
  if (st && st.dataset.built !== "1") {
    st.innerHTML = `<option value="">All Status</option>` +
      STATUSES.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
    st.dataset.built = "1";
  }
}

function analysisFilteredLabs() {
  const sp   = document.getElementById("anFilterSales")?.value    || "";
  const as   = document.getElementById("anFilterAssignee")?.value || "";
  const st   = document.getElementById("anFilterStatus")?.value   || "";
  const from = document.getElementById("anFilterFrom")?.value     || "";
  const to   = document.getElementById("anFilterTo")?.value       || "";
  const q    = (document.getElementById("anFilterSearch")?.value || "").toLowerCase().trim();

  return labs.filter(l => {
    if (sp && (l.salesPerson || "") !== sp) return false;
    if (as && (l.assignee    || "") !== as) return false;
    if (st && (l.status      || "") !== st) return false;
    if (from && (!l.assignedOn || l.assignedOn < from)) return false;
    if (to   && (!l.assignedOn || l.assignedOn > to))   return false;
    if (q && !(l.name || "").toLowerCase().includes(q)) return false;
    return true;
  });
}

// Same buckets as the top-level stat cards: Live / Onboarding / Hold / Lost,
// derived from isLive() and inOnboarding() so the analysis view can never
// drift out of sync with the main dashboard's definitions.
function anBucketCounts(list) {
  return {
    total:      list.length,
    live:       list.filter(isLive).length,
    onboarding: list.filter(inOnboarding).length,
    hold:       list.filter(l => l.status === "Hold").length,
    lost:       list.filter(l => l.status === "Lost").length
  };
}

function anGroupCounts(list, field) {
  const groups = {};
  list.forEach(l => {
    const key = (l[field] || "").trim() || "Unassigned";
    (groups[key] ||= []).push(l);
  });
  return Object.entries(groups)
    .map(([name, items]) => ({ name, ...anBucketCounts(items) }))
    .sort((a, b) => b.total - a.total);
}

// Same hues as the .dc-* stat-card variants in style.css, so the dashboard
// cards, the pipeline badges and these charts all read as one colour system.
const AN_COLORS = { live: "#2fbf71", onboarding: "#4f8ef7", hold: "#f5a524", lost: "#8a97a3" };

function renderAnalysis() {
  if (!document.getElementById("analysisModal") || typeof Chart === "undefined") return;

  const filtered = analysisFilteredLabs();
  const overall  = anBucketCounts(filtered);

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("anTotal",    overall.total);
  set("anLive",     overall.live);
  set("anOnboard",  overall.onboarding);
  set("anHold",     overall.hold);
  set("anLost",     overall.lost);
  set("anLivePct",  overall.total ? Math.round(overall.live / overall.total * 100) + "%" : "—");

  const bySales    = anGroupCounts(filtered, "salesPerson");
  const byAssignee = anGroupCounts(filtered, "assignee");

  anRenderBarChart("anChartSales",    bySales);
  anRenderBarChart("anChartAssignee", byAssignee);
  anRenderTable("anTableSales",    bySales,    "Sales Person");
  anRenderTable("anTableAssignee", byAssignee, "Assignee");
  anRenderDonut(overall);
  anRenderTrend(filtered);
}

function anRenderBarChart(canvasId, groups) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (anCharts[canvasId]) anCharts[canvasId].destroy();

  if (!groups.length) { anCharts[canvasId] = null; return; }

  anCharts[canvasId] = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: groups.map(g => g.name),
      datasets: [
        { label: "Live",       data: groups.map(g => g.live),       backgroundColor: AN_COLORS.live },
        { label: "Onboarding", data: groups.map(g => g.onboarding), backgroundColor: AN_COLORS.onboarding },
        { label: "Hold",       data: groups.map(g => g.hold),       backgroundColor: AN_COLORS.hold },
        { label: "Lost",       data: groups.map(g => g.lost),       backgroundColor: AN_COLORS.lost }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: {
          mode: "index",
          intersect: false,
          callbacks: {
            footer: items => {
              const total = items.reduce((s, i) => s + i.parsed.y, 0);
              return `Total: ${total}`;
            }
          }
        }
      },
      scales: {
        x: { stacked: true, ticks: { autoSkip: false, maxRotation: 40, minRotation: 0, font: { size: 11 } } },
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }
      }
    }
  });
}

function anRenderDonut(overall) {
  const canvas = document.getElementById("anChartDonut");
  if (!canvas) return;
  if (anCharts.donut) anCharts.donut.destroy();

  anCharts.donut = new Chart(canvas.getContext("2d"), {
    type: "doughnut",
    data: {
      labels: ["Live", "Under Onboarding", "Hold", "Lost"],
      datasets: [{
        data: [overall.live, overall.onboarding, overall.hold, overall.lost],
        backgroundColor: [AN_COLORS.live, AN_COLORS.onboarding, AN_COLORS.hold, AN_COLORS.lost],
        borderWidth: 2,
        borderColor: document.documentElement.getAttribute("data-theme") === "dark" ? "#1a212c" : "#fff"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
              const pct = Math.round(ctx.parsed / total * 100);
              return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

function anRenderTrend(filtered) {
  const canvas = document.getElementById("anChartTrend");
  if (!canvas) return;
  if (anCharts.trend) anCharts.trend.destroy();

  const months = {};
  filtered.forEach(l => {
    if (!l.assignedOn) return;
    const m = l.assignedOn.slice(0, 7); // YYYY-MM
    months[m] = (months[m] || 0) + 1;
  });
  const sortedMonths = Object.keys(months).sort();

  if (!sortedMonths.length) { anCharts.trend = null; return; }

  anCharts.trend = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels: sortedMonths,
      datasets: [{
        label: "Labs Assigned",
        data: sortedMonths.map(m => months[m]),
        borderColor: document.documentElement.getAttribute("data-theme") === "dark" ? "#4fa3ff" : "#0f4c81",
        backgroundColor: document.documentElement.getAttribute("data-theme") === "dark" ? "rgba(79,163,255,0.18)" : "rgba(15,76,129,0.15)",
        fill: true,
        tension: 0.3,
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}

function anRenderTable(tableId, groups, labelName) {
  const table = document.getElementById(tableId);
  if (!table) return;

  if (!groups.length) {
    table.innerHTML = `
      <thead class="table-primary"><tr>
        <th>${esc(labelName)}</th><th>Total</th><th>Live</th><th>Onboarding</th><th>Hold</th><th>Lost</th><th>Live %</th>
      </tr></thead>
      <tbody><tr><td colspan="7" class="text-center text-muted py-3">No labs match the current filters</td></tr></tbody>`;
    return;
  }

  table.innerHTML = `
    <thead class="table-primary">
      <tr><th>${esc(labelName)}</th><th>Total</th><th>Live</th><th>Onboarding</th><th>Hold</th><th>Lost</th><th>Live %</th></tr>
    </thead>
    <tbody>
      ${groups.map(g => `
        <tr>
          <td>${esc(g.name)}</td>
          <td>${g.total}</td>
          <td>${g.live}</td>
          <td>${g.onboarding}</td>
          <td>${g.hold}</td>
          <td>${g.lost}</td>
          <td>${g.total ? Math.round(g.live / g.total * 100) + "%" : "—"}</td>
        </tr>`).join("")}
    </tbody>`;
}
