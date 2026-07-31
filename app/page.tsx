import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 py-16 text-center">
      <div className="max-w-2xl rounded-3xl border border-slate-200 bg-white p-10 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">IkiMetr</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">Authentication foundation ready</h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          The app now includes Supabase-authenticated routes, protected navigation, password recovery, and a secure dashboard entry point.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/login" className="rounded-lg bg-slate-900 px-5 py-3 font-medium text-white transition hover:bg-slate-700">
            Sign in
          </Link>
          <Link href="/register" className="rounded-lg border border-slate-300 px-5 py-3 font-medium text-slate-900 transition hover:bg-slate-50">
            Create account
          </Link>
          <Link href="/properties/new" className="rounded-lg border border-slate-300 px-5 py-3 font-medium text-slate-900 transition hover:bg-slate-50">
            Create property
          </Link>
        </div>
      </div>
    </main>
  );
}