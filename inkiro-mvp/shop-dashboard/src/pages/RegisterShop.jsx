import { useState } from 'react';
import api from '@/lib/api';
import { InkCard, InkButton, Tamil } from '@/components/ink';

export default function RegisterShop({ user, onRegistered }) {
  const [form, setForm] = useState({ shop_name: '', address: '', category: '', lat: '', lng: '' });
  const [locating, setLocating] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function useCurrentLocation() {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        set('lat', pos.coords.latitude);
        set('lng', pos.coords.longitude);
        setLocating(false);
      },
      () => { setError('Location access denied'); setLocating(false); }
    );
  }

  async function submit() {
    if (!form.shop_name.trim()) { setError('Shop name is required'); return; }
    if (!form.lat || !form.lng)  { setError('Location is required — tap the button below'); return; }
    setLoading(true); setError('');
    try {
      const { data } = await api.post('/shops/register', {
        user_id: user.id,
        shop_name: form.shop_name.trim(),
        address:   form.address.trim(),
        category:  form.category.trim() || 'General',
        lat: parseFloat(form.lat),
        lng: parseFloat(form.lng),
      });
      onRegistered(data.shop);
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <h1 className="font-serif text-ink" style={{ fontSize: 40, lineHeight: '44px' }}>
          Register<br />your shop.
        </h1>
        <Tamil size={14}>உங்கள் கடையை பதிவு செய்யுங்கள்</Tamil>
        <p className="text-ink-soft mt-2">One-time setup.</p>

        <div className="mt-6 space-y-3">
          <Field label="Shop name *">
            <input
              className="w-full text-ink text-lg font-semibold bg-transparent outline-none mt-1"
              placeholder="e.g. Sri Murugan Provision"
              value={form.shop_name}
              onChange={e => set('shop_name', e.target.value)}
            />
          </Field>

          <Field label="Address">
            <textarea
              className="w-full text-ink text-sm bg-transparent outline-none mt-1 resize-none"
              placeholder="Street, area, city"
              rows={2}
              value={form.address}
              onChange={e => set('address', e.target.value)}
            />
          </Field>

          <Field label="Category">
            <input
              className="w-full text-ink text-sm bg-transparent outline-none mt-1"
              placeholder="Grocery / Pharmacy / Bakery"
              value={form.category}
              onChange={e => set('category', e.target.value)}
            />
          </Field>

          <InkCard className="p-3.5">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-full bg-accent-soft flex items-center justify-center text-accent-ink">
                <LocationPinIcon size={18} />
              </div>
              <div className="flex-1">
                <div className="text-ink-muted text-[11px] font-bold tracking-wider uppercase">Shop location</div>
                {locating
                  ? <div className="text-ink-soft text-sm mt-0.5">Getting GPS…</div>
                  : form.lat && form.lng
                    ? <div className="text-ink font-mono text-sm mt-0.5">{Number(form.lat).toFixed(5)}, {Number(form.lng).toFixed(5)}</div>
                    : <div className="text-ink-muted text-sm mt-0.5">Tap Get GPS</div>}
              </div>
              <InkButton variant="ghost" size="sm" onClick={useCurrentLocation}>Get GPS</InkButton>
            </div>
          </InkCard>

          {error && <p className="text-rose text-xs">{error}</p>}

          <InkButton variant="accent" size="lg" full onClick={submit} disabled={loading}>
            {loading ? 'Registering…' : 'Register shop'}
          </InkButton>
        </div>
      </div>
    </div>
  );
}

function LocationPinIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 22s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12z" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function Field({ label, children }) {
  return (
    <InkCard className="p-3.5">
      <div className="text-ink-muted text-[11px] font-bold tracking-wider uppercase">{label}</div>
      {children}
    </InkCard>
  );
}
