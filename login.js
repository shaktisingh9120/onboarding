// ── Flabs Login — User / Admin tabs ─────────────────────────
// Real per-person sign-in via Firebase Auth, replacing the old hardcoded
// single shared password. Role + permissions are looked up from the
// "users" collection (see lab-onboarding/script.js for how they're created).

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

let activeTab = "user"; // "user" | "admin"

// Already mid-session? Skip straight through.
if (sessionStorage.getItem("loggedIn") === "true") {
  window.location.href = "home/index.html";
}

function switchLoginTab(tab) {
  activeTab = tab;
  document.getElementById("tabUserBtn").classList.toggle("active", tab === "user");
  document.getElementById("tabAdminBtn").classList.toggle("active", tab === "admin");
  document.getElementById("tabHint").textContent = tab === "admin"
    ? "Admin accounts only — full access to every tool."
    : "Sign in with the login your admin gave you.";
  document.getElementById("error").textContent = "";
}

async function login() {
  const email    = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errBox   = document.getElementById("error");
  const btn      = document.getElementById("loginBtn");
  errBox.textContent = "";

  if (!email || !password) {
    errBox.textContent = "Enter both email and password.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Signing in...";

  try {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    const uid  = cred.user.uid;

    // Look up their role/permissions. No "users" doc yet (e.g. the very first
    // admin account, created directly in Firebase Console) defaults to Admin
    // so nobody already using the tool gets locked out.
    let role = "Admin", name = email, permissions = null;
    try {
      const doc = await db.collection("users").doc(uid).get();
      if (doc.exists) {
        role = doc.data().role || "Custom";
        name = doc.data().name || email;
        permissions = doc.data().permissions || null;
      }
    } catch (e) { /* rules may briefly block the lookup right after sign-in — role stays default */ }

    if (activeTab === "admin" && role !== "Admin") {
      await auth.signOut();
      errBox.textContent = "This account doesn't have Admin access — use the User tab instead.";
      return;
    }

    sessionStorage.setItem("loggedIn", "true");
    sessionStorage.setItem("userRole", role);
    sessionStorage.setItem("userEmail", email);
    sessionStorage.setItem("userName", name);
    sessionStorage.setItem("userPerms", JSON.stringify(permissions));

    window.location.href = "home/index.html";
  } catch (err) {
    let msg = "Invalid email or password.";
    if (err.code === "auth/too-many-requests") msg = "Too many attempts — try again in a minute.";
    if (err.code === "auth/user-disabled")     msg = "This account has been disabled. Contact your admin.";
    if (err.code === "auth/configuration-not-found") msg = "Login isn't set up yet — ask your admin to enable it in Firebase.";
    errBox.textContent = msg;
  } finally {
    btn.disabled = false;
    btn.textContent = "Login";
  }
}

function forgotPassword() {
  const email = document.getElementById("loginEmail").value.trim();
  if (!email) { alert("Type your email above first, then click Forgot password."); return; }
  auth.sendPasswordResetEmail(email)
    .then(() => alert("Password reset link sent to " + email))
    .catch(err => alert("Couldn't send reset email: " + err.message));
}
