"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useAuth } from '@/providers/auth-provider';

interface AuthFormProps {
  mode: 'sign-in' | 'sign-up' | 'forgot-password' | 'reset-password';
}

function getFriendlyAuthError(message: string | undefined) {
  if (!message) {
    return 'Unable to complete the request right now. Please try again.';
  }

  if (message.includes('Invalid login credentials') || message.includes('Invalid login')) {
    return 'The email or password is incorrect.';
  }

  if (message.includes('Email not confirmed')) {
    return 'Please confirm your email before signing in.';
  }

  if (message.includes('already registered') || message.includes('already exists')) {
    return 'An account with this email already exists.';
  }

  if (message.includes('Password') && message.includes('least')) {
    return 'Password must be at least 8 characters long.';
  }

  return 'Unable to complete the request right now. Please try again.';
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const { signIn, signUp, resetPassword, updatePassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isPasswordMode = mode === 'sign-in' || mode === 'sign-up' || mode === 'reset-password';
  const isSignupMode = mode === 'sign-up';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const trimmedEmail = email.trim();
    const trimmedDisplayName = displayName.trim();

    try {
      if (mode === 'sign-in') {
        if (!trimmedEmail || !password) {
          setError('Please enter your email and password.');
          return;
        }

        const { error } = await signIn(trimmedEmail, password);
        if (error) {
          setError(getFriendlyAuthError(error.message));
        } else {
          setMessage('Signed in successfully.');
          router.replace('/dashboard');
        }
      } else if (mode === 'sign-up') {
        if (!trimmedEmail || !password || !confirmPassword) {
          setError('Please complete every required field.');
          return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
          setError('Please enter a valid email address.');
          return;
        }

        if (password.length < 8) {
          setError('Password must be at least 8 characters long.');
          return;
        }

        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          return;
        }

        if (trimmedDisplayName.length < 2) {
          setError('Please enter a display name with at least 2 characters.');
          return;
        }

        const { error } = await signUp(trimmedEmail, password, trimmedDisplayName);
        if (error) {
          setError(getFriendlyAuthError(error.message));
        } else {
          setMessage('Account created. Please check your inbox to confirm your email.');
          router.replace('/auth/sign-in');
        }
      } else if (mode === 'forgot-password') {
        if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
          setError('Please enter a valid email address.');
          return;
        }

        const { error } = await resetPassword(trimmedEmail);
        if (error) {
          setError(getFriendlyAuthError(error.message));
        } else {
          setMessage('If an account exists for this email, a reset link has been sent.');
        }
      } else if (mode === 'reset-password') {
        if (!password || !confirmPassword) {
          setError('Please enter and confirm your new password.');
          return;
        }

        if (password.length < 8) {
          setError('Password must be at least 8 characters long.');
          return;
        }

        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          return;
        }

        const { error } = await updatePassword(password);
        if (error) {
          setError(getFriendlyAuthError(error.message));
        } else {
          setMessage('Password updated successfully.');
          router.replace('/dashboard');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const footerLinks = useMemo(() => {
    const links = [];
    if (mode !== 'sign-up') {
      links.push({ href: '/auth/sign-up', label: 'Create account' });
    }
    if (mode !== 'sign-in') {
      links.push({ href: '/auth/sign-in', label: 'Sign in' });
    }
    if (mode !== 'forgot-password' && mode !== 'reset-password') {
      links.push({ href: '/auth/forgot-password', label: 'Forgot password?' });
    }
    return links;
  }, [mode]);

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="mb-6 space-y-2">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
          {mode === 'sign-in' && 'Sign in'}
          {mode === 'sign-up' && 'Create account'}
          {mode === 'forgot-password' && 'Reset password'}
          {mode === 'reset-password' && 'Set new password'}
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">
          {mode === 'sign-in' && 'Welcome back'}
          {mode === 'sign-up' && 'Start with IkiMetr'}
          {mode === 'forgot-password' && 'Recover access'}
          {mode === 'reset-password' && 'Choose a new password'}
        </h1>
      </div>

      {error ? <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {message ? <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p> : null}

      <div className="space-y-4">
        {(mode === 'sign-up' || mode === 'sign-in' || mode === 'forgot-password') && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
            />
          </div>
        )}

        {isSignupMode && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="displayName">Display name</label>
            <input
              id="displayName"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
            />
          </div>
        )}

        {isPasswordMode && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={isSignupMode ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
            />
          </div>
        )}

        {(isSignupMode || mode === 'reset-password') && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="confirmPassword">Confirm password</label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete={isSignupMode ? 'new-password' : 'current-password'}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-slate-900 px-4 py-2.5 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : mode === 'sign-up' ? 'Create account' : mode === 'forgot-password' ? 'Send reset link' : 'Update password'}
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        {footerLinks.map((link) => (
          <Link key={link.href} href={link.href} className="font-medium text-slate-900 hover:underline">
            {link.label}
          </Link>
        ))}
      </div>
    </form>
  );
}
