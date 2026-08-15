import Link from "next/link";
import { CardShowcase } from "./CardShowcase";
import {
  Eyebrow,
  FeatureCard,
  INVITE_MAILTO,
  PrimaryCta,
  SecondaryCta,
  Section,
  SectionHead,
  StatTile,
  Step,
  WelcomeFooter,
  WelcomeHeader,
} from "./parts";

/**
 * The pitch.
 *
 * Separated from `app/welcome/page.tsx` so it can be rendered by
 * `welcome-links.test.tsx`, which walks every href on it and asserts the route
 * exists — a marketing page that links to a 404 is worse than no marketing
 * page, and this one links out fourteen times.
 *
 * ## The rule this page is written under
 *
 * Every number on it is one the product can be held to, and every claim is
 * about something that has shipped. The temptation on a page like this is the
 * roadmap voice — "predictive intelligence that finds you an edge" — and the
 * product's own honest note (SPEC §11.1, and the docblock on `/edges`) says the
 * opposite in a measured number: the model's flagged disagreements went 49.2%
 * against the closing line in the 2023–25 backtest, where 52.4% is break-even.
 * So §05 prints that, and it is the most persuasive section on the page. It is
 * the reason to trust the other five.
 *
 * BRAND §16 governs the vocabulary: edge, model, line, probability, record.
 * Nothing here says LOCK, and nothing here has a dollar sign in it.
 */
