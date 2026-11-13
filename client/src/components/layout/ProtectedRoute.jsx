import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { EmptyState, Spinner } from '../common/ui';

/**
 * Client-side route guard. This is a UX layer only: every API call is authorised again on the server.
 * `permission` is a backend permission key such as "audit:read"; `roles` optionally restricts by role.
 */
export default function ProtectedRoute({ children, permission, roles }) {
  const { user, loading, can } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner label="Checking your session…" className="min-h-screen" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if ((permission && !can(permission)) || (roles && !roles.includes(user.role))) {
    return <EmptyState icon={ShieldAlert} title="You do not have access to this page">Your role ({user.role.replace('_', ' ')}) is not permitted to view this area. Contact an administrator if you need access.</EmptyState>;
  }
  return children;
}
