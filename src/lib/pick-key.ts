/**
 * The identity of one pick — a game and a market — as a string.
 *
 * Its own module, and deliberately not in `session-picks`, because both sides
 * of the render boundary need it: the client store keys "just placed" picks by
 * it, and `group-share` (which runs on the SERVER, in the group hub and the
 * pick board) stamps the same key onto the rows it shapes so the two agree
 * about which pick is which.
 *
 * It lived in `session-picks` until 2026-08-29 and took that file's
 * `"use client"` with it: Next.js turns every export of a client module into a
 * server-side reference stub, so calling this from a server component threw
 * *"Attempted to call pickKey() from the server"* and every pick'em group hub
 * and pick board rendered the error page. A pure helper shared across the
 * boundary belongs in a module that declares neither side.
 */
export const pickKey = (gameId: number, market: string): string => `${gameId}:${market}`;
