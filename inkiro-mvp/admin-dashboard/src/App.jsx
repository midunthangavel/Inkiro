import { useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import api, { getAdminKey, clearAdminKey } from './lib/api';
import { LanguageProvider }  from './hooks/useLanguage';
import { LanguageToggle }    from './components/ink';
import AdminLoginPage        from './pages/Login';
import DashboardPage         from './pages/DashboardPage';
import OrdersPage            from './pages/OrdersPage';
import ShopsPage             from './pages/ShopsPage';
import RunnersPage           from './pages/RunnersPage';
import './index.css';

const qc = new QueryClient();

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '▣' },
  { id: 'orders',    label: 'Orders',    icon: '◫' },
  { id: 'shops',     label: 'Shops',     icon: '◉' },
  { id: 'runners',   label: 'Runners',   icon: '◐' },
];

function AdminApp() {
  // Derive initial tab from URL hash so refresh / shared links land on the right page
  const [tab, setTab] = useState(() => {
    const hash = window.location.hash.slice(1);
    return TABS.some(t => t.id === hash) ? hash : 'dashboard';
  });
  const [authed, setAuthed] = useState(() => !!getAdminKey());

  function handleSetTab(id) {
    window.location.hash = id;
    setTab(id);
  }

  const { data: runnersData } = useQuery({
    queryKey: ['runners'],
    queryFn:  () => api.get('/admin/runners').then(r => r.data),
    refetchInterval: 15000,
    enabled: authed,
  });

  function handleLogout() {
    clearAdminKey();
    qc.clear();
    setAuthed(false);
  }

  if (!authed) return <AdminLoginPage onLogin={() => setAuthed(true)} />;

  return (
    <div className="min-h-screen bg-paper flex">
      <aside
        className="w-[210px] flex flex-col text-paper"
        style={{ minHeight: '100vh', backgroundColor: 'var(--color-ink)' }}
      >
        <div className="px-5 pt-5 pb-4">
          <div style={{ fontFamily: 'Instrument Serif', fontSize: 24, lineHeight: '24px', color: 'var(--color-paper)' }}>
            Inkiro<span style={{ color: 'var(--color-accent)' }}>.</span>
          </div>
          <div className="text-[10px] font-bold tracking-widest uppercase mt-0.5" style={{ color: 'rgba(245,239,228,0.5)' }}>
            Ops
          </div>
        </div>

        <nav className="flex-1 px-3 py-2 space-y-1">
          {TABS.map(t => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => handleSetTab(t.id)}
                className="w-full text-left px-2.5 py-2 rounded-lg text-[13px] font-semibold flex items-center gap-2.5 transition"
                style={{
                  backgroundColor: active ? 'rgba(245,239,228,0.12)' : 'transparent',
                  color: active ? 'var(--color-paper)' : 'rgba(245,239,228,0.6)',
                }}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-5 py-4" style={{ borderTop: '1px solid rgba(245,239,228,0.12)' }}>
          <div className="text-[10px] font-bold tracking-widest uppercase" style={{ color: 'rgba(245,239,228,0.5)' }}>
            Environment
          </div>
          <div className="mt-1 text-[12px] font-mono" style={{ color: 'var(--color-mint)' }}>● production</div>
          <button
            onClick={handleLogout}
            className="mt-4 text-[11px] font-semibold transition"
            style={{ color: 'rgba(245,239,228,0.5)' }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 p-6 overflow-auto">
        <div className="flex justify-end mb-3">
          <LanguageToggle />
        </div>
        {tab === 'dashboard' && <DashboardPage />}
        {tab === 'orders'    && <OrdersPage runners={runnersData?.runners} />}
        {tab === 'shops'     && <ShopsPage />}
        {tab === 'runners'   && <RunnersPage />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <AdminApp />
      </LanguageProvider>
    </QueryClientProvider>
  );
}
