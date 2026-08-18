import { NextResponse, type NextRequest } from "next/server";
import { TAPE_QUESTIONS, tapePayload, type TapeAnswer } from "../../../../lib/tape";
import { fetchTapePractice } from "../../../../lib/practice-data";
import { createClient } from "../../../../lib/supabase/server";
import { createServiceClient } from "../../../../lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * The Tape, unscored (PRAC-1).
 *
 * **This route contains no write, and that is the guarantee.** Progress arrives
 * from the client on every call, which is safe for exactly one reason — nothing
 * here is scored, so there is nothing for a client to lie its way into. Same
 * reasoning GTG-6 used, same structural consequence: "practice cannot touch
 * your record" is a fact about the code, not a promise in a comment.
 *
 * Two things it deliberately shares with the daily rather than reimplementing:
 *
 *   * **`tapePayload` does the cutting.** Practice and the daily therefore hide
 *     exactly the same things, and a change to one cannot leave the other
 *     behind. A second spoiler-cutting path is how those two drift.
 *   * **The response shape is identical.** The client sends the choices it has
 *     made so far and gets a full round state back, so the board renders through
 *     the same component the daily uses instead of a copy that looks almost
 *     right.
 *
 * The server re-grades the whole submitted list every call rather than trusting
 * per-answer verdicts from the client. It holds the key, so that is cheaper than
 * validating a claim — and it means the history shown is always the server's.
 */

/** The client's choices, graded against the key. */
function grade(choices: string[], questions: { answer: string }[]): TapeAnswer[] {
  return choices.slice(0, TAPE_QUESTIONS).map((choice, idx) => ({
    idx,
    choice,
    correct: choice === questions[idx]?.answer,
  }));
}

async function round(id: number | null) {
  return fetchTapePractice(createServiceClient(), id);
}

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

  const r = await round(id);
  if (!r) return NextResponse.json({ error: "No practice rounds yet" }, { status: 404 });

  return NextResponse.json({
    practiceId: r.id,
    crests: r.crests,
    ...tapePayload("practice", r.fixture, r.questions, { answers: [], completed_at: null }),
  });
}

export async function POST(req: NextRequest) {
  if (!(await signedIn())) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  let id: number;
  let choices: string[];
  try {
    const body = (await req.json()) as { id?: unknown; choices?: unknown };
    id = Number(body.id);
    choices = Array.isArray(body.choices) ? body.choices.map(String) : [];
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!Number.isInteger(id) || choices.length === 0 || choices.length > TAPE_QUESTIONS) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const r = await round(id);
  if (!r) return NextResponse.json({ error: "No such round" }, { status: 404 });

  /* A choice that is not on offer is refused rather than marked wrong — the same
     courtesy the daily extends, so a fat finger costs nothing here either. */
  const latest = choices[choices.length - 1]!;
  const q = r.questions[choices.length - 1];
  if (!q || !q.choices.includes(latest)) {
    return NextResponse.json({ error: "Pick one of the options" }, { status: 422 });
  }

  const answers = grade(choices, r.questions);
  const done = answers.length >= TAPE_QUESTIONS;

  return NextResponse.json({
    practiceId: r.id,
    crests: r.crests,
    ...tapePayload("practice", r.fixture, r.questions, {
      answers,
      completed_at: done ? "practice" : null,
    }),
  });
}
