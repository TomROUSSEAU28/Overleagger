import { expandSelection } from './commands/ops';
import type { Element, Id } from './model/types';

/** Where a drawing is shown: the presentation, or the exported files. */
export type Audience = 'present' | 'export';

const flag = (a: Audience) => (a === 'present' ? 'noPresent' : 'noExport');

/** Is this element hidden for `audience`, by itself or through one of its groups? */
export function isHiddenFor(el: Element, byId: Map<Id, Element>, audience: Audience): boolean {
  const key = flag(audience);
  const seen = new Set<Id>();
  let cur: Element | undefined = el;
  while (cur && !seen.has(cur.id)) {
    if (cur[key]) return true;
    seen.add(cur.id);
    cur = cur.groupId ? byId.get(cur.groupId) : undefined;
  }
  return false;
}

/** The elements shown to `audience` (hidden elements and members of hidden groups removed). */
export function visibleFor(elements: Element[], audience: Audience): Element[] {
  const key = flag(audience);
  if (!elements.some((e) => e[key])) return elements;
  const byId = new Map(elements.map((e) => [e.id, e]));
  return elements.filter((e) => !isHiddenFor(e, byId, audience));
}

/** What a sheet export draws: elements not hidden from export, restricted to `only` if given. */
export function exportedElements(all: Element[], only?: Iterable<Id>): Element[] {
  const shown = visibleFor(all, 'export');
  if (!only) return shown;
  const keep = expandSelection(all, only);
  return shown.filter((e) => keep.has(e.id));
}
