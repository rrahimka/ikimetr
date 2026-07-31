import { AuthForm } from '@/components/auth/auth-form';

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-16">
      <AuthForm mode="sign-up" />
    </main>
  );
}
