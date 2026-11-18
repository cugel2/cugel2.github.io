import { createCopyView } from "../../copy/copyView";
import type { CopyHost, MountedCopy, OffersToday } from "../types";

/** Copy's unit in Today and in the mode switch. */
export const COPY_UNIT = "COPY";

/** Copy time per day, when it is not Off. */
export const todayParts: OffersToday = (settings) => {
  const minutes = settings.minutes[COPY_UNIT] ?? 0;
  return minutes > 0 ? [{ kind: "TIMED", unitId: COPY_UNIT, label: "Copy", minutes }] : [];
};

/**
 * The Copy activity (0.17.0): a thin adapter around Copy's own view in src/copy/, which is unchanged. It finds
 * Copy's markup and lends the view the host's services.
 */
function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

export function mountCopy(host: CopyHost): MountedCopy {
  const view = createCopyView({
    stage: requiredElement<HTMLElement>("#copyStage"),
    referencePane: requiredElement<HTMLElement>("#copyReferencePane"),
    drawingPane: requiredElement<HTMLElement>("#copyDrawingPane"),
    referenceCanvas: requiredElement<HTMLCanvasElement>("#copyReferenceCanvas"),
    drawingCanvas: requiredElement<HTMLCanvasElement>("#copyDrawingCanvas"),
    fileInput: requiredElement<HTMLInputElement>("#copyFileInput"),
    emptyState: requiredElement<HTMLElement>("#copyEmpty"),
    referenceBar: requiredElement<HTMLElement>("#copyReferenceBar"),
    drawingBar: requiredElement<HTMLElement>("#copyDrawingBar"),
    drawTools: requiredElement<HTMLElement>("#copyDrawTools"),
    bookName: requiredElement<HTMLElement>("#copyBookName"),
    backToFrameButton: requiredElement<HTMLButtonElement>("#copyBackToFrameButton"),
    compareBar: requiredElement<HTMLElement>("#copyCompareBar"),
    compareButtons: Array.from(document.querySelectorAll<HTMLButtonElement>("#copyCompareBar button[data-compare]")),
    opacityInput: requiredElement<HTMLInputElement>("#copyOpacityInput"),
    tintButton: requiredElement<HTMLButtonElement>("#copyTintButton"),
    undoButton: requiredElement<HTMLButtonElement>("#copyUndoButton"),
    clearButton: requiredElement<HTMLButtonElement>("#copyClearButton"),
    newButton: requiredElement<HTMLButtonElement>("#copyNewButton"),
    compareButton: requiredElement<HTMLButtonElement>("#copyCompareButton"),
    saveButton: requiredElement<HTMLButtonElement>("#copySaveButton"),
    saveDialog: requiredElement<HTMLDialogElement>("#copySaveDialog"),
    saveDrawingButton: requiredElement<HTMLButtonElement>("#copySaveDrawingButton"),
    saveSideBySideButton: requiredElement<HTMLButtonElement>("#copySaveSideBySideButton"),
    saveOverlayButton: requiredElement<HTMLButtonElement>("#copySaveOverlayButton"),
    saveNote: requiredElement<HTMLElement>("#copySaveNote"),
    savePreview: requiredElement<HTMLElement>("#copySavePreview"),
    savePreviewImage: requiredElement<HTMLImageElement>("#copySavePreviewImage"),
    saveDownloadLink: requiredElement<HTMLAnchorElement>("#copySaveDownloadLink"),
    pageButton: requiredElement<HTMLButtonElement>("#copyPageButton"),
    libraryButton: requiredElement<HTMLButtonElement>("#copyLibraryButton"),
    libraryDialog: requiredElement<HTMLDialogElement>("#copyLibraryDialog"),
    libraryList: requiredElement<HTMLElement>("#copyLibraryList"),
    libraryNote: requiredElement<HTMLElement>("#copyLibraryNote"),
    memorySelect: requiredElement<HTMLSelectElement>("#copyMemorySelect"),
    memoryBar: requiredElement<HTMLElement>("#copyMemoryBar"),
    memoryText: requiredElement<HTMLElement>("#copyMemoryText"),
    memoryStartButton: requiredElement<HTMLButtonElement>("#copyMemoryStartButton"),
    memoryPeekButton: requiredElement<HTMLButtonElement>("#copyMemoryPeekButton"),
  }, {
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
    show: () => view.show(),
    hide: () => view.hide(),
    isBusy: () => view.isDrawing(),
    isDrawing: () => view.isDrawing(),
    onHandedness: () => view.setHandedness(),
    setTime: (text) => view.setTime(text),
  };
}
