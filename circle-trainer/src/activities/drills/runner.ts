import { actionAfterResize, backingOutOfDate, shiftStroke, type CanvasBox } from "../../core/canvasSize";
import { rawSampleIdentity } from "../../core/input";
import { EXERCISE_LABELS, MODE_LABELS, PracticeScheduler } from "../../core/scheduler";
import { isTap, type TapPoint } from "../../core/tap";
import type {
  AnalysisResult,
  ExerciseType,
  Handedness,
  PracticeMode,
  PrimitiveMetrics,
  RawSample,
  RawStroke,
  ScheduleContext,
  StrokeEventType,
  TargetDefinition,
  TrialRecord,
} from "../../core/types";
import { DEFAULT_HANDEDNESS } from "../../core/types";
import { saveStroke, saveTrial } from "../../storage";
import type { DrillsDiagnostics, DrillsHost, MountedDrills } from "../types";
import { ALL_EXERCISE_TYPES, drillFor } from "./registry";
import type { Drill } from "./types";

/**
 * The drill runner (moved from main.ts in 0.17.0): the trial state machine, Pencil capture, the feedback card and
 * tap-for-next. It names no drill: everything drill-specific comes from the registry, everything shared from the
 * host.
 */

type TrialState = "PREPARING" | "READY" | "DRAWING" | "PROCESSING" | "FEEDBACK";

/** How long the canvas size must stay still before a target is judged against it. */
const RESIZE_SETTLE_MS = 350;
const TIPS_OPEN_KEY = "circle-trainer:box-tips-open";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function createId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function timestampHistogram(stroke: RawStroke | null): string {
  if (!stroke || stroke.samples.length < 2) return "No stroke captured";
  const buckets = [0, 0, 0, 0, 0];
  for (let index = 1; index < stroke.samples.length; index += 1) {
    const delta = stroke.samples[index].tMs - stroke.samples[index - 1].tMs;
    if (delta < 4) buckets[0] += 1;
    else if (delta < 8) buckets[1] += 1;
    else if (delta < 16) buckets[2] += 1;
    else if (delta < 33) buckets[3] += 1;
    else buckets[4] += 1;
  }
  return `<4:${buckets[0]} · <8:${buckets[1]} · <16:${buckets[2]} · <33:${buckets[3]} · 33+:${buckets[4]}`;
}

