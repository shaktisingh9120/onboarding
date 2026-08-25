if (sessionStorage.getItem("loggedIn") !== "true") {
  window.location.href = "../index.html";
}

function openTool(tool) {
  window.location.href = "../" + tool + "/index.html";
}

function logout() {
  sessionStorage.clear();
  window.location.href = "../index.html";
}
