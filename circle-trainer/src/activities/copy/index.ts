import { mountStudio } from "../../copy/engine";
import type { CopyHost, MountedCopy, OffersToday } from "../types";

/** Copy's unit in Today and in the mode switch. */
export const COPY_UNIT = "COPY";

/** Copy time per day, when it is not Off. */
export const todayParts: OffersToday = (settings) => {
  const minutes = settings.minutes[COPY_UNIT] ?? 0;
  return minutes > 0 ? [{ kind: "TIMED", unitId: COPY_UNIT, label: "Copy", minutes }] : [];
};

/**
 * The Copy activity: a thin adapter around the screen it shares with Memory (src/copy/). Copy is plain copying since
 * 0.19.0; its old Memory setting became Memory's study time.
 */
export function mountCopy(host: CopyHost): MountedCopy {
  const view = mountStudio("COPY", {
    pxPerMm: () => host.cssPxPerMm(),
    handedness: () => host.handedness(),
    onActivity: (ended) => host.recordActivity({ save: ended, show: true }),
    // Moving or zooming the reference is part of copying. Recording activity is only arithmetic, so it can run per move.
    onGesture: () => host.recordActivity({ save: false, show: false }),
    onCheckpoint: () => host.checkpoint(),
    showToast: (message) => host.toast(message),
    setStatus: (text) => host.setStatus(text),
  });
  return {
    show: () => view.show("COPY"),
    hide: () => view.hide(),
    isBusy: () => view.isDrawing(),
    isDrawing: () => view.isDrawing(),
    onHandedness: () => view.setHandedness(),
    setTime: (text) => view.setTime(text),
  };
}
