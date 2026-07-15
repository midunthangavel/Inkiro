import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the api module (@/lib/api)
vi.mock('@/lib/api', () => ({
  default: { post: vi.fn() },
}));

import api   from '@/lib/api';
import Login from '@/pages/Login';

describe('Login page', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  test('renders the phone step initially', () => {
    render(<Login onLogin={vi.fn()} />);
    expect(screen.getByPlaceholderText(/98765/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send otp/i })).toBeInTheDocument();
  });

  test('rejects a phone shorter than 10 digits with an inline error', async () => {
    const user = userEvent.setup();
    render(<Login onLogin={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(/98765/), '12345');
    await user.click(screen.getByRole('button', { name: /send otp/i }));

    expect(await screen.findByText(/valid 10-digit phone/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  test('successful send-otp moves to the OTP step and shows the dev_otp hint', async () => {
    api.post.mockResolvedValueOnce({ data: { dev_otp: '123456' } });
    const user = userEvent.setup();
    render(<Login onLogin={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(/98765/), '9876540002');
    await user.click(screen.getByRole('button', { name: /send otp/i }));

    expect(api.post).toHaveBeenCalledWith('/auth/send-otp', {
      phone: '9876540002',
      role:  'shop',
    });
    expect(await screen.findByText(/Dev build/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify/i })).toBeInTheDocument();
  });

  test('successful verify-otp calls onLogin with user + token', async () => {
    api.post
      .mockResolvedValueOnce({ data: { dev_otp: '123456' } })                                // send-otp
      .mockResolvedValueOnce({ data: { user: { id: 'u1' }, token: 'jwt.xxx' } });             // verify-otp

    const onLogin = vi.fn();
    const user    = userEvent.setup();
    render(<Login onLogin={onLogin} />);

    await user.type(screen.getByPlaceholderText(/98765/), '9876540002');
    await user.click(screen.getByRole('button', { name: /send otp/i }));
    await screen.findByRole('button', { name: /verify/i });

    // dev_otp auto-fills the code in state; Verify button becomes enabled
    await user.click(screen.getByRole('button', { name: /verify/i }));

    expect(api.post).toHaveBeenLastCalledWith('/auth/verify-otp', {
      phone: '9876540002',
      code:  '123456',
      role:  'shop',
    });
    expect(onLogin).toHaveBeenCalledWith({ user: { id: 'u1' }, token: 'jwt.xxx' });
  });

  test('surfaces server error from verify-otp', async () => {
    api.post
      .mockResolvedValueOnce({ data: { dev_otp: '123456' } })
      .mockRejectedValueOnce({ response: { data: { error: 'Invalid OTP' } } });

    const user = userEvent.setup();
    render(<Login onLogin={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(/98765/), '9876540002');
    await user.click(screen.getByRole('button', { name: /send otp/i }));
    await screen.findByRole('button', { name: /verify/i });
    await user.click(screen.getByRole('button', { name: /verify/i }));

    expect(await screen.findByText(/invalid otp/i)).toBeInTheDocument();
  });

  test('shows a generic error when send-otp network fails', async () => {
    api.post.mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();
    render(<Login onLogin={vi.fn()} />);

    await user.type(screen.getByPlaceholderText(/98765/), '9876540002');
    await user.click(screen.getByRole('button', { name: /send otp/i }));

    expect(await screen.findByText(/failed to send otp/i)).toBeInTheDocument();
  });
});
