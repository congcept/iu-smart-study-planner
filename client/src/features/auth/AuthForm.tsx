import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { LoginSchema, RegisterSchema, type UserRole } from '@iu-study-planner/shared';
import { Button, Card } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { getDemoLoginStatus } from '@/lib/api';
import { authErrorMessage } from './errors';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const { user, login, register, demoLogin } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const isRegister = mode === 'register';
  const [demoEnabled, setDemoEnabled] = useState(false);

  useEffect(() => {
    if (isRegister) return;
    let active = true;
    void getDemoLoginStatus()
      .then(({ enabled }) => {
        if (active) setDemoEnabled(enabled);
      })
      .catch(() => {
        /* Normal sign-in stays available if demo access cannot be checked. */
      });
    return () => {
      active = false;
    };
  }, [isRegister]);
  const title = isRegister ? 'Create account' : 'Sign in';
  const inputClass =
    'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500';

  if (user) return <Navigate to="/curriculum" replace />;

  async function signInDemo(role: UserRole) {
    if (isSubmitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await demoLogin({ role });
    } catch (caught) {
      setError(authErrorMessage(caught, 'Could not sign in to the demo. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    const form = new FormData(event.currentTarget);
    const credentials = {
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    };
    const parsed = isRegister
      ? {
          mode: 'register' as const,
          result: RegisterSchema.safeParse({
            ...credentials,
            studentId: String(form.get('studentId') ?? ''),
            name: String(form.get('name') ?? ''),
          }),
        }
      : { mode: 'login' as const, result: LoginSchema.safeParse(credentials) };
    if (!parsed.result.success) {
      setError(parsed.result.error.issues[0].message);
      return;
    }
    setSubmitting(true);
    try {
      if (parsed.mode === 'register') await register(parsed.result.data);
      else await login(parsed.result.data);
    } catch (caught) {
      setError(authErrorMessage(caught, 'Could not sign in. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md py-8">
      <Card>
        <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
        <p className="mt-2 text-sm text-gray-600">
          {isRegister
            ? 'Create your own student account to use the planner.'
            : 'Welcome back to IU Smart Study Planner.'}
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <fieldset disabled={isSubmitting} className="space-y-4">
            {isRegister && (
              <>
                <label className="block text-sm font-medium text-gray-700" htmlFor="studentId">
                  Student ID
                  <input
                    className={inputClass}
                    id="studentId"
                    name="studentId"
                    autoComplete="off"
                    required
                    maxLength={64}
                  />
                </label>
                <label className="block text-sm font-medium text-gray-700" htmlFor="name">
                  Full name
                  <input
                    className={inputClass}
                    id="name"
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={200}
                  />
                </label>
              </>
            )}
            <label className="block text-sm font-medium text-gray-700" htmlFor="email">
              Email
              <input
                className={inputClass}
                id="email"
                name="email"
                type="email"
                autoComplete={isRegister ? 'email' : 'username'}
                required
                maxLength={254}
              />
            </label>
            <label className="block text-sm font-medium text-gray-700" htmlFor="password">
              Password
              <input
                className={inputClass}
                id="password"
                name="password"
                type="password"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                required
                minLength={8}
                aria-describedby={isRegister ? 'password-help' : undefined}
              />
            </label>
            {isRegister && (
              <p id="password-help" className="text-sm text-gray-500">
                Use at least 8 characters.
              </p>
            )}
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" isLoading={isSubmitting}>
              {isSubmitting ? 'Please wait…' : title}
            </Button>
          </fieldset>
        </form>
        {demoEnabled && (
          <div className="mt-5 border-t border-gray-200 pt-4">
            <p className="mb-3 text-sm text-gray-600">Try a simulated account:</p>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                disabled={isSubmitting}
                onClick={() => void signInDemo('STUDENT')}
              >
                Demo student
              </Button>
              <Button
                variant="secondary"
                disabled={isSubmitting}
                onClick={() => void signInDemo('ADMIN')}
              >
                Demo school admin
              </Button>
            </div>
          </div>
        )}
        <p className="mt-5 text-center text-sm text-gray-600">
          {isRegister ? 'Already have an account? ' : 'New here? '}
          <Link
            to={isRegister ? '/login' : '/register'}
            className="font-medium text-primary-700 underline"
          >
            {isRegister ? 'Sign in' : 'Create account'}
          </Link>
        </p>
        <p className="mt-3 text-center text-sm">
          <Link to="/" className="text-gray-600 underline">
            Explore the demo curriculum
          </Link>
        </p>
      </Card>
    </div>
  );
}
