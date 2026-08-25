# Lab Onboarding — v2 setup notes

What changed, and the two things you need to do before this goes into daily use.

---

## 1. Backfill the existing labs (do this first)

Labs already in Firestore have no `stage` / `assignedOn` fields, so they'll all
show as "Assigned" with no dates until you backfill them.

Open the Lab Onboarding page, hit F12, and run this once in the console:

```js
labs.filter(l => !l.stage).forEach(l => labsCol.doc(l.id).update({
  stage: "Assigned",
  assignedOn: l.createdAt?.toDate ? ymd(l.createdAt.toDate()) : today(),
  goLiveTarget: "",
  goLiveOn: "",
  stageHistory: []
}));
```

If a lab is already live, set it properly instead:

```js
labsCol.doc("<LAB_ID>").update({
  stage: "Live",
  assignedOn: "2026-05-02",
  goLiveOn: "2026-05-14",
  stageHistory: [
    { stage: "Assigned", date: "2026-05-02" },
    { stage: "Live",     date: "2026-05-14" }
  ]
});
```

---

## 2. Security rules — this one matters

Right now the only gate is this line in `index.html`:

```js
if (sessionStorage.getItem("loggedIn") !== "true") { ... }
```

That is a UI redirect, not security. Anyone can open devtools, run
`sessionStorage.setItem("loggedIn","true")`, and walk in. Worse, they can skip
the page entirely and query Firestore directly using the config in
`firebase-config.js` — that config is public by design and is not a secret.

**Firestore rules are the only real lock.** This database now holds lab contact
names, emails and phone numbers.

Add Firebase Auth (email/password is enough for an internal team), then apply:

**firestore.rules**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

**storage.rules**
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Apply these only *after* Auth is wired up — otherwise you lock yourself out too.

---

## 3. Heads-up: hosting is pointed at the wrong folder

`firebase.json` currently says:

```json
"hosting": { "public": "public", ... }
```

But `public/` only contains the default Firebase welcome page. The real app —
`index.html`, `home/`, `lab-onboarding/`, `test-matching/` — sits at the repo
root. So `firebase deploy --only hosting` (and the GitHub Action, which reads
the same file) ships the welcome page, not your tools.

Left it untouched in case your live setup differs from what's in this zip. If it
is in fact broken, the fix is one line:

```json
"hosting": {
  "public": ".",
  "ignore": ["firebase.json", "**/.*", "**/node_modules/**", "public/**"]
}
```

Also drop the catch-all rewrite (`"source": "**" → "/index.html"`) — it breaks
direct links like `/lab-onboarding/index.html` on a multi-page site.

---

## What's new in the module

**Collections**

| Collection | Purpose |
|---|---|
| `labs` | now also carries `stage`, `assignedOn`, `goLiveTarget`, `goLiveOn`, `stageHistory[]` |
| `daily_logs` | one row per lab per activity per day — the day-by-day record |
| `daily_reports` | archived 6 PM reports, document ID is the date |

**Pipeline** — Assigned → Kickoff & Requirements → Master Configuration →
Machine Interfacing → Data Migration → Staff Training → UAT / Trial Run →
Go-Live → Live. Every move is date-stamped into `stageHistory`, which is what
produces the per-lab journey.

**Tabs** — Onboarding Pipeline (progress per lab, arrows to move stages),
Daily Tracker (log what happened, browse any past date), 6 PM Report
(auto-composed, copy / archive / download).

**Editing a lab** — the pencil icon in the Actions column (and the Edit button
inside the detail modal) opens a full edit form: name, code, status, priority,
city, contact, email, phone, notes, plus the stage and all three dates.

Two things it handles that a plain form wouldn't:

- `daily_logs` store the lab name on each row for speed, so renaming a lab also
  rewrites every one of its past log entries — otherwise old entries would keep
  showing the wrong name in the report and the journey view.
- Changing the stage by hand reconciles `stageHistory`: forward stamps today's
  date, backward drops the stages after it. For everyday progress keep using the
  arrows in the pipeline — the edit form is for fixing mistakes.

**Two decisions worth knowing about**

- A blocked entry stays blocked until someone changes its status. So a blocker
  from three days ago still shows in tonight's report, marked "since 22/08",
  instead of quietly vanishing.
- The blocker tag decides the report section. Pick a ⚙️ system tag and it lands
  under System issues; a 🏢 client tag lands under Client-side issues. You never
  fill that in twice.

**Export ZIP** now also produces `daily_record.csv` per lab, a combined
`all_daily_logs.csv`, and today's report as a `.txt`.
