import React, { useState } from 'react';
import { Menu, ShieldCheck, X } from 'lucide-react';
import type { PageId } from '../types';
import { SchoolCrest } from './SchoolCrest';

interface NavbarProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  onOpenStaffPortal: () => void;
  isStaffAuthenticated: boolean;
}

const NAV_ITEMS: { id: PageId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'take-exam', label: 'Take Exam' },
  { id: 'check-result', label: 'Check Result' },
  { id: 'about', label: 'About Us' },
  { id: 'contact', label: 'Contact' },
];

export const Navbar: React.FC<NavbarProps> = ({
  currentPage,
  onNavigate,
  onOpenStaffPortal,
  isStaffAuthenticated,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLinkClick = (page: PageId) => {
    setMobileOpen(false);
    onNavigate(page);
  };

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => handleLinkClick('home')}
          className="flex items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
        >
          <SchoolCrest className="w-8 h-8 shrink-0" />
          <span className="font-display text-sm sm:text-base font-bold tracking-tight text-blue-950 whitespace-nowrap shrink-0">
            JAIMAN GOLDENLITE TECH LTD
          </span>
        </button>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav
          aria-label="Primary Navigation"
          className="hidden md:flex items-center gap-5 lg:gap-7"
        >
          {NAV_ITEMS.map((item) => {
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleLinkClick(item.id)}
                className={`relative py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded-sm ${
                  active
                    ? 'text-blue-900 font-semibold'
                    : 'text-slate-600 hover:text-blue-900'
                }`}
              >
                {item.label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[19px] h-0.5 bg-amber-600"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Primary Action (Staff shortcut shown only after authenticated sign-in) */}
        <div className="flex items-center gap-2.5 shrink-0">
          {isStaffAuthenticated && (
            <button
              type="button"
              onClick={onOpenStaffPortal}
              title="Staff & Exam Portal (Signed In)"
              aria-label="Open Signed-In Staff Dashboard"
              className="p-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-900 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            >
              <ShieldCheck className="w-5 h-5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => handleLinkClick('take-exam')}
            className="hidden sm:inline-flex items-center justify-center px-4 py-2 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
          >
            Start Exam
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            className="md:hidden p-2 rounded-lg text-slate-700 hover:bg-slate-100 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleLinkClick(item.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-blue-50 text-blue-900 font-semibold'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {item.label}
              </button>
            );
          })}
          <div className="pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => handleLinkClick('take-exam')}
              className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
            >
              Start Exam
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
