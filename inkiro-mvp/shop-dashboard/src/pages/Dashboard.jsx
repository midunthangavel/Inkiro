import { useEffect, useState, useCallback, useRef } from 'react';
import api from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { toast } from 'sonner';
import { InkCard, InkButton, InkPill, StatCard, LanguageToggle, Tamil } from '@/components/ink';
import { rupees } from '@/lib/tokens';
import ChatModal from '@/components/ChatModal';
function shortId(id)   { return id ? `#${String(id).replace(/-/g, '').slice(0, 6).toUpperCase()}` : '#------'; }
function runnerCode(order) {
  if (order?.handoff_code) return String(order.handoff_code).padStart(4, '0');
  const id = order?.id;
  if (!id) return '0000';
  const hex = String(id).replace(/-/g, '').slice(-4);
  return String(parseInt(hex, 16) % 10000).padStart(4, '0');
}
function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso); const now = new Date();
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

const STATUS_PILL = {
  pending:         { label: 'New',            color: 'accent' },
  accepted:        { label: 'Packing',        color: 'amber' },
  pending_runner:  { label: 'Finding runner', color: 'amber' },
  runner_notified: { label: 'Finding runner', color: 'amber' },
  runner_assigned: { label: 'Runner here',    color: 'amber' },
  picked_up:       { label: 'En route',       color: 'mint' },
  delivered:       { label: 'Delivered',      color: 'mint' },
  declined:        { label: 'Declined',       color: 'rose' },
  cancelled:       { label: 'Cancelled',      color: 'rose' },
  expired:         { label: 'Expired',        color: 'ink' },
};

