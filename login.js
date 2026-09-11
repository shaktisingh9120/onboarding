function login() {
  const user = document.getElementById("userId").value;
  const pass = document.getElementById("password").value;

  if (user === "flabs" && pass === "flabs@123") {
    sessionStorage.setItem("loggedIn", "true");
    window.location.href = "home/index.html";
  } else {
    document.getElementById("error").innerText =
      "Invalid ID or Password";
  }
}
