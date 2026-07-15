import { useState, useEffect } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { useAuth } from '@/hooks/useAuth';
import { LanguageProvider } from '@/hooks/useLanguage';
import api, { configureLogout } from '@/lib/api';
import { disconnectSocket }      from '@/lib/socket';
import Login        from '@/pages/Login';
import RegisterShop from '@/pages/RegisterShop';
import Dashboard    from '@/pages/Dashboard';

function Main() {
  const { user, login, logout } = useAuth();
  const [shop, setShop]         = useState(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => { configureLogout(() => { disconnectSocket(); logout(); }); }, [logout]);

  useEffect(() => {
    if (!user) return;
    setChecking(true);
    api.get(`/shops/by-user/${user.id}`)
      .then(({ data }) => setShop(data.shop))
      .catch(() => setShop(null))
      .finally(() => setChecking(false));
  }, [user]);

  if (!user) return <Login onLogin={login} />;

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-ink-soft text-sm">
        Loading…
      </div>
    );
  }

  if (!shop) return <RegisterShop user={user} onRegistered={setShop} />;

  return <Dashboard user={user} shop={shop} onLogout={logout} />;
}

export default function App() {
  return (
    <LanguageProvider>
      <Main />
      <Toaster position="top-right" />
    </LanguageProvider>
  );
}
