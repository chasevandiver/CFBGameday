import { NextResponse, type NextRequest } from "next/server";
import { TAPE_QUESTIONS, tapePayload, type TapeAnswer } from "../../../lib/tape";
import { fetchTapeDay, fetchTapeEntry, fetchTapeStanding } from "../../../lib/tape-data";
import { productDate } from "../../../lib/streak";
import { createClient } from "../../../lib/supabase/server";
import { createServiceClient } from "../../../lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * The Tape's play surface (TAPE-2).
 *
 * Server-authoritative for two reasons, only one of which is about spoilers.
 *
 *   1. **The answer key is not readable by the caller.** `tape_questions` has
 *      RLS on and no select policy at all (migration 0068), so grading has to
 *      happen here, on the service client. The page cannot check an answer even
 *      if it wanted to.
 *   2. **"No going back" has to be enforced, not asked for.** A POST whose
 *      `idx` is not the next unanswered one is refused. A client that replays a
 *      request, or reorders two, cannot re-answer a question — and the round's
 *      whole shape depends on that, because later questions are readable once
 *      earlier ones are settled.
 *
 * What this route does NOT claim is an anti-spoiler property. The fixture is
 * named up front, and every fact about it is public — in this database and on
 * the open internet. Withholding the score until the round is over is worth
 * doing; calling it a guarantee would be a lie. See 0068's header.
 *
 * Writes run on the service client because `tape_entries` revokes member
 * writes; identity comes from the session, so the write is always scoped to
 * the caller's own row.
 */

async function session(day: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const service = createServiceClient();
  return { user, service, day };
}

export async function GET() {
  const day = productDate(new Date());
  const ctx = await session(day);
  if (!ctx) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const [today, row, stats] = await Promise.all([
    fetchTapeDay(ctx.service, day),
    fetchTapeEntry(ctx.service, ctx.user.id, day),
    fetchTapeStanding(ctx.service, ctx.user.id),
  ]);
  if (!today) return NextResponse.json({ error: "No round today" }, { status: 404 });

  return NextResponse.json(tapePayload(day, today.fixture, today.questions, row, stats));
}

export async function POST(req: NextRequest) {
  const day = productDate(new Date());
  const ctx = await session(day);
  if (!ctx) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  let idx: number;
  let choice: string;
  try {
    const body = (await req.json()) as { idx?: unknown; choice?: unknown };
    idx = Number(body.idx);
    choice = String(body.choice ?? "");
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!Number.isInteger(idx) || idx < 0 || idx >= TAPE_QUESTIONS) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const [today, row] = await Promise.all([
    fetchTapeDay(ctx.service, day),
    fetchTapeEntry(ctx.service, ctx.user.id, day),
  ]);
  if (!today) return NextResponse.json({ error: "No round today" }, { status: 404 });

  if (row.answers.length >= TAPE_QUESTIONS) {
    return NextResponse.json({ error: "Today's round is finished" }, { status: 409 });
  }
  /* The one that makes "no going back" real: the only answerable question is
     the next unanswered one. A replayed or reordered request lands here. */
  if (idx !== row.answers.length) {
    return NextResponse.json({ error: "That question is not the one in play" }, { status: 409 });
  }

  const question = today.questions[idx];
  if (!question) return NextResponse.json({ error: "No round today" }, { status: 404 });
  /* An unrecognised choice costs no answer, the same courtesy Guess the Game
     extends to a guess that does not resolve: a fat finger is not a wrong
     answer. */
  if (!question.choices.includes(choice)) {
    return NextResponse.json({ error: "Pick one of the options" }, { status: 422 });
  }

  const answers: TapeAnswer[] = [
    ...row.answers,
    { idx, choice, correct: choice === question.answer },
  ];
  const done = answers.length >= TAPE_QUESTIONS;
  const correct = answers.filter((a) => a.correct).length;

  const { error } = await ctx.service.from("tape_entries").upsert(
    {
      user_id: ctx.user.id,
      day,
      answers,
      correct,
      completed_at: done ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,day" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    tapePayload(
      day,
      today.fixture,
      today.questions,
      { answers, completed_at: done ? new Date().toISOString() : null },
      await fetchTapeStanding(ctx.service, ctx.user.id),
    ),
  );
}