export default function Dashboard({ user, shop, onLogout }) {
  const [nav, setNav]               = useState('incoming');
  const [orders, setOrders]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState(false);
  const [socketOk, setSocketOk]     = useState(true);
  const [checked, setChecked]       = useState({});
  const [chatTarget, setChatTarget] = useState(null);

  function openChat(order) {
    if (!order.customer_id) return;
    setChatTarget({ orderId: order.id, otherId: order.customer_id, otherName: order.customer_name || 'Customer' });
  }

  const fetchOrders = useCallback(async () => {
    setLoadError(false);
    try {
      const { data } = await api.get(`/shops/${shop.id}/orders`);
      setOrders(data.orders || []);
    } catch {
      setLoadError(true);
    } finally { setLoading(false); }
  }, [shop.id]);

  useEffect(() => {
    fetchOrders();
    const socket = getSocket();
    socket.connect();
    socket.emit('join:shop', shop.id);

    socket.on('connect',       () => setSocketOk(true));
    socket.on('connect_error', () => setSocketOk(false));
    socket.on('disconnect',    () => setSocketOk(false));

    socket.on('order:new', (o) => {
      setOrders(prev => [o, ...prev]);
      toast.success(`New order · ${rupees(o.total_amount_paise || 0)}`);
    });
    socket.on('order:updated', (o) => {
      setOrders(prev => prev.map(x => x.id === o.id ? { ...x, ...o } : x));
    });

    return () => {
      socket.off('connect'); socket.off('connect_error'); socket.off('disconnect');
      socket.off('order:new'); socket.off('order:updated');
      socket.disconnect();
    };
  }, [fetchOrders, shop.id]);

  async function respond(orderId, action, reason = null) {
    try {
      await api.post(`/orders/${orderId}/shop-respond`, reason ? { action, decline_reason: reason } : { action });
      toast.success(action === 'accept' ? 'Order accepted' : 'Order declined');
      fetchOrders();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action failed');
    }
  }

  async function markReady(orderId) {
    try {
      await api.post(`/orders/${orderId}/mark-ready`);
      toast.success('Marked ready for pickup');
      fetchOrders();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Phase E will add the endpoint');
    }
  }

  const pendingOrders  = orders.filter(o => o.status === 'pending');
  const todayDelivered = orders.filter(o => o.status === 'delivered' && isToday(o.completed_at || o.created_at));
  const todayRevenue   = todayDelivered.reduce((s, o) => s + (o.total_amount_paise || 0), 0);

  const colNew      = orders.filter(o => o.status === 'pending');
  const colPacking  = orders.filter(o => ['accepted', 'pending_runner', 'runner_notified'].includes(o.status));
  const colHandoff  = orders.filter(o => ['runner_assigned', 'picked_up'].includes(o.status));

  return (
    <div className="min-h-screen bg-paper flex">
      <aside className="w-[220px] bg-paper-elev border-r border-hair p-4 flex flex-col" style={{ minHeight: '100vh' }}>
        <div>
          <div style={{ fontFamily: 'Instrument Serif', fontSize: 28, lineHeight: '28px', color: 'var(--color-ink)' }}>
            Inkiro<span style={{ color: 'var(--color-accent)' }}>.</span>
          </div>
          <div className="text-ink-muted text-[10px] font-bold tracking-widest uppercase mt-0.5">Shop</div>
        </div>

        <InkCard tone="sunk" className="p-2.5 mt-3 mb-3">
          <div className="text-ink font-semibold text-[13px] truncate">{shop.shop_name}</div>
          <div className="text-mint font-semibold text-[11px] mt-0.5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-mint inline-block" /> Open
          </div>
        </InkCard>

        <NavItem label="Incoming"       icon="🔔" count={pendingOrders.length} active={nav === 'incoming'} onClick={() => setNav('incoming')} />
        <NavItem label="Today's orders" icon="🕐" active={nav === 'today'}    onClick={() => setNav('today')} />
        <NavItem label="Items"          icon="📦" active={nav === 'items'}    onClick={() => setNav('items')} />
        <NavItem label="Settings"       icon="⚙"  active={nav === 'settings'} onClick={() => setNav('settings')} />

        <div className="mt-auto">
          <InkCard tone="sunk" className="p-3">
            <div className="text-ink-muted text-[10px] font-bold tracking-widest uppercase">Today</div>
            <div className="font-mono font-extrabold text-ink text-xl">{rupees(todayRevenue)}</div>
            <div className="text-ink-muted text-[11px] mt-0.5">{todayDelivered.length} delivered</div>
          </InkCard>
          <button onClick={onLogout} className="mt-3 text-ink-muted text-xs font-semibold hover:text-ink">
            Sign out · {user.phone}
          </button>
        </div>
      </aside>

      <main className="flex-1 p-6 overflow-auto">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 style={{ fontFamily: 'Instrument Serif', fontSize: 32, lineHeight: '34px', color: 'var(--color-ink)' }}>
              {nav === 'incoming' ? 'Incoming orders' : nav === 'today' ? 'Today' : nav === 'items' ? 'Items' : 'Settings'}
            </h1>
            {nav === 'incoming' && (
              <div className="text-ink-muted text-xs mt-1 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-mint inline-block anim-pulse" />
                LIVE · {socketOk ? 'connected' : 'offline — retrying'}
              </div>
            )}
            {nav === 'today' && <Tamil size={13}>இன்றைய ஆர்டர்கள்</Tamil>}
            {nav === 'items' && <div className="text-ink-muted text-xs mt-1">Your product catalog</div>}
          </div>
          <LanguageToggle />
        </div>

        {nav === 'incoming' && (
          <IncomingView
            loading={loading}
            loadError={loadError}
            onRetry={() => { setLoading(true); fetchOrders(); }}
            colNew={colNew}
            colPacking={colPacking}
            colHandoff={colHandoff}
            checked={checked}
            setChecked={setChecked}
            onAccept={(id) => respond(id, 'accept')}
            onDecline={(id) => respond(id, 'decline')}
            onMarkReady={markReady}
            onChat={openChat}
          />
        )}

        {nav === 'today'    && <TodayView orders={orders} />}
        {nav === 'items'    && <ItemsView shop={shop} />}
        {nav === 'settings' && <SettingsView shop={shop} user={user} />}
      </main>

      <ChatModal
        open={!!chatTarget}
        onClose={() => setChatTarget(null)}
        orderId={chatTarget?.orderId}
        myType="shop"
        myId={shop.id}
        otherType="customer"
        otherId={chatTarget?.otherId}
        otherName={chatTarget?.otherName}
      />
    </div>
  );
}

