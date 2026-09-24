/** Reference designator as TeX: R12 → R_{12}. */
export function refToTex(ref: string): string {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
  return m ? `${m[1]}_{${m[2]}}` : `\\text{${ref}}`;
}
