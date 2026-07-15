import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { InkCard, InkPill, StatCard, Tamil } from '../components/ink';
import { rupees } from '../lib/tokens';
function shortId(id)   { return id ? `#${String(id).replace(/-/g, '').slice(0, 6).toUpperCase()}` : '#------'; }
function ageMinutes(iso) {
  if (!iso) return 0;
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

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

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery({
    queryKey: ['dashboard'],
    queryFn:  () => api.get('/admin/dashboard').then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: orders } = useQuery({
    queryKey: ['orders', 'all'],
    queryFn:  () => api.get('/admin/orders').then(r => r.data),
    refetchInterval: 20000,
  });

  if (statsLoading) return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0,1,2,3].map(i => <div key={i} className="h-24 rounded-2xl bg-paper-elev" />)}
      </div>
      <div className="h-40 rounded-2xl bg-paper-elev" />
      <div className="space-y-2">
        {[0,1,2,3].map(i => <div key={i} className="h-14 rounded-xl bg-paper-elev" />)}
      </div>
    </div>
  );
  if (statsError)   return <p className="text-rose text-sm">Failed to load dashboard</p>;

  const allOrders = orders?.orders || [];
  const stuck = allOrders
    .filter(o => ['pending', 'pending_runner', 'runner_notified'].includes(o.status))
    .filter(o => ageMinutes(o.created_at) >= 2);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const hourly = Array(24).fill(0);
  allOrders.forEach(o => {
    const d = new Date(o.created_at);
    if (d.getTime() >= todayMs) hourly[d.getHours()]++;
  });
  const maxH     = Math.max(1, ...hourly);
  const peakHour = hourly.indexOf(Math.max(...hourly));

  return (
    <>
      <div className="mb-5 flex items-end justify-between">
        <div>
          <div className="text-ink-muted text-[11px] font-bold tracking-wider uppercase">
            Today · {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
          <h1 style={{ fontFamily: 'Instrument Serif', fontSize: 30, lineHeight: '32px', color: 'var(--color-ink)' }}>
            Ops overview
          </h1>
          <Tamil size={12}>செயல்பாட்டு கண்ணோட்டம்</Tamil>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <StatCard label="Orders today"   value={stats.today_orders}          color="ink" />
        <StatCard label="Revenue"        value={rupees(stats.today_revenue)} color="ink" />
        <StatCard label="Active runners" value={stats.active_runners}        color="mint" />
        <StatCard label="Active shops"   value={stats.active_shops}          color="ink" />
        <StatCard
          label="Stuck · action"
          value={stuck.length ? `⚠ ${stuck.length}` : '0'}
          color={stuck.length ? 'rose' : 'ink'}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-5">
        <InkCard className="md:col-span-3 p-4">
          <div className="flex justify-between items-center">
            <div className="text-[12px] font-bold tracking-wider uppercase text-ink">Orders per hour · today</div>
            <span className="text-[11px] text-ink-muted">live</span>
          </div>
          <div className="flex items-end gap-1 h-[140px] mt-3">
            {hourly.map((c, h) => (
              <div
                key={h}
                className="flex-1"
                style={{
                  minHeight: 4,
                  height: `${(c / maxH) * 100}%`,
                  backgroundColor: h === peakHour && c > 0 ? 'var(--color-accent)' : 'var(--color-accent-soft)',
                  borderRadius: 2,
                }}
              />
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-ink-muted font-mono mt-1">
            <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
          </div>
          {maxH > 0 && (
            <div className="text-[11px] text-ink-soft mt-2">
              Peak · {String(peakHour).padStart(2, '0')}:00 ({maxH} orders)
            </div>
          )}
        </InkCard>

        <InkCard className="md:col-span-2 p-0 overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="text-[12px] font-bold tracking-wider uppercase text-rose">⚠ Needs attention</div>
            <span className="text-[10px] text-ink-muted">auto-flagged</span>
          </div>
          {stuck.length === 0 ? (
            <div className="px-4 pb-4 text-[12px] text-ink-soft italic">All clear — no stuck orders.</div>
          ) : stuck.slice(0, 4).map(o => (
            <div key={o.id} className="px-4 py-3 border-t border-hair">
              <div className="font-mono text-[13px] font-bold text-rose">{shortId(o.id)}</div>
              <div className="text-[11px] text-ink-soft mt-0.5">
                {o.status.replace('_', ' ')} · {ageMinutes(o.created_at)}m
                {o.status === 'pending' && ' · 0 shops accepted'}
              </div>
            </div>
          ))}
        </InkCard>
      </div>

      <InkCard className="p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-hair">
          <div className="text-[12px] font-bold tracking-wider uppercase text-ink">Recent orders</div>
          <span className="text-[11px] text-ink-muted ml-auto">
            showing {Math.min(8, allOrders.length)} of {allOrders.length}
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] font-bold text-ink-muted uppercase tracking-wider bg-paper-sunk">
              <th className="text-left px-4 py-2.5">ID</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Items</th>
              <th className="text-left px-4 py-2.5">Amount</th>
              <th className="text-left px-4 py-2.5">Age</th>
            </tr>
          </thead>
          <tbody>
            {allOrders.slice(0, 8).map(o => {
              const pill = STATUS_PILL[o.status] || { label: o.status, color: 'ink' };
              return (
                <tr key={o.id} className="border-t border-hair">
                  <td className="px-4 py-2.5 font-mono text-[12px] text-ink font-bold">{shortId(o.id)}</td>
                  <td className="px-4 py-2.5"><InkPill color={pill.color}>{pill.label}</InkPill></td>
                  <td className="px-4 py-2.5 text-ink-soft">{(o.items || []).length}</td>
                  <td className="px-4 py-2.5 font-mono text-ink font-bold">
                    {rupees((o.platform_fee_paise || 0) + (o.delivery_fee_paise || 0))}
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted text-[11px]">{ageMinutes(o.created_at)}m</td>
                </tr>
              );
            })}
            {allOrders.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-muted text-sm">No orders yet.</td></tr>
            )}
          </tbody>
        </table>
      </InkCard>
    </>
  );
}
