/** Read an image file, downscale it to at most `max` px and return a data URL + display size. */
export async function loadImageFile(
  file: File,
  max = 1600,
): Promise<{ src: string; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Unsupported image'));
      img.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cw = Math.max(1, Math.round(img.naturalWidth * k));
    const ch = Math.max(1, Math.round(img.naturalHeight * k));
    let src: string;
    if (file.type === 'image/svg+xml') {
      src = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.readAsDataURL(file);
      });
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      canvas.getContext('2d')!.drawImage(img, 0, 0, cw, ch);
      // Photos compress far better as JPEG; keep PNG for drawings with transparency.
      src =
        file.type === 'image/jpeg'
          ? canvas.toDataURL('image/jpeg', 0.88)
          : canvas.toDataURL('image/png');
    }
    // Display size: at most 480 px wide on the sheet.
    const d = Math.min(1, 480 / cw);
    return { src, w: cw * d, h: ch * d };
  } finally {
    URL.revokeObjectURL(url);
  }
}
