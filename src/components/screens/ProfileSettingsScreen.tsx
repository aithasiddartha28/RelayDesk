import { useState, type FormEvent } from 'react';
import { Save } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { formatFullTimestamp, getRoleLabel } from '../../lib/format';
import type { PresenceMode, User } from '../../types';
import { Avatar } from '../Avatar';

interface ProfileSettingsScreenProps {
  currentUser: User;
  onUserUpdated: (user: User) => void;
  sendWsEvent: (payload: Record<string, unknown>) => boolean;
}

export function ProfileSettingsScreen({
  currentUser,
  onUserUpdated,
  sendWsEvent,
}: ProfileSettingsScreenProps) {
  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [bio, setBio] = useState(currentUser.bio);
  const [presenceMode, setPresenceMode] = useState<PresenceMode>(currentUser.presenceMode);
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState(currentUser.readReceiptsEnabled);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const payload: Record<string, unknown> = {
        displayName,
        bio,
        presenceMode,
        readReceiptsEnabled,
      };
      if (newPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }
      const res = await apiFetch<{ user: User }>('/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      onUserUpdated(res.user);
      sendWsEvent({ type: 'presence:update', presenceMode });
      setCurrentPassword('');
      setNewPassword('');
      setMessage({ type: 'ok', text: 'Profile and preferences saved.' });
    } catch (err) {
      setMessage({ type: 'err', text: err instanceof Error ? err.message : 'Unable to save settings' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center gap-4">
        <Avatar
          name={currentUser.displayName}
          color={currentUser.avatarColor}
          size="lg"
          isOnline={true}
          presenceMode={presenceMode}
          showPresence={true}
        />
        <div>
          <h2 className="text-base font-semibold text-slate-900">{currentUser.displayName}</h2>
          <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="font-mono">@{currentUser.username}</span>
            <span aria-hidden="true">·</span>
            <span>{currentUser.email}</span>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-blue-700">{getRoleLabel(currentUser.role)}</span>
          </div>
          <div className="text-xs font-mono tabular-nums text-slate-400 mt-1">
            Joined {formatFullTimestamp(currentUser.createdAt)}
          </div>
        </div>
      </div>

      {message && (
        <div
          className={`px-4 py-2.5 rounded-lg text-xs border ${
            message.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Display Name</label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Live Presence Mode</label>
            <select
              value={presenceMode}
              onChange={(e) => setPresenceMode(e.target.value as PresenceMode)}
              className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value="available">Available</option>
              <option value="busy">Busy</option>
              <option value="away">Away</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">Bio / Role Note</label>
          <input
            type="text"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={240}
            className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
          />
        </div>

        <div className="pt-2 border-t border-slate-100">
          <label className="flex items-center gap-2.5 text-xs font-medium text-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={readReceiptsEnabled}
              onChange={(e) => setReadReceiptsEnabled(e.target.checked)}
              className="rounded border-slate-300"
            />
            Send live WebSocket read receipts when viewing conversations
          </label>
        </div>

        <div className="pt-4 border-t border-slate-100 space-y-3">
          <h3 className="text-xs font-semibold text-slate-700">Change Password (Optional)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (min 6 chars)"
              className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
