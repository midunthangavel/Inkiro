import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { InkCard, InkButton, InkPill } from '../components/ink';
import { rupees } from '../lib/tokens';
function shortId(id)   { return id ? `#${String(id).replace(/-/g, '').slice(0, 6).toUpperCase()}` : '#------'; }
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const STATUSES = ['', 'pending', 'accepted', 'pending_runner', 'runner_assigned', 'picked_up', 'delivered', 'declined', 'cancelled', 'expired'];

const STATUS_PILL = {
  pending:         { label: 'BROADCASTING',    color: 'rose'  },
  pending_runner:  { label: 'PENDING RUNNER',  color: 'amber' },
  runner_notified: { label: 'PENDING RUNNER',  color: 'amber' },
  runner_assigned: { label: 'RUNNER ASSIGNED', color: 'amber' },
  accepted:        { label: 'ACCEPTED',        color: 'amber' },
  picked_up:       { label: 'EN-ROUTE',        color: 'amber' },
  delivered:       { label: 'DELIVERED',       color: 'mint'  },
  declined:        { label: 'DECLINED',        color: 'rose'  },
  cancelled:       { label: 'CANCELLED',       color: 'rose'  },
  expired:         { label: 'EXPIRED',         color: 'ink'   },
};

export default function OrdersPage({ runners }) {
  const [filter, setFilter]           = useState('');
  const [assignModal, setAssignModal] = useState(null);
  const [runnerId, setRunnerId]       = useState('');
  const [noteModal, setNoteModal]     = useState(null);
  const [noteText, setNoteText]       = useState('');
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['orders', filter],
    queryFn:  () => api.get('/admin/orders', { params: filter ? { status: filter } : {} }).then(r => r.data),
    refetchInterval: 20000,
  });

  const assign = useMutation({
    mutationFn: ({ order_id, runner_id }) => api.post('/admin/assign-runner', { order_id, runner_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      setAssignModal(null);
      setRunnerId('');
    },
  });

  const saveNote = useMutation({
    mutationFn: ({ id, note }) => api.put(`/admin/orders/${id}/note`, { note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      setNoteModal(null);
    },
  });

  return (
    <>
      <div className="flex items-end justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 style={{ fontFamily: 'Instrument Serif', fontSize: 30, lineHeight: '32px', color: 'var(--color-ink)' }}>
            Orders
          </h1>
          <div className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mt-1">
            {data?.orders?.length ?? 0} total
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {STATUSES.map(s => {
            const active = filter === s;
            return (
              <button
                key={s || 'all'}
                onClick={() => setFilter(s)}
                className="px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition"
                style={{
                  backgroundColor: active ? 'var(--color-ink)' : 'var(--color-paper-sunk)',
                  color: active ? 'var(--color-paper)' : 'var(--color-ink-soft)',
                }}
              >
                {s ? s.replace('_', ' ') : 'All'}
              </button>
            );
          })}
        </div>
      </div>

      {isLoading && (
        <div className="animate-pulse space-y-2">
          {[0,1,2,3,4].map(i => <div key={i} className="h-12 rounded-xl bg-paper-elev" />)}
        </div>
      )}
      {error     && <p className="text-rose text-sm">Failed to load orders</p>}

      {data && (
        <InkCard className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-bold text-ink-muted uppercase tracking-wider bg-paper-sunk">
                <th className="text-left px-4 py-2.5">ID</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Items</th>
                <th className="text-left px-4 py-2.5">Amount</th>
                <th className="text-left px-4 py-2.5">Created</th>
                <th className="text-left px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map(o => {
                const pill = STATUS_PILL[o.status] || { label: o.status, color: 'ink' };
                const canAssign = o.status === 'accepted' && !o.runner_id;
                return (
                  <tr key={o.id} className="border-t border-hair">
                    <td className="px-4 py-3 font-mono text-[12px] text-ink font-bold">{shortId(o.id)}</td>
                    <td className="px-4 py-3"><InkPill color={pill.color}>{pill.label}</InkPill></td>
                    <td className="px-4 py-3 text-ink-soft max-w-xs truncate">
                      {Array.isArray(o.items)
                        ? o.items.map(i => `${i.name} ×${i.quantity}`).join(', ')
                        : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-ink">
                      {rupees((o.platform_fee_paise || 0) + (o.delivery_fee_paise || 0))}
                    </td>
                    <td className="px-4 py-3 text-ink-muted whitespace-nowrap">{fmtDate(o.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {canAssign && (
                          <InkButton variant="accent" size="sm" onClick={() => { setAssignModal(o); setRunnerId(''); }}>
                            Assign runner
                          </InkButton>
                        )}
                        <button
                          title={o.admin_note || 'Add note'}
                          onClick={() => { setNoteModal(o); setNoteText(o.admin_note || ''); }}
                          className={`text-base leading-none transition ${o.admin_note ? 'opacity-100' : 'opacity-30 hover:opacity-70'}`}
                        >
                          🗒️
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {data.orders.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-muted text-sm">No orders found</td></tr>
              )}
            </tbody>
          </table>
        </InkCard>
      )}

      {noteModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <InkCard className="w-full max-w-sm p-6">
            <h3 className="text-ink font-bold">Dispute note</h3>
            <p className="text-[11px] font-mono text-ink-muted mt-0.5">Order {shortId(noteModal.id)}</p>
            <textarea
              className="w-full mt-4 bg-paper-sunk border border-hair rounded-xl px-3 py-2 text-sm text-ink outline-none resize-none"
              rows={4}
              placeholder="e.g. Customer reported missing item. Refund issued."
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              maxLength={500}
              autoFocus
            />
            <div className="flex gap-2 mt-3">
              <InkButton variant="ghost" full size="md" onClick={() => setNoteModal(null)}>Cancel</InkButton>
              <InkButton
                variant="accent"
                full size="md"
                disabled={saveNote.isPending}
                onClick={() => saveNote.mutate({ id: noteModal.id, note: noteText })}
              >
                {saveNote.isPending ? 'Saving…' : 'Save note'}
              </InkButton>
            </div>
            {saveNote.isError && <p className="text-rose text-xs mt-2">Failed to save</p>}
          </InkCard>
        </div>
      )}

      {assignModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <InkCard className="w-full max-w-sm p-6">
            <h3 className="text-ink font-bold">Assign runner</h3>
            <p className="text-[11px] font-mono text-ink-muted mt-0.5">Order {shortId(assignModal.id)}</p>

            <select
              className="w-full mt-4 bg-paper-sunk border border-hair rounded-xl px-3 py-2 text-sm text-ink outline-none"
              value={runnerId}
              onChange={e => setRunnerId(e.target.value)}
            >
              <option value="">Select an online runner…</option>
              {(runners || []).filter(r => r.is_available).map(r => (
                <option key={r.id} value={r.id}>{shortId(r.id)} · Available</option>
              ))}
            </select>

            <div className="flex gap-2 mt-4">
              <InkButton variant="ghost" full size="md" onClick={() => setAssignModal(null)}>Cancel</InkButton>
              <InkButton
                variant="accent"
                full size="md"
                disabled={!runnerId || assign.isPending}
                onClick={() => assign.mutate({ order_id: assignModal.id, runner_id: runnerId })}
              >
                {assign.isPending ? 'Assigning…' : 'Assign'}
              </InkButton>
            </div>
            {assign.isError && <p className="text-rose text-xs mt-2">Failed — {assign.error?.response?.data?.error}</p>}
          </InkCard>
        </div>
      )}
    </>
  );
}
