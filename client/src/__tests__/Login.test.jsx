import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Login from '../pages/Login';

const login = vi.fn();
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ login, isAuthenticated: false, sessionExpired: false }) }));

const renderLogin = () => render(<MemoryRouter><Login /></MemoryRouter>);

describe('Login page', () => {
  beforeEach(() => login.mockReset());

  it('shows validation errors and does not call the API for empty/invalid input', async () => {
    renderLogin();
    await userEvent.type(screen.getByLabelText(/^email/i), 'bad');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/valid email address/i)).toBeInTheDocument();
    expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('submits valid credentials', async () => {
    login.mockResolvedValue({ role: 'admin' });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/^email/i), 'user@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'Secret123');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(login).toHaveBeenCalledWith('user@example.com', 'Secret123'));
  });

  it('displays the server error when authentication fails', async () => {
    login.mockRejectedValue(new Error('Invalid email or password'));
    renderLogin();
    await userEvent.type(screen.getByLabelText(/^email/i), 'user@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'Wrong1234');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
  });

  it('toggles password visibility', async () => {
    renderLogin();
    const input = screen.getByLabelText(/^password/i);
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(input).toHaveAttribute('type', 'text');
  });
});
