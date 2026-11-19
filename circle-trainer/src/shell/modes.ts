import { dayKey } from "../core/timer";
import type { PracticeMode } from "../core/types";
import { savePracticeMode } from "../storage";
import { activities, app, requiredElement, showToast, studioActivity, studioClock, VALID_MODES, type Studio } from "./state";
import { dayDoneDialog, persistPracticeTime, updatePracticeTime } from "./today";

/**
 * The toolbar's mode switch, and moving between the Drills activity and the shared Copy/Memory screen (moved from
 * main.ts in 0.17.0; Memory added in 0.19.0).
 */

const modeSelect = requiredElement<HTMLSelectElement>("#practiceModeSelect");
const todayModeButton = requiredElement<HTMLButtonElement>("#todayModeButton");
const studioButtons: Record<Studio, HTMLButtonElement> = {
  COPY: requiredElement<HTMLButtonElement>("#copyModeButton"),
  MEMORY: requiredElement<HTMLButtonElement>("#memoryModeButton"),
};
const appShell = requiredElement<HTMLElement>(".app-shell");
/** The practice day Copy (or, since 0.19.0, Memory) was open on, so a reload reopens it that day. */
const STUDIO_ACTIVE_KEYS: Record<Studio, string> = { COPY: "circle-trainer:copy-active", MEMORY: "circle-trainer:memory-active" };
/** Practice day a mode was last picked from the menu, so a same-day reload keeps a free mode instead of jumping to Today. */
const MODE_DAY_KEY = "circle-trainer:mode-day";

function rememberModeDay(): void {
  try { localStorage.setItem(MODE_DAY_KEY, dayKey(Date.now())); } catch { /* storage blocked: reloads open on Today */ }
}

export function readModeDay(): string | null {
  try { return localStorage.getItem(MODE_DAY_KEY); } catch { return null; }
}

/** Stores which of Copy and Memory is open, and on which practice day, so a reload reopens it that day but a new day opens on Today. */
export function rememberStudioActive(studio: Studio | null): void {
  try {
    for (const each of ["COPY", "MEMORY"] as const) {
      if (each === studio) localStorage.setItem(STUDIO_ACTIVE_KEYS[each], dayKey(Date.now()));
      else localStorage.removeItem(STUDIO_ACTIVE_KEYS[each]);
    }
  } catch { /* storage blocked: it just won't reopen by itself */ }
}

/** Copy or Memory was open when the page was last left: which, and whether that was today (older versions stored "1"). */
export function readStudioActive(): { studio: Studio; when: "today" | "earlier" } | null {
  try {
    for (const studio of ["COPY", "MEMORY"] as const) {
      const value = localStorage.getItem(STUDIO_ACTIVE_KEYS[studio]);
      if (value !== null) return { studio, when: value === dayKey(Date.now()) ? "today" : "earlier" };
    }
    return null;
  } catch { return null; }
}

/**
 * The toolbar's mode switch: Today, Copy and Memory are buttons, the single drills sit in the Drills menu.
 * The menu shows "Drills" while one of the buttons is on.
 */
export function showModeChoice(mode: PracticeMode | Studio): void {
  const drill = mode !== "TODAY" && mode !== "COPY" && mode !== "MEMORY" && Array.from(modeSelect.options).some((option) => option.value === mode);
  modeSelect.value = drill ? mode : "";
  modeSelect.classList.toggle("active", drill);
  todayModeButton.setAttribute("aria-pressed", String(mode === "TODAY"));
  for (const studio of ["COPY", "MEMORY"] as const) studioButtons[studio].setAttribute("aria-pressed", String(mode === studio));
}

/** A fresh session of a practice mode in the Drills activity. */
export function resetSession(mode: PracticeMode): void {
  app.selectedMode = mode;
  showModeChoice(mode);
  activities.drills.show({ mode });
}

/** Opens Copy or Memory, from the drills or from the other one. */
export function enterStudio(studio: Studio): void {
  if (app.studio === studio) return;
  const now = Date.now();
  if (app.studio) {
    studioClock(app.studio).setVisible(false, now);
    persistPracticeTime();
    if (dayDoneDialog.open) dayDoneDialog.close();
    studioActivity(app.studio).hide();
  } else {
    activities.drills.hide();
  }
  app.studio = studio;
  showModeChoice(studio);
  appShell.classList.add("copy-active");
  studioActivity(studio).show();
  studioClock(studio).setVisible(document.visibilityState === "visible", now);
  updatePracticeTime();
  rememberStudioActive(studio);
}

export function enterCopy(): void {
  enterStudio("COPY");
}

/** Leaves Copy or Memory for a practice mode. */
export function leaveStudio(mode: PracticeMode): void {
  const studio = app.studio;
  if (!studio) return;
  app.studio = null;
  studioClock(studio).setVisible(false, Date.now());
  persistPracticeTime();
  if (dayDoneDialog.open) dayDoneDialog.close();
  studioActivity(studio).hide();
  appShell.classList.remove("copy-active");
  rememberStudioActive(null);
  resetSession(mode);
}

/** Switches mode from the toolbar, unless a stroke is in progress. */
function chooseMode(value: string): void {
  const current = app.studio ?? app.selectedMode;
  if (value === current) { showModeChoice(current); return; }
  if (app.studio ? studioActivity(app.studio).isDrawing() : activities.drills.isDrawing()) {
    showModeChoice(current);
    showToast("Finish the current stroke before changing modes");
    return;
  }
  // Copy and Memory are handled before any practice-mode logic: they have no trials.
  if (value === "COPY" || value === "MEMORY") {
    enterStudio(value);
    return;
  }
  const mode = value as PracticeMode;
  if (!VALID_MODES.includes(mode)) { showModeChoice(current); return; }
  if (app.studio) leaveStudio(mode);
  else resetSession(mode);
  rememberModeDay();
  void savePracticeMode(mode).catch(() => showToast("Practice mode could not be saved"));
}

export function goToToday(): void {
  if (dayDoneDialog.open) dayDoneDialog.close();
  showModeChoice("TODAY");
  if (app.studio) leaveStudio("TODAY");
  else resetSession("TODAY");
  void savePracticeMode("TODAY").catch(() => showToast("Practice mode could not be saved"));
}

export function wireModes(): void {
  modeSelect.addEventListener("change", () => chooseMode(modeSelect.value));
  todayModeButton.addEventListener("click", () => chooseMode("TODAY"));
  for (const studio of ["COPY", "MEMORY"] as const) studioButtons[studio].addEventListener("click", () => chooseMode(studio));
}
