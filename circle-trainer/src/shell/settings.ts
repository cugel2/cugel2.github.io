import type { Handedness } from "../core/types";
import { saveCalibration, saveCorrectionGateEnabled, saveHandedness } from "../storage";
import { activities, app, createId, requiredElement, showToast } from "./state";
import { doneSettingsButton, renderCopyBudget, renderDailyTicks } from "./today";

/** The Settings sheet: drawing hand, correction rejection, ruler calibration (moved from main.ts in 0.17.0). */

const DEFAULT_RULER_WIDTH_CSS_PX = 378;
export const calibrationDialog = requiredElement<HTMLDialogElement>("#calibrationDialog");
const scaleStatus = requiredElement<HTMLElement>("#scaleStatus");
const correctionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("#correctionGateSetting button[data-corrections]"));
const handButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".hand-setting button[data-hand]"));
const drawingStage = requiredElement<HTMLElement>(".drawing-stage");
const rulerLine = requiredElement<HTMLElement>("#rulerLine");
const rulerSlider = requiredElement<HTMLInputElement>("#rulerSlider");
const rulerOutput = requiredElement<HTMLOutputElement>("#rulerOutput");

export function configureRuler(): void {
  const maximum = Math.max(240, Math.min(760, window.innerWidth - 100));
  rulerSlider.max = String(maximum);
  const desired = app.calibration ? app.calibration.cssPxPerMm * 100 : Number(rulerSlider.value) || DEFAULT_RULER_WIDTH_CSS_PX;
  rulerSlider.value = String(Math.min(maximum, Math.max(Number(rulerSlider.min), Math.round(desired))));
  updateRulerDisplay();
}

function updateRulerDisplay(): void {
  const width = Number(rulerSlider.value);
  rulerLine.style.width = `${width}px`;
  rulerOutput.value = `${Math.round(width)} px`;
}

async function persistCalibration(): Promise<void> {
  app.calibration = {
    id: createId(), cssPxPerMm: Number(rulerSlider.value) / 100, calibratedAt: Date.now(),
    viewportWidthCssPx: window.innerWidth, viewportHeightCssPx: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1,
  };
  try {
    await saveCalibration(app.calibration);
    updateScaleStatus();
    calibrationDialog.close();
    activities.drills.newTrial();
    showToast("100 mm calibration saved");
  } catch { showToast("Calibration could not be saved"); }
}

export function updateScaleStatus(): void {
  scaleStatus.textContent = app.calibration
    ? `Calibrated · ${app.calibration.cssPxPerMm.toFixed(2)} px/mm`
    : "Scale provisional · calibrate with a ruler";
}

/** Overlays (feedback card, tips) sit on the side away from the drawing hand; Box layout reads the same setting. */
export function applyHandedness(): void {
  drawingStage.dataset.hand = app.handedness.toLowerCase();
  for (const button of handButtons) button.setAttribute("aria-pressed", String(button.dataset.hand === app.handedness));
}

function setHandedness(next: Handedness): void {
  if (next === app.handedness) return;
  app.handedness = next;
  applyHandedness();
  activities.copy.onHandedness();
  activities.memory.onHandedness();
  void saveHandedness(next).catch(() => showToast("Hand setting could not be saved"));
  activities.drills.onHandedness();
}

export function updateCorrectionGateButton(): void {
  for (const button of correctionButtons) button.setAttribute("aria-pressed", String((button.dataset.corrections === "on") === app.correctionGateEnabled));
}

export function openSettings(): void {
  configureRuler();
  renderDailyTicks();
  renderCopyBudget();
  calibrationDialog.showModal();
}

export function wireSettings(): void {
  for (const button of correctionButtons) button.addEventListener("click", () => {
    const enabled = button.dataset.corrections === "on";
    if (enabled === app.correctionGateEnabled) return;
    app.correctionGateEnabled = enabled;
    updateCorrectionGateButton();
    showToast(`Correction rejection ${app.correctionGateEnabled ? "on" : "off"}`);
    void saveCorrectionGateEnabled(app.correctionGateEnabled).catch(() => showToast("Correction setting could not be saved"));
  });
  requiredElement<HTMLButtonElement>("#settingsButton").addEventListener("click", openSettings);
  doneSettingsButton.addEventListener("click", openSettings);
  requiredElement<HTMLButtonElement>("#saveCalibrationButton").addEventListener("click", () => void persistCalibration());
  requiredElement<HTMLButtonElement>("#resetCalibrationButton").addEventListener("click", () => {
    rulerSlider.value = String(Math.min(Number(rulerSlider.max), DEFAULT_RULER_WIDTH_CSS_PX));
    updateRulerDisplay();
  });
  rulerSlider.addEventListener("input", updateRulerDisplay);
  for (const button of handButtons) button.addEventListener("click", () => setHandedness(button.dataset.hand === "RIGHT" ? "RIGHT" : "LEFT"));
  // The ruler's longest setting follows the window width (it was refreshed with every canvas resize before 0.17.0).
  window.addEventListener("resize", configureRuler);
}
