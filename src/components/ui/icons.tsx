import type { SVGProps } from "react";

/**
 * Minimal inline-SVG icon set (zero dependencies).
 * If you already have lucide-react installed, you can delete this and import
 * from there instead — the names roughly match.
 */
type IconProps = SVGProps<SVGSVGElement>;

const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Icons = {
  home:    (p: IconProps) => <svg width="16" height="16" viewBox="0 0 24 24" {...s} {...p}><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>,
  ship:    (p: IconProps) => <svg width="16" height="16" viewBox="0 0 24 24" {...s} {...p}><path d="M3 15l1.8 5h14.4L21 15"/><path d="M5 15V9l7-3 7 3v6"/><path d="M12 3v3"/></svg>,
  box:     (p: IconProps) => <svg width="16" height="16" viewBox="0 0 24 24" {...s} {...p}><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>,
  bill:    (p: IconProps) => <svg width="16" height="16" viewBox="0 0 24 24" {...s} {...p}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></svg>,
  money:   (p: IconProps) => <svg width="16" height="16" viewBox="0 0 24 24" {...s} {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.6 2.5 1.6c0 2.4-5 1.4-5 3.8 0 1 1 1.6 2.5 1.6s2.5-.5 2.5-1.5"/></svg>,
  users:   (p: IconProps) => <svg width="16" height="16" viewBox="0 0 24 24" {...s} {...p}><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16 5.5a3 3 0 0 1 0 5.8M20.5 20c0-2.4-1.4-4.2-3.5-4.8"/></svg>,
  search:  (p: IconProps) => <svg width="15" height="15" viewBox="0 0 24 24" {...s} strokeWidth={1.9} {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>,
  bell:    (p: IconProps) => <svg width="16" height="16" viewBox="0 0 24 24" {...s} {...p}><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>,
  plus:    (p: IconProps) => <svg width="15" height="15" viewBox="0 0 24 24" {...s} strokeWidth={2} {...p}><path d="M12 5v14M5 12h14"/></svg>,
  chevR:   (p: IconProps) => <svg width="14" height="14" viewBox="0 0 24 24" {...s} strokeWidth={2} {...p}><path d="m9 6 6 6-6 6"/></svg>,
  refresh: (p: IconProps) => <svg width="15" height="15" viewBox="0 0 24 24" {...s} {...p}><path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 4v5h-5"/></svg>,
  edit:    (p: IconProps) => <svg width="15" height="15" viewBox="0 0 24 24" {...s} {...p}><path d="M4 20h4L18.5 9.5a2 2 0 0 0-3-3L5 17v3Z"/></svg>,
  trash:   (p: IconProps) => <svg width="15" height="15" viewBox="0 0 24 24" {...s} {...p}><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>,
  eye:     (p: IconProps) => <svg width="15" height="15" viewBox="0 0 24 24" {...s} {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>,
  doc:     (p: IconProps) => <svg width="15" height="15" viewBox="0 0 24 24" {...s} {...p}><path d="M6 2h8l4 4v16H6V2Z"/><path d="M14 2v4h4"/></svg>,
};