export function WelcomeContent() {
  return (
    <div className="brand-surface min-h-dvh bg-background text-chalk">
      <WelcomeHeader />

      <main id="main">
        {/* ---- hero ---------------------------------------------------- */}
        <div className="mx-auto w-full max-w-5xl px-5 pb-14 pt-12 sm:pt-20">
          <Eyebrow>Ratings · Predictions · Picks · Bet tracking</Eyebrow>
          <h1 className="mt-5 text-balance text-[2.15rem] leading-[1.06] sm:text-6xl">
            Everything your Saturday
            <br className="hidden sm:block" /> is riding on, on one screen.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-chalk/85">
            The Slate is a private command center for a group that watches all of it and bets some
            of it. Live scores and market lines, a model that prices every game, a pick&rsquo;em
            pool that locks at kickoff, and one ledger where everybody&rsquo;s record is public.
            College football and the NFL, same product.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <PrimaryCta href="/demo">See a live Saturday →</PrimaryCta>
            <SecondaryCta href={INVITE_MAILTO}>Ask for an invite</SecondaryCta>
          </div>
          <p className="mt-4 text-sm text-dim">
            The demo is the real product running on invented games and invented money — not a
            mock-up, not a video.{" "}
            <Link href="/login" className="text-accent hover:underline">
              Already have an account? Sign in
            </Link>
            .
          </p>

          <div className="mt-11 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4">
            <StatTile figure="136" label="FBS teams rated and re-rated every Sunday" />
            <StatTile figure="4" label="rating systems on every card — ours, SP+, FPI, Elo" />
            <StatTile figure="2" label="leagues, one ledger — college football and the NFL" />
            <StatTile figure="0" label="predictions edited after the fact. Ever." />
          </div>
        </div>

        {/* Proof, before the prose. Real cards, invented games. */}
        <CardShowcase />

        {/* ---- 01 the week --------------------------------------------- */}
        <Section id="week" className="pb-16">
          <SectionHead
            n="01"
            eyebrow="How it works"
            title="One week on The Slate"
            id="week"
            lede="The site runs itself on a schedule. Nothing here has a refresh button, and nobody has to remember to post anything."
          />
          <ol className="mt-2">
            <Step when="Wednesday" title="The board fills in">
              Lines post and the model prices every game on the slate — a spread, a total, a
              projected score and a win probability per side. Where our number disagrees with the
              market, the game gets flagged and{" "}
              <Link href="/edges" className="text-accent hover:underline">
                /edges
              </Link>{" "}
              ranks the week&rsquo;s disagreements biggest first.
            </Step>
            <Step when="Thursday, 10pm CT" title="The receipts freeze">
              Every prediction for the week is written to an append-only table, timestamped and
              stamped with the model version that made it. It cannot be edited afterwards, by
              anyone, including whoever runs the site. That is what makes the season record mean
              something in December.
            </Step>
            <Step when="Friday" title="You make your picks">
              A pick locks the line at the moment you take it, not at kickoff — so two people can
              hold different numbers on the same game, and when to take it is part of the skill.
              Edit until kickoff and the line re-snapshots; after kickoff the database refuses the
              write.
            </Step>
            <Step when="Saturday" title="The slate goes live">
              Scores update in place — no reload, no jump, no losing your place. Cards carry a
              verdict the moment the game passes the number you took, the ticker up top shows what
              you have riding, and the hub answers the only question worth asking: what do I have
              going right now, and is it covering?
            </Step>
            <Step when="Sunday" title="It grades itself">
              Results settle every pick and every bet, ratings move off what actually happened,
              closing-line value posts against the number you took, and the week&rsquo;s recap
              writes itself — upsets, movers, whose card was best.
            </Step>
          </ol>
        </Section>

        {/* ---- 02 the screens ------------------------------------------ */}
        <Section id="screens" className="pb-16">
          <SectionHead
            n="02"
            eyebrow="What's in it"
            title="The screens"
            id="screens"
            lede="Everything below already exists and is being used. This is an inventory, not a roadmap."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FeatureCard label="Slate" title="Every game, sorted how you think" href="/demo/slate" linkLabel="Open the demo slate">
              The whole board by kickoff, or re-sorted by watchability, biggest edge, closest
              spread or highest total. Filter to just your picks, just one league, just one
              conference. Live, final and upcoming cards each read differently at a glance, and
              kickoffs are in your own timezone.
            </FeatureCard>

            <FeatureCard label="Game card" title="The whole game on one page">
              Tale of the tape, the four rating systems side by side, projected score, cover
              probability, and the line&rsquo;s movement from open to now as a chart. Weather at
              the stadium when it matters — wind and precipitation move totals. Live box score and
              scoring timeline once it kicks.
            </FeatureCard>

            <FeatureCard label="Edges" title="Where we disagree with the market" href="/edges">
              This week&rsquo;s flagged games, biggest disagreement first, with the consensus
              flag when our model, SP+, FPI and Elo all lean the same way against the number.
              Presented as information — see §05 for why there is no suggested stake on it.
            </FeatureCard>

            <FeatureCard label="Ratings" title="One number per team, and how it moved" href="/ratings">
              Points better or worse than an average team on a neutral field, with offense and
              defense splits, movement arrows, sparklines and sortable columns. Updated from
              results every Sunday, never by hand.
            </FeatureCard>

            <FeatureCard label="Rankings & standings" title="The polls, and the races" href="/rankings">
              AP, Coaches and the Playoff committee, with week-over-week movement, first-place
              votes — and the model&rsquo;s dissent printed on every row. Conference standings
              derived from actual results sit alongside.
            </FeatureCard>

            <FeatureCard label="Teams" title="A page per team, with the reasoning shown" href="/teams">
              Where a team&rsquo;s rating came from, broken into its parts: last season, recruiting
              talent, roster churn, coaching change and luck regression. Then the schedule map with
              a win probability on every game, the win total versus the market, and the verdict —
              ceiling, floor, and the one thing that decides their season.
            </FeatureCard>

            <FeatureCard label="Groups" title="As many pools as your group wants" href="/rules" linkLabel="Read the league rules">
              Separate pick&rsquo;em pools and betting groups, each with its own members, its own
              weekly board and its own settings. Leaderboards by record, units, ROI and
              closing-line value. The rulebook is in the app, because ambiguity about the rules is
              the number-one source of arguments in a betting group.
            </FeatureCard>

            <FeatureCard label="Ledger" title="Your bets, and what they were actually worth">
              Log a bet in a couple of taps straight off the slate, at the number you got. The
              ledger keeps record, units, ROI, a cumulative units curve, and closing-line value on
              every single bet. Break it down by side, spread range, day, league, confidence tier.
              Export the lot to CSV.
            </FeatureCard>

            <FeatureCard label="Receipts" title="The model's report card, in public" href="/receipts">
              Frozen predictions against what happened, calibration — do 70% favorites win 70% of
              the time — and the week-by-week recap. Nothing is quietly dropped when it looks bad.
            </FeatureCard>

            <FeatureCard label="The model" title="Including the ideas that failed" href="/model">
              Which version made a given call, and a log of every change that was tested and
              rejected, with the number that killed it. Per-play efficiency, blending in SP+,
              widening early-season variance — all tried, all rejected on evidence, all listed.
            </FeatureCard>
          </div>
        </Section>

        {/* ---- 03 the pool --------------------------------------------- */}
        <Section id="pool" className="pb-16">
          <SectionHead
            n="03"
            eyebrow="The pool"
            title="Pick'em where the timing counts"
            id="pool"
            lede="Most pick'em apps hand everyone the same number at lock time. This one doesn't, and that single difference is what makes the leaderboard worth arguing about."
          />
          <div className="card p-5 sm:p-7">
            <ul className="flex flex-col gap-4 text-sm leading-relaxed text-dim">
              <li>
                <span className="font-semibold text-chalk">Your pick, your number.</span> The line
                is snapshotted the second you tap it. Take a number Tuesday and hold it while it
                moves against everyone who waited — that is a skill, and the leaderboard measures
                it.
              </li>
              <li>
                <span className="font-semibold text-chalk">Kickoff is enforced, not requested.</span>{" "}
                Picks are editable right up to kickoff and impossible afterwards — the rule lives
                in the database, not in the interface, so there is no version of the site that lets
                anyone through late.
              </li>
              <li>
                <span className="font-semibold text-chalk">Push is no action.</span> A push
                doesn&rsquo;t touch your record or your units. A postponed or canceled game voids
                every open pick and bet on it, immediately.
              </li>
              <li>
                <span className="font-semibold text-chalk">Season standings that mean something.</span>{" "}
                Record, units, ROI and average closing-line value, with ROI as the first
                tiebreaker. Blind pick&rsquo;em before kickoff is a per-pool setting — some groups
                like sweating each other&rsquo;s cards, some don&rsquo;t.
              </li>
            </ul>
            <Link
              href="/rules"
              className="stat mt-6 inline-flex min-h-11 items-center text-xs font-semibold text-accent hover:underline"
            >
              The full rulebook →
            </Link>
          </div>
        </Section>

        {/* ---- 04 the money -------------------------------------------- */}
        <Section id="money" className="pb-16">
          <SectionHead
            n="04"
            eyebrow="The ledger"
            title="Closing-line value, on every bet you log"
            id="money"
            lede="Win-loss records lie to you for months at a time. CLV is the number that tells you whether you were right before the game told you."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="card p-5">
              <h3 className="text-base font-semibold text-chalk">Graded against the close</h3>
              <p className="mt-2 text-sm leading-relaxed text-dim">
                The site polls the market right up to kickoff and keeps its own append-only record
                of every line it saw. Your bet is measured against the last number before kickoff —
                so &ldquo;I got a good number&rdquo; stops being a claim and becomes a column.
              </p>
            </div>
            <div className="card p-5">
              <h3 className="text-base font-semibold text-chalk">The angle audit</h3>
              <p className="mt-2 text-sm leading-relaxed text-dim">
                Your record and ROI split by how you came to the bet — what you originated, what
                you tailed off somebody, what you faded them on — plus how you do riding each
                specific member versus opposing them. Nobody types any of that in: it is derived
                from who got their money down first, so nobody can flatter themselves with it.
              </p>
            </div>
            <div className="card p-5">
              <h3 className="text-base font-semibold text-chalk">Unhideable by design</h3>
              <p className="mt-2 text-sm leading-relaxed text-dim">
                Bets can be voided, never quietly deleted. Everyone&rsquo;s numbers are visible to
                the group. That transparency is the whole reason a betting group stays fun instead
                of turning into a competition about who remembers what.
              </p>
            </div>
            <div className="card p-5">
              <h3 className="text-base font-semibold text-chalk">Shareable</h3>
              <p className="mt-2 text-sm leading-relaxed text-dim">
                One tap turns your card for the day into an image built for a group chat — your
                bets in confidence order, the numbers you took, the crests, on the same dark field
                as everything else here.
              </p>
            </div>
          </div>
        </Section>

        {/* ---- 05 the honest part -------------------------------------- */}
        <Section id="honest" className="pb-16">
          <SectionHead
            n="05"
            eyebrow="Read this part"
            title="What it won't do"
            id="honest"
            lede="This is the section most sites like this don't print. It is here because a tool that only shows you its wins is not a tool, and because these numbers are on the site anyway."
          />
          <div className="card p-5 sm:p-7">
            <div className="flex flex-col gap-6">
              <div>
                <p className="stat text-3xl font-semibold text-chalk sm:text-4xl">49.2%</p>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-dim">
                  How the model&rsquo;s flagged disagreements did against the closing line across
                  the 2023–25 backtest. Break-even at standard −110 juice is{" "}
                  <span className="stat text-chalk">52.4%</span>. It does not beat the closing
                  spread, we tested whether it does, and the answer is printed here rather than
                  buried.
                </p>
              </div>
              <div className="border-t border-chalk/12 pt-6">
                <p className="stat text-3xl font-semibold text-chalk sm:text-4xl">+0.27</p>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-dim">
                  Average closing-line value, in points, on the games where the model disagreed
                  with the opener by four or more. The market does drift toward our side after the
                  number posts — just not far enough to pay the vig. The honest version of the
                  claim is that the disagreement is real and CLV is how you would know, not that
                  the model is a printing press.
                </p>
              </div>
            </div>
            <ul className="mt-7 flex flex-col gap-3 border-t border-chalk/12 pt-6 text-sm leading-relaxed text-dim">
              <li>
                <span className="font-semibold text-chalk">No picks are sold, promoted or
                pushed.</span>{" "}
                There is no lock of the week, no suggested stake and no unit-size advice on the
                edges page — the stake sizing that used to sit there implied an edge the backtest
                could not find, so it was taken out.
              </li>
              <li>
                <span className="font-semibold text-chalk">Trends are walled off from the model.</span>{" "}
                &ldquo;7–2 against the spread as a road dog after a bye&rdquo; is noise. It is on
                the game card because it is fun to argue about, and it never touches a number.
              </li>
              <li>
                <span className="font-semibold text-chalk">Nothing is retroactive.</span> Every
                model parameter change is fitted, recorded and dated in a changelog, and no
                prediction already frozen is ever re-priced under a new version.
              </li>
              <li>
                <span className="font-semibold text-chalk">No money moves through this site.</span>{" "}
                It is a scoreboard and a set of books. Your group settles up the way it always did.
              </li>
            </ul>
          </div>
        </Section>

        {/* ---- 06 on the phone ----------------------------------------- */}
        <Section id="phone" className="pb-16">
          <SectionHead
            n="06"
            eyebrow="Where you'll use it"
            title="Built for a phone, in a dim room, for six hours"
            id="phone"
            lede="This was designed for one hand on a couch with a TV on, and the constraints show."
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="card p-5">
              <h3 className="text-base font-semibold text-chalk">Installs like an app</h3>
              <p className="mt-2 text-sm leading-relaxed text-dim">
                Add it to your home screen and it opens full-screen with its own dark splash —
                no browser bar, no white flash. It is a website, so there is nothing to update.
              </p>
            </div>
            <div className="card p-5">
              <h3 className="text-base font-semibold text-chalk">Tells you when it matters</h3>
              <p className="mt-2 text-sm leading-relaxed text-dim">
                Optional push notifications: picks due before the wave kicks off, a nudge to log
                what you bet, and bad beats live off the scoreboard as they happen.
              </p>
            </div>
            <div className="card p-5">
              <h3 className="text-base font-semibold text-chalk">Never loses your place</h3>
              <p className="mt-2 text-sm leading-relaxed text-dim">
                Scores change in place. A 9 becoming a 10 shifts nothing on the page, and a refresh
                mid-scroll never throws you back to the top. Dark by default, light if you want it.
              </p>
            </div>
          </div>
        </Section>

        {/* ---- close --------------------------------------------------- */}
        <Section id="join" className="pb-4">
          <div className="card p-6 text-center sm:p-10">
            <h2 id="join" className="scroll-mt-20 text-balance text-2xl sm:text-3xl">
              Have a look before you ask
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-dim">
              The demo is a Saturday mid-afternoon with three games live — the hub, the slate, the
              cards, the money. Nothing is behind a form. If it looks like something you&rsquo;d
              keep open all day, ask for an invite; the site is invite-only and stays that way.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <PrimaryCta href="/demo">See a live Saturday →</PrimaryCta>
              <SecondaryCta href={INVITE_MAILTO}>Ask for an invite</SecondaryCta>
            </div>
            <p className="mt-4 text-xs text-dim">
              Or{" "}
              <Link href="/slate" className="text-accent hover:underline">
                browse this week&rsquo;s real slate
              </Link>{" "}
              — most of the site is readable without an account.
            </p>
          </div>
        </Section>
      </main>

      <WelcomeFooter />
    </div>
  );
}
