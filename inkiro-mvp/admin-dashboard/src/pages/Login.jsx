import { useState } from 'react';
import { setAdminKey } from '../lib/api';
import { InkCard, InkButton, Tamil } from '../components/ink';

export default function AdminLoginPage({ onLogin }) {
  const [key, setKey]         = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) { setError('Admin key is required'); return; }

    setLoading(true); setError('');
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'}/admin/dashboard`,
        { headers: { 'X-Admin-Key': trimmed } }
      );
      if (res.status === 401 || res.status === 403) { setError('Invalid admin key'); return; }
      if (!res.ok) { setError('Could not reach server — try again'); return; }
      setAdminKey(trimmed);
      onLogin();
    } catch {
      setError('Could not reach server — check your connection');
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center p-4">
      <InkCard className="w-full max-w-md p-8" style={{ borderRadius: 24 }}>
        <div style={{ fontFamily: 'Instrument Serif', fontSize: 48, lineHeight: '48px', color: 'var(--color-ink)' }}>
          Inkiro<span style={{ color: 'var(--color-accent)' }}>.</span>
        </div>
        <div className="text-ink-muted text-[11px] font-bold tracking-widest uppercase mt-1">Ops</div>
        <p className="text-ink-soft mt-2">Admin access only.</p>
        <Tamil size={12}>நிர்வாக அணுகல் மட்டும்</Tamil>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <div className="text-ink-muted text-[11px] font-bold tracking-wider uppercase">Admin key</div>
            <input
              type="password"
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="••••••••••••••••"
              className="w-full mt-2 pb-2 border-b-2 border-ink bg-transparent text-ink text-lg font-bold font-mono outline-none"
              autoFocus
              autoComplete="current-password"
            />
          </div>

          {error && <p className="text-rose text-xs">{error}</p>}

          <InkButton variant="accent" size="lg" full type="submit" disabled={loading}>
            {loading ? 'Verifying…' : 'Sign in'}
          </InkButton>
        </form>
      </InkCard>
    </div>
  );
}
