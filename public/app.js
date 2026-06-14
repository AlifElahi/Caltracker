const calendarGrid = document.querySelector("#calendarGrid");
const appShell = document.querySelector(".app-shell");
const sidebarToggle = document.querySelector("#sidebarToggle");
const monthLabel = document.querySelector("#monthLabel");
const monthBalance = document.querySelector("#monthBalance");
const todayIntakeCard = document.querySelector("#todayIntakeCard");
const todayRemainingCard = document.querySelector("#todayRemainingCard");
const todayRemainingLabel = document.querySelector("#todayRemainingLabel");
const todayBalanceCard = document.querySelector("#todayBalanceCard");
const latestWeightCard = document.querySelector("#latestWeightCard");
const todayGoalCard = document.querySelector("#todayGoalCard");
const maintenanceInput = document.querySelector("#maintenanceInput");
const intakeGoalInput = document.querySelector("#intakeGoalInput");
const downloadBackup = document.querySelector("#downloadBackup");
const restoreBackup = document.querySelector("#restoreBackup");
const restoreFileName = document.querySelector("#restoreFileName");
const uploadBackup = document.querySelector("#uploadBackup");
const backupStatus = document.querySelector("#backupStatus");
const sessionStart = document.querySelector("#sessionStart");
const sessionEnd = document.querySelector("#sessionEnd");
const sessionPanel = document.querySelector(".session-panel");
const sessionToggle = document.querySelector("#sessionToggle");
const sessionDays = document.querySelector("#sessionDays");
const sessionIntake = document.querySelector("#sessionIntake");
const sessionBurned = document.querySelector("#sessionBurned");
const sessionBalance = document.querySelector("#sessionBalance");
const sessionWeight = document.querySelector("#sessionWeight");
const dialog = document.querySelector("#dayDialog");
const dialogDate = document.querySelector("#dialogDate");
const dayIntake = document.querySelector("#dayIntake");
const dayMaintenance = document.querySelector("#dayMaintenance");
const dayBurned = document.querySelector("#dayBurned");
const dayBalance = document.querySelector("#dayBalance");
const entryList = document.querySelector("#entryList");
const entryCount = document.querySelector("#entryCount");
const manualLabel = document.querySelector("#manualLabel");
const manualCalories = document.querySelector("#manualCalories");
const walkCalories = document.querySelector("#walkCalories");
const workoutDone = document.querySelector("#workoutDone");
const workoutCalories = document.querySelector("#workoutCalories");
const weightKg = document.querySelector("#weightKg");

let store = { settings: { maintenanceCalories: 2200, intakeGoal: 1200, maintenanceHistory: [], sessionStart: "", sessionEnd: "" }, days: {} };
let visibleMonth = new Date();
let selectedDate = toDateKey(new Date());

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dayRecord(key) {
  store.days[key] ||= { entries: [], burned: 0, workoutDone: false, workoutBurned: 0, weightKg: "" };
  store.days[key].entries ||= [];
  store.days[key].burned ||= 0;
  store.days[key].workoutDone = Boolean(store.days[key].workoutDone);
  store.days[key].workoutBurned ||= 0;
  return store.days[key];
}

function readDayRecord(key) {
  const day = store.days[key];
  return {
    entries: day?.entries || [],
    burned: Number(day?.burned || 0),
    workoutDone: Boolean(day?.workoutDone),
    workoutBurned: Number(day?.workoutBurned || 0),
    weightKg: day?.weightKg || ""
  };
}

function normalizeSettings() {
  store.settings ||= {};
  store.settings.maintenanceCalories ||= 2200;
  store.settings.intakeGoal ||= 1200;
  store.settings.maintenanceHistory ||= [];
  store.settings.sessionStart ||= "";
  store.settings.sessionEnd ||= "";
  store.days ||= {};

  if (!store.settings.maintenanceHistory.length) {
    const existingDays = Object.keys(store.days).sort();
    store.settings.maintenanceHistory = [
      {
        date: existingDays[0] || toDateKey(new Date()),
        calories: Number(store.settings.maintenanceCalories || 2200)
      }
    ];
  }

  store.settings.maintenanceHistory = store.settings.maintenanceHistory
    .map(item => ({ date: item.date, calories: Number(item.calories || 0) }))
    .filter(item => item.date && item.calories > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!store.settings.maintenanceHistory.length) {
    const existingDays = Object.keys(store.days).sort();
    store.settings.maintenanceHistory = [
      {
        date: existingDays[0] || toDateKey(new Date()),
        calories: Number(store.settings.maintenanceCalories || 2200)
      }
    ];
  }
}

