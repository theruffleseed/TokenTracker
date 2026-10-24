export default function DashboardLoading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading dashboard">
      <div className="h-3 w-20 rounded bg-slate-200" />
      <div className="mt-3 h-8 w-64 rounded bg-slate-200" />
      <div className="mt-2 h-4 w-96 max-w-full rounded bg-slate-200" />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="card h-[76px] px-4 py-3">
            <div className="h-3 w-24 rounded bg-slate-100" />
            <div className="mt-3 h-5 w-16 rounded bg-slate-200" />
          </div>
        ))}
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="card h-[340px]" />
        ))}
      </div>
    </div>
  );
}
