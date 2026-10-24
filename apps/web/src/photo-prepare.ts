export interface PrepareLimits {
  maxBytes: number;
  maxEdge: number;
}
export const ASSET_LIMITS: PrepareLimits = { maxBytes: 40 * 1024, maxEdge: 640 };
export const TICKET_LIMITS: PrepareLimits = { maxBytes: 350 * 1024, maxEdge: 1600 };
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const QUALITIES = [0.86, 0.74, 0.62, 0.5, 0.38, 0.26];
const decodedBytes = (dataUrl: string) => {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
};
export async function preparePhoto(file: File, limits: PrepareLimits): Promise<string> {
  if (!['image/jpeg', 'image/png'].includes(file.type))
    throw new Error(
      'Choose a JPEG or PNG photo. On iPhone, set Camera > Formats to Most Compatible or take the photo here.',
    );
  if (!file.size || file.size > MAX_SOURCE_BYTES)
    throw new Error('Choose an image no larger than 10 MiB.');
  const image = await createImageBitmap(file).catch(() => {
    throw new Error('This image could not be opened. Choose another JPEG or PNG.');
  });
  try {
    if (!image.width || !image.height) throw new Error('This image has no usable dimensions.');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image preparation is unavailable in this browser.');
    const initialScale = Math.min(1, limits.maxEdge / Math.max(image.width, image.height));
    for (let step = 0; step < 6; step++) {
      const scale = initialScale * 0.8 ** step;
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of QUALITIES) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (!dataUrl.startsWith('data:image/jpeg;base64,'))
          throw new Error('Image preparation is unavailable in this browser.');
        if (decodedBytes(dataUrl) <= limits.maxBytes) return dataUrl;
      }
    }
    throw new Error('This image could not fit the photo limit. Choose a simpler image.');
  } finally {
    image.close();
  }
}