function maintenanceForDate(key) {
  let active = store.settings.maintenanceHistory[0]?.calories || Number(store.settings.maintenanceCalories || 0);
  for (const item of store.settings.maintenanceHistory) {
    if (item.date > key) break;
    active = Number(item.calories || active);
  }
  return active;
}

function setMaintenanceFromDate(dateKey, calories) {
  const value = Number(calories || 0);
  if (!value) return;

  const history = store.settings.maintenanceHistory.filter(item => item.date < dateKey);
  history.push({ date: dateKey, calories: value });
  history.sort((a, b) => a.date.localeCompare(b.date));
  store.settings.maintenanceHistory = history;
  store.settings.maintenanceCalories = value;
}

function totals(key) {
  const day = readDayRecord(key);
  const intake = day.entries.reduce((sum, entry) => sum + Number(entry.calories || 0), 0);
  const maintenance = maintenanceForDate(key);
  const burned = Number(day.burned || 0) + Number(day.workoutBurned || 0);
  return {
    intake,
    maintenance,
    burned,
    balance: intake - maintenance - burned
  };
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(date.getDate() + amount);
  return next;
}

function daysBetween(startKey, endKey) {
  if (!startKey || !endKey || endKey < startKey) return [];
  const days = [];
  for (let cursor = parseDateKey(startKey); toDateKey(cursor) <= endKey; cursor = addDays(cursor, 1)) {
    days.push(toDateKey(cursor));
  }
  return days;
}

function isInSession(key) {
  const { sessionStart: start, sessionEnd: end } = store.settings;
  return Boolean(start && end && start <= key && key <= end);
}

function sessionReport() {
  const keys = daysBetween(store.settings.sessionStart, store.settings.sessionEnd);
  const report = {
    days: keys.length,
    intake: 0,
    maintenance: 0,
    burned: 0,
    balance: 0,
    firstWeight: null,
    lastWeight: null
  };

  for (const key of keys) {
    const total = totals(key);
    const day = readDayRecord(key);
    report.intake += total.intake;
    report.maintenance += total.maintenance;
    report.burned += total.burned;
    report.balance += total.balance;

    if (day.weightKg) {
      const weight = Number(day.weightKg);
      report.firstWeight ??= weight;
      report.lastWeight = weight;
    }
  }

  return report;
}

function formatSigned(value) {
  if (value > 0) return `+${value}`;
  return String(value);
}

function balanceClass(value) {
  if (value > 50) return "surplus";
  if (value < -50) return "deficit";
  return "even";
}

function intakeClass(value) {
  const goal = Number(store.settings.intakeGoal || 1200);
  const warningFloor = Math.max(0, goal - 100);
  if (value > goal) return "intake-over";
  if (value > warningFloor) return "intake-warn";
  return "intake-good";
}

function workoutClass(key) {
  const day = readDayRecord(key);
  return day.workoutDone ? "workout-done" : "workout-not-done";
}

function workoutLabel(key) {
  return readDayRecord(key).workoutDone ? "Workout done" : "Workout not done";
}

function latestWeight() {
  const entries = Object.entries(store.days)
    .filter(([, day]) => day.weightKg)
    .sort(([a], [b]) => b.localeCompare(a));
  if (!entries.length) return null;
  return entries[0][1].weightKg;
}

async function apiFetch(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    window.location.href = "/login.html";
    throw new Error("Login required.");
  }
  return response;
}

async function loadStore() {
  const response = await apiFetch("/api/data");
  store = await response.json();
  normalizeSettings();
  maintenanceInput.value = maintenanceForDate(toDateKey(new Date()));
  intakeGoalInput.value = store.settings.intakeGoal || 1200;
  sessionStart.value = store.settings.sessionStart || "";
  sessionEnd.value = store.settings.sessionEnd || "";
  render();
}

async function saveStore() {
  await apiFetch("/api/data", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(store)
  });
}

