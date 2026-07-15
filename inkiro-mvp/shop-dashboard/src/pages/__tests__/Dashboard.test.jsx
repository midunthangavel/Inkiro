import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

// Socket mock — capture registered handlers so tests can invoke them synthetically
const socketHandlers = new Map();
const socketMock = {
  connect:    vi.fn(),
  disconnect: vi.fn(),
  emit:       vi.fn(),
  on:         vi.fn((event, cb) => socketHandlers.set(event, cb)),
  off:        vi.fn((event) => socketHandlers.delete(event)),
};
vi.mock('@/lib/socket', () => ({
  getSocket: () => socketMock,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import api       from '@/lib/api';
import { toast } from 'sonner';
import Dashboard from '@/pages/Dashboard';

const SHOP = { id: 'shop-1', shop_name: 'TestShop' };
const USER = { id: 'u-1', phone: '9876540002' };

const pendingOrder = {
  id:                 'order-1',
  status:             'pending',
  total_amount_paise: 35000,
  items:              [{ name: 'Milk', quantity: 2, estimated_price_rupees: 30 }],
  customer_name:      'Alice',
  created_at:         new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  socketHandlers.clear();
});

// ─── Initial load ────────────────────────────────────────────────────────────

describe('Dashboard — initial load', () => {
  test('shows loading state before orders arrive, empty state after', async () => {
    let resolve;
    api.get.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    render(<Dashboard user={USER} shop={SHOP} onLogout={vi.fn()} />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    resolve({ data: { orders: [] } });
    expect(await screen.findByText(/waiting for orders/i)).toBeInTheDocument();
  });

  test('joins the shop room and registers order handlers on mount', async () => {
    api.get.mockResolvedValueOnce({ data: { orders: [] } });
    render(<Dashboard user={USER} shop={SHOP} onLogout={vi.fn()} />);

    await waitFor(() => {
      expect(socketMock.connect).toHaveBeenCalled();
      expect(socketMock.emit).toHaveBeenCalledWith('join:shop', 'shop-1');
    });

    expect(socketHandlers.has('order:new')).toBe(true);
    expect(socketHandlers.has('order:updated')).toBe(true);
  });

  test('shows error toast when order fetch fails', async () => {
    api.get.mockRejectedValueOnce(new Error('down'));
    render(<Dashboard user={USER} shop={SHOP} onLogout={vi.fn()} />);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load orders'));
  });
});

// ─── Order actions ───────────────────────────────────────────────────────────

describe('Dashboard — accept / decline', () => {
  test('renders a pending order card with the rupee total', async () => {
    api.get.mockResolvedValueOnce({ data: { orders: [pendingOrder] } });
    render(<Dashboard user={USER} shop={SHOP} onLogout={vi.fn()} />);

    expect(await screen.findByText(/₹350/)).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  test('accept button POSTs shop-respond with action=accept', async () => {
    api.get.mockResolvedValue({ data: { orders: [pendingOrder] } });
    api.post.mockResolvedValueOnce({ data: {} });

    const user = userEvent.setup();
    render(<Dashboard user={USER} shop={SHOP} onLogout={vi.fn()} />);

    const acceptBtn = await screen.findByRole('button', { name: /accept/i });
    await user.click(acceptBtn);

    expect(api.post).toHaveBeenCalledWith('/orders/order-1/shop-respond', { action: 'accept' });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Order accepted'));
  });

  test('decline button POSTs shop-respond with action=decline', async () => {
    api.get.mockResolvedValue({ data: { orders: [pendingOrder] } });
    api.post.mockResolvedValueOnce({ data: {} });

    const user = userEvent.setup();
    render(<Dashboard user={USER} shop={SHOP} onLogout={vi.fn()} />);

    const declineBtn = await screen.findByRole('button', { name: /decline/i });
    await user.click(declineBtn);

    expect(api.post).toHaveBeenCalledWith('/orders/order-1/shop-respond', { action: 'decline' });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Order declined'));
  });

  test('action failure surfaces server error in toast', async () => {
    api.get.mockResolvedValue({ data: { orders: [pendingOrder] } });
    api.post.mockRejectedValueOnce({ response: { data: { error: 'Already taken' } } });

    const user = userEvent.setup();
    render(<Dashboard user={USER} shop={SHOP} onLogout={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /accept/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Already taken'));
  });
});

// ─── Realtime socket events ──────────────────────────────────────────────────

describe('Dashboard — realtime', () => {
  test('order:new event appends the order and fires a success toast', async () => {
    api.get.mockResolvedValueOnce({ data: { orders: [] } });
    render(<Dashboard user={USER} shop={SHOP} onLogout={vi.fn()} />);

    await waitFor(() => expect(socketHandlers.has('order:new')).toBe(true));

    const liveOrder = {
      id:                 'live-1',
      status:             'pending',
      total_amount_paise: 50000,
      items:              [{ name: 'Rice', quantity: 1, estimated_price_rupees: 50 }],
      customer_name:      'Bob',
      created_at:         new Date().toISOString(),
    };
    socketHandlers.get('order:new')(liveOrder);

    expect(await screen.findByText(/Bob/)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/New order/i));
  });

  test('order:updated event replaces the matching order in-place', async () => {
    api.get.mockResolvedValueOnce({ data: { orders: [pendingOrder] } });
    render(<Dashboard user={USER} shop={SHOP} onLogout={vi.fn()} />);

    await waitFor(() => expect(socketHandlers.has('order:updated')).toBe(true));

    // Flip the order status to 'accepted' via socket; card should move out of New column
    socketHandlers.get('order:updated')({ ...pendingOrder, status: 'accepted' });

    await waitFor(() => {
      const accept = screen.queryByRole('button', { name: /accept/i });
      expect(accept).toBeNull();
    });
  });
});

// ─── Tab navigation ──────────────────────────────────────────────────────────

describe('Dashboard — navigation', () => {
  test('clicking "Settings" nav switches to settings view', async () => {
    api.get.mockResolvedValueOnce({ data: { orders: [] } });
    const user = userEvent.setup();
    render(<Dashboard user={USER} shop={SHOP} onLogout={vi.fn()} />);

    await waitFor(() => expect(socketMock.connect).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: /settings/i }));

    expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument();
    // Labels unique to the SettingsView (not present in the sidebar)
    expect(screen.getByText(/Shop name/i)).toBeInTheDocument();
    expect(screen.getByText(/Owner phone/i)).toBeInTheDocument();
  });

  test('clicking "Today" nav switches to today view', async () => {
    api.get.mockResolvedValueOnce({ data: { orders: [] } });
    const user = userEvent.setup();
    render(<Dashboard user={USER} shop={SHOP} onLogout={vi.fn()} />);

    await waitFor(() => expect(socketMock.connect).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: /Today's orders/i }));

    expect(screen.getByRole('heading', { name: /^Today$/i })).toBeInTheDocument();
  });
});
