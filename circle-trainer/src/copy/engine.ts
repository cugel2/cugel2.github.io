import { createCopyView, type CopyServices, type CopyView, type StudioKind } from "./copyView";

/**
 * The one screen Copy and Memory share (0.19.0): both activities mount it, and it is built once, on first mount,
 * from Copy's markup. The services are the shell's shared ones and the same for both; only the checkpoint (where the
 * shell may say Copy time is up) belongs to one mode, so each mode registers its own.
 */

export interface StudioServices extends Omit<CopyServices, "onCheckpoint"> {
  /** Compare turned on, New, or the Save sheet closed, in this mode. */
  onCheckpoint?(): void;
}

let view: CopyView | null = null;
const checkpoints: Partial<Record<StudioKind, () => void>> = {};

export function mountStudio(kind: StudioKind, services: StudioServices): CopyView {
  checkpoints[kind] = services.onCheckpoint;
  view ??= createCopyView(studioElements(), { ...services, onCheckpoint: (shown) => checkpoints[shown]?.() });
  return view;
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function studioElements(): Parameters<typeof createCopyView>[0] {
  return {
    stage: requiredElement<HTMLElement>("#copyStage"),
    referencePane: requiredElement<HTMLElement>("#copyReferencePane"),
    drawingPane: requiredElement<HTMLElement>("#copyDrawingPane"),
    referenceCanvas: requiredElement<HTMLCanvasElement>("#copyReferenceCanvas"),
    drawingCanvas: requiredElement<HTMLCanvasElement>("#copyDrawingCanvas"),
    fileInput: requiredElement<HTMLInputElement>("#copyFileInput"),
    emptyState: requiredElement<HTMLElement>("#copyEmpty"),
    emptyTitle: requiredElement<HTMLElement>("#copyEmptyTitle"),
    emptyText: requiredElement<HTMLElement>("#copyEmptyText"),
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
    memoryAgainButton: requiredElement<HTMLButtonElement>("#copyMemoryAgainButton"),
    memoryEarlierButton: requiredElement<HTMLButtonElement>("#copyMemoryEarlierButton"),
  };
}
