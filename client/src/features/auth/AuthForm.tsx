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
  const [demoError, setDemoError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{
    field: 'studentId' | 'name' | 'email' | 'password';
    message: string;
  } | null>(null);
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
    'mt-1 block min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500';

  if (user) return <Navigate to="/curriculum" replace />;

  async function signInDemo(role: UserRole) {
    if (isSubmitting) return;
    setError(null);
    setFieldError(null);
    setDemoError(null);
    setSubmitting(true);
    try {
      await demoLogin({ role });
    } catch (caught) {
      setDemoError(authErrorMessage(caught, 'Could not sign in to the demo. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setFieldError(null);
    setDemoError(null);
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
      const issue = parsed.result.error.issues[0];
      const field = issue.path[0];
      let message: string;
      if (field === 'password') {
        message =
          issue.code === 'custom'
            ? 'Password is too long. Shorten it to 72 bytes or less; accented letters and emoji use more space.'
            : 'Use at least 8 characters for your password.';
      } else if (field === 'email') {
        message = 'Enter a valid email address, such as name@example.com.';
      } else {
        message = field === 'studentId' ? 'Enter your student ID.' : 'Enter your full name.';
      }
      const errorField =
        field === 'studentId' || field === 'name' || field === 'email' || field === 'password'
          ? field
          : 'email';
      setFieldError({ field: errorField, message });
      event.currentTarget.querySelector<HTMLInputElement>(`[name="${errorField}"]`)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      if (parsed.mode === 'register') await register(parsed.result.data);
      else await login(parsed.result.data);
    } catch (caught) {
      setError(
        authErrorMessage(
          caught,
          isRegister
            ? 'Could not create your account. Please try again.'
            : 'Could not sign in. Please try again.',
        ),
      );
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
            ? 'Save completed and planned courses to your student account.'
            : 'View and update your saved course progress.'}
        </p>
        <form
          onSubmit={submit}
          onChange={() => {
            setError(null);
            setFieldError(null);
          }}
          className="mt-6 space-y-4"
        >
          <p className="text-sm text-gray-600">All fields are required.</p>
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
                    aria-invalid={fieldError?.field === 'studentId'}
                    aria-describedby={
                      fieldError?.field === 'studentId' ? 'studentId-error' : undefined
                    }
                  />
                </label>
                {fieldError?.field === 'studentId' && (
                  <p id="studentId-error" role="alert" className="text-sm text-red-700">
                    {fieldError.message}
                  </p>
                )}
                <label className="block text-sm font-medium text-gray-700" htmlFor="name">
                  Full name
                  <input
                    className={inputClass}
                    id="name"
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={200}
                    aria-invalid={fieldError?.field === 'name'}
                    aria-describedby={fieldError?.field === 'name' ? 'name-error' : undefined}
                  />
                </label>
                {fieldError?.field === 'name' && (
                  <p id="name-error" role="alert" className="text-sm text-red-700">
                    {fieldError.message}
                  </p>
                )}
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
                aria-invalid={fieldError?.field === 'email'}
                aria-describedby={fieldError?.field === 'email' ? 'email-error' : undefined}
              />
            </label>
            {fieldError?.field === 'email' && (
              <p id="email-error" role="alert" className="text-sm text-red-700">
                {fieldError.message}
              </p>
            )}
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
                aria-invalid={fieldError?.field === 'password'}
                aria-describedby={
                  [
                    isRegister && 'password-help',
                    fieldError?.field === 'password' && 'password-error',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
              />
            </label>
            {isRegister && (
              <p id="password-help" className="text-sm text-gray-500">
                Use at least 8 characters, up to 72 bytes. Accented letters and emoji use more than
                one byte.
              </p>
            )}
            {fieldError?.field === 'password' && (
              <p id="password-error" role="alert" className="text-sm text-red-700">
                {fieldError.message}
              </p>
            )}
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" isLoading={isSubmitting}>
              {isSubmitting ? (isRegister ? 'Creating account…' : 'Signing in…') : title}
            </Button>
          </fieldset>
        </form>
        {demoEnabled && (
          <div className="mt-5 border-t border-gray-200 pt-4">
            <p className="mb-3 text-sm text-gray-600">Sign in with a shared demo account:</p>
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
            {demoError && (
              <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {demoError}
              </p>
            )}
            <p className="mt-3 text-sm text-gray-600">
              Both roles open the curriculum. The admin dashboard is not available yet.
            </p>
          </div>
        )}
        <p className="mt-5 text-center text-sm text-gray-600">
          {isRegister ? 'Already have an account? ' : 'Need an account? '}
          <Link
            to={isRegister ? '/login' : '/register'}
            className="font-medium text-primary-700 underline"
          >
            {isRegister ? 'Sign in' : 'Create account'}
          </Link>
        </p>
        <p className="mt-3 text-center text-sm">
          <Link to="/" className="text-gray-600 underline">
            Explore the curriculum without an account
          </Link>
        </p>
      </Card>
    </div>
  );
}
