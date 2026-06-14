const authTitle = document.querySelector("#authTitle");
const authCopy = document.querySelector("#authCopy");
const nameInput = document.querySelector("#nameInput");
const passwordInput = document.querySelector("#passwordInput");
const authButton = document.querySelector("#authButton");
const authStatus = document.querySelector("#authStatus");

let needsSetup = false;
let knownUsers = [];

async function status() {
  const response = await fetch("/api/auth/status");
  const payload = await response.json();
  if (payload.authenticated) {
    window.location.href = "/";
    return;
  }

  knownUsers = payload.users || [];
  needsSetup = !payload.configured;
  if (needsSetup) {
    authTitle.textContent = "Create first user";
    authCopy.textContent = "Choose your name and password. You can add your wife after logging in.";
    authButton.textContent = "Create user";
    nameInput.autocomplete = "name";
    passwordInput.autocomplete = "new-password";
  } else {
    authTitle.textContent = "Login";
    authCopy.textContent = knownUsers.length
      ? `Users: ${knownUsers.map(user => user.name).join(", ")}`
      : "Enter your user name and password.";
    nameInput.placeholder = knownUsers[0]?.name || "User name";
    if (knownUsers.length === 1) nameInput.value = knownUsers[0].name;
  }
}

async function submit() {
  const name = nameInput.value.trim();
  const password = passwordInput.value;
  if (!name) {
    authStatus.textContent = "Enter your user name.";
    nameInput.focus();
    return;
  }

  if (!password || password.length < 8) {
    authStatus.textContent = "Use at least 8 characters.";
    passwordInput.focus();
    return;
  }

  authStatus.textContent = needsSetup ? "Creating user..." : "Logging in...";
  const response = await fetch(needsSetup ? "/api/auth/setup" : "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password })
  });
  const payload = await response.json();

  if (!response.ok) {
    authStatus.textContent = payload.error || "Authentication failed.";
    return;
  }

  window.location.href = "/";
}

authButton.addEventListener("click", submit);
[nameInput, passwordInput].forEach(input => input.addEventListener("keydown", event => {
  if (event.key === "Enter") submit();
}));

status();
