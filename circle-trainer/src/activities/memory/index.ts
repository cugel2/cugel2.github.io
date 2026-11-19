import { mountStudio } from "../../copy/engine";
import type { ActivityHost, MountedMemory } from "../types";

/** Memory's unit in the mode switch (and, later, in Today). */
export const MEMORY_UNIT = "MEMORY";

/**
 * The Memory activity (0.19.0): draw from memory after Lecoq de Boisbaudran. Study the framed reference for a set
 * time (framing locked, drawing refused), draw with it covered (no time limit, Peek counted), compare; Again studies
 * the same framing afresh and draws a new attempt. It shares Copy's screen, books, Compare and Save (src/copy/), with
 * its own drawing in progress and its own place in each book.
 *
 * Not part of Today yet: it offers no Today parts until the daily total (TODO "One daily total") is built.
 */
export function mountMemory(host: ActivityHost): MountedMemory {
  const view = mountStudio("MEMORY", {
    pxPerMm: () => host.cssPxPerMm(),
    handedness: () => host.handedness(),
    onActivity: (ended) => host.recordActivity({ save: ended, show: true }),
    onGesture: () => host.recordActivity({ save: false, show: false }),
    showToast: (message) => host.toast(message),
    setStatus: (text) => host.setStatus(text),
  });
  return {
    show: () => view.show("MEMORY"),
    hide: () => view.hide(),
    isBusy: () => view.isDrawing(),
    isDrawing: () => view.isDrawing(),
    onHandedness: () => view.setHandedness(),
    setTime: (text) => view.setTime(text),
  };
}
