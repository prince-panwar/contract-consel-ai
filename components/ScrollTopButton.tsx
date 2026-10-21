"use client";

import { useEffect, useState, type RefObject } from "react";

interface Props {
  target: RefObject<HTMLElement | null>;
  threshold?: number;
  className?: string;
}

// Floating "back to top" for a scrollable pane. Render it inside a
// position:relative wrapper around (not inside) the scrolling element.
export function ScrollTopButton({ target, threshold = 600, className = "" }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const onScroll = () => setVisible(el.scrollTop > threshold);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [target, threshold]);

  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={() => target.current?.scrollTo({ top: 0, behavior: "smooth" })}
      className={`absolute bottom-4 right-4 z-20 flex items-center gap-1.5 rounded-full border border-accent/50 bg-bg-secondary/95 px-3 py-1.5 text-xs text-accent shadow-lg backdrop-blur hover:bg-accent hover:text-background transition-colors ${className}`}
      aria-label="Scroll to top"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m18 15-6-6-6 6" />
      </svg>
      Top
    </button>
  );
}
