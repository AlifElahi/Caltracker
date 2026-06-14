const authTitle = document.querySelector("#authTitle");
const authCopy = document.querySelector("#authCopy");
const passwordInput = document.querySelector("#passwordInput");
const authButton = document.querySelector("#authButton");
const authStatus = document.querySelector("#authStatus");

let needsSetup = false;

async function status() {
  const response = await fetch("/api/auth/status");
  const payload = await response.json();
  if (payload.authenticated) {
    window.location.href = "/";
    return;
  }

  needsSetup = !payload.configured;
  if (needsSetup) {
    authTitle.textContent = "Create password";
    authCopy.textContent = "Choose a password for this app. You will use it to unlock your calorie data.";
    authButton.textContent = "Create password";
    passwordInput.autocomplete = "new-password";
  }
}

async function submit() {
  const password = passwordInput.value;
  if (!password || password.length < 8) {
    authStatus.textContent = "Use at least 8 characters.";
    return;
  }

  authStatus.textContent = needsSetup ? "Creating password..." : "Logging in...";
  const response = await fetch(needsSetup ? "/api/auth/setup" : "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  const payload = await response.json();

  if (!response.ok) {
    authStatus.textContent = payload.error || "Authentication failed.";
    return;
  }

  window.location.href = "/";
}

authButton.addEventListener("click", submit);
passwordInput.addEventListener("keydown", event => {
  if (event.key === "Enter") submit();
});

status();
