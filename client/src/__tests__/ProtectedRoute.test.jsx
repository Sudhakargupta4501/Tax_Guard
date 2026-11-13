import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../components/layout/ProtectedRoute';

const mockAuth = vi.fn();
vi.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth() }));

const setup = (auth, props = {}) => {
  mockAuth.mockReturnValue({ can: (p) => (auth.permissions || []).includes(p), ...auth });
  return render(
    <MemoryRouter initialEntries={['/secret']}>
      <Routes>
        <Route path="/login" element={<p>Login page</p>} />
        <Route path="/secret" element={<ProtectedRoute {...props}><p>Secret content</p></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>
  );
};

describe('ProtectedRoute', () => {
  it('redirects anonymous users to /login', () => {
    setup({ user: null, loading: false });
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('shows a loading state while the session is being restored', () => {
    setup({ user: null, loading: true });
    expect(screen.getByText(/checking your session/i)).toBeInTheDocument();
  });

  it('renders children for an authorised user', () => {
    setup({ user: { role: 'admin' }, loading: false, permissions: ['audit:read'] }, { permission: 'audit:read' });
    expect(screen.getByText('Secret content')).toBeInTheDocument();
  });

  it('blocks a user whose role lacks the permission', () => {
    setup({ user: { role: 'reviewer' }, loading: false, permissions: [] }, { permission: 'audit:read' });
    expect(screen.queryByText('Secret content')).not.toBeInTheDocument();
    expect(screen.getByText(/do not have access/i)).toBeInTheDocument();
  });
});