async function downloadDataBackup() {
  backupStatus.textContent = "Preparing download...";
  const response = await apiFetch("/api/backup");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `caltracker-backup-${date}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  backupStatus.textContent = "Backup downloaded.";
}

async function restoreDataBackup() {
  const file = restoreBackup.files[0];
  if (!file) {
    backupStatus.textContent = "Choose a backup file first.";
    return;
  }

  backupStatus.textContent = "Restoring backup...";
  try {
    const payload = JSON.parse(await file.text());
    const response = await apiFetch("/api/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Restore failed.");
    restoreBackup.value = "";
    restoreFileName.textContent = "Choose JSON file";
    backupStatus.textContent = "Backup restored.";
    await loadStore();
  } catch (error) {
    backupStatus.textContent = error.message;
  }
}

function render() {
  renderDashboard();
  renderCalendar();
  renderSessionReport();
  if (dialog.open) renderDialog();
}

function renderDashboard() {
  const todayTotal = totals(toDateKey(new Date()));
  const intakeGoal = Number(store.settings.intakeGoal || 1200);
  const remaining = intakeGoal - todayTotal.intake;
  todayIntakeCard.textContent = todayTotal.intake;
  todayIntakeCard.className = intakeClass(todayTotal.intake);
  todayGoalCard.textContent = `target ${store.settings.intakeGoal || 1200}`;
  todayRemainingCard.textContent = remaining >= 0 ? remaining : `+${Math.abs(remaining)}`;
  todayRemainingCard.className = remaining >= 0 ? "intake-good" : "intake-over";
  todayRemainingLabel.textContent = remaining >= 0 ? "calories left" : "over goal";
  todayBalanceCard.textContent = formatSigned(todayTotal.balance);
  todayBalanceCard.className = balanceClass(todayTotal.balance);
  latestWeightCard.textContent = latestWeight() || "--";
}

function renderSessionReport() {
  const report = sessionReport();
  sessionStart.value = store.settings.sessionStart || "";
  sessionEnd.value = store.settings.sessionEnd || "";
  sessionDays.textContent = report.days;
  sessionIntake.textContent = Math.round(report.intake);
  sessionBurned.textContent = Math.round(report.burned);
  sessionBalance.textContent = formatSigned(Math.round(report.balance));
  sessionBalance.className = balanceClass(report.balance);

  if (report.firstWeight === null || report.lastWeight === null) {
    sessionWeight.textContent = "--";
  } else {
    const change = report.lastWeight - report.firstWeight;
    sessionWeight.textContent = `${formatSigned(change.toFixed(1))} kg`;
  }
}

function renderCalendar() {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(first);
  const mondayOffset = (first.getDay() + 6) % 7;
  start.setDate(first.getDate() - mondayOffset);
  const todayKey = toDateKey(new Date());

  monthLabel.textContent = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  calendarGrid.innerHTML = "";

  let monthlyBalance = 0;
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = toDateKey(date);
    const total = totals(key);
    const day = readDayRecord(key);
    const inMonth = date.getMonth() === month;
    if (inMonth) monthlyBalance += total.balance;

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = [
      "day-cell",
      inMonth ? "" : "muted",
      isInSession(key) ? "in-session" : "",
      key === todayKey ? "is-today" : "",
      day.entries.length || day.burned || day.weightKg ? "has-data" : ""
    ].filter(Boolean).join(" ");
    cell.innerHTML = `
      <div class="day-number">
        <span class="day-num">${date.getDate()}</span>
        <span class="mobile-date">${date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
        <span class="workout-fire ${workoutClass(key)}" title="${workoutLabel(key)}" aria-label="${workoutLabel(key)}">🔥</span>
        ${key === todayKey ? "<span class=\"today-pill\">Today</span>" : ""}
      </div>
      <div class="day-stats">
        <span class="${intakeClass(total.intake)}">Food ${total.intake}</span>
        <span>Goal ${total.maintenance}</span>
        ${day.burned ? `<span>Walk ${day.burned}</span>` : ""}
        ${day.workoutBurned ? `<span>Workout ${day.workoutBurned}</span>` : ""}
        <span class="balance ${balanceClass(total.balance)}">${formatSigned(total.balance)} cal</span>
        ${day.weightKg ? `<span>${day.weightKg} kg</span>` : ""}
      </div>
    `;
    cell.addEventListener("click", () => openDay(key));
    calendarGrid.append(cell);
  }

  monthBalance.textContent = formatSigned(Math.round(monthlyBalance));
  monthBalance.className = balanceClass(monthlyBalance);
}

function openDay(key) {
  selectedDate = key;
  renderDialog();
  dialog.showModal();
}

function renderDialog() {
  const date = parseDateKey(selectedDate);
  const day = readDayRecord(selectedDate);
  const total = totals(selectedDate);

  dialogDate.textContent = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  dayIntake.textContent = total.intake;
  dayIntake.className = intakeClass(total.intake);
  dayMaintenance.textContent = total.maintenance;
  dayBurned.textContent = total.burned;
  dayBalance.textContent = formatSigned(total.balance);
  dayBalance.className = balanceClass(total.balance);
  walkCalories.value = day.burned || "";
  workoutDone.checked = day.workoutDone;
  workoutCalories.value = day.workoutBurned || "";
  weightKg.value = day.weightKg || "";
  entryCount.textContent = `${day.entries.length} ${day.entries.length === 1 ? "entry" : "entries"}`;

  entryList.innerHTML = "";
  if (!day.entries.length) {
    entryList.innerHTML = "<p class=\"empty-state\">No food entries yet.</p>";
    return;
  }

  day.entries.forEach((entry, index) => {
    const item = document.createElement("div");
    item.className = "entry-item";
    item.innerHTML = `
      <div>
        <strong>${entry.label}</strong>
        <small>${entry.note || "Manual"}</small>
      </div>
      <strong>${entry.calories} cal</strong>
      <button class="ghost-button" type="button">Remove</button>
    `;
    item.querySelector("button").addEventListener("click", async () => {
      day.entries.splice(index, 1);
      await saveStore();
      render();
    });
    entryList.append(item);
  });
}

async function addEntry(entry) {
  dayRecord(selectedDate).entries.push({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...entry
  });
  await saveStore();
  render();
}

document.querySelector("#prevMonth").addEventListener("click", () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
  renderCalendar();
});

document.querySelector("#nextMonth").addEventListener("click", () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  renderCalendar();
});

document.querySelector("#todayButton").addEventListener("click", () => {
  visibleMonth = new Date();
  renderCalendar();
});

sidebarToggle.addEventListener("click", () => {
  const collapsed = appShell.classList.toggle("sidebar-collapsed");
  sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
  sidebarToggle.textContent = collapsed ? "☰" : "‹";
});

sessionToggle.addEventListener("click", () => {
  const collapsed = sessionPanel.classList.toggle("session-collapsed");
  sessionToggle.setAttribute("aria-expanded", String(!collapsed));
  sessionToggle.textContent = collapsed ? "+" : "−";
});

document.querySelector("#logoutButton").addEventListener("click", async () => {
  await apiFetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login.html";
});

document.querySelector("#saveMaintenance").addEventListener("click", async () => {
  setMaintenanceFromDate(toDateKey(new Date()), maintenanceInput.value);
  await saveStore();
  render();
});

document.querySelector("#saveIntakeGoal").addEventListener("click", async () => {
  const value = Number(intakeGoalInput.value || 0);
  if (!value) return;
  store.settings.intakeGoal = value;
  await saveStore();
  render();
});

downloadBackup.addEventListener("click", downloadDataBackup);
uploadBackup.addEventListener("click", restoreDataBackup);
restoreBackup.addEventListener("change", () => {
  restoreFileName.textContent = restoreBackup.files[0]?.name || "Choose JSON file";
});

document.querySelector("#saveSession").addEventListener("click", async () => {
  const start = sessionStart.value;
  const end = sessionEnd.value;
  store.settings.sessionStart = start;
  store.settings.sessionEnd = end && start && end < start ? start : end;
  await saveStore();
  render();
});

document.querySelector("#clearSession").addEventListener("click", async () => {
  store.settings.sessionStart = "";
  store.settings.sessionEnd = "";
  await saveStore();
  render();
});

document.querySelector("#setSessionStart").addEventListener("click", async () => {
  store.settings.sessionStart = selectedDate;
  if (store.settings.sessionEnd && store.settings.sessionEnd < selectedDate) {
    store.settings.sessionEnd = selectedDate;
  }
  await saveStore();
  render();
});

document.querySelector("#setSessionEnd").addEventListener("click", async () => {
  store.settings.sessionEnd = selectedDate;
  if (store.settings.sessionStart && store.settings.sessionStart > selectedDate) {
    store.settings.sessionStart = selectedDate;
  }
  if (!store.settings.sessionStart) {
    store.settings.sessionStart = selectedDate;
  }
  await saveStore();
  render();
});

document.querySelector("#addManual").addEventListener("click", async () => {
  const calories = Number(manualCalories.value || 0);
  if (!calories) return;
  await addEntry({
    label: manualLabel.value.trim() || "Manual calorie entry",
    calories,
    source: "manual"
  });
  manualLabel.value = "";
  manualCalories.value = "";
  manualLabel.focus();
});

[manualLabel, manualCalories].forEach(input => {
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      document.querySelector("#addManual").click();
    }
  });
});

document.querySelector("#saveWalk").addEventListener("click", async () => {
  dayRecord(selectedDate).burned = Number(walkCalories.value || 0);
  await saveStore();
  render();
});

document.querySelector("#saveWorkout").addEventListener("click", async () => {
  const day = dayRecord(selectedDate);
  day.workoutDone = workoutDone.checked;
  day.workoutBurned = Number(workoutCalories.value || 0);
  await saveStore();
  render();
});

document.querySelector("#saveWeight").addEventListener("click", async () => {
  dayRecord(selectedDate).weightKg = weightKg.value ? Number(weightKg.value).toFixed(1) : "";
  await saveStore();
  render();
});

loadStore();
