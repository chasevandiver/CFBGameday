import { NextResponse, type NextRequest } from "next/server";
import { EMPTY_RUN, chainsPayload } from "../../../../lib/chains";
import { fetchChainsPractice } from "../../../../lib/practice-data";
import { createClient } from "../../../../lib/supabase/server";
import { createServiceClient } from "../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * Chains, unscored (PRAC-1). No write anywhere in this file — see the Tape
 * practice route for why that is the guarantee rather than an omission.
 *
 * `chainsPayload` cuts the deck exactly as it does for the daily: one face-up
 * card, the played ones revealed, the tail only once the run is over. Practice
 * inherits that by going through the same function, and the response shape
 * matches the daily so the board renders through the same component.
 *
 * The run is rebuilt from the client's list of sides each call rather than from
 * a claimed length: the server holds the deck, so replaying the list is both
 * cheaper than validating a claim and the only way the reported run length is
 * the server's own arithmetic.
 */
async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user !== null;
}

export async function GET(req: NextRequest) {
  if (!(await signedIn())) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const idParam = new URL(req.url).searchParams.get("id");
  const id = idParam === null ? null : Number(idParam);
  if (id !== null && !Number.isInteger(id)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const r = await fetchChainsPractice(createServiceClient(), id);
  if (!r) return NextResponse.json({ error: "No practice rounds yet" }, { status: 404 });

  return NextResponse.json({
    practiceId: r.id,
    crests: r.crests,
    ...chainsPayload("practice", r.deck, EMPTY_RUN),
  });
}

export async function POST(req: NextRequest) {
  if (!(await signedIn())) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  let id: number;
  let sides: string[];
  try {
    const body = (await req.json()) as { id?: unknown; choices?: unknown };
    id = Number(body.id);
    sides = Array.isArray(body.choices) ? body.choices.map(String) : [];
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!Number.isInteger(id) || sides.length === 0) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (sides.some((c) => c !== "left" && c !== "right")) {
    return NextResponse.json({ error: "Pick a side" }, { status: 400 });
  }

  const r = await fetchChainsPractice(createServiceClient(), id);
  if (!r) return NextResponse.json({ error: "No such round" }, { status: 404 });
  if (sides.length > r.deck.length) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  /* Replay the run and stop at the first miss, exactly as the daily does — a run
     does not continue past a bust, so anything the client sent after one is
     ignored rather than trusted. */
  const answers: Array<{ idx: number; choice: "left" | "right"; correct: boolean }> = [];
  let length = 0;
  let busted = false;
  for (let i = 0; i < sides.length && !busted; i++) {
    const choice = sides[i] as "left" | "right";
    const correct = choice === r.deck[i]!.answer;
    answers.push({ idx: i, choice, correct });
    if (correct) length += 1;
    else busted = true;
  }

  return NextResponse.json({
    practiceId: r.id,
    crests: r.crests,
    ...chainsPayload("practice", r.deck, {
      ...EMPTY_RUN,
      length,
      busted,
      answers,
      ended_at: busted || length >= r.deck.length ? "practice" : null,
    }),
  });
}
