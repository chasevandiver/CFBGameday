import { NextResponse, type NextRequest } from "next/server";
import { chainsPayload, type ChainsRunState } from "../../../lib/chains";
import { fetchChainsDay, fetchChainsRun, fetchChainsStanding } from "../../../lib/chains-data";
import { productDate } from "../../../lib/streak";
import { createClient } from "../../../lib/supabase/server";
import { createServiceClient } from "../../../lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * Chains' play surface (CHAIN-2).
 *
 * The deck is the answer key AND the future of the run, so it never leaves the
 * server whole: `chains_cards` has RLS on with no select policy (0069), and
 * this route ships exactly one face-up card. Shipping the rest would not merely
 * spoil an answer, it would end the game — a player who can read card nine
 * before answering card one has a list, not a run.
 *
 * The index in play is the run's own `length`, read from the stored row rather
 * than taken from the request. A client-supplied cursor is a client-supplied
 * score.
 */

async function session() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { user, service: createServiceClient() };
}

export async function GET() {
  const day = productDate(new Date());
  const ctx = await session();
  if (!ctx) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const [today, run, stats] = await Promise.all([
    fetchChainsDay(ctx.service, day),
    fetchChainsRun(ctx.service, ctx.user.id, day),
    fetchChainsStanding(ctx.service, ctx.user.id),
  ]);
  if (!today) return NextResponse.json({ error: "No run today" }, { status: 404 });

  return NextResponse.json(chainsPayload(day, today.deck, run, stats));
}

export async function POST(req: NextRequest) {
  const day = productDate(new Date());
  const ctx = await session();
  if (!ctx) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  let choice: "left" | "right";
  let idx: number;
  try {
    const body = (await req.json()) as { idx?: unknown; choice?: unknown };
    idx = Number(body.idx);
    const raw = String(body.choice ?? "");
    if (raw !== "left" && raw !== "right") {
      return NextResponse.json({ error: "Pick a side" }, { status: 400 });
    }
    choice = raw;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const [today, run] = await Promise.all([
    fetchChainsDay(ctx.service, day),
    fetchChainsRun(ctx.service, ctx.user.id, day),
  ]);
  if (!today) return NextResponse.json({ error: "No run today" }, { status: 404 });

  if (run.busted || run.length >= today.deck.length) {
    return NextResponse.json({ error: "Today's run is over" }, { status: 409 });
  }
  /* The card in play is the one the RUN is on, never the one the request names
     — a client-supplied cursor is a client-supplied score. The index still has
     to agree, so a replayed request is refused rather than silently applied to
     whatever card is current now. */
  if (idx !== run.length) {
    return NextResponse.json({ error: "That card is not the one in play" }, { status: 409 });
  }

  const card = today.deck[run.length]!;
  const correct = choice === card.answer;
  const answers = [...run.answers, { idx: run.length, choice, correct }];
  const next: ChainsRunState = {
    length: correct ? run.length + 1 : run.length,
    busted: !correct,
    answers,
    /* A run ends on a miss OR on clearing the deck. Both write `ended_at`,
       because the board counts ended runs and a cleared deck is the best
       possible result — leaving it open would drop it from the standings. */
    ended_at:
      !correct || run.length + 1 >= today.deck.length ? new Date().toISOString() : null,
  };

  const { error } = await ctx.service.from("chains_runs").upsert(
    {
      user_id: ctx.user.id,
      day,
      length: next.length,
      busted: next.busted,
      answers: next.answers,
      ended_at: next.ended_at,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,day" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    chainsPayload(day, today.deck, next, await fetchChainsStanding(ctx.service, ctx.user.id)),
  );
}
