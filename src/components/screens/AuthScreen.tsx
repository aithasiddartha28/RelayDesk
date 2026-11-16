import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, KeyRound, Lock, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { apiFetch, setStoredToken } from '../../lib/api';
import type { User } from '../../types';

interface AuthScreenProps {
  onAuthenticated: (user: User) => void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<{ hasUsers: boolean }>('/auth/bootstrap-status')
      .then((res) => {
        setHasUsers(res.hasUsers);
        if (!res.hasUsers) {
          setMode('register');
        }
      })
      .catch(() => {
        setHasUsers(true);
      });
  }, []);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      setStoredToken(data.token);
      onAuthenticated(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch<{ token: string; user: User }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username,
          email,
          displayName,
          password: regPassword,
        }),
      });
      setStoredToken(data.token);
      onAuthenticated(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to register');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left Context & Role Overview */}
        <div className="lg:col-span-6 flex flex-col justify-between bg-white border border-slate-200 rounded-xl p-8">
          <div>
            <div className="text-xl font-bold tracking-tight text-slate-900">RelayDesk</div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 text-balance">
              Real-Time Chat &amp; Group Communication Platform
            </h1>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              WebSocket-powered one-to-one and group messaging with live delivery receipts, role-based moderation,
              contact controls, and Admin-only activity audit reports calculated from live workspace events.
            </p>

            <div className="mt-8 space-y-3">
              <h2 className="text-xs font-semibold text-slate-500 tracking-wide">
                Workspace Role Architecture
              </h2>
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg text-xs">
                <div className="p-3.5">
                  <div className="font-semibold text-slate-900">Admin (First Registered Account)</div>
                  <p className="text-slate-500 mt-0.5">
                    Creates or promotes accounts, moderates platform content, and accesses all 4 Admin-only Reports
                    (User Activity, Message Activity, Group Participation, Group Creation).
                  </p>
                </div>
                <div className="p-3.5">
                  <div className="font-semibold text-slate-900">Group Administrator</div>
                  <p className="text-slate-500 mt-0.5">
                    Creates and manages group channels, adds/removes members, pins messages, and handles group
                    moderation.
                  </p>
                </div>
                <div className="p-3.5">
                  <div className="font-semibold text-slate-900">Registered User</div>
                  <p className="text-slate-500 mt-0.5">
                    Engages in real-time 1-to-1 and group WebSocket chats, manages contacts, and controls personal
                    blocking and read receipts.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              Scrypt password hashing
            </span>
            <span aria-hidden="true">·</span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
              Admin-only audit reporting
            </span>
            <span aria-hidden="true">·</span>
            <span className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-slate-400" />
              WebSocket presence
            </span>
          </div>
        </div>

        {/* Right Sign In / Register Panel */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-8 flex flex-col justify-center">
          {hasUsers === false && (
            <div className="mb-5 p-3.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900">
              <div className="font-semibold">Initial Workspace Setup</div>
              <p className="mt-0.5 text-blue-800">
                No accounts exist yet. The first account you register will automatically become the{' '}
                <span className="font-semibold">Platform Admin</span>. Additional accounts can register here or be
                created inside Moderation &amp; Controls.
              </p>
            </div>
          )}

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Create Account
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
              {error}
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Sign in to your workspace</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Your login and WebSocket session timestamps are logged for the Admin User Activity Report.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="login-id">
                  Email or Username
                </label>
                <input
                  id="login-id"
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  placeholder="Enter your email or username"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="login-pw">
                  Password
                </label>
                <input
                  id="login-pw"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  placeholder="Enter your password"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <KeyRound className="w-4 h-4" />
                {loading ? 'Signing in...' : 'Sign In'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {hasUsers === false ? 'Create Platform Admin Account' : 'Register a New Account'}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {hasUsers === false
                    ? 'This initial account will be created with full Admin privileges.'
                    : 'New accounts register as Registered User and can be promoted by an Admin.'}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="reg-name">
                    Full Name
                  </label>
                  <input
                    id="reg-name"
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                    placeholder="Your full name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="reg-username">
                    Username
                  </label>
                  <input
                    id="reg-username"
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                    placeholder="username"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="reg-email">
                  Email Address
                </label>
                <input
                  id="reg-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  placeholder="you@domain.com"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="reg-pw">
                  Password (min 6 characters)
                </label>
                <input
                  id="reg-pw"
                  type="password"
                  required
                  minLength={6}
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  placeholder="Minimum 6 characters"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                {loading
                  ? 'Creating account...'
                  : hasUsers === false
                  ? 'Create Admin Account'
                  : 'Create Account'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
