type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'dataset' | 'style'>> & {
  dataset?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
};

/** Tiny element builder: h('button', { className: 'pill', onclick }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props<K> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const { dataset, style, ...rest } = props;
  const el = Object.assign(document.createElement(tag), rest);
  if (dataset) Object.assign(el.dataset, dataset);
  if (style) Object.assign(el.style, style);
  for (const child of children) if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}
