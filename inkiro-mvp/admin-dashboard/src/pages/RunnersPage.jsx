import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { InkButton, InkCard, InkPill } from '../components/ink';
import { rupees } from '../lib/tokens';

function shortId(id)  { return id ? `#${String(id).replace(/-/g, '').slice(0, 6).toUpperCase()}` : '#------'; }
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const VEHICLE_LABEL = { walk: '🚶 Walk', cycle: '🚲 Cycle', bike: '🛵 Bike' };

export default function RunnersPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['runners'],
    queryFn:  () => api.get('/admin/runners').then(r => r.data),
    refetchInterval: 15000,
  });

  const toggle = useMutation({
    mutationFn: ({ id, block }) => api.post(`/admin/runners/${id}/${block ? 'block' : 'unblock'}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['runners'] }),
  });

  const runners  = data?.runners || [];
  const online   = runners.filter(r => r.is_available).length;
  const verified = runners.filter(r => r.is_verified).length;
  const pending  = runners.filter(r => !r.is_verified).length;

  return (
    <>
      <div className="flex items-end justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 style={{ fontFamily: 'Instrument Serif', fontSize: 30, lineHeight: '32px', color: 'var(--color-ink)' }}>
            Runners
          </h1>
          <div className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mt-1">
            {runners.length} total
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <InkPill color="mint">Online · {online}</InkPill>
          <InkPill color="ink">Verified · {verified}</InkPill>
          {pending > 0 && <InkPill color="amber">⚠ Pending KYC · {pending}</InkPill>}
        </div>
      </div>

      {isLoading && (
        <div className="animate-pulse space-y-2">
          {[0,1,2,3,4].map(i => <div key={i} className="h-12 rounded-xl bg-paper-elev" />)}
        </div>
      )}
      {error && <p className="text-rose text-sm">Failed to load runners</p>}

      {data && (
        <InkCard className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-bold text-ink-muted uppercase tracking-wider bg-paper-sunk">
                <th className="text-left px-4 py-2.5">ID</th>
                <th className="text-left px-4 py-2.5">Vehicle</th>
                <th className="text-left px-4 py-2.5">KYC</th>
                <th className="text-left px-4 py-2.5">Lifetime</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Joined</th>
                <th className="text-left px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runners.map(r => (
                <tr key={r.id} className={`border-t border-hair ${r.is_blocked ? 'bg-rose-soft/30' : !r.is_verified ? 'bg-paper-sunk' : ''}`}>
                  <td className="px-4 py-3 font-mono text-[12px] text-ink font-bold">
                    {shortId(r.id)}
                    {r.is_blocked && <InkPill color="rose" className="ml-2">Blocked</InkPill>}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{VEHICLE_LABEL[r.vehicle_type] || '—'}</td>
                  <td className="px-4 py-3">
                    <InkPill color={r.is_verified ? 'mint' : 'amber'}>
                      {r.is_verified ? '✓' : '⚠ pending'}
                    </InkPill>
                  </td>
                  <td className="px-4 py-3 font-mono text-ink">{rupees(r.total_earnings_paise || 0)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${r.is_available ? 'text-mint' : 'text-ink-muted'}`}>
                      <span
                        className="w-1.5 h-1.5 rounded-full inline-block"
                        style={{ backgroundColor: r.is_available ? 'var(--color-mint)' : 'var(--color-ink-muted)' }}
                      />
                      {r.is_available ? 'online' : 'offline'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{fmtDate(r.created_at)}</td>
                  <td className="px-4 py-3">
                    <InkButton
                      variant={r.is_blocked ? 'ghost' : 'rose'}
                      size="sm"
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate({ id: r.id, block: !r.is_blocked })}
                    >
                      {r.is_blocked ? 'Unblock' : 'Block'}
                    </InkButton>
                  </td>
                </tr>
              ))}
              {runners.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-ink-muted text-sm">No runners registered</td></tr>
              )}
            </tbody>
          </table>
        </InkCard>
      )}
    </>
  );
}
