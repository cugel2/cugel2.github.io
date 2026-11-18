import { dayKey } from "../core/timer";
import type { PracticeMode } from "../core/types";
import { savePracticeMode } from "../storage";
import { activities, app, requiredElement, showToast, VALID_MODES } from "./state";
import { dayDoneDialog, persistPracticeTime, updatePracticeTime } from "./today";

/** The toolbar's mode switch, and moving between the Drills and Copy activities (moved from main.ts in 0.17.0). */

const modeSelect = requiredElement<HTMLSelectElement>("#practiceModeSelect");
const todayModeButton = requiredElement<HTMLButtonElement>("#todayModeButton");
const copyModeButton = requiredElement<HTMLButtonElement>("#copyModeButton");
const appShell = requiredElement<HTMLElement>(".app-shell");
const COPY_ACTIVE_KEY = "circle-trainer:copy-active";
/** Practice day a mode was last picked from the menu, so a same-day reload keeps a free mode instead of jumping to Today. */
const MODE_DAY_KEY = "circle-trainer:mode-day";

function rememberModeDay(): void {
  try { localStorage.setItem(MODE_DAY_KEY, dayKey(Date.now())); } catch { /* storage blocked: reloads open on Today */ }
}

export function readModeDay(): string | null {
  try { return localStorage.getItem(MODE_DAY_KEY); } catch { return null; }
}

/** Stores the practice day Copy was open on, so a reload reopens Copy that day but a new day opens on Today. */
export function rememberCopyActive(value: boolean): void {
  try {
    if (value) localStorage.setItem(COPY_ACTIVE_KEY, dayKey(Date.now()));
    else localStorage.removeItem(COPY_ACTIVE_KEY);
  } catch { /* storage blocked: Copy just won't reopen by itself */ }
}

/** Copy was open when the page was last left. "today" when that was today (older versions stored "1"). */
export function readCopyActive(): "today" | "earlier" | null {
  try {
    const value = localStorage.getItem(COPY_ACTIVE_KEY);
    return value === null ? null : value === dayKey(Date.now()) ? "today" : "earlier";
  } catch { return null; }
}

/**
 * The toolbar's mode switch: Today and Copy are buttons, the single drills sit in the Drills menu.
 * The menu shows "Drills" while Today or Copy is on.
 */
export function showModeChoice(mode: PracticeMode | "COPY"): void {
  const drill = mode !== "TODAY" && mode !== "COPY" && Array.from(modeSelect.options).some((option) => option.value === mode);
  modeSelect.value = drill ? mode : "";
  modeSelect.classList.toggle("active", drill);
  todayModeButton.setAttribute("aria-pressed", String(mode === "TODAY"));
  copyModeButton.setAttribute("aria-pressed", String(mode === "COPY"));
}

/** A fresh session of a practice mode in the Drills activity. */
export function resetSession(mode: PracticeMode): void {
  app.selectedMode = mode;
  showModeChoice(mode);
  activities.drills.show({ mode });
}

export function enterCopy(): void {
  app.copyActive = true;
  showModeChoice("COPY");
  appShell.classList.add("copy-active");
  activities.drills.hide();
  activities.copy.show();
  app.copyClock.setVisible(document.visibilityState === "visible", Date.now());
  updatePracticeTime();
  rememberCopyActive(true);
}

export function leaveCopy(mode: PracticeMode): void {
  app.copyActive = false;
  app.copyClock.setVisible(false, Date.now());
  persistPracticeTime();
  if (dayDoneDialog.open) dayDoneDialog.close();
  activities.copy.hide();
  appShell.classList.remove("copy-active");
  rememberCopyActive(false);
  resetSession(mode);
}

/** Switches mode from the toolbar, unless a stroke is in progress. */
function chooseMode(value: string): void {
  const current = app.copyActive ? "COPY" : app.selectedMode;
  if (value === current) { showModeChoice(current); return; }
  if ((app.copyActive && activities.copy.isDrawing()) || (!app.copyActive && activities.drills.isDrawing())) {
    showModeChoice(current);
    showToast("Finish the current stroke before changing modes");
    return;
  }
  // Copy is handled before any practice-mode logic: it has no trials.
  if (value === "COPY") {
    enterCopy();
    return;
  }
  const mode = value as PracticeMode;
  if (!VALID_MODES.includes(mode)) { showModeChoice(current); return; }
  if (app.copyActive) leaveCopy(mode);
  else resetSession(mode);
  rememberModeDay();
  void savePracticeMode(mode).catch(() => showToast("Practice mode could not be saved"));
}

export function goToToday(): void {
  if (dayDoneDialog.open) dayDoneDialog.close();
  showModeChoice("TODAY");
  if (app.copyActive) leaveCopy("TODAY");
  else resetSession("TODAY");
  void savePracticeMode("TODAY").catch(() => showToast("Practice mode could not be saved"));
}

export function wireModes(): void {
  modeSelect.addEventListener("change", () => chooseMode(modeSelect.value));
  todayModeButton.addEventListener("click", () => chooseMode("TODAY"));
  copyModeButton.addEventListener("click", () => chooseMode("COPY"));
}
