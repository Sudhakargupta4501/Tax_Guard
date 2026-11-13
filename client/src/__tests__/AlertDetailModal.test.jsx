import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AlertDetailModal from '../components/fraud/AlertDetailModal';
import { ToastProvider } from '../components/common/Toast';

const canMock = vi.fn();
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ can: canMock }) }));
vi.mock('../services/api', async () => {
  const actual = await vi.importActual('../services/api');
  return { ...actual, api: { get: vi.fn(), patch: vi.fn() } };
});
import { api } from '../services/api';

const alertBody = (status = 'New') => ({
  data: {
    categoryLabel: 'Duplicate Invoice',
    invoice: null,
    alert: {
      alertId: 'FA-0001', severity: 'High', riskScore: 82, reviewStatus: status, detectionMethod: 'rule-based', detectionVersion: 'rules-v1.0.0',
      detectedAt: '2026-10-01T10:00:00Z', description: 'Two invoices share the same customer, total and items.',
      triggeredRules: [{ ruleId: 'DUPLICATE_INVOICE', name: 'Duplicate invoice', weight: 70, detail: 'Same total within 7 days' }],
      history: [], reviewComments: [],
    },
  },
});

const renderModal = (onChanged = vi.fn()) => render(<ToastProvider><AlertDetailModal alertId="abc" onClose={() => {}} onChanged={onChanged} /></ToastProvider>);

describe('AlertDetailModal', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the explanation, risk score and triggered rule', async () => {
    canMock.mockReturnValue(true);
    api.get.mockResolvedValue(alertBody());
    renderModal();
    expect(await screen.findByText(/two invoices share the same customer/i)).toBeInTheDocument();
    expect(screen.getByText(/risk score 82\/100/i)).toBeInTheDocument();
    expect(screen.getByText(/DUPLICATE_INVOICE/)).toBeInTheDocument();
  });

  it('hides the review form from users without the review permission', async () => {
    canMock.mockReturnValue(false);
    api.get.mockResolvedValue(alertBody());
    renderModal();
    expect(await screen.findByText(/your role cannot change its status/i)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: /review alert/i })).not.toBeInTheDocument();
  });

  it('requires resolution notes, then PATCHes the review and notifies the parent', async () => {
    canMock.mockReturnValue(true);
    api.get.mockResolvedValue(alertBody());
    api.patch.mockResolvedValue({ message: 'Alert updated' });
    const onChanged = vi.fn();
    renderModal(onChanged);
    await screen.findByRole('form', { name: /review alert/i });

    await userEvent.selectOptions(screen.getByLabelText(/review status/i), 'False Positive');
    await userEvent.click(screen.getByRole('button', { name: /save review/i }));
    expect(await screen.findByText(/document the reason/i)).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/resolution notes/i), 'Verified with customer: legitimate repeat order');
    await userEvent.click(screen.getByRole('button', { name: /save review/i }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch.mock.calls[0][0]).toBe('/fraud-alerts/abc/review');
    expect(api.patch.mock.calls[0][1]).toMatchObject({ reviewStatus: 'False Positive' });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
