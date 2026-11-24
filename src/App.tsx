import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { AboutPage } from './components/AboutPage';
import { AdminAuthModal } from './components/AdminAuthModal';
import { AdminDashboardPage } from './components/AdminDashboardPage';
import { CheckResultPage } from './components/CheckResultPage';
import { ContactPage } from './components/ContactPage';
import { HomePage } from './components/HomePage';
import { Navbar } from './components/Navbar';
import { TakeExamPage } from './components/TakeExamPage';
import { TeacherPortalPage } from './components/TeacherPortalPage';
import type {
  AcademicConfig,
  ActiveExamSession,
  ExamResult,
  PageId,
  Subject,
  TeacherPublicProfile,
} from './types';

export default function App() {
  const [currentPage, setCurrentPage] = useState<PageId>('home');
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [academicConfig, setAcademicConfig] = useState<AcademicConfig | null>(null);
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [activeSession, setActiveSession] = useState<ActiveExamSession | null>(null);
  const [latestResult, setLatestResult] = useState<ExamResult | null>(null);

  // Staff Bearer tokens strictly held in React memory
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [teacherToken, setTeacherToken] = useState<string | null>(null);
  const [teacherProfile, setTeacherProfile] = useState<TeacherPublicProfile | null>(null);
  const [showStaffAuthModal, setShowStaffAuthModal] = useState(false);
  const [staffModalTab, setStaffModalTab] = useState<'admin' | 'teacher'>('admin');

  // Confirm leaving an active timed exam
  const [pendingLeaveTarget, setPendingLeaveTarget] = useState<PageId | 'staff-modal' | null>(null);

  const loadSubjects = useCallback(async () => {
    setLoadingSubjects(true);
    try {
      const res = await fetch('/api/subjects');
      if (res.ok) {
        const data = await res.json();
        setSubjects(data.subjects || []);
        if (data.academicConfig) {
          setAcademicConfig(data.academicConfig);
        }
      }
    } catch {
      // Keep current list on transient failure
    } finally {
      setLoadingSubjects(false);
    }
  }, []);

  useEffect(() => {
    void loadSubjects();
  }, [loadSubjects]);

  // Direct hidden URL access (/admin, /staff, /teacher, #admin/#staff/#teacher, ?admin=1/?teacher=1) & shortcuts (Alt+Shift+A / Ctrl+Shift+A)
  useEffect(() => {
    const checkStaffRoute = () => {
      const pathLower = window.location.pathname.replace(/\/+$/, '').toLowerCase();
      const hashLower = window.location.hash.toLowerCase();
      const searchParams = new URLSearchParams(window.location.search);
      if (
        pathLower === '/teacher' ||
        hashLower === '#teacher' ||
        searchParams.has('teacher')
      ) {
        setStaffModalTab('teacher');
        setShowStaffAuthModal(true);
      } else if (
        pathLower === '/admin' ||
        pathLower === '/staff' ||
        hashLower === '#admin' ||
        hashLower === '#staff' ||
        searchParams.has('admin') ||
        searchParams.has('staff')
      ) {
        setStaffModalTab('admin');
        setShowStaffAuthModal(true);
      }
    };

    checkStaffRoute();
    window.addEventListener('popstate', checkStaffRoute);
    window.addEventListener('hashchange', checkStaffRoute);
    return () => {
      window.removeEventListener('popstate', checkStaffRoute);
      window.removeEventListener('hashchange', checkStaffRoute);
    };
  }, []);

  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const isAdminCombo =
        (e.altKey && e.shiftKey && key === 'a') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'a');
      const isTeacherCombo = e.altKey && e.shiftKey && key === 't';

      if (isAdminCombo || isTeacherCombo) {
        e.preventDefault();
        if (activeSession && currentPage === 'take-exam') return;
        if (adminToken) {
          setCurrentPage('admin');
        } else if (teacherToken && teacherProfile) {
          setCurrentPage('teacher');
        } else {
          setStaffModalTab(isTeacherCombo ? 'teacher' : 'admin');
          setShowStaffAuthModal(true);
        }
      }
    };

    window.addEventListener('keydown', handleShortcut);
    return () => {
      window.removeEventListener('keydown', handleShortcut);
    };
  }, [activeSession, adminToken, currentPage, teacherProfile, teacherToken]);

  const navigateNow = useCallback((page: PageId) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleNavigate = (page: PageId) => {
    if (activeSession && currentPage === 'take-exam' && page !== 'take-exam') {
      setPendingLeaveTarget(page);
      return;
    }
    navigateNow(page);
  };

  const handleOpenStaffPortal = () => {
    if (activeSession && currentPage === 'take-exam') {
      setPendingLeaveTarget('staff-modal');
      return;
    }
    if (adminToken) {
      navigateNow('admin');
    } else if (teacherToken && teacherProfile) {
      navigateNow('teacher');
    } else {
      setShowStaffAuthModal(true);
    }
  };

  const cleanStaffUrl = () => {
    if (window.location.pathname !== '/' || window.location.hash || window.location.search) {
      window.history.replaceState({}, '', '/');
    }
  };

  const handleAdminAuthenticated = (token: string) => {
    setAdminToken(token);
    setShowStaffAuthModal(false);
    cleanStaffUrl();
    navigateNow('admin');
  };

  const handleTeacherAuthenticated = (token: string, teacher: TeacherPublicProfile) => {
    setTeacherToken(token);
    setTeacherProfile(teacher);
    setShowStaffAuthModal(false);
    cleanStaffUrl();
    navigateNow('teacher');
  };

  const handleAdminSignOut = async () => {
    if (adminToken) {
      try {
        await fetch('/api/admin/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
        });
      } catch {
        // Ignore network errors on logout
      }
    }
    setAdminToken(null);
    cleanStaffUrl();
    navigateNow('home');
  };

  const handleTeacherSignOut = async () => {
    if (teacherToken) {
      try {
        await fetch('/api/teacher/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${teacherToken}` },
        });
      } catch {
        // Ignore network errors on logout
      }
    }
    setTeacherToken(null);
    setTeacherProfile(null);
    cleanStaffUrl();
    navigateNow('home');
  };

  const handleAdminSessionExpired = useCallback(() => {
    setAdminToken(null);
    setStaffModalTab('admin');
    setShowStaffAuthModal(true);
    navigateNow('home');
  }, [navigateNow]);

  const handleTeacherSessionExpired = useCallback(() => {
    setTeacherToken(null);
    setTeacherProfile(null);
    setStaffModalTab('teacher');
    setShowStaffAuthModal(true);
    navigateNow('home');
  }, [navigateNow]);

  const handleExamCompleted = (result: ExamResult) => {
    setActiveSession(null);
    setLatestResult(result);
    navigateNow('check-result');
  };

  const handleConfirmAbandonExam = () => {
    const target = pendingLeaveTarget;
    setPendingLeaveTarget(null);
    setActiveSession(null);
    if (target === 'staff-modal') {
      if (adminToken) {
        navigateNow('admin');
      } else if (teacherToken && teacherProfile) {
        navigateNow('teacher');
      } else {
        setShowStaffAuthModal(true);
      }
    } else if (target) {
      navigateNow(target);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <div className="no-print">
        <Navbar
          currentPage={currentPage}
          onNavigate={handleNavigate}
          onOpenStaffPortal={handleOpenStaffPortal}
          isStaffAuthenticated={Boolean(adminToken || teacherToken)}
        />
      </div>

      <main className="flex-1">
        {currentPage === 'home' && (
          <HomePage
            subjects={subjects}
            loadingSubjects={loadingSubjects}
            onNavigate={handleNavigate}
          />
        )}

        {currentPage === 'take-exam' && (
          <TakeExamPage
            subjects={subjects}
            preselectedSubjectId={null}
            activeSession={activeSession}
            onSessionStart={setActiveSession}
            onExamCompleted={handleExamCompleted}
          />
        )}

        {currentPage === 'check-result' && (
          <CheckResultPage
            latestResult={latestResult}
            onNavigate={handleNavigate}
          />
        )}

        {currentPage === 'about' && <AboutPage onNavigate={handleNavigate} />}

        {currentPage === 'contact' && <ContactPage />}

        {currentPage === 'admin' && adminToken && (
          <AdminDashboardPage
            adminToken={adminToken}
            onSignOut={() => void handleAdminSignOut()}
            onSessionExpired={handleAdminSessionExpired}
            onDataChanged={() => void loadSubjects()}
          />
        )}

        {currentPage === 'teacher' && teacherToken && teacherProfile && (
          <TeacherPortalPage
            teacherToken={teacherToken}
            teacherProfile={teacherProfile}
            onSignOut={() => void handleTeacherSignOut()}
            onSessionExpired={handleTeacherSessionExpired}
            onDataChanged={() => void loadSubjects()}
          />
        )}
      </main>

      <footer className="no-print bg-white border-t border-slate-200 py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p
            onDoubleClick={handleOpenStaffPortal}
            className="font-medium text-slate-700 select-none"
          >
            JAIMAN GOLDENLITE TECH LTD · Akoko-Edo L.G.A., Edo State ·{' '}
            <span className="text-slate-500">
              {academicConfig?.currentSession || '2026/2027'} ({academicConfig?.currentTerm || 'First Term'})
            </span>
          </p>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => handleNavigate('home')}
              className="hover:text-blue-900 cursor-pointer"
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => handleNavigate('take-exam')}
              className="hover:text-blue-900 cursor-pointer"
            >
              Take Exam
            </button>
            <button
              type="button"
              onClick={() => handleNavigate('check-result')}
              className="hover:text-blue-900 cursor-pointer"
            >
              Check Result
            </button>
            <button
              type="button"
              onClick={() => handleNavigate('contact')}
              className="hover:text-blue-900 cursor-pointer"
            >
              Exam Support
            </button>
          </div>
        </div>
      </footer>

      <AdminAuthModal
        isOpen={showStaffAuthModal}
        initialTab={staffModalTab}
        onClose={() => {
          setShowStaffAuthModal(false);
          if (window.location.pathname !== '/' || window.location.hash || window.location.search) {
            window.history.replaceState({}, '', '/');
          }
        }}
        onAuthenticatedAdmin={handleAdminAuthenticated}
        onAuthenticatedTeacher={handleTeacherAuthenticated}
      />

      {/* In-app confirmation before abandoning an active timed exam */}
      {pendingLeaveTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Leave Active Examination?
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  Your timed CBT session is still running. Your progress has been autosaved on the server, and you can resume before the timer expires.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPendingLeaveTarget(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Stay in Exam
              </button>
              <button
                type="button"
                onClick={handleConfirmAbandonExam}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-700 hover:bg-red-600 rounded-lg cursor-pointer"
              >
                Leave Exam
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