function NavItem({ label, icon, count, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`mt-1 flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] text-[13px] text-left w-full transition ${
        active
          ? 'bg-accent-soft text-accent-ink font-bold'
          : 'text-ink-soft font-semibold hover:bg-paper-sunk'
      }`}
    >
      <span>{icon}</span>
      <span className="flex-1">{label}</span>
      {count > 0 && (
        <span className="bg-accent text-paper-elev text-[10px] font-bold px-1.5 py-0.5 rounded-full">{count}</span>
      )}
    </button>
  );
}

function IncomingView({ loading, loadError, onRetry, colNew, colPacking, colHandoff, checked, setChecked, onAccept, onDecline, onMarkReady, onChat }) {
  if (loading) return <div className="text-ink-soft">Loading…</div>;

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="text-ink-soft text-sm">Couldn't load orders.</div>
        <button
          onClick={onRetry}
          className="px-4 py-2 rounded-full text-sm font-semibold"
          style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
        >
          Retry
        </button>
      </div>
    );
  }

  const total = colNew.length + colPacking.length + colHandoff.length;
  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <div
          className="w-[120px] h-[120px] rounded-full flex items-center justify-center"
          style={{ borderWidth: 3, borderStyle: 'dashed', borderColor: 'var(--color-hair-strong)', backgroundColor: 'var(--color-paper-elev)' }}
        >
          <span style={{ fontSize: 48 }}>🔔</span>
        </div>
        <div style={{ fontFamily: 'Instrument Serif', fontSize: 24, color: 'var(--color-ink)' }}>Waiting for orders…</div>
        <Tamil size={12}>ஆர்டர் வரும் வரை காத்திருங்கள்</Tamil>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Column title="New" pillColor="accent" orders={colNew}>
        {(o) => <NewCard order={o} onAccept={() => onAccept(o.id)} onDecline={() => onDecline(o.id)} onChat={() => onChat(o)} />}
      </Column>
      <Column title="Packing" pillColor="mint" orders={colPacking}>
        {(o) => <PackingCard order={o} checked={checked} setChecked={setChecked} onMarkReady={() => onMarkReady(o.id)} onChat={() => onChat(o)} />}
      </Column>
      <Column title="Runner here" pillColor="amber" orders={colHandoff}>
        {(o) => <HandoffCard order={o} onChat={() => onChat(o)} />}
      </Column>
    </div>
  );
}

function Column({ title, pillColor, orders, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <InkPill color={pillColor}>{title}</InkPill>
        <span className="text-ink-muted text-[11px] font-semibold">{orders.length}</span>
      </div>
      <div className="space-y-3">
        {orders.length === 0 ? (
          <div
            className="text-ink-muted text-xs italic py-8 text-center border-2 border-dashed rounded-2xl"
            style={{ borderColor: 'var(--color-hair)' }}
          >
            empty
          </div>
        ) : orders.map(o => <div key={o.id}>{children(o)}</div>)}
      </div>
    </div>
  );
}

