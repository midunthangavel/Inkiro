import { useState } from 'react';
import { setAdminKey } from '../lib/api';

export default function AdminLoginPage({ onLogin }) {
  const [key, setKey]       = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) {
      setError('Admin key is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'}/admin/dashboard`,
        { headers: { 'X-Admin-Key': trimmed } }
      );

      if (res.status === 401 || res.status === 403) {
        setError('Invalid admin key');
        return;
      }
      if (!res.ok) {
        setError('Could not reach server — try again');
        return;
      }

      setAdminKey(trimmed);
      onLogin();
    } catch {
      setError('Could not reach server — check your connection');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-sm">
        <div className="mb-6">
          <p className="text-green-600 font-bold text-xl">
            Inkiro <span className="text-gray-400 font-medium text-base">Admin</span>
          </p>
          <p className="mt-1 text-sm text-gray-500">Enter your admin key to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Admin Key
            </label>
            <input
              type="password"
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="••••••••••••••••"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              autoFocus
              autoComplete="current-password"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Verifying…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
