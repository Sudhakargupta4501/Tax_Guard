import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { registerSchema } from '../schemas';
import { applyServerErrors } from '../services/api';
import { Alert, Field, SubmitButton } from '../components/common/ui';

export default function Register() {
  const { register: signUp, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [serverError, setServerError] = useState('');
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
  });
  if (isAuthenticated) return <Navigate to="/" replace />;

  const onSubmit = async ({ name, email, password }) => {
    setServerError('');
    try {
      await signUp({ name, email, password });
      navigate('/', { replace: true });
    } catch (e) {
      if (e.status === 409) setError('email', { type: 'server', message: 'An account with this email already exists' });
      else if (!applyServerErrors(e, setError)) setServerError(e.message);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white"><ShieldCheck className="h-6 w-6" aria-hidden="true" /></span>
          <h1 className="text-2xl font-semibold text-slate-900">Create your account</h1>
          <p className="mt-1 text-slate-500">New accounts get the Accountant role. Administrators can change roles later.</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="card space-y-4 p-6" aria-label="Create account">
          {serverError && <Alert tone="error">{serverError}</Alert>}
          <Field label="Full name" error={errors.name} required><input autoComplete="name" className={`input ${errors.name ? 'input-error' : ''}`} {...register('name')} /></Field>
          <Field label="Email" error={errors.email} required><input type="email" autoComplete="email" className={`input ${errors.email ? 'input-error' : ''}`} {...register('email')} /></Field>
          <Field label="Password" error={errors.password} hint="8+ characters with upper-case, lower-case and a number." required>
            <div className="relative">
              <input type={show ? 'text' : 'password'} autoComplete="new-password" className={`input pr-10 ${errors.password ? 'input-error' : ''}`} {...register('password')} />
              <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 px-3 text-slate-500">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
            </div>
          </Field>
          <Field label="Confirm password" error={errors.confirmPassword} required><input type={show ? 'text' : 'password'} autoComplete="new-password" className={`input ${errors.confirmPassword ? 'input-error' : ''}`} {...register('confirmPassword')} /></Field>
          <SubmitButton busy={isSubmitting}>{isSubmitting ? 'Creating account…' : 'Create account'}</SubmitButton>
          <p className="text-center text-slate-500">Already registered? <Link to="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link></p>
        </form>
      </div>
    </div>
  );
}
