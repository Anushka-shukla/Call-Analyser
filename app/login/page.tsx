'use client';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function LoginBox() {
  const error = useSearchParams().get('error');
  return (
    <div className="login-box">
      <h1>Call analyzer</h1>
      <p>Sign in with your work Google account to see today's customer calls.</p>
      {error && <p style={{ color: 'var(--red)' }}>That account isn't allowed. Use your company email.</p>}
      <button className="btn" onClick={() => signIn('google', { callbackUrl: '/' })}>Sign in with Google</button>
    </div>
  );
}

export default function Login() {
  return (
    <main className="page login">
      <Suspense><LoginBox /></Suspense>
    </main>
  );
}
