// Photo utilities: thumbnail generation

const THUMB_SIZE = 200;

export function generateId(): string {
  return crypto.randomUUID();
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

function resizeToCanvas(
  img: HTMLImageElement,
  maxW: number,
  maxH: number
): HTMLCanvasElement {
  let { naturalWidth: w, naturalHeight: h } = img;
  if (w > maxW || h > maxH) {
    const ratio = Math.min(maxW / w, maxH / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create blob'));
      },
      'image/jpeg',
      quality
    );
  });
}

export interface ProcessedPhoto {
  blob: Blob;
  thumbnailBlob: Blob;
  width: number;
  height: number;
  mimeType: string;
}

export async function processPhoto(file: File): Promise<ProcessedPhoto> {
  const img = await loadImage(file);
  
  // Keep the original file blob — no re-encoding, no quality loss
  const blob: Blob = file;
  
  // Thumbnail
  const thumbCanvas = resizeToCanvas(img, THUMB_SIZE, THUMB_SIZE);
  const thumbnailBlob = await canvasToBlob(thumbCanvas, 0.6);

  const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const mimeType = SUPPORTED_TYPES.includes(file.type) ? file.type : 'image/jpeg';
  
  return {
    blob,
    thumbnailBlob,
    width: img.naturalWidth,
    height: img.naturalHeight,
    mimeType,
  };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
