import React, { useEffect, useRef, useState } from 'react';
import { BookOpenCheck, Eye, EyeOff, Lock, ShieldCheck, User, X } from 'lucide-react';
import type { TeacherPublicProfile } from '../types';

interface AdminAuthModalProps {
  isOpen: boolean;
  initialTab?: 'admin' | 'teacher';
  onClose: () => void;
  onAuthenticatedAdmin: (token: string) => void;
  onAuthenticatedTeacher: (token: string, teacher: TeacherPublicProfile) => void;
}

type StaffRoleTab = 'admin' | 'teacher';

export const AdminAuthModal: React.FC<AdminAuthModalProps> = ({
  isOpen,
  initialTab = 'admin',
  onClose,
  onAuthenticatedAdmin,
  onAuthenticatedTeacher,
}) => {
  const [roleTab, setRoleTab] = useState<StaffRoleTab>(initialTab);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setRoleTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setUsername('');
      setError('');
      setShowPassword(false);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [isOpen, roleTab]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (roleTab === 'teacher' && !username.trim()) {
      setError('Please enter your teacher username.');
      return;
    }
    if (!password.trim()) {
      setError(
        roleTab === 'admin'
          ? 'Please enter the administrator password.'
          : 'Please enter your teacher password.'
      );
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      if (roleTab === 'admin') {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const raw = await res.text();
        let data: { token?: string; error?: string } = {};
        try {
          data = raw ? (JSON.parse(raw) as { token?: string; error?: string }) : {};
        } catch {
          data = {};
        }
        if (!res.ok || !data.token) {
          setError(data.error || `Authentication failed (HTTP ${res.status}).`);
          setSubmitting(false);
          return;
        }
        setSubmitting(false);
        onAuthenticatedAdmin(data.token);
      } else {
        const res = await fetch('/api/teacher/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.trim(), password }),
        });
        const raw = await res.text();
        let data: { token?: string; teacher?: TeacherPublicProfile; error?: string } = {};
        try {
          data = raw
            ? (JSON.parse(raw) as { token?: string; teacher?: TeacherPublicProfile; error?: string })
            : {};
        } catch {
          data = {};
        }
        if (!res.ok || !data.token || !data.teacher) {
          setError(data.error || `Teacher authentication failed (HTTP ${res.status}).`);
          setSubmitting(false);
          return;
        }
        setSubmitting(false);
        onAuthenticatedTeacher(data.token, data.teacher);
      }
    } catch {
      setError('Unable to reach server. Please check your connection and try again.');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="staff-auth-title"
    >
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
        <div className="bg-blue-950 px-6 py-5 flex items-center justify-between text-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-400">
              {roleTab === 'admin' ? (
                <ShieldCheck className="w-5 h-5" />
              ) : (
                <BookOpenCheck className="w-5 h-5" />
              )}
            </div>
            <div>
              <h2 id="staff-auth-title" className="font-display text-base font-bold">
                Staff &amp; Exam Officer Portal
              </h2>
              <p className="text-xs text-blue-200">JAIMAN GOLDENLITE TECH LTD</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-blue-200 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Role Switch */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setRoleTab('admin')}
              className={`py-2 px-3 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                roleTab === 'admin'
                  ? 'bg-white text-blue-950 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Exam Officer / Admin
            </button>
            <button
              type="button"
              onClick={() => setRoleTab('teacher')}
              className={`py-2 px-3 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                roleTab === 'teacher'
                  ? 'bg-white text-blue-950 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Subject Teacher
            </button>
          </div>

          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            {roleTab === 'admin'
              ? 'Sign in as Exam Officer to manage academic sessions, subjects, teacher accounts, student records, and scratch cards.'
              : 'Sign in with your assigned Teacher account to create tests, upload questions, set exam rules, and export class score sheets.'}
          </p>

          {roleTab === 'teacher' && (
            <div>
              <label
                htmlFor="teacher-username-input"
                className="block text-sm font-medium text-slate-800 mb-1.5"
              >
                Teacher Username
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <User className="w-4 h-4" />
                </span>
                <input
                  ref={inputRef}
                  id="teacher-username-input"
                  type="text"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="e.g. t.adebayo or t.okonkwo"
                  autoComplete="username"
                  className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                />
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor="staff-password-input"
              className="block text-sm font-medium text-slate-800 mb-1.5"
            >
              {roleTab === 'admin' ? 'Administrator Password' : 'Teacher Password'}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <Lock className="w-4 h-4" />
              </span>
              <input
                ref={roleTab === 'admin' ? inputRef : undefined}
                id="staff-password-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError('');
                }}
                placeholder={
                  roleTab === 'admin' ? 'Enter admin password' : 'Enter teacher password'
                }
                autoComplete="current-password"
                className="w-full pl-10 pr-11 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800 focus:border-blue-800"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {roleTab === 'teacher' && (
              <p className="mt-1.5 text-[11px] text-slate-500">
                Demo accounts: <code className="font-mono">t.adebayo</code> or{' '}
                <code className="font-mono">t.okonkwo</code> · password{' '}
                <code className="font-mono">teacher123</code>
              </p>
            )}
            {error && (
              <p role="alert" className="mt-2 text-xs font-medium text-red-700">
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
            >
              {submitting
                ? 'Verifying...'
                : roleTab === 'admin'
                  ? 'Unlock Admin'
                  : 'Enter Teacher Portal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
