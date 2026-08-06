import { AppNav } from "../components/AppNav";

/** Root-level loading state: nav shell + content skeleton, zero layout shift. */
export default function Loading() {
  return (
    <>
      <AppNav />
      <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 py-6" aria-busy>
        <span className="skeleton block h-8 w-40" />
        <span className="skeleton mt-6 block h-24 w-full rounded-xl" />
        <span className="skeleton mt-4 block h-64 w-full rounded-xl" />
      </main>
    </>
  );
}
