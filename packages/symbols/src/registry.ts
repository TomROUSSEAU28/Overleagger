import { control } from './library/control';
import { analog, annotations, machines, measurement, switches } from './library/misc';
import { passives } from './library/passives';
import { power } from './library/power';
import { diodes, thyristors, transistors } from './library/semiconductors';
import { sources } from './library/sources';
import { primsBBox } from './prims';
import type {
  BBox,
  OptionValue,
  PinDef,
  Primitive,
  Standard,
  StaticSymbolDef,
  SymbolDef,
  SymbolGraphics,
} from './types';

export const builtinSymbols: SymbolDef[] = [
  ...passives,
  ...sources,
  ...diodes,
  ...transistors,
  ...thyristors,
  ...power,
  ...switches,
  ...machines,
  ...analog,
  ...measurement,
  ...annotations,
  ...control,
];

export const CATEGORY_ORDER = [
  'Passives',
  'Sources',
  'Diodes',
  'Transistors',
  'Thyristors',
  'Power modules',
  'Switches & protection',
  'Machines',
  'Analog & logic',
  'Measurement',
  'Control blocks',
  'Annotations',
];

const byId = new Map(builtinSymbols.map((s) => [s.id, s]));

export type AnySymbol = SymbolDef | StaticSymbolDef;

export function isStatic(s: AnySymbol): s is StaticSymbolDef {
  return 'graphics' in s;
}

export function getBuiltinSymbol(id: string): SymbolDef | undefined {
  return byId.get(id);
}

/** Default option values of a symbol. */
export function defaultOptions(sym: AnySymbol): Record<string, OptionValue> {
  const out: Record<string, OptionValue> = {};
  if (!isStatic(sym)) for (const o of sym.options ?? []) out[o.key] = o.default;
  return out;
}

/** Default parameters (ref/value + extra params) for a new component. */
export function defaultParams(sym: AnySymbol): Record<string, string> {
  const out: Record<string, string> = { value: sym.defaultValue ?? '' };
  for (const p of sym.params ?? []) out[p.key] = p.default;
  return out;
}

export interface ResolvedSymbol {
  prims: Primitive[];
  pins: PinDef[];
  /** Bounding box in grid units, including pins. */
  bbox: BBox;
}

const cache = new Map<string, ResolvedSymbol>();
const staticCache = new WeakMap<SymbolGraphics, ResolvedSymbol>();

/** Build (and cache) the graphics of a symbol for a given standard and options. */
export function resolveSymbol(
  sym: AnySymbol,
  standard: Standard,
  opts: Record<string, OptionValue> = {},
): ResolvedSymbol {
  if (isStatic(sym)) {
    let hit = staticCache.get(sym.graphics);
    if (!hit) {
      hit = withBBox(sym.graphics);
      staticCache.set(sym.graphics, hit);
    }
    return hit;
  }
  const merged = { ...defaultOptions(sym), ...opts };
  const key = `${sym.id}|${standard}|${JSON.stringify(merged, Object.keys(merged).sort())}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = withBBox(sym.build({ standard, opts: merged }));
    cache.set(key, hit);
    if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  }
  return hit;
}

function withBBox(g: SymbolGraphics): ResolvedSymbol {
  return { prims: g.prims, pins: g.pins, bbox: primsBBox(g.prims, g.pins) };
}

/** Case-insensitive search over name, id, category and keywords. */
export function searchSymbols(query: string, symbols: AnySymbol[] = builtinSymbols): AnySymbol[] {
  const q = query.trim().toLowerCase();
  if (!q) return symbols;
  const words = q.split(/\s+/);
  const scored: { s: AnySymbol; score: number }[] = [];
  for (const s of symbols) {
    const name = s.name.toLowerCase();
    const hay = [name, s.id, s.category.toLowerCase(), ...(s.keywords ?? [])].join(' ');
    if (!words.every((w) => hay.includes(w))) continue;
    let score = 0;
    if (name.startsWith(q)) score += 10;
    if (name.includes(q)) score += 5;
    if (s.id === q) score += 20;
    scored.push({ s, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((x) => x.s);
}

export function groupByCategory(symbols: AnySymbol[]): [string, AnySymbol[]][] {
  const map = new Map<string, AnySymbol[]>();
  for (const s of symbols) {
    const list = map.get(s.category) ?? [];
    list.push(s);
    map.set(s.category, list);
  }
  const order = (c: string) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i < 0 ? CATEGORY_ORDER.length : i;
  };
  return [...map.entries()].sort((a, b) => order(a[0]) - order(b[0]));
}

/** Replace `{key}` placeholders with parameter values. */
export function fillTemplate(t: string, params: Record<string, string>): string {
  return t.replace(/\{(\w+)\}/g, (_, k: string) => params[k] ?? '');
}
