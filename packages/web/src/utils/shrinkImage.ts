/** Longest side of a photo shrunk for a weak connection. */
export const SHRINK_MAX_SIDE = 1600;
const SHRINK_QUALITY = 0.8;
/** Below this a photo is already small enough to send as it is. */
const SHRINK_MIN_BYTES = 300 * 1024;

/** Still photos only: GIFs would lose their animation, SVGs are not pixels. */
export function canShrink(file: File): boolean {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size > SHRINK_MIN_BYTES;
}

/** The size that fits `width`×`height` inside a `max`-pixel square, keeping the aspect ratio; never upscales. */
export function fitWithin(width: number, height: number, max = SHRINK_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Re-encode a photo as JPEG at most {@link SHRINK_MAX_SIDE} px on its longest side.
 * Returns the original when it cannot be decoded or the result would not be smaller.
 */
export async function shrinkImage(file: File): Promise<File> {
  if (!canShrink(file)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    // JPEG has no alpha: paint transparent PNG areas white rather than black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', SHRINK_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}
