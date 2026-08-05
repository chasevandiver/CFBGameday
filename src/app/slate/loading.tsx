import { AppNav } from "../../components/AppNav";
import { SkeletonSlate } from "../../components/slate/SlateView";

export default function SlateLoading() {
  return (
    <>
      <AppNav />
      <main className="w-full flex-1 px-4">
        <div className="mx-auto flex max-w-7xl items-center gap-3 py-3">
          <span className="skeleton h-8 w-28" />
          <span className="skeleton h-8 w-40" />
          <span className="skeleton ml-auto h-4 w-24" />
        </div>
        <div className="mx-auto mt-2 max-w-7xl">
          <SkeletonSlate />
        </div>
      </main>
    </>
  );
}
