"use client";

/**
 * View Transitions shim (FUN-15).
 *
 * Next 16.3's App Router ships React canary, which exports `ViewTransition`
 * and `addTransitionType` — no config flag needed (verified in
 * node_modules/next/dist/docs/01-app/02-guides/view-transitions.md). But the
 * *installed* react@19.2.8 — the one vitest resolves — does NOT export them,
 * so every use goes through this shim: the real component in the app, a
 * props-ignoring passthrough under tests and any non-canary runtime.
 *
 * Gating is the caller's job via `useVtOn()`: render the wrapper only while
 * the Fun Mode toggle is on. With no participating <ViewTransition> in the
 * tree React never starts a browser transition, so off means zero work.
 *
 * No `document.startViewTransition` is called anywhere in this design; if a
 * future manual call is ever added it must check
 * `matchMedia("(prefers-reduced-motion: reduce)")` itself — the CSS clamp
 * cannot reach a JS-started transition's timing.
 */

import * as React from "react";
import { funOn, useFunPrefs } from "./fun-mode";

export interface VTProps {
  children?: React.ReactNode;
  name?: string;
  share?: string;
  enter?: string | Record<string, string>;
  exit?: string | Record<string, string>;
  default?: string;
}

const runtime = React as unknown as Record<string, unknown>;

const Passthrough = ({ children }: VTProps) => <>{children}</>;

export const VT: React.ComponentType<VTProps> =
  (runtime.ViewTransition as React.ComponentType<VTProps> | undefined) ?? Passthrough;

export const addVtType: (type: string) => void =
  (runtime.addTransitionType as ((type: string) => void) | undefined) ?? (() => {});

/** Is the Fun Mode transitions toggle on? SSR says no; the client settles. */
export function useVtOn(): boolean {
  const [prefs] = useFunPrefs();
  return funOn(prefs, "transitions");
}

/**
 * A shared-element name, applied only while `on` — off renders the children
 * bare, so the default app carries no view-transition names at all.
 * `default="none"` is load-bearing: without it every named element would
 * crossfade on every unrelated transition.
 */
export function VtName({
  on,
  name,
  children,
}: {
  on: boolean;
  name: string;
  children: React.ReactNode;
}) {
  if (!on) return <>{children}</>;
  return (
    <VT name={name} share="morph" default="none">
      {children}
    </VT>
  );
}
