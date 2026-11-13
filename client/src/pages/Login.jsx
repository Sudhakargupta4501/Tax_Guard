import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { loginSchema } from '../schemas';
import { Alert, Field, SubmitButton } from '../components/common/ui';

export default function Login() {
  const { login, isAuthenticated, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [show, setShow] = useState(false);
  const [serverError, setServerError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const from = location.state?.from?.pathname || '/';
  if (isAuthenticated) return <Navigate to={from} replace />;

  const onSubmit = async ({ email, password }) => {
    setServerError('');
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (e) {
      setServerError(e.message);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white"><ShieldCheck className="h-6 w-6" aria-hidden="true" /></span>
          <h1 className="text-2xl font-semibold text-slate-900">Sign in to TaxGuard AI</h1>
          <p className="mt-1 text-slate-500">Billing management and fraud-risk review</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="card space-y-4 p-6" aria-label="Sign in">
          {sessionExpired && <Alert tone="warning">Your session has expired. Please sign in again.</Alert>}
          {serverError && <Alert tone="error">{serverError}</Alert>}
          <Field label="Email" error={errors.email} required>
            <input type="email" autoComplete="email" className={`input ${errors.email ? 'input-error' : ''}`} {...register('email')} />
          </Field>
          <Field label="Password" error={errors.password} required>
            <div className="relative">
              <input type={show ? 'text' : 'password'} autoComplete="current-password" className={`input pr-10 ${errors.password ? 'input-error' : ''}`} {...register('password')} />
              <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 px-3 text-slate-500 hover:text-slate-700">
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <SubmitButton busy={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</SubmitButton>
          <p className="text-center text-slate-500">No account? <Link to="/register" className="font-medium text-brand-700 hover:underline">Create one</Link></p>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">Educational project. Not a substitute for professional tax advice.</p>
      </div>
    </div>
  );
}
