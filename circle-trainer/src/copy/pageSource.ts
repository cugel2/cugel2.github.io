/**
 * A reference document for Copy mode: one or more pages that can be drawn
 * into any rectangle. An image is a one-page document; PDFs (stage 2) will
 * implement the same interface, rendering pages asynchronously.
 */
import type { PageSize } from "./docSpace";

export type DrawContext = CanvasRenderingContext2D;

export interface PageSource {
  readonly pageCount: number;
  pageSize(index: number): PageSize;
  /** Draws page `index` scaled to fill (x, y, width, height) in the context's current units. */
  draw(context: DrawContext, index: number, x: number, y: number, width: number, height: number): void;
  dispose(): void;
}

/**
 * Larger photos are scaled down to this on the long side when loaded: plenty
 * for copying, and it keeps memory and canvas sizes safe on the iPad.
 */
const MAX_IMAGE_SIDE = 4096;

export async function imageSource(blob: Blob): Promise<PageSource> {
  let bitmap: ImageBitmap | HTMLCanvasElement = await createImageBitmap(blob);
  const long = Math.max(bitmap.width, bitmap.height);
  if (long > MAX_IMAGE_SIDE) {
    const factor = MAX_IMAGE_SIDE / long;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * factor);
    canvas.height = Math.round(bitmap.height * factor);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D unavailable");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    bitmap = canvas;
  }
  const image = bitmap;
  const size = { width: image.width, height: image.height };
  return {
    pageCount: 1,
    pageSize: () => size,
    draw(context, _index, x, y, width, height) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, x, y, width, height);
    },
    dispose() {
      if ("close" in image) image.close();
      else { image.width = 0; image.height = 0; }
    },
  };
}
