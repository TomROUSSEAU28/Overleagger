import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import 'mathjax-full/js/input/tex/noerrors/NoErrorsConfiguration.js';

export interface TexSvg {
  /** viewBox of the MathJax SVG (units of 1/1000 em). */
  vb: [number, number, number, number];
  /** Inner SVG markup (paths use `currentColor`). */
  inner: string;
  /** Depth below the baseline in em. */
  depth: number;
}

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const doc = mathjax.document('', {
  InputJax: new TeX({ packages: ['base', 'ams', 'newcommand', 'boldsymbol', 'noerrors'] }),
  OutputJax: new SVG({ fontCache: 'none' }),
});

export function texToSvg(tex: string, display: boolean): TexSvg {
  const node = doc.convert(tex, { display });
  const html = adaptor.outerHTML(node);
  const svgStart = html.indexOf('<svg');
  const svgOpenEnd = html.indexOf('>', svgStart);
  const open = html.slice(svgStart, svgOpenEnd + 1);
  const inner = html.slice(svgOpenEnd + 1, html.lastIndexOf('</svg>'));
  const vbMatch = /viewBox="([^"]+)"/.exec(open);
  const vb = (vbMatch?.[1] ?? '0 0 0 0').split(/\s+/).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const va = /vertical-align:\s*(-?[\d.]+)ex/.exec(open);
  // 1ex ≈ 0.442em for the MathJax TeX fonts.
  const depth = va ? -Number(va[1]) * 0.442 : 0;
  return { vb, inner, depth };
}