export function mountDrillRunner(host: DrillsHost): MountedDrills {
  const canvas = requiredElement<HTMLCanvasElement>("#drawingCanvas");
  const context = (() => {
    const value = canvas.getContext("2d", { alpha: true });
    if (!value) throw new Error("Canvas 2D is unavailable in this browser");
    return value;
  })();
  const emptyState = requiredElement<HTMLElement>("#emptyState");
  const instructionType = requiredElement<HTMLElement>("#instructionType");
  const instructionText = requiredElement<HTMLElement>("#instructionText");
  const instructionNote = requiredElement<HTMLElement>("#emptyState span");
  const DEFAULT_INSTRUCTION_NOTE = instructionNote.textContent ?? "";
  const repCount = requiredElement<HTMLElement>("#repCount");
  const streakCount = requiredElement<HTMLElement>("#streakCount");
  const lastScore = requiredElement<HTMLElement>("#lastScore");
  const bestScore = requiredElement<HTMLElement>("#bestScore");
  const feedbackCard = requiredElement<HTMLElement>("#feedbackCard");
  const feedbackResult = requiredElement<HTMLElement>("#feedbackResult");
  const feedbackScore = requiredElement<HTMLElement>("#feedbackScore");
  const feedbackDetail = requiredElement<HTMLElement>("#feedbackDetail");
  const nextTrialButton = requiredElement<HTMLButtonElement>("#nextTrialButton");
  const undoStrokeButton = requiredElement<HTMLButtonElement>("#undoStrokeButton");
  /** A drill's Tips button and panel (Box has them; the ids and the stored key keep their names). */
  const tipsButton = requiredElement<HTMLButtonElement>("#boxTipsButton");
  const tipsPanel = requiredElement<HTMLElement>("#boxTipsPanel");

  const runtime = {
    pointerEventCount: 0,
    rawSampleCount: 0,
    duplicateSampleCount: 0,
    reorderedSampleCount: 0,
    ignoredTouchCount: 0,
    pressureObserved: false,
    tiltObserved: false,
  };

  /** Shown (not hidden behind Copy). */
  let shown = false;
  let mode: PracticeMode = ALL_EXERCISE_TYPES[0];
  let scheduler = new PracticeScheduler(ALL_EXERCISE_TYPES[0], createId());
  let targetGenerationIndex = 0;
  let activeExercise: ExerciseType = ALL_EXERCISE_TYPES[0];
  let trialState: TrialState = "PREPARING";
  let target: TargetDefinition | null = null;
  let activePointerId: number | null = null;
  /**
   * A Pencil or finger touch on the canvas during feedback, followed until it lifts to see whether it
   * was a tap. `spoiled` is set when another contact lands meanwhile (a palm, a pinch): then it is not a tap.
   */
  let feedbackTap: { pointerId: number; pen: boolean; spoiled: boolean; points: TapPoint[] } | null = null;
  let activeStroke: RawStroke | null = null;
  let activeSampleKeys = new Set<string>();
  let completedStroke: RawStroke | null = null;
  /** Accepted strokes of the current trial, in drawing order (the finished one, for a one-stroke drill). */
  let trialStrokes: RawStroke[] = [];
  /** The canvas size (CSS px) and drawing hand the current target was laid out for. */
  let targetCanvas: CanvasBox | null = null;
  let targetHandedness: Handedness = DEFAULT_HANDEDNESS;
  /** Times the size watcher found the canvas's pixel size out of date (shown in Diagnostics). */
  let lateCanvasResizes = 0;
  let tipsOpen = readTipsOpen();
  let lastAnalysis: AnalysisResult<PrimitiveMetrics> | null = null;
  let sessionReps = 0;
  let sessionStreak = 0;
  let bestByExercise: Partial<Record<ExerciseType, number>> = {};
  let touchNoticeShown = false;
  const introducedExercises = new Set<ExerciseType>();
  let resizeSettleTimer: number | undefined;

  /* ---------- canvas size ---------- */

  function configureContext(): void {
    const dpr = window.devicePixelRatio || 1;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.lineCap = "round";
    context.lineJoin = "round";
  }

  function resizeCanvas(): void {
    const bounds = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(bounds.width * dpr));
    canvas.height = Math.max(1, Math.round(bounds.height * dpr));
    configureContext();
    redrawAll();
  }

  /**
   * The canvas changed size: match its pixel size and redraw at once (so the Pencil stays aligned), then, once the
   * size has settled (on the iPad a rotation arrives in steps, the height last), make a new target only if nothing
   * is drawn yet and the old one no longer suits the canvas (actionAfterResize). Strokes, a half-drawn box and
   * feedback are kept.
   */
  function handleCanvasResize(): void {
    if (!shown) return; // The Copy view lays itself out; showing the drills again resizes the canvas.
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    resizeCanvas();
    window.clearTimeout(resizeSettleTimer);
    resizeSettleTimer = window.setTimeout(judgeTargetAfterResize, RESIZE_SETTLE_MS);
  }

  function judgeTargetAfterResize(): void {
    if (!shown) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    if (backingOutOfDate(bounds, { width: canvas.width, height: canvas.height }, window.devicePixelRatio || 1)) resizeCanvas();
    const size = { width: bounds.width, height: bounds.height };
    const drill = target ? activeDrill() : null;
    const action = actionAfterResize({ state: trialState, target, relayout: Boolean(drill?.relayout), generatedFor: targetCanvas, canvas: size, cssPxPerMm: host.cssPxPerMm() });
    if (action === "WAIT") {
      resizeSettleTimer = window.setTimeout(judgeTargetAfterResize, RESIZE_SETTLE_MS);
      return;
    }
    if (action === "NEW_TARGET") {
      beginNewTrial();
      return;
    }
    if (action !== "RELAYOUT" || !target || !drill?.relayout) return;
    const moved = drill.relayout(target, size, host.cssPxPerMm(), targetHandedness);
    if (!moved) {
      // A target is made to fit the canvas it was made on; a landscape box often does not fit the smaller portrait
      // halves. Before any stroke: a fresh one. With strokes drawn: keep its layout, so turning the iPad back lines
      // everything up again.
      if (trialState === "READY" && trialStrokes.length === 0) beginNewTrial();
      else if (trialState === "READY") host.toast(`This ${drill.singular} doesn't fit this way round — turn the iPad back to finish it`);
      return;
    }
    // The same target in the new layout; strokes drawn so far move with it, so they score the same.
    const lastWasCompleted = completedStroke !== null && completedStroke === trialStrokes.at(-1);
    trialStrokes = trialStrokes.map((stroke) => shiftStroke(stroke, moved.strokeShift));
    if (lastWasCompleted) completedStroke = trialStrokes.at(-1) ?? null;
    target = moved.target;
    targetCanvas = size;
    redrawAll();
  }

  /* ---------- the active drill ---------- */

  function activeDrill(): Drill {
    return drillFor(activeExercise);
  }

  /** The drill needs several strokes (Box's 11 edges): progress, Undo and "keep drawing" apply. */
  function multiStroke(): boolean {
    return activeDrill().strokesRequired > 1;
  }

  /** "Box · 4/11", and what is left today: the status line of a drill needing several strokes. */
  function progressText(): string {
    const drill = activeDrill();
    const name = drill.singular.charAt(0).toUpperCase() + drill.singular.slice(1);
    const progress = `${name} · ${trialStrokes.length}/${drill.strokesRequired}`;
    const left = mode === "TODAY" ? host.today.repsLeft() : null;
    return left !== null ? `${progress} · ${left} left today` : progress;
  }

  /** Every saved attempt moves the schedule on: the queue in Today, the scheduler otherwise. */
  function advanceSchedule(): void {
    if (mode !== "TODAY") {
      scheduler.advance();
      return;
    }
    host.today.repDone();
  }

  function scheduleContext(): ScheduleContext {
    const generationIndex = targetGenerationIndex - 1;
    const today = mode === "TODAY" ? host.today.scheduleContext(generationIndex) : null;
    return today ?? { ...scheduler.context(), generationIndex };
  }

  /* ---------- controls ---------- */

  /** Device-local convenience only, so plain localStorage (guarded) rather than IndexedDB. */
  function readTipsOpen(): boolean {
    try { return window.localStorage.getItem(TIPS_OPEN_KEY) === "1"; } catch { return false; }
  }

  function updateTips(): void {
    const tips = activeDrill().controls.tips;
    tipsButton.hidden = !tips;
    tipsButton.setAttribute("aria-pressed", String(tipsOpen));
    tipsPanel.hidden = !tips || !tipsOpen;
  }

  function setTipsOpen(open: boolean): void {
    tipsOpen = open;
    try { window.localStorage.setItem(TIPS_OPEN_KEY, open ? "1" : "0"); } catch { /* Private mode: just don't remember. */ }
    updateTips();
  }

  function updateUndoButton(): void {
    const drawing = activeDrill().controls.undo && (trialState === "READY" || trialState === "DRAWING");
    undoStrokeButton.hidden = !drawing;
    undoStrokeButton.disabled = !drawing || trialState !== "READY" || trialStrokes.length === 0;
  }

  function undoStroke(): void {
    if (!activeDrill().controls.undo || trialState !== "READY" || trialStrokes.length === 0) return;
    trialStrokes.pop();
    completedStroke = trialStrokes.at(-1) ?? null;
    host.setStatus(progressText());
    updateUndoButton();
    redrawAll();
  }

  function redrawAll(): void {
    const bounds = canvas.getBoundingClientRect();
    context.clearRect(0, 0, bounds.width, bounds.height);
    if (!target) return;
    activeDrill().draw(context, {
      target,
      strokes: trialStrokes,
      activeStroke,
      feedback: trialState === "FEEDBACK",
      cssPxPerMm: host.cssPxPerMm(),
      layoutCanvas: targetCanvas ?? { width: bounds.width, height: bounds.height },
    });
  }

  function statusForCurrentTrial(): string {
    if (multiStroke()) return progressText();
    const today = mode === "TODAY" ? host.today.status() : null;
    if (today !== null) return today;
    const exerciseLabel = EXERCISE_LABELS[activeExercise];
    if (mode === "MIXED_BLOCKED") {
      const progress = scheduler.blockProgress()!;
      return `${MODE_LABELS[mode]} · ${exerciseLabel} ${progress.current}/${progress.total}`;
    }
    if (mode === "MIXED_RANDOM") return `${MODE_LABELS[mode]} · ${exerciseLabel}`;
    return `Draw one committed ${exerciseLabel.toLowerCase().replace(/s$/, "")} through the checkpoints`;
  }

  function updateBestHud(): void {
    const best = bestByExercise[activeExercise];
    bestScore.textContent = best === undefined ? "—" : String(best);
    host.today.updateHud();
  }

  /** Today's queue is finished (or empty): no target; the shell shows its card in the drawing area. */
  function showDone(): void {
    host.today.updateHud();
    target = null;
    trialState = "PREPARING";
    feedbackCard.hidden = true;
    emptyState.classList.add("hidden");
    undoStrokeButton.hidden = true;
    tipsButton.hidden = true;
    tipsPanel.hidden = true;
    host.today.showDone();
    redrawAll();
  }

  /* ---------- trials ---------- */

  function beginNewTrial(): void {
    trialState = "PREPARING";
    activePointerId = null;
    feedbackTap = null;
    activeStroke = null;
    activeSampleKeys = new Set<string>();
    completedStroke = null;
    trialStrokes = [];
    lastAnalysis = null;
    feedbackCard.hidden = true;
    feedbackCard.classList.remove("failed");
    if (mode === "TODAY") {
      const next = host.today.next();
      if (!next) {
        showDone();
        return;
      }
      activeExercise = next;
    } else {
      activeExercise = scheduler.currentExercise();
    }
    host.today.hideDone();
    const bounds = canvas.getBoundingClientRect();
    targetCanvas = { width: bounds.width, height: bounds.height };
    targetHandedness = host.handedness();
    const drill = activeDrill();
    target = drill.generate({ width: bounds.width, height: bounds.height }, host.cssPxPerMm(), scheduler.sessionSeed, targetGenerationIndex, host.handedness());
    targetGenerationIndex += 1;
    instructionType.textContent = drill.intro.kicker;
    instructionText.textContent = drill.intro.prompt;
    instructionNote.textContent = drill.intro.note ?? DEFAULT_INSTRUCTION_NOTE;
    emptyState.classList.toggle("compact", drill.intro.compact);
    nextTrialButton.textContent = `Next ${drill.singular}`;
    trialState = "READY";
    host.setStatus(statusForCurrentTrial());
    updateUndoButton();
    updateTips();
    emptyState.classList.toggle("hidden", introducedExercises.has(activeExercise));
    updateBestHud();
    redrawAll();
  }

  function resetSession(next: PracticeMode): void {
    mode = next;
    scheduler = new PracticeScheduler(next, createId());
    targetGenerationIndex = 0;
    sessionReps = 0;
    sessionStreak = 0;
    repCount.textContent = "0";
    streakCount.textContent = "0";
    lastScore.textContent = "—";
    beginNewTrial();
  }

  /* ---------- Pencil input ---------- */

  function sourceEvents(event: PointerEvent): PointerEvent[] {
    if (typeof event.getCoalescedEvents !== "function") return [event];
    const coalesced = event.getCoalescedEvents();
    return coalesced.length > 0 ? coalesced : [event];
  }

  function eventToSample(event: PointerEvent, sourceEventType: StrokeEventType): RawSample {
    const bounds = canvas.getBoundingClientRect();
    return {
      xCss: event.clientX - bounds.left,
      yCss: event.clientY - bounds.top,
      tMs: event.timeStamp,
      pressure: Number.isFinite(event.pressure) ? event.pressure : undefined,
      tiltX: Number.isFinite(event.tiltX) ? event.tiltX : undefined,
      tiltY: Number.isFinite(event.tiltY) ? event.tiltY : undefined,
      twist: Number.isFinite(event.twist) ? event.twist : undefined,
      tangentialPressure: Number.isFinite(event.tangentialPressure) ? event.tangentialPressure : undefined,
      width: Number.isFinite(event.width) ? event.width : undefined,
      height: Number.isFinite(event.height) ? event.height : undefined,
      sourceEventType,
    };
  }

  function appendPointerSamples(event: PointerEvent, sourceEventType: StrokeEventType): void {
    if (!activeStroke) return;
    runtime.pointerEventCount += 1;
    let requiresSort = false;
    for (const sourceEvent of sourceEvents(event)) {
      const sample = eventToSample(sourceEvent, sourceEventType);
      const identity = rawSampleIdentity(sample);
      if (activeSampleKeys.has(identity)) {
        runtime.duplicateSampleCount += 1;
        continue;
      }
      activeSampleKeys.add(identity);
      const previous = activeStroke.samples.at(-1);
      if (previous && sample.tMs < previous.tMs) requiresSort = true;
      activeStroke.samples.push(sample);
      runtime.rawSampleCount += 1;
      runtime.pressureObserved ||= (sample.pressure ?? 0) > 0;
      runtime.tiltObserved ||= (sample.tiltX ?? 0) !== 0 || (sample.tiltY ?? 0) !== 0;
    }
    if (requiresSort) {
      activeStroke.samples.sort((a, b) => a.tMs - b.tMs);
      runtime.reorderedSampleCount += 1;
    }
    redrawAll();
  }

  function handlePointerDown(event: PointerEvent): void {
    // During feedback nothing is drawn, so a finger may tap on too; palm rejection while drawing is unchanged.
    if (trialState === "FEEDBACK") {
      startFeedbackTap(event);
      return;
    }
    if (event.pointerType !== "pen" && event.pointerType !== "mouse") {
      runtime.ignoredTouchCount += 1;
      if (!touchNoticeShown) {
        host.toast("Finger drawing is off — use Apple Pencil");
        touchNoticeShown = true;
      }
      return;
    }
    if (trialState !== "READY" || activePointerId !== null) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    activeSampleKeys = new Set<string>();
    activeStroke = { id: createId(), pointerType: event.pointerType, startedAtEpochMs: Date.now(), cancelled: false, samples: [] };
    trialState = "DRAWING";
    try { canvas.setPointerCapture(event.pointerId); } catch { /* Pointer already ended. */ }
    introducedExercises.add(activeExercise);
    host.recordActivity({ save: false, show: false });
    emptyState.classList.add("hidden");
    host.setStatus(multiStroke() ? progressText() : `${EXERCISE_LABELS[activeExercise]} · commit to the movement`);
    updateUndoButton();
    appendPointerSamples(event, "pointerdown");
  }

  function tapPoint(event: PointerEvent): TapPoint {
    const bounds = canvas.getBoundingClientRect();
    return { xCss: event.clientX - bounds.left, yCss: event.clientY - bounds.top, tMs: event.timeStamp };
  }

  /** During feedback the canvas draws nothing: a touch is followed only to see whether it is a tap. */
  function startFeedbackTap(event: PointerEvent): void {
    event.preventDefault();
    if (feedbackTap !== null) {
      feedbackTap.spoiled = true;
      return;
    }
    feedbackTap = { pointerId: event.pointerId, pen: event.pointerType !== "touch", spoiled: false, points: [tapPoint(event)] };
    try { canvas.setPointerCapture(event.pointerId); } catch { /* Pointer already ended. */ }
  }

  /** Ends a feedback touch. A tap starts the next rep; a longer touch is ignored. Returns false if the pointer is not one. */
  function endFeedbackTap(event: PointerEvent, cancelled: boolean): boolean {
    if (!feedbackTap || event.pointerId !== feedbackTap.pointerId) return false;
    event.preventDefault();
    const { pen, spoiled } = feedbackTap;
    const points = [...feedbackTap.points, tapPoint(event)];
    feedbackTap = null;
    if (cancelled || spoiled || trialState !== "FEEDBACK") return true;
    host.recordActivity({ save: false, show: false });
    if (isTap(points, host.cssPxPerMm())) beginNewTrial();
    else if (pen) host.toast("Not counted — tap to go on"); // A long finger touch is likely a resting hand: say nothing.
    return true;
  }

  function handlePointerMove(event: PointerEvent): void {
    if (feedbackTap && event.pointerId === feedbackTap.pointerId) {
      event.preventDefault();
      for (const sourceEvent of sourceEvents(event)) feedbackTap.points.push(tapPoint(sourceEvent));
      return;
    }
    if (event.pointerId !== activePointerId || trialState !== "DRAWING") return;
    event.preventDefault();
    appendPointerSamples(event, "pointermove");
  }

  /* ---------- feedback ---------- */

  function updatePracticeHud(analysis: AnalysisResult): void {
    sessionReps += 1;
    repCount.textContent = sessionReps.toLocaleString();
    if (analysis.executionPassed) {
      sessionStreak += 1;
      const value = analysis.accuracyScore ?? 0;
      lastScore.textContent = String(value);
      bestByExercise[activeExercise] = Math.max(bestByExercise[activeExercise] ?? 0, value);
    } else {
      sessionStreak = 0;
      lastScore.textContent = "—";
    }
    streakCount.textContent = String(sessionStreak);
    updateBestHud();
  }

  function showFeedback(analysis: AnalysisResult): void {
    const drill = activeDrill();
    feedbackCard.hidden = false;
    nextTrialButton.textContent = "Next";
    if (analysis.executionPassed) {
      feedbackResult.textContent = `Committed ${drill.singular} ✓`;
      feedbackScore.textContent = `Accuracy ${analysis.accuracyScore ?? 0}`;
      feedbackDetail.textContent = drill.feedbackText(analysis.metrics);
      host.setStatus(`Feedback shown — ${drill.revealName} in blue`);
    } else {
      feedbackCard.classList.add("failed");
      feedbackResult.textContent = "Execution not scored";
      feedbackScore.textContent = analysis.executionReason ?? "Try another one";
      feedbackDetail.textContent = host.correctionGateEnabled()
        ? "Accuracy is hidden when the movement is incomplete or too corrective."
        : "Accuracy is hidden when the movement is incomplete or implausible.";
      host.setStatus("No accuracy score — commit to the next one");
    }
  }

  async function finishStroke(event: PointerEvent, cancelled: boolean): Promise<void> {
    if (event.pointerId !== activePointerId || !activeStroke || !target) return;
    event.preventDefault();
    if (!cancelled) appendPointerSamples(event, "pointerup");
    trialState = "PROCESSING";
    const stroke = activeStroke;
    stroke.cancelled = cancelled;
    stroke.completedAtEpochMs = Date.now();
    completedStroke = stroke;
    host.recordActivity({ save: true, show: true });
    activeStroke = null;
    activePointerId = null;

    const drill = activeDrill();
    if (drill.strokesRequired > 1) {
      await finishOneOfSeveral(drill, stroke, target);
      return;
    }

    if (cancelled) {
      try { await saveStroke(stroke); host.recordSaved({ trials: 0, strokes: 1 }); } catch { host.toast("Interrupted stroke could not be saved"); }
      beginNewTrial();
      return;
    }
    trialStrokes = [stroke];
    await submitTrial(drill, target);
  }

  function showEvaluationFailure(): void {
    trialState = "FEEDBACK";
    feedbackCard.hidden = false;
    feedbackCard.classList.add("failed");
    feedbackResult.textContent = "Couldn’t evaluate this stroke";
    feedbackScore.textContent = "Try another one";
    feedbackDetail.textContent = "The raw stroke was kept for diagnostics.";
    host.setStatus("Evaluation failed — raw stroke preserved");
    updateUndoButton();
    redrawAll();
  }

  function returnToDrawing(message?: string): void {
    trialState = "READY";
    if (message) host.toast(message);
    host.setStatus(progressText());
    updateUndoButton();
    redrawAll();
  }

  /** One stroke of a drill needing several has ended: drop it, keep it, or (on the last) score the whole trial. */
  async function finishOneOfSeveral(drill: Drill, stroke: RawStroke, trialTarget: TargetDefinition): Promise<void> {
    if (stroke.cancelled) {
      void saveStroke(stroke).then(() => { host.recordSaved({ trials: 0, strokes: 1 }); }, () => undefined);
      returnToDrawing("Stroke interrupted — not counted");
      return;
    }
    const rejection = drill.acceptStroke?.(stroke, host.cssPxPerMm()) ?? null;
    if (rejection) {
      returnToDrawing(rejection);
      return;
    }
    trialStrokes.push(stroke);
    if (trialStrokes.length < drill.strokesRequired) {
      returnToDrawing();
      return;
    }
    trialState = "PROCESSING";
    updateUndoButton();
    host.setStatus(progressText());
    await submitTrial(drill, trialTarget);
  }

  /**
   * Scores the trial's strokes and saves the record. A one-stroke drill's record holds `rawStroke`, a several-stroke
   * drill's `rawStrokes` (each stroke is stored once, inside its trial, since 0.15.3).
   */
  async function submitTrial(drill: Drill, trialTarget: TargetDefinition): Promise<void> {
    const strokes = [...trialStrokes];
    try {
      const correctionGateEnabled = host.correctionGateEnabled();
      const analysis = drill.analyse(trialTarget, strokes, { cssPxPerMm: host.cssPxPerMm(), correctionGateEnabled });
      lastAnalysis = analysis;
      const trial = {
        id: createId(),
        appVersion: host.appVersion,
        metricVersion: drill.versions.metric,
        scoringVersion: drill.versions.scoring,
        createdAtEpochMs: Date.now(),
        exerciseType: drill.id,
        practiceMode: mode,
        correctionGateEnabled: drill.usesCorrectionGate ? correctionGateEnabled : false,
        schedule: scheduleContext(),
        target: trialTarget,
        ...(drill.strokesRequired > 1 ? { rawStrokes: strokes } : { rawStroke: strokes[0] }),
        calibrationId: host.calibrationId(),
        derived: analysis,
      } as TrialRecord;
      await saveTrial(trial);
      host.recordSaved({ trials: 1, strokes: strokes.length });
      updatePracticeHud(analysis);
      advanceSchedule();
      trialState = "FEEDBACK";
      showFeedback(analysis);
      redrawAll();
    } catch {
      showEvaluationFailure();
    }
  }

  /* ---------- wiring ---------- */

  requiredElement<HTMLButtonElement>("#newTrialButton").addEventListener("click", beginNewTrial);
  nextTrialButton.addEventListener("click", beginNewTrial);
  undoStrokeButton.addEventListener("click", undoStroke);
  tipsButton.addEventListener("click", () => setTipsOpen(!tipsOpen));
  requiredElement<HTMLButtonElement>("#closeBoxTipsButton").addEventListener("click", () => setTipsOpen(false));
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", (event) => { if (!endFeedbackTap(event, false)) void finishStroke(event, false); });
  canvas.addEventListener("pointercancel", (event) => { if (!endFeedbackTap(event, true)) void finishStroke(event, true); });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("resize", handleCanvasResize);
  // The Home Screen app corrects its height late (--app-height), without a window resize, so also watch the
  // canvas itself and resize whenever its pixel size no longer matches its box.
  new ResizeObserver(() => {
    const bounds = canvas.getBoundingClientRect();
    if (!shown || !backingOutOfDate(bounds, { width: canvas.width, height: canvas.height }, window.devicePixelRatio || 1)) return;
    lateCanvasResizes += 1;
    handleCanvasResize();
  }).observe(canvas);
  resizeCanvas();

  /* ---------- the mounted activity ---------- */

  return {
    show({ mode: next }) {
      const wasShown = shown;
      shown = true;
      if (!wasShown) resizeCanvas();
      resetSession(next);
    },
    hide() {
      shown = false;
      feedbackCard.hidden = true;
    },
    isBusy: () => trialState === "DRAWING" || trialState === "PROCESSING" || (trialState === "READY" && trialStrokes.length > 0),
    isDrawing: () => trialState === "DRAWING",
    onHandedness() {
      // A target laid out for the drawing hand (a box) is laid out again if not started; one in progress keeps its
      // layout until the next one.
      const drill = activeDrill();
      if (drill.relayout && trialState === "READY" && trialStrokes.length === 0) beginNewTrial();
      else if (drill.relayout) host.toast(`Applies from the next ${drill.singular}`);
    },
    newTrial: beginNewTrial,
    loadHistory(trials) {
      for (const trial of trials) {
        introducedExercises.add(trial.exerciseType);
        const value = trial.derived.accuracyScore;
        if (value !== undefined) bestByExercise[trial.exerciseType] = Math.max(bestByExercise[trial.exerciseType] ?? 0, value);
      }
    },
    clearHistory() {
      bestByExercise = {};
      introducedExercises.clear();
    },
    diagnostics(): DrillsDiagnostics {
      const stroke = completedStroke;
      const duration = stroke && stroke.samples.length > 1 ? stroke.samples.at(-1)!.tMs - stroke.samples[0].tMs : 0;
      const rate = duration > 0 && stroke ? Math.round(((stroke.samples.length - 1) * 1000) / duration) : 0;
      const bounds = canvas.getBoundingClientRect();
      const stale = backingOutOfDate(bounds, { width: canvas.width, height: canvas.height }, window.devicePixelRatio || 1);
      return {
        currentExercise: activeExercise,
        pressureObserved: runtime.pressureObserved,
        tiltObserved: runtime.tiltObserved,
        lastUniqueSamples: stroke?.samples.length ?? 0,
        lastUniqueSampleRate: rate ? `${rate} Hz` : "No stroke captured",
        timestampHistogram: timestampHistogram(stroke),
        overlappingSamplesRemoved: runtime.duplicateSampleCount,
        outOfOrderBatchesRepaired: runtime.reorderedSampleCount,
        fingerTouchesIgnored: runtime.ignoredTouchCount,
        canvasCss: `${Math.round(bounds.width * 10) / 10} × ${Math.round(bounds.height * 10) / 10}${stale ? " (pixels out of date)" : ""}`,
        canvasPixels: `${canvas.width} × ${canvas.height}`,
        canvasWatcherFixes: lateCanvasResizes,
        lastNormalizedError: lastAnalysis ? lastAnalysis.metrics.normalizedError.toFixed(5) : "No scored trial",
      };
    },
  };
}
