"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ResizableColumn = { id: string; label: string; minWidth: number; defaultShare: number; content: ReactNode };

const keyboardStep = 0.02;

function normalize(shares: number[]) {
  const total = shares.reduce((sum, share) => sum + share, 0);
  return total > 0 ? shares.map((share) => share / total) : shares;
}

function readShares(key: string, count: number): number[] | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as unknown;
    if (Array.isArray(parsed) && parsed.length === count && parsed.every((value) => typeof value === "number" && Number.isFinite(value) && value > 0)) return normalize(parsed);
  } catch { /* storage unavailable or malformed: use the defaults */ }
  return null;
}

function writeShares(key: string, shares: number[]) {
  try { window.localStorage.setItem(key, JSON.stringify(shares.map((share) => Math.round(share * 1000) / 1000))); } catch { /* storage unavailable */ }
}

/**
 * Move the boundary between columns `index` and `index + 1` by `delta` (a share
 * of the container), keeping both neighbours at or above their minimum width.
 * Other columns keep their width.
 */
export function moveBoundary(shares: number[], index: number, delta: number, minimumShares: number[]) {
  const left = shares[index]!;
  const right = shares[index + 1]!;
  const pair = left + right;
  const nextLeft = Math.min(pair - minimumShares[index + 1]!, Math.max(minimumShares[index]!, left + delta));
  if (!Number.isFinite(nextLeft) || nextLeft <= 0 || pair - nextLeft <= 0) return shares;
  const next = [...shares];
  next[index] = nextLeft;
  next[index + 1] = pair - nextLeft;
  return next;
}

/**
 * Side-by-side columns separated by drag handles. Each column scrolls on its
 * own. Drag a handle, or focus it and use the arrow keys, to change the widths;
 * double-click or press Enter on a handle to restore the defaults. Widths are
 * remembered per browser. Below the `lg` breakpoint the columns stack.
 */
export function ResizableColumns({ columns, storageKey, className }: { columns: ResizableColumn[]; storageKey: string; className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const defaults = normalize(columns.map((column) => column.defaultShare));
  const [shares, setShares] = useState(defaults);
  const [dragging, setDragging] = useState<number | null>(null);
  const drag = useRef<{ index: number; startX: number; startShares: number[]; width: number } | null>(null);

  // Stored widths are read after hydration so server and client render the same first frame.
  useEffect(() => {
    const stored = readShares(storageKey, columns.length);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from browser storage
    if (stored) setShares(stored);
  }, [storageKey, columns.length]);

  const minimumShares = useCallback((width: number) => columns.map((column) => width > 0 ? Math.min(column.minWidth / width, 1 / columns.length) : 0), [columns]);

  const commit = useCallback((next: number[]) => { setShares(next); writeShares(storageKey, next); }, [storageKey]);

  useEffect(() => {
    if (dragging === null) return;
    const move = (event: PointerEvent) => {
      const state = drag.current;
      if (!state || state.width <= 0) return;
      setShares(moveBoundary(state.startShares, state.index, (event.clientX - state.startX) / state.width, minimumShares(state.width)));
    };
    const end = () => {
      drag.current = null;
      setDragging(null);
      setShares((current) => { writeShares(storageKey, current); return current; });
    };
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [dragging, minimumShares, storageKey]);

  const template = shares.map((share) => `minmax(0, ${share}fr)`).join(" 9px ");

  return (
    <div ref={container} className={cn("grid min-h-0 grid-cols-1 lg:[grid-template-columns:var(--balsa-columns)]", className)} style={{ ["--balsa-columns" as string]: template }}>
      {columns.map((column, index) => (
        <Fragment key={column.id}>
          <section aria-label={column.label} className="@container min-w-0 lg:h-full lg:overflow-y-auto">{column.content}</section>
          {index < columns.length - 1 && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={`Resize ${column.label} and ${columns[index + 1]!.label}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((shares.slice(0, index + 1).reduce((sum, share) => sum + share, 0)) * 100)}
              tabIndex={0}
              title="Drag to resize · double-click to reset"
              className="group relative hidden cursor-col-resize touch-none outline-none lg:block"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                drag.current = { index, startX: event.clientX, startShares: shares, width: (container.current?.getBoundingClientRect().width ?? 0) - 9 * (columns.length - 1) };
                setDragging(index);
              }}
              onDoubleClick={() => commit(defaults)}
              onKeyDown={(event) => {
                const width = (container.current?.getBoundingClientRect().width ?? 0) - 9 * (columns.length - 1);
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  commit(moveBoundary(shares, index, event.key === "ArrowLeft" ? -keyboardStep : keyboardStep, minimumShares(width)));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  commit(defaults);
                }
              }}
            >
              <span aria-hidden="true" className={cn("absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-rule transition-colors group-hover:bg-ink-2 group-focus-visible:bg-ink", dragging === index && "bg-ink")} />
              <span aria-hidden="true" className={cn("absolute top-1/2 left-1/2 h-8 w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-rule bg-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100", dragging === index && "opacity-100")} />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}
