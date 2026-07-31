"use client";

import { useAuth } from '@/providers/auth-provider';

export default function DashboardPage() {
  const { user, signOut } = useAuth();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-16">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Protected area</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Welcome to your dashboard</h1>
        <p className="mt-3 text-sm text-slate-600">
          Authenticated user: <span className="font-medium text-slate-900">{user?.email ?? 'Unknown'}</span>
        </p>
        <button
          onClick={() => signOut()}
          className="mt-6 rounded-lg bg-slate-900 px-4 py-2.5 font-medium text-white transition hover:bg-slate-700"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