function NewCard({ order, onAccept, onDecline, onChat }) {
  const items = Array.isArray(order.items) ? order.items : [];
  return (
    <InkCard className="p-4 border-2 border-accent">
      <div className="flex items-center justify-between">
        <InkPill color="accent">● NEW</InkPill>
        <div className="flex items-center gap-2">
          {order.customer_id && (
            <button onClick={onChat} className="text-[18px] opacity-60 hover:opacity-100 transition" title="Chat with customer">💬</button>
          )}
          <span className="font-mono font-extrabold text-ink text-lg">{rupees(order.total_amount_paise || 0)}</span>
        </div>
      </div>
      <div className="text-[11px] font-mono text-ink-muted mt-1">
        {shortId(order.id)} · {order.customer_name || 'Customer'}
      </div>
      <div className="mt-3 p-2.5 bg-paper-sunk rounded-xl text-[12px] space-y-1">
        {items.map((it, i) => (
          <div key={i} className="flex justify-between">
            <span className="text-ink">{it.name} ×{it.quantity}</span>
            <span className="font-mono text-ink-soft">₹{it.estimated_price_rupees}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <InkButton variant="ghost" size="sm" full onClick={onDecline}>Decline</InkButton>
        <InkButton variant="accent" size="sm" full onClick={onAccept}>Accept</InkButton>
      </div>
    </InkCard>
  );
}

function PackingCard({ order, checked, setChecked, onMarkReady, onChat }) {
  const items = Array.isArray(order.items) ? order.items : [];
  const packedCount = items.filter((_, i) => checked[`${order.id}:${i}`]).length;
  const allChecked  = items.length > 0 && packedCount === items.length;
  const awaitingRunner = order.status !== 'accepted';

  function toggle(i) {
    const k = `${order.id}:${i}`;
    setChecked(prev => ({ ...prev, [k]: !prev[k] }));
  }

  return (
    <InkCard className="p-4">
      <div className="flex items-center justify-between">
        <InkPill color={awaitingRunner ? 'amber' : 'mint'}>
          {awaitingRunner ? 'Finding runner' : 'Packing'}
        </InkPill>
        <div className="flex items-center gap-2">
          {order.customer_id && (
            <button onClick={onChat} className="text-[18px] opacity-60 hover:opacity-100 transition" title="Chat with customer">💬</button>
          )}
          <span className="font-mono font-extrabold text-ink text-lg">{rupees(order.total_amount_paise || 0)}</span>
        </div>
      </div>
      <div className="text-[11px] font-mono text-ink-muted mt-1">
        {shortId(order.id)} · {order.customer_name || 'Customer'}
      </div>
      <div className="mt-3 space-y-1">
        {items.map((it, i) => {
          const done = !!checked[`${order.id}:${i}`];
          return (
            <button
              key={i}
              onClick={() => toggle(i)}
              disabled={awaitingRunner}
              className="w-full flex items-center gap-2 text-[12px] text-left"
            >
              <span className={`w-3.5 h-3.5 rounded-[4px] flex items-center justify-center border-[1.5px] ${
                done ? 'bg-mint border-mint' : 'border-hair-strong bg-transparent'
              }`}>
                {done && <span className="text-paper-elev text-[10px] font-extrabold">✓</span>}
              </span>
              <span className={`flex-1 ${done ? 'text-ink-muted line-through' : 'text-ink'}`}>{it.name}</span>
              <span className="text-ink-muted">×{it.quantity}</span>
            </button>
          );
        })}
      </div>
      {!awaitingRunner ? (
        <InkButton variant="accent" size="sm" full className="mt-3" onClick={onMarkReady} disabled={!allChecked}>
          {allChecked ? 'Ready for pickup' : `${packedCount}/${items.length} packed`}
        </InkButton>
      ) : (
        <div className="mt-3 text-[11px] text-ink-soft italic">Runner will arrive shortly…</div>
      )}
    </InkCard>
  );
}

function HandoffCard({ order, onChat }) {
  const runnerHere = order.status === 'runner_assigned';
  return (
    <InkCard
      className={`p-4 ${runnerHere ? 'border-2 border-accent' : ''}`}
      style={runnerHere ? { backgroundColor: 'var(--color-accent-soft)' } : undefined}
    >
      <div className="flex items-center justify-between">
        <InkPill color={runnerHere ? 'amber' : 'mint'}>{runnerHere ? 'Runner here' : 'En route'}</InkPill>
        <div className="flex items-center gap-2">
          {order.customer_id && (
            <button onClick={onChat} className="text-[18px] opacity-60 hover:opacity-100 transition" title="Chat with customer">💬</button>
          )}
          <span className="font-mono font-extrabold text-accent-ink text-lg">{rupees(order.total_amount_paise || 0)}</span>
        </div>
      </div>
      <div className="text-[11px] font-mono mt-1"
        style={{ color: runnerHere ? 'var(--color-accent-ink)' : 'var(--color-ink-muted)', opacity: runnerHere ? 0.8 : 1 }}>
        {shortId(order.id)} · {order.customer_name || 'Customer'}
      </div>
      <div className="mt-3 flex items-center gap-2.5 p-2.5 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.55)' }}>
        <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center">
          <span className="text-paper-elev font-extrabold">{(order.runner_name?.[0] || 'R').toUpperCase()}</span>
        </div>
        <div className="flex-1">
          <div className="text-[13px] font-bold text-accent-ink">{order.runner_name || 'Runner'}</div>
          {order.runner_vehicle_number && (
            <div className="text-[10px] font-mono" style={{ color: 'var(--color-accent-ink)', opacity: 0.7 }}>
              {order.runner_vehicle_number}
            </div>
          )}
        </div>
      </div>
      {runnerHere && (
        <div className="mt-3 p-3 rounded-xl bg-ink text-center">
          <div className="text-paper-elev text-[9px] font-bold tracking-widest uppercase" style={{ opacity: 0.6 }}>Code</div>
          <div className="text-paper-elev font-mono font-extrabold text-2xl" style={{ letterSpacing: 4 }}>
            {runnerCode(order)}
          </div>
        </div>
      )}
    </InkCard>
  );
}

function TodayView({ orders }) {
  const today    = orders.filter(o => isToday(o.created_at));
  const revenue  = today.filter(o => o.status === 'delivered').reduce((s, o) => s + (o.total_amount_paise || 0), 0);
  const count    = today.filter(o => o.status === 'delivered').length;
  const declined = today.filter(o => ['declined', 'cancelled', 'expired'].includes(o.status)).length;

  return (
    <>
      <div className="grid grid-cols-3 gap-3 mb-5">
        <StatCard label="Revenue"         value={rupees(revenue)} color="ink"  />
        <StatCard label="Orders"          value={count}           color="mint" />
        <StatCard label="Declined/Expired" value={declined}       color="rose" />
      </div>
      <InkCard className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] font-bold text-ink-muted uppercase tracking-wider bg-paper-sunk">
              <th className="text-left px-4 py-2.5">ID</th>
              <th className="text-left px-4 py-2.5">Customer</th>
              <th className="text-left px-4 py-2.5">Items</th>
              <th className="text-left px-4 py-2.5">Amount</th>
              <th className="text-left px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {today.map(o => {
              const pill = STATUS_PILL[o.status] || { label: o.status, color: 'ink' };
              return (
                <tr key={o.id} className="border-t border-hair">
                  <td className="px-4 py-2.5 font-mono text-[12px] text-ink font-bold">{shortId(o.id)}</td>
                  <td className="px-4 py-2.5 text-ink-soft">{o.customer_name || '—'}</td>
                  <td className="px-4 py-2.5 text-ink-soft">{(o.items || []).length}</td>
                  <td className="px-4 py-2.5 font-mono text-ink font-bold">{rupees(o.total_amount_paise || 0)}</td>
                  <td className="px-4 py-2.5"><InkPill color={pill.color}>{pill.label}</InkPill></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {today.length === 0 && <div className="p-8 text-center text-ink-muted text-sm">No orders today.</div>}
      </InkCard>
    </>
  );
}

function ItemsView({ shop }) {
  const [items, setItems]     = useState(null);
  const [adding, setAdding]   = useState(false);
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('piece');
  const [newPrice, setNewPrice] = useState('');

  useEffect(() => {
    api.get(`/shops/${shop.id}/items`)
      .then(r => setItems(r.data.items || []))
      .catch(() => setItems([]));
  }, [shop.id]);

  async function addItem() {
    if (!newName.trim()) return;
    try {
      const { data } = await api.post(`/shops/${shop.id}/items`, {
        name: newName.trim(),
        unit: newUnit.trim() || 'piece',
        price_paise: Math.round((parseFloat(newPrice) || 0) * 100),
      });
      setItems(prev => [...(prev || []), data.item]);
      setNewName(''); setNewUnit('piece'); setNewPrice(''); setAdding(false);
      toast.success('Item added');
    } catch (err) { toast.error(err.response?.data?.error || 'Could not add item'); }
  }

  async function toggleStock(item) {
    try {
      const { data } = await api.put(`/shops/${shop.id}/items/${item.id}`, { in_stock: !item.in_stock });
      setItems(prev => prev.map(i => i.id === item.id ? data.item : i));
    } catch { toast.error('Could not update'); }
  }

  async function deleteItem(id) {
    try {
      await api.delete(`/shops/${shop.id}/items/${id}`);
      setItems(prev => prev.filter(i => i.id !== id));
      toast.success('Item removed');
    } catch { toast.error('Could not remove item'); }
  }

  if (items === null) {
    return <div className="animate-pulse space-y-2">{[0,1,2].map(i => <div key={i} className="h-10 rounded-xl bg-paper-elev" />)}</div>;
  }

  return (
    <div className="max-w-2xl space-y-3">
      <InkCard className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] font-bold text-ink-muted uppercase tracking-wider bg-paper-sunk">
              <th className="text-left px-4 py-2.5">Name</th>
              <th className="text-left px-4 py-2.5">Unit</th>
              <th className="text-left px-4 py-2.5">Price</th>
              <th className="text-left px-4 py-2.5">Stock</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} className="border-t border-hair">
                <td className="px-4 py-2.5 font-semibold text-ink">{item.name}</td>
                <td className="px-4 py-2.5 text-ink-soft text-xs">{item.unit}</td>
                <td className="px-4 py-2.5 font-mono text-ink text-xs">
                  {item.price_paise ? `₹${(item.price_paise / 100).toFixed(0)}` : '—'}
                </td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => toggleStock(item)}
                    className={`text-xs font-bold px-2.5 py-1 rounded-full transition ${
                      item.in_stock
                        ? 'bg-mint/20 text-mint hover:bg-rose/20 hover:text-rose'
                        : 'bg-rose/20 text-rose hover:bg-mint/20 hover:text-mint'
                    }`}
                  >
                    {item.in_stock ? '● In stock' : '○ Out'}
                  </button>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => deleteItem(item.id)}
                    className="text-ink-muted hover:text-rose text-base leading-none transition"
                    title="Remove item"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && !adding && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-muted text-sm">No items yet. Add your first product below.</td></tr>
            )}
          </tbody>
        </table>
      </InkCard>

      {adding ? (
        <InkCard className="p-4 space-y-3">
          <div className="text-ink-muted text-[11px] font-bold tracking-wider uppercase">New item</div>
          <div className="flex gap-2 flex-wrap">
            <input
              autoFocus
              placeholder="Name (e.g. Tomato)"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="flex-1 min-w-[140px] bg-paper-sunk border border-hair rounded-xl px-3 py-1.5 text-sm text-ink outline-none"
            />
            <input
              placeholder="Unit (kg, piece…)"
              value={newUnit}
              onChange={e => setNewUnit(e.target.value)}
              className="w-28 bg-paper-sunk border border-hair rounded-xl px-3 py-1.5 text-sm text-ink outline-none"
            />
            <input
              placeholder="₹ Price"
              type="number"
              min="0"
              step="1"
              value={newPrice}
              onChange={e => setNewPrice(e.target.value)}
              className="w-24 bg-paper-sunk border border-hair rounded-xl px-3 py-1.5 text-sm text-ink outline-none"
            />
          </div>
          <div className="flex gap-2">
            <InkButton variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</InkButton>
            <InkButton variant="accent" size="sm" onClick={addItem} disabled={!newName.trim()}>Add item</InkButton>
          </div>
        </InkCard>
      ) : (
        <InkButton variant="ghost" size="sm" onClick={() => setAdding(true)}>+ Add item</InkButton>
      )}
    </div>
  );
}

function SettingsView({ shop, user }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
      <InkCard className="p-4">
        <div className="text-ink-muted text-[11px] font-bold tracking-wider uppercase">Shop name</div>
        <div className="text-ink text-lg font-bold mt-1">{shop.shop_name}</div>
      </InkCard>
      <InkCard className="p-4">
        <div className="text-ink-muted text-[11px] font-bold tracking-wider uppercase">Address</div>
        <div className="text-ink text-sm mt-1">{shop.address || '—'}</div>
      </InkCard>
      <InkCard className="p-4">
        <div className="text-ink-muted text-[11px] font-bold tracking-wider uppercase">Location</div>
        <div className="text-ink font-mono text-sm mt-1">
          {typeof shop.lat === 'number' && typeof shop.lng === 'number'
            ? `${shop.lat.toFixed(5)}, ${shop.lng.toFixed(5)}`
            : '—'}
        </div>
      </InkCard>
      <InkCard className="p-4">
        <div className="text-ink-muted text-[11px] font-bold tracking-wider uppercase">Owner phone</div>
        <div className="text-ink font-mono text-sm mt-1">{user.phone}</div>
      </InkCard>
    </div>
  );
}
