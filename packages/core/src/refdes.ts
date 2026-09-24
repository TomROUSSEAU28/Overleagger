import type { Project } from './model/project';

/** All reference designators used in the project (every sheet). */
export function collectRefs(project: Project): Set<string> {
  const out = new Set<string>();
  for (const s of project.listSheets()) {
    for (const el of project.getElements(s.id))
      if (el.type === 'component' && el.ref) out.add(el.ref);
  }
  return out;
}

/** Next free reference for a prefix: R → R1, R2… (lowest unused number). */
export function nextRef(prefix: string, used: Set<string>): string {
  if (!prefix) return '';
  for (let i = 1; ; i++) {
    const ref = `${prefix}${i}`;
    if (!used.has(ref)) return ref;
  }
}

/** Split "R12" into ["R", 12]. */
export function splitRef(ref: string): [string, number] | undefined {
  const m = /^(.*?)(\d+)$/.exec(ref);
  return m ? [m[1]!, Number(m[2])] : undefined;
}
