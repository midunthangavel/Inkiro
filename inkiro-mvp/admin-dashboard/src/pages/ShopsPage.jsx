import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { InkButton, InkCard, InkPill } from '../components/ink';

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ShopsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['shops'],
    queryFn:  () => api.get('/admin/shops').then(r => r.data),
  });

  const toggle = useMutation({
    mutationFn: ({ id, block }) => api.post(`/admin/shops/${id}/${block ? 'block' : 'unblock'}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['shops'] }),
  });

  return (
    <>
      <div className="mb-5">
        <h1 style={{ fontFamily: 'Instrument Serif', fontSize: 30, lineHeight: '32px', color: 'var(--color-ink)' }}>
          Shops
        </h1>
        <div className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mt-1">
          {data?.shops?.length ?? 0} registered
        </div>
      </div>

      {isLoading && (
        <div className="animate-pulse space-y-2">
          {[0,1,2,3].map(i => <div key={i} className="h-12 rounded-xl bg-paper-elev" />)}
        </div>
      )}
      {error && <p className="text-rose text-sm">Failed to load shops</p>}

      {data && (
        <InkCard className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-bold text-ink-muted uppercase tracking-wider bg-paper-sunk">
                <th className="text-left px-4 py-2.5">Shop name</th>
                <th className="text-left px-4 py-2.5">Address</th>
                <th className="text-left px-4 py-2.5">Location</th>
                <th className="text-left px-4 py-2.5">Active</th>
                <th className="text-left px-4 py-2.5">Registered</th>
                <th className="text-left px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.shops.map(shop => (
                <tr key={shop.id} className={`border-t border-hair ${shop.is_blocked ? 'bg-rose-soft/30' : ''}`}>
                  <td className="px-4 py-3 font-semibold text-ink">
                    {shop.shop_name}
                    {shop.is_blocked && <InkPill color="rose" className="ml-2">Blocked</InkPill>}
                  </td>
                  <td className="px-4 py-3 text-ink-soft max-w-xs truncate">{shop.address || '—'}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-ink-muted">
                    {typeof shop.lat === 'number' ? shop.lat.toFixed(4) : '—'}
                    {typeof shop.lng === 'number' ? `, ${shop.lng.toFixed(4)}` : ''}
                  </td>
                  <td className="px-4 py-3">
                    <InkPill color={shop.is_active ? 'mint' : 'ink'}>
                      {shop.is_active ? '● Open' : 'Closed'}
                    </InkPill>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{fmtDate(shop.created_at)}</td>
                  <td className="px-4 py-3">
                    <InkButton
                      variant={shop.is_blocked ? 'ghost' : 'rose'}
                      size="sm"
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate({ id: shop.id, block: !shop.is_blocked })}
                    >
                      {shop.is_blocked ? 'Unblock' : 'Block'}
                    </InkButton>
                  </td>
                </tr>
              ))}
              {data.shops.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-muted text-sm">No shops registered</td></tr>
              )}
            </tbody>
          </table>
        </InkCard>
      )}
    </>
  );
}
