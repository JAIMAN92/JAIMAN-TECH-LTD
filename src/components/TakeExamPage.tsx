import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  CloudOff,
  Copy,
  Flag,
  KeyRound,
  Lock,
  LogOut,
  Maximize2,
  Play,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldAlert,
  UserCheck,
  UserPlus,
  WifiOff,
} from 'lucide-react';
import {
  CLASS_ARMS,
  CLASS_LEVELS,
  type AcademicConfig,
  type ActiveExamSession,
  type ClassArm,
  type ClassLevel,
  type ExamResult,
  type OptionKey,
  type PublicQuestion,
  type Student,
  type StudentGender,
  type Subject,
} from '../types';
import { safeReadJson } from '../utils/http';

interface TakeExamPageProps {
  subjects: Subject[];
  preselectedSubjectId: string | null;
  activeSession: ActiveExamSession | null;
  onSessionStart: (session: ActiveExamSession) => void;
  onExamCompleted: (result: ExamResult) => void;
}

interface PortalAssignedSubject extends Subject {
  attemptsUsed: number;
  attemptsRemaining: number | null;
  scheduleStatus: 'open' | 'upcoming' | 'closed';
}

interface ResumableDraftSummary {
  sessionId: string;
  subjectId: string;
  subjectName?: string;
  subjectCode?: string;
  startedAt: number;
  expiresAt: number;
  lastSavedAt: string;
  answeredCount: number;
}

interface StudentPortalPayload {
  student: Student;
  academicConfig: AcademicConfig;
  assignedSubjects: PortalAssignedSubject[];
  activeDrafts: ResumableDraftSummary[];
  allowedResults: ExamResult[];
}

interface PendingOfflineSubmission {
  sessionId: string;
  answers: Record<string, string>;
  autoSubmitted: boolean;
  tabViolations?: number;
  terminationReason?: string;
  queuedAt: string;
  subjectName: string;
  studentName: string;
  examNumber: string;
}

const ALL_OPTION_KEYS: OptionKey[] = ['A', 'B', 'C', 'D'];
const TRUE_FALSE_KEYS: OptionKey[] = ['A', 'B'];
const MAX_SECURITY_VIOLATIONS = 3;
const PENDING_SUBMIT_STORAGE_KEY = 'gloryland_cbt_pending_submit';
const DRAFT_PREFIX = 'gloryland_cbt_draft_';

function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatSavedTime(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

export const TakeExamPage: React.FC<TakeExamPageProps> = ({
  subjects,
  preselectedSubjectId,
  activeSession,
  onSessionStart,
  onExamCompleted,
}) => {
  // Entry mode: Quick Sign-In, Student Portal, or Register New Student
  const [entryMode, setEntryMode] = useState<'signin' | 'portal' | 'register'>('signin');

  // Quick Sign-In form state
  const [studentName, setStudentName] = useState('');
  const [examNumber, setExamNumber] = useState('');
  const [classLevel, setClassLevel] = useState<ClassLevel>('SS1');
  const [classArm, setClassArm] = useState<ClassArm>('A');
  const [subjectId, setSubjectId] = useState('');
  const [loginError, setLoginError] = useState('');
  const [starting, setStarting] = useState(false);

  // Lookup auto-fill & resumable drafts for Sign-In
  const [verifyingExamNo, setVerifyingExamNo] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState<{
    tone: 'success' | 'info';
    text: string;
  } | null>(null);
  const [signInDrafts, setSignInDrafts] = useState<ResumableDraftSummary[]>([]);

  // Student Portal state
  const [portalExamNumber, setPortalExamNumber] = useState('');
  const [portalPasscode, setPortalPasscode] = useState('');
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState('');
  const [portalData, setPortalData] = useState<StudentPortalPayload | null>(null);
  const [portalPaperFilter, setPortalPaperFilter] = useState<'all' | 'exams' | 'practice'>('all');

  // New Student Registration state
  const [regName, setRegName] = useState('');
  const [regClass, setRegClass] = useState<ClassLevel>('JSS1');
  const [regArm, setRegArm] = useState<ClassArm>('A');
  const [regGender, setRegGender] = useState<StudentGender>('Male');
  const [regPhone, setRegPhone] = useState('');
  const [regPasscode, setRegPasscode] = useState('');
  const [registering, setRegistering] = useState(false);
  const [regError, setRegError] = useState('');
  const [registeredStudent, setRegisteredStudent] = useState<Student | null>(null);
  const [copiedRegNo, setCopiedRegNo] = useState(false);

  // Offline submission sync state
  const [pendingOfflineSubmit, setPendingOfflineSubmit] =
    useState<PendingOfflineSubmission | null>(null);
  const [syncedOfflineResult, setSyncedOfflineResult] = useState<ExamResult | null>(null);
  const [syncingPending, setSyncingPending] = useState(false);

  // Active exam state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [autosaveStatus, setAutosaveStatus] = useState<{
    tone: 'saved' | 'offline';
    label: string;
  } | null>(null);

  // Lockdown & focus proctoring state
  const [violationCount, setViolationCount] = useState(0);
  const [securityModalMessage, setSecurityModalMessage] = useState<string | null>(null);
  const [shortcutAlert, setShortcutAlert] = useState<string | null>(null);
  const [needsFullscreenReentry, setNeedsFullscreenReentry] = useState(false);

  const answersRef = useRef<Record<string, string>>({});
  const flaggedRef = useRef<Record<string, boolean>>({});
  const autoSubmittedRef = useRef(false);
  const violationCountRef = useRef(0);
  const lastViolationTsRef = useRef(0);
  const enteredFullscreenRef = useRef(false);
  const shortcutTimerRef = useRef<number | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const dirtySinceAutosaveRef = useRef(false);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    flaggedRef.current = flagged;
  }, [flagged]);

  // Attempt syncing any offline-queued exam submission on mount and when online
  const flushPendingOfflineSubmit = useCallback(async () => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(PENDING_SUBMIT_STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) {
      setPendingOfflineSubmit(null);
      return;
    }

    let parsed: PendingOfflineSubmission | null = null;
    try {
      parsed = JSON.parse(raw) as PendingOfflineSubmission;
    } catch {
      window.localStorage.removeItem(PENDING_SUBMIT_STORAGE_KEY);
      return;
    }
    if (!parsed || !parsed.sessionId) {
      window.localStorage.removeItem(PENDING_SUBMIT_STORAGE_KEY);
      return;
    }

    setPendingOfflineSubmit(parsed);
    if (!navigator.onLine) return;

    setSyncingPending(true);
    try {
      const res = await fetch('/api/exams/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: parsed.sessionId,
          answers: parsed.answers,
          autoSubmitted: parsed.autoSubmitted,
          tabViolations: parsed.tabViolations,
          terminationReason: parsed.terminationReason,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        window.localStorage.removeItem(PENDING_SUBMIT_STORAGE_KEY);
        window.localStorage.removeItem(`${DRAFT_PREFIX}${parsed.sessionId}`);
        setPendingOfflineSubmit(null);
        setSyncedOfflineResult(data.result);
      } else if (res.status === 404) {
        // Session no longer exists or already synced previously
        window.localStorage.removeItem(PENDING_SUBMIT_STORAGE_KEY);
        setPendingOfflineSubmit(null);
      }
    } catch {
      // Remain queued until network is restored
    } finally {
      setSyncingPending(false);
    }
  }, []);

  useEffect(() => {
    void flushPendingOfflineSubmit();
    const handleOnline = () => {
      void flushPendingOfflineSubmit();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [flushPendingOfflineSubmit]);

  // Filter subjects compatible with selected class, arm, and active with questions
  const eligibleSubjects = useMemo(() => {
    return subjects.filter(
      (s) =>
        s.isActive &&
        (s.questionCount ?? 0) > 0 &&
        s.classes.includes(classLevel) &&
        (!s.arms || s.arms.length === 0 || s.arms.includes(classArm))
    );
  }, [subjects, classLevel, classArm]);

  // Preselect subject if navigated from HomePage
  useEffect(() => {
    if (!preselectedSubjectId) return;
    const match = subjects.find((s) => s.id === preselectedSubjectId);
    if (match) {
      if (!match.classes.includes(classLevel) && match.classes.length > 0) {
        setClassLevel(match.classes[0]);
      }
      if (match.arms && match.arms.length > 0 && !match.arms.includes(classArm)) {
        setClassArm(match.arms[0]);
      }
      setSubjectId(match.id);
    }
  }, [preselectedSubjectId, subjects, classLevel, classArm]);

  // Keep subjectId valid when class/arm changes
  useEffect(() => {
    if (eligibleSubjects.length === 0) {
      setSubjectId('');
      return;
    }
    if (!eligibleSubjects.some((s) => s.id === subjectId)) {
      setSubjectId(eligibleSubjects[0].id);
    }
  }, [eligibleSubjects, subjectId]);

  const selectedSubject = useMemo(
    () => eligibleSubjects.find((s) => s.id === subjectId) || null,
    [eligibleSubjects, subjectId]
  );

  // Restore draft answers + reset exam runner state whenever a session starts or resumes
  useEffect(() => {
    if (!activeSession) return;

    let initialAnswers: Record<string, string> = { ...(activeSession.savedAnswers || {}) };
    let initialFlagged: Record<string, boolean> = { ...(activeSession.savedFlagged || {}) };

    try {
      const localRaw = window.localStorage.getItem(`${DRAFT_PREFIX}${activeSession.sessionId}`);
      if (localRaw) {
        const localDraft = JSON.parse(localRaw) as {
          answers?: Record<string, string>;
          flagged?: Record<string, boolean>;
        };
        if (localDraft.answers) {
          initialAnswers = { ...initialAnswers, ...localDraft.answers };
        }
        if (localDraft.flagged) {
          initialFlagged = { ...initialFlagged, ...localDraft.flagged };
        }
      }
    } catch {
      // Ignore storage read errors
    }

    setCurrentIndex(0);
    setAnswers(initialAnswers);
    setFlagged(initialFlagged);
    answersRef.current = initialAnswers;
    flaggedRef.current = initialFlagged;
    dirtySinceAutosaveRef.current = false;
    autoSubmittedRef.current = false;
    violationCountRef.current = 0;
    lastViolationTsRef.current = 0;
    enteredFullscreenRef.current = Boolean(document.fullscreenElement);
    setViolationCount(0);
    setSecurityModalMessage(null);
    setShortcutAlert(null);
    setNeedsFullscreenReentry(false);
    setShowSubmitModal(false);
    setSubmitError('');

    if (activeSession.lastSavedAt) {
      setAutosaveStatus({
        tone: 'saved',
        label: `Autosaved ${formatSavedTime(activeSession.lastSavedAt)}`,
      });
    } else {
      setAutosaveStatus(null);
    }

    const initialRemaining = Math.max(
      1,
      Math.round((activeSession.expiresAt - Date.now()) / 1000)
    );
    setSecondsLeft(initialRemaining);
  }, [activeSession]);

  const requestExamFullscreen = useCallback(async () => {
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        enteredFullscreenRef.current = true;
        setNeedsFullscreenReentry(false);
      }
    } catch {
      // Fullscreen may be restricted by browser/iframe permissions
    }
  }, []);

  const exitExamFullscreen = useCallback(() => {
    enteredFullscreenRef.current = false;
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // Push autosave payload to server
  const pushAutosaveToServer = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch('/api/exams/autosave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          answers: answersRef.current,
          flagged: flaggedRef.current,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        dirtySinceAutosaveRef.current = false;
        setAutosaveStatus({
          tone: 'saved',
          label: `Autosaved ${formatSavedTime(data.savedAt || new Date().toISOString())}`,
        });
      }
    } catch {
      setAutosaveStatus({
        tone: 'offline',
        label: 'Saved locally (offline)',
      });
    }
  }, []);

  // Persist locally on every answer/flag edit and debounce server sync
  const updateAnswer = useCallback(
    (questionId: string, value: string) => {
      setAnswers((prev) => {
        const next = { ...prev, [questionId]: value };
        if (activeSession) {
          try {
            window.localStorage.setItem(
              `${DRAFT_PREFIX}${activeSession.sessionId}`,
              JSON.stringify({
                answers: next,
                flagged: flaggedRef.current,
                updatedAt: new Date().toISOString(),
              })
            );
          } catch {
            // Ignore quota issues
          }
        }
        return next;
      });
      dirtySinceAutosaveRef.current = true;
      if (activeSession) {
        if (autosaveTimerRef.current) {
          window.clearTimeout(autosaveTimerRef.current);
        }
        const sid = activeSession.sessionId;
        autosaveTimerRef.current = window.setTimeout(() => {
          void pushAutosaveToServer(sid);
        }, 800);
      }
    },
    [activeSession, pushAutosaveToServer]
  );

  const toggleFlag = useCallback(
    (questionId: string) => {
      setFlagged((prev) => {
        const next = { ...prev, [questionId]: !prev[questionId] };
        if (activeSession) {
          try {
            window.localStorage.setItem(
              `${DRAFT_PREFIX}${activeSession.sessionId}`,
              JSON.stringify({
                answers: answersRef.current,
                flagged: next,
                updatedAt: new Date().toISOString(),
              })
            );
          } catch {
            // Ignore quota issues
          }
        }
        return next;
      });
      dirtySinceAutosaveRef.current = true;
      if (activeSession) {
        if (autosaveTimerRef.current) {
          window.clearTimeout(autosaveTimerRef.current);
        }
        const sid = activeSession.sessionId;
        autosaveTimerRef.current = window.setTimeout(() => {
          void pushAutosaveToServer(sid);
        }, 800);
      }
    },
    [activeSession, pushAutosaveToServer]
  );

  // Periodic 15-second autosave heartbeat during active session
  useEffect(() => {
    if (!activeSession) return;
    const interval = window.setInterval(() => {
      if (dirtySinceAutosaveRef.current) {
        void pushAutosaveToServer(activeSession.sessionId);
      }
    }, 15000);
    return () => {
      window.clearInterval(interval);
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [activeSession, pushAutosaveToServer]);

  const submitExam = useCallback(
    async (isAuto: boolean, reason?: string, violations?: number) => {
      if (!activeSession || submitting) return;
      setSubmitting(true);
      setSubmitError('');

      const submissionPayload = {
        sessionId: activeSession.sessionId,
        answers: answersRef.current,
        autoSubmitted: isAuto,
        tabViolations: violations ?? violationCountRef.current,
        terminationReason: reason,
      };

      try {
        const res = await fetch('/api/exams/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(submissionPayload),
        });
        const data = await safeReadJson<{ result: ExamResult }>(res);
        if (!res.ok || !data.result) {
          setSubmitError(data.error || `Could not submit examination (HTTP ${res.status}).`);
          setSubmitting(false);
          return;
        }
        autoSubmittedRef.current = true;
        try {
          window.localStorage.removeItem(`${DRAFT_PREFIX}${activeSession.sessionId}`);
          window.localStorage.removeItem(PENDING_SUBMIT_STORAGE_KEY);
        } catch {
          // Ignore storage cleanup error
        }
        exitExamFullscreen();
        setSubmitting(false);
        setShowSubmitModal(false);
        setSecurityModalMessage(null);
        onExamCompleted(data.result);
      } catch {
        // Network disconnect during submission: persist offline retry queue so progress isn't lost
        const offlineRecord: PendingOfflineSubmission = {
          ...submissionPayload,
          queuedAt: new Date().toISOString(),
          subjectName: `${activeSession.subject.code} — ${activeSession.subject.name}`,
          studentName: activeSession.studentName,
          examNumber: activeSession.examNumber,
        };
        try {
          window.localStorage.setItem(
            PENDING_SUBMIT_STORAGE_KEY,
            JSON.stringify(offlineRecord)
          );
          setPendingOfflineSubmit(offlineRecord);
        } catch {
          // Ignore storage write failure
        }
        setSubmitError(
          'Connection dropped during submission. Your completed answers have been safely saved on this browser and will auto-submit as soon as the connection returns. Do not clear browser data.'
        );
        setSubmitting(false);
      }
    },
    [activeSession, exitExamFullscreen, onExamCompleted, submitting]
  );

  // Live countdown timer with auto-submit
  useEffect(() => {
    if (!activeSession) return;
    const interval = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((activeSession.expiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0 && !autoSubmittedRef.current) {
        autoSubmittedRef.current = true;
        window.clearInterval(interval);
        void submitExam(true);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [activeSession, submitExam]);

  const guardrailsEnabled = Boolean(
    activeSession && activeSession.subject.enableBrowserGuardrails !== false
  );

  // Exam Lockdown & Focus Proctoring Security Layer (conditional on enableBrowserGuardrails)
  useEffect(() => {
    if (!activeSession) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!autoSubmittedRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    if (!guardrailsEnabled) {
      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      };
    }

    const triggerShortcutAlert = (msg: string) => {
      setShortcutAlert(msg);
      if (shortcutTimerRef.current) {
        window.clearTimeout(shortcutTimerRef.current);
      }
      shortcutTimerRef.current = window.setTimeout(() => {
        setShortcutAlert(null);
      }, 3500);
    };

    const recordFocusViolation = (reason: string) => {
      if (autoSubmittedRef.current || submitting) return;
      const now = Date.now();
      if (now - lastViolationTsRef.current < 700) return;
      lastViolationTsRef.current = now;

      const nextCount = violationCountRef.current + 1;
      violationCountRef.current = nextCount;
      setViolationCount(nextCount);

      if (nextCount >= MAX_SECURITY_VIOLATIONS) {
        autoSubmittedRef.current = true;
        void submitExam(
          true,
          `Auto-submitted after ${MAX_SECURITY_VIOLATIONS} focus/tab-switch security violations.`,
          nextCount
        );
      } else {
        setSecurityModalMessage(reason);
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        recordFocusViolation(
          'You minimized the browser or switched to another tab/application. Leaving the examination window is prohibited.'
        );
      }
    };

    const handleWindowBlur = () => {
      recordFocusViolation(
        'Browser focus moved outside the examination window. Minimizing, opening new windows, or switching tabs is prohibited.'
      );
    };

    const handleFullscreenChange = () => {
      if (enteredFullscreenRef.current && !document.fullscreenElement && !autoSubmittedRef.current) {
        setNeedsFullscreenReentry(true);
        recordFocusViolation(
          'You exited fullscreen examination mode. Fullscreen must remain active until you submit your paper.'
        );
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      triggerShortcutAlert('Right-click menu is disabled during an active CBT examination.');
    };

    const handleClipboardBlock = (e: ClipboardEvent) => {
      const targetTag = (e.target as HTMLElement | null)?.tagName;
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA') return;
      e.preventDefault();
      triggerShortcutAlert('Copy and cut actions on question text are disabled during the examination.');
    };

    const handleLockdownKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      const isBlockedShortcut =
        e.key === 'F12' ||
        e.key === 'F5' ||
        e.key === 'F11' ||
        (ctrlOrMeta && ['t', 'n', 'w', 'r', 'c', 'p', 's', 'u'].includes(key)) ||
        (ctrlOrMeta && e.shiftKey && ['i', 'j', 'c', 'n', 't'].includes(key)) ||
        (ctrlOrMeta && e.key === 'Tab') ||
        (e.altKey && e.key === 'Tab');

      if (isBlockedShortcut) {
        e.preventDefault();
        e.stopPropagation();
        triggerShortcutAlert(
          'Opening new tabs, closing windows, refreshing, copying, or opening developer tools is blocked during the exam.'
        );
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('copy', handleClipboardBlock);
    document.addEventListener('cut', handleClipboardBlock);
    window.addEventListener('keydown', handleLockdownKeyDown, true);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('copy', handleClipboardBlock);
      document.removeEventListener('cut', handleClipboardBlock);
      window.removeEventListener('keydown', handleLockdownKeyDown, true);
      if (shortcutTimerRef.current) {
        window.clearTimeout(shortcutTimerRef.current);
      }
    };
  }, [activeSession, guardrailsEnabled, submitExam, submitting]);

  // Keyboard shortcuts during active exam (A-D / A-B to answer objective questions, Left/Right arrows to navigate)
  useEffect(() => {
    if (!activeSession || showSubmitModal || securityModalMessage) return;
    const currentQ = activeSession.questions[currentIndex];
    if (!currentQ) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const upper = e.key.toUpperCase();
      if (currentQ.type === 'true_false') {
        if (upper === 'A' || upper === 'B') {
          updateAnswer(currentQ.id, upper);
        }
      } else if (currentQ.type !== 'fill_blank') {
        if (upper === 'A' || upper === 'B' || upper === 'C' || upper === 'D') {
          updateAnswer(currentQ.id, upper);
        }
      }

      if (e.key === 'ArrowRight') {
        setCurrentIndex((i) => Math.min(activeSession.questions.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft') {
        setCurrentIndex((i) => Math.max(0, i - 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSession, currentIndex, securityModalMessage, showSubmitModal, updateAnswer]);

  const checkResumableDrafts = useCallback(async (trimmedExamNo: string) => {
    if (trimmedExamNo.length < 3) {
      setSignInDrafts([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/exams/resume?examNumber=${encodeURIComponent(trimmedExamNo)}`
      );
      if (res.ok) {
        const data = await res.json();
        setSignInDrafts(data.drafts || []);
      }
    } catch {
      // Ignore network glitch during draft check
    }
  }, []);

  const handleVerifyExamNumber = async () => {
    const trimmed = examNumber.trim().toUpperCase();
    if (trimmed.length < 3) {
      setVerifyNotice({
        tone: 'info',
        text: 'Enter an Admission / Exam Number first to auto-fill your profile.',
      });
      return;
    }

    setVerifyingExamNo(true);
    setVerifyNotice(null);
    setLoginError('');
    try {
      const [verifyRes] = await Promise.all([
        fetch(`/api/students/verify?examNumber=${encodeURIComponent(trimmed)}`),
        checkResumableDrafts(trimmed),
      ]);
      const data = await safeReadJson<{
        found?: boolean;
        student?: {
          fullName: string;
          examNumber: string;
          classLevel: ClassLevel;
          classArm: ClassArm;
        };
      }>(verifyRes);
      if (!verifyRes.ok) {
        setVerifyNotice({
          tone: 'info',
          text: data.error || `Unable to verify Exam Number (HTTP ${verifyRes.status}).`,
        });
      } else if (data.found && data.student) {
        setStudentName(data.student.fullName);
        setExamNumber(data.student.examNumber);
        setClassLevel(data.student.classLevel);
        setClassArm(data.student.classArm);
        setVerifyNotice({
          tone: 'success',
          text: `Profile loaded for ${data.student.fullName} (${data.student.classLevel} Arm ${data.student.classArm}).`,
        });
      } else {
        setVerifyNotice({
          tone: 'info',
          text: 'Exam Number not found in student registry. Switch to Register New Student to generate one.',
        });
      }
    } catch {
      setVerifyNotice({
        tone: 'info',
        text: 'Network error while verifying Exam Number.',
      });
    } finally {
      setVerifyingExamNo(false);
    }
  };

  const handleStudentPortalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = portalExamNumber.trim().toUpperCase();
    if (trimmed.length < 3) {
      setPortalError('Enter your Admission / Exam Number.');
      return;
    }

    setPortalLoading(true);
    setPortalError('');
    try {
      const res = await fetch('/api/students/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          examNumber: trimmed,
          passcode: portalPasscode.trim(),
        }),
      });
      const data = await safeReadJson<StudentPortalPayload>(res);
      if (!res.ok || !data.student) {
        setPortalError(data.error || `Could not sign in to Student Portal (HTTP ${res.status}).`);
        setPortalLoading(false);
        return;
      }
      setPortalData(data);
      setPortalLoading(false);
    } catch {
      setPortalError('Network error while connecting to Student Portal.');
      setPortalLoading(false);
    }
  };

  const handleRegisterStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (regName.trim().length < 2) {
      setRegError('Please enter the student full name (Surname First).');
      return;
    }

    setRegistering(true);
    setRegError('');
    try {
      const res = await fetch('/api/students/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: regName.trim(),
          classLevel: regClass,
          classArm: regArm,
          gender: regGender,
          guardianPhone: regPhone.trim(),
          ...(regPasscode.trim() ? { passcode: regPasscode.trim() } : {}),
        }),
      });
      const data = await safeReadJson<{ student: Student }>(res);
      if (!res.ok || !data.student) {
        setRegError(data.error || `Could not register student (HTTP ${res.status}).`);
        setRegistering(false);
        return;
      }
      setRegisteredStudent(data.student);
      setRegistering(false);
    } catch {
      setRegError('Network error while saving student registration.');
      setRegistering(false);
    }
  };

  const handleUseRegisteredStudent = (stu: Student) => {
    setStudentName(stu.fullName);
    setExamNumber(stu.examNumber);
    setClassLevel(stu.classLevel);
    setClassArm(stu.classArm);
    setPortalExamNumber(stu.examNumber);
    setVerifyNotice({
      tone: 'success',
      text: `Assigned Exam Number ${stu.examNumber} loaded. Select your subject below to begin.`,
    });
    setLoginError('');
    setEntryMode('signin');
  };

  const handleCopyRegisteredExamNumber = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedRegNo(true);
      window.setTimeout(() => setCopiedRegNo(false), 2000);
    } catch {
      // Clipboard blocked; code remains visible on screen
    }
  };

  const launchExamSession = async (params: {
    studentName: string;
    examNumber: string;
    classLevel: ClassLevel;
    classArm: ClassArm;
    subjectId: string;
    resumeSessionId?: string;
    onError: (msg: string) => void;
  }) => {
    setStarting(true);
    params.onError('');
    try {
      const res = await fetch('/api/exams/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName: params.studentName,
          examNumber: params.examNumber.toUpperCase(),
          classLevel: params.classLevel,
          classArm: params.classArm,
          subjectId: params.subjectId,
          ...(params.resumeSessionId ? { resumeSessionId: params.resumeSessionId } : {}),
        }),
      });
      const data = await safeReadJson<ActiveExamSession>(res);
      if (!res.ok || !data.sessionId) {
        params.onError(data.error || `Unable to start examination (HTTP ${res.status}).`);
        setStarting(false);
        return;
      }
      setStarting(false);
      if (data.subject?.enableBrowserGuardrails !== false) {
        await requestExamFullscreen();
      }
      onSessionStart(data);
    } catch {
      params.onError('Network error while starting examination. Please try again.');
      setStarting(false);
    }
  };

  const handleStartExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName.trim()) {
      setLoginError('Please enter your full name.');
      return;
    }
    if (!examNumber.trim()) {
      setLoginError('Please enter your Admission or Exam Number.');
      return;
    }
    if (!subjectId) {
      setLoginError('Please select an active examination subject.');
      return;
    }

    await launchExamSession({
      studentName: studentName.trim(),
      examNumber: examNumber.trim().toUpperCase(),
      classLevel,
      classArm,
      subjectId,
      onError: setLoginError,
    });
  };

  // RENDER STAGE 1: Sign-In, Student Portal, or New Student Registration
  if (!activeSession) {
    const filteredPortalSubjects = (portalData?.assignedSubjects || []).filter((s) => {
      if (portalPaperFilter === 'practice') return Boolean(s.isPractice || s.assessmentType === 'Practice');
      if (portalPaperFilter === 'exams') return !s.isPractice && s.assessmentType !== 'Practice';
      return true;
    });

    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
        <div className="max-w-2xl space-y-2">
          <p className="text-xs font-semibold text-amber-700 tracking-wide">
            JAIMAN GOLDENLITE TECH LTD · Examination Hall Portal
          </p>
          <h1 className="font-display text-3xl font-bold text-slate-900 tracking-tight">
            Candidate Exam Sign-In &amp; Student Portal
          </h1>
          <p className="text-sm sm:text-base text-slate-600">
            Sign in for an immediate exam, open your Student Portal to see assigned papers and practice tests, or register for an official Admission Number.
          </p>
        </div>

        {/* Offline Sync Recovery Banners */}
        {syncedOfflineResult && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm text-emerald-950">
              <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
              <span>
                Queued offline submission for{' '}
                <strong>{syncedOfflineResult.subjectCode}</strong> ({syncedOfflineResult.examNumber}) synced successfully.
              </span>
            </div>
            <button
              type="button"
              onClick={() => onExamCompleted(syncedOfflineResult)}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-600 rounded-lg cursor-pointer"
            >
              View Result Slip
            </button>
          </div>
        )}

        {pendingOfflineSubmit && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3 text-sm text-amber-950">
              <WifiOff className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">
                  Unsynced Offline Submission Queued ({pendingOfflineSubmit.subjectName})
                </p>
                <p className="text-xs text-amber-800 mt-0.5">
                  Candidate {pendingOfflineSubmit.examNumber} · Saved at{' '}
                  {new Date(pendingOfflineSubmit.queuedAt).toLocaleTimeString()}. It will auto-upload once internet returns.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={syncingPending}
              onClick={() => void flushPendingOfflineSubmit()}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-amber-950 bg-amber-200 hover:bg-amber-300 rounded-lg cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{syncingPending ? 'Syncing...' : 'Retry Sync Now'}</span>
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-5">
            {/* Segmented Mode Switch */}
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setEntryMode('signin')}
                className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
                  entryMode === 'signin'
                    ? 'bg-white text-blue-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <UserCheck className="w-4 h-4 shrink-0" />
                <span>Quick Sign-In</span>
              </button>
              <button
                type="button"
                onClick={() => setEntryMode('portal')}
                className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
                  entryMode === 'portal'
                    ? 'bg-white text-blue-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BookOpen className="w-4 h-4 shrink-0" />
                <span>Student Portal</span>
              </button>
              <button
                type="button"
                onClick={() => setEntryMode('register')}
                className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
                  entryMode === 'register'
                    ? 'bg-white text-blue-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <UserPlus className="w-4 h-4 shrink-0" />
                <span>Register</span>
              </button>
            </div>

            {/* MODE 1: QUICK SIGN-IN */}
            {entryMode === 'signin' && (
              <form onSubmit={handleStartExam} className="space-y-5">
                {signInDrafts.length > 0 && (
                  <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 space-y-2.5">
                    <p className="text-xs font-bold text-blue-950 flex items-center gap-1.5">
                      <RotateCcw className="w-3.5 h-3.5 text-blue-800" />
                      <span>Resumable Autosaved Session Found</span>
                    </p>
                    {signInDrafts.map((draft) => (
                      <div
                        key={draft.sessionId}
                        className="flex flex-wrap items-center justify-between gap-3 bg-white border border-blue-200 rounded-lg px-3.5 py-2.5 text-xs"
                      >
                        <div>
                          <p className="font-semibold text-slate-900">
                            {draft.subjectCode} — {draft.subjectName}
                          </p>
                          <p className="text-slate-500">
                            {draft.answeredCount} answered · Last saved {formatSavedTime(draft.lastSavedAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={starting}
                          onClick={() =>
                            void launchExamSession({
                              studentName: studentName.trim() || 'Candidate',
                              examNumber: examNumber.trim().toUpperCase(),
                              classLevel,
                              classArm,
                              subjectId: draft.subjectId,
                              resumeSessionId: draft.sessionId,
                              onError: setLoginError,
                            })
                          }
                          className="px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-600 rounded-lg cursor-pointer"
                        >
                          Resume Session
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <label
                      htmlFor="student-exam-number"
                      className="block text-sm font-medium text-slate-800"
                    >
                      Admission / Exam Number
                    </label>
                    <button
                      type="button"
                      disabled={verifyingExamNo}
                      onClick={() => void handleVerifyExamNumber()}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-900 hover:text-blue-700 cursor-pointer disabled:opacity-50"
                    >
                      <Search className="w-3.5 h-3.5" />
                      <span>{verifyingExamNo ? 'Checking...' : 'Auto-fill Profile'}</span>
                    </button>
                  </div>
                  <input
                    id="student-exam-number"
                    type="text"
                    required
                    value={examNumber}
                    onChange={(e) => {
                      setExamNumber(e.target.value.toUpperCase());
                      if (loginError) setLoginError('');
                      if (verifyNotice) setVerifyNotice(null);
                    }}
                    onBlur={() => {
                      if (examNumber.trim().length >= 6) {
                        void checkResumableDrafts(examNumber.trim().toUpperCase());
                      }
                    }}
                    placeholder="e.g. GSS/2026/0104"
                    className="w-full px-3.5 py-2.5 text-sm font-mono uppercase border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                  />
                  {verifyNotice && (
                    <p
                      className={`mt-1.5 text-xs font-medium ${
                        verifyNotice.tone === 'success' ? 'text-emerald-700' : 'text-amber-800'
                      }`}
                    >
                      {verifyNotice.text}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="student-full-name"
                    className="block text-sm font-medium text-slate-800 mb-1.5"
                  >
                    Full Name (Surname First)
                  </label>
                  <input
                    id="student-full-name"
                    type="text"
                    required
                    value={studentName}
                    onChange={(e) => {
                      setStudentName(e.target.value);
                      if (loginError) setLoginError('');
                    }}
                    placeholder="e.g. Okafor Chinedu Samuel"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="student-class"
                      className="block text-sm font-medium text-slate-800 mb-1.5"
                    >
                      Class
                    </label>
                    <select
                      id="student-class"
                      value={classLevel}
                      onChange={(e) => setClassLevel(e.target.value as ClassLevel)}
                      className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-800"
                    >
                      {CLASS_LEVELS.map((cls) => (
                        <option key={cls} value={cls}>
                          {cls}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="student-arm"
                      className="block text-sm font-medium text-slate-800 mb-1.5"
                    >
                      Arm
                    </label>
                    <select
                      id="student-arm"
                      value={classArm}
                      onChange={(e) => setClassArm(e.target.value as ClassArm)}
                      className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-800"
                    >
                      {CLASS_ARMS.map((arm) => (
                        <option key={arm} value={arm}>
                          Arm {arm}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="student-subject"
                    className="block text-sm font-medium text-slate-800 mb-1.5"
                  >
                    Examination / Practice Paper
                  </label>
                  {eligibleSubjects.length === 0 ? (
                    <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
                      No active examinations are currently assigned to {classLevel} Arm {classArm}. Please verify your class and arm or check with the Exam Officer.
                    </div>
                  ) : (
                    <select
                      id="student-subject"
                      value={subjectId}
                      onChange={(e) => setSubjectId(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-800"
                    >
                      {eligibleSubjects.map((sub) => (
                        <option key={sub.id} value={sub.id}>
                          {sub.code} — {sub.name} · {sub.assessmentType || (sub.isPractice ? 'Practice' : 'Exam')} ({sub.questionCount} Qs · {sub.durationMinutes} mins)
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {loginError && (
                  <p role="alert" className="text-xs font-medium text-red-700">
                    {loginError}
                  </p>
                )}

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={starting || !selectedSubject}
                    className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 text-sm sm:text-base font-bold text-white bg-blue-900 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                  >
                    <Play className="w-4 h-4" />
                    <span>{starting ? 'Preparing Examination...' : 'Begin Examination'}</span>
                  </button>
                </div>
              </form>
            )}

            {/* MODE 2: STUDENT PORTAL */}
            {entryMode === 'portal' && (
              <div className="space-y-5">
                {!portalData ? (
                  <form onSubmit={handleStudentPortalLogin} className="space-y-4">
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Log in with your Admission / Exam Number to see all assigned term exams, CA tests, CBT practice papers, resumable drafts, and permitted results.
                    </p>

                    <div>
                      <label
                        htmlFor="portal-exam-number"
                        className="block text-sm font-medium text-slate-800 mb-1.5"
                      >
                        Admission / Exam Number
                      </label>
                      <input
                        id="portal-exam-number"
                        type="text"
                        required
                        value={portalExamNumber}
                        onChange={(e) => {
                          setPortalExamNumber(e.target.value.toUpperCase());
                          if (portalError) setPortalError('');
                        }}
                        placeholder="e.g. GSS/2026/0104"
                        className="w-full px-3.5 py-2.5 text-sm font-mono uppercase border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="portal-passcode"
                        className="block text-sm font-medium text-slate-800 mb-1.5"
                      >
                        Student Passcode <span className="text-xs font-normal text-slate-500">(if configured for your account)</span>
                      </label>
                      <div className="relative">
                        <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          id="portal-passcode"
                          type="password"
                          value={portalPasscode}
                          onChange={(e) => {
                            setPortalPasscode(e.target.value);
                            if (portalError) setPortalError('');
                          }}
                          placeholder="Leave blank if no passcode is set"
                          className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                        />
                      </div>
                    </div>

                    {portalError && (
                      <p role="alert" className="text-xs font-medium text-red-700">
                        {portalError}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={portalLoading}
                      className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 text-sm sm:text-base font-bold text-white bg-blue-900 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                    >
                      <BookOpen className="w-4 h-4" />
                      <span>{portalLoading ? 'Signing In...' : 'Open Student Portal'}</span>
                    </button>

                    <p className="text-[11px] text-slate-500">
                      New candidate? Switch to{' '}
                      <button
                        type="button"
                        onClick={() => setEntryMode('register')}
                        className="font-semibold text-blue-900 hover:underline cursor-pointer"
                      >
                        Register
                      </button>{' '}
                      above to generate an Admission Number, or test with{' '}
                      <code className="font-mono">GSS/2026/0104</code> (no passcode).
                    </p>
                  </form>
                ) : (
                  <div className="space-y-5">
                    {/* Student Portal Profile Header */}
                    <div className="p-4 bg-blue-950 text-white rounded-xl flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs text-amber-300 font-semibold">
                          {portalData.academicConfig.currentSession} · {portalData.academicConfig.currentTerm}
                        </p>
                        <h2 className="font-display text-base font-bold">
                          {portalData.student.fullName}
                        </h2>
                        <p className="text-xs text-blue-200 font-mono">
                          {portalData.student.examNumber} · {portalData.student.classLevel} Arm {portalData.student.classArm}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPortalData(null);
                          setPortalPasscode('');
                          setPortalError('');
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-900 hover:bg-blue-800 border border-blue-700 rounded-lg cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Sign Out</span>
                      </button>
                    </div>

                    {portalError && (
                      <p role="alert" className="text-xs font-medium text-red-700">
                        {portalError}
                      </p>
                    )}

                    {/* Resumable Drafts */}
                    {portalData.activeDrafts.length > 0 && (
                      <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2.5">
                        <p className="text-xs font-bold text-emerald-950">
                          Continue Saved Examination Session
                        </p>
                        {portalData.activeDrafts.map((draft) => {
                          const sub = portalData.assignedSubjects.find(
                            (s) => s.id === draft.subjectId
                          );
                          return (
                            <div
                              key={draft.sessionId}
                              className="bg-white border border-emerald-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                            >
                              <div>
                                <p className="font-semibold text-slate-900">
                                  {sub ? `${sub.code} — ${sub.name}` : 'Active Examination'}
                                </p>
                                <p className="text-slate-500">
                                  {draft.answeredCount} questions answered · Autosaved {formatSavedTime(draft.lastSavedAt)}
                                </p>
                              </div>
                              <button
                                type="button"
                                disabled={starting}
                                onClick={() =>
                                  void launchExamSession({
                                    studentName: portalData.student.fullName,
                                    examNumber: portalData.student.examNumber,
                                    classLevel: portalData.student.classLevel,
                                    classArm: portalData.student.classArm,
                                    subjectId: draft.subjectId,
                                    resumeSessionId: draft.sessionId,
                                    onError: setPortalError,
                                  })
                                }
                                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-600 rounded-lg cursor-pointer"
                              >
                                Resume Now
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Assigned Tests & Practice Papers */}
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-display text-sm font-bold text-slate-900">
                          Assigned Tests &amp; Practice ({filteredPortalSubjects.length})
                        </h3>
                        <div className="flex items-center gap-1 text-xs">
                          {(
                            [
                              ['all', 'All'],
                              ['exams', 'Exams / CA'],
                              ['practice', 'Practice'],
                            ] as const
                          ).map(([val, label]) => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => setPortalPaperFilter(val)}
                              className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer ${
                                portalPaperFilter === val
                                  ? 'bg-blue-900 text-white'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {filteredPortalSubjects.length === 0 ? (
                        <p className="text-xs text-slate-500 py-4 text-center border border-dashed border-slate-200 rounded-xl">
                          No papers match this filter for {portalData.student.classLevel} Arm {portalData.student.classArm}.
                        </p>
                      ) : (
                        <div className="space-y-2.5">
                          {filteredPortalSubjects.map((sub) => {
                            const noQuestions = (sub.questionCount ?? 0) === 0;
                            const outOfAttempts =
                              sub.attemptsRemaining !== null && sub.attemptsRemaining <= 0;
                            const notOpen = sub.scheduleStatus !== 'open';
                            const disabled = starting || noQuestions || outOfAttempts || notOpen;

                            return (
                              <div
                                key={sub.id}
                                className="border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                              >
                                <div className="space-y-1">
                                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                    <span className="font-mono font-bold text-blue-900">
                                      {sub.code}
                                    </span>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-semibold text-amber-800">
                                      {sub.assessmentType || (sub.isPractice ? 'Practice' : 'Exam')}
                                    </span>
                                    <span aria-hidden="true">·</span>
                                    <span
                                      className={`font-semibold ${
                                        sub.scheduleStatus === 'open'
                                          ? 'text-emerald-700'
                                          : 'text-slate-500'
                                      }`}
                                    >
                                      {sub.scheduleStatus === 'open'
                                        ? 'Open'
                                        : sub.scheduleStatus === 'upcoming'
                                          ? `Opens ${new Date(sub.startAt!).toLocaleDateString()}`
                                          : 'Closed'}
                                    </span>
                                  </div>
                                  <p className="font-display text-sm font-bold text-slate-900">
                                    {sub.name}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {sub.questionCount} Qs · {sub.durationMinutes} mins ·{' '}
                                    {sub.attemptsRemaining === null
                                      ? `Unlimited attempts (${sub.attemptsUsed} used)`
                                      : `${sub.attemptsRemaining} of ${sub.allowedAttempts ?? 1} attempt(s) left`}
                                  </p>
                                </div>

                                <button
                                  type="button"
                                  disabled={disabled}
                                  onClick={() =>
                                    void launchExamSession({
                                      studentName: portalData.student.fullName,
                                      examNumber: portalData.student.examNumber,
                                      classLevel: portalData.student.classLevel,
                                      classArm: portalData.student.classArm,
                                      subjectId: sub.id,
                                      onError: setPortalError,
                                    })
                                  }
                                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-900 hover:bg-blue-800 disabled:opacity-45 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  <Play className="w-3.5 h-3.5" />
                                  <span>
                                    {outOfAttempts
                                      ? 'Attempt Used'
                                      : sub.isPractice
                                        ? 'Practice Now'
                                        : 'Start Exam'}
                                  </span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Allowed Results History */}
                    {portalData.allowedResults.length > 0 && (
                      <div className="pt-3 border-t border-slate-100 space-y-2.5">
                        <h3 className="font-display text-sm font-bold text-slate-900">
                          My Recent Submissions ({portalData.allowedResults.length})
                        </h3>
                        <div className="space-y-2">
                          {portalData.allowedResults.slice(0, 6).map((res) => (
                            <div
                              key={res.id}
                              className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                            >
                              <div>
                                <p className="font-semibold text-slate-900">
                                  {res.subjectCode} — {res.subjectName}
                                </p>
                                <p className="text-slate-500">
                                  {new Date(res.submittedAt).toLocaleDateString()} ·{' '}
                                  {res.scoreWithheld
                                    ? 'Recorded (Pending Release)'
                                    : `${res.score}/${res.totalQuestions} (${res.percentage}% · ${res.grade})`}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => onExamCompleted(res)}
                                className="text-xs font-semibold text-blue-900 hover:underline cursor-pointer"
                              >
                                View Slip
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* MODE 3: REGISTER NEW STUDENT */}
            {entryMode === 'register' &&
              (registeredStudent ? (
                <div className="space-y-5">
                  <div className="p-5 rounded-xl bg-emerald-50 border border-emerald-200 space-y-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                      <div>
                        <h2 className="font-display text-base font-bold text-emerald-950">
                          Student Registered &amp; Saved to Database
                        </h2>
                        <p className="text-xs text-emerald-800 mt-0.5">
                          Keep your automatically generated Admission / Exam Number for CBT sign-in and Result Checking.
                        </p>
                      </div>
                    </div>

                    <div className="bg-white border border-emerald-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-slate-500">
                          Generated Admission / Exam Number
                        </p>
                        <p className="font-mono text-2xl font-bold text-blue-950 tracking-tight mt-0.5">
                          {registeredStudent.examNumber}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopyRegisteredExamNumber(registeredStudent.examNumber)
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg cursor-pointer self-start sm:self-center"
                      >
                        {copiedRegNo ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-700" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy Number</span>
                          </>
                        )}
                      </button>
                    </div>

                    <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
                      <div>
                        <dt className="text-emerald-800">Student Name</dt>
                        <dd className="font-semibold text-slate-900 mt-0.5">
                          {registeredStudent.fullName}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-emerald-800">Class &amp; Arm</dt>
                        <dd className="font-semibold text-slate-900 mt-0.5">
                          {registeredStudent.classLevel} (Arm {registeredStudent.classArm})
                        </dd>
                      </div>
                      <div>
                        <dt className="text-emerald-800">Gender</dt>
                        <dd className="font-semibold text-slate-900 mt-0.5">
                          {registeredStudent.gender}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      type="button"
                      onClick={() => handleUseRegisteredStudent(registeredStudent)}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-bold text-white bg-blue-900 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <Play className="w-4 h-4" />
                      <span>Proceed to Exam Sign-In</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRegisteredStudent(null);
                        setRegName('');
                        setRegPhone('');
                        setRegPasscode('');
                        setRegError('');
                      }}
                      className="px-4 py-3 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                    >
                      Register Another
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleRegisterStudent} className="space-y-4">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Complete your profile below. The portal will save your record to the school database and automatically generate an official <strong className="text-slate-800">Admission / Exam Number</strong>.
                  </p>

                  <div>
                    <label
                      htmlFor="reg-full-name"
                      className="block text-sm font-medium text-slate-800 mb-1.5"
                    >
                      Student Full Name (Surname First)
                    </label>
                    <input
                      id="reg-full-name"
                      type="text"
                      required
                      value={regName}
                      onChange={(e) => {
                        setRegName(e.target.value);
                        if (regError) setRegError('');
                      }}
                      placeholder="e.g. Oshiomhole Faith Ese"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor="reg-class"
                        className="block text-sm font-medium text-slate-800 mb-1.5"
                      >
                        Class
                      </label>
                      <select
                        id="reg-class"
                        value={regClass}
                        onChange={(e) => setRegClass(e.target.value as ClassLevel)}
                        className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-800"
                      >
                        {CLASS_LEVELS.map((cls) => (
                          <option key={cls} value={cls}>
                            {cls}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="reg-arm"
                        className="block text-sm font-medium text-slate-800 mb-1.5"
                      >
                        Arm
                      </label>
                      <select
                        id="reg-arm"
                        value={regArm}
                        onChange={(e) => setRegArm(e.target.value as ClassArm)}
                        className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-800"
                      >
                        {CLASS_ARMS.map((arm) => (
                          <option key={arm} value={arm}>
                            Arm {arm}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor="reg-gender"
                        className="block text-sm font-medium text-slate-800 mb-1.5"
                      >
                        Gender
                      </label>
                      <select
                        id="reg-gender"
                        value={regGender}
                        onChange={(e) => setRegGender(e.target.value as StudentGender)}
                        className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-800"
                      >
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="reg-phone"
                        className="block text-sm font-medium text-slate-800 mb-1.5"
                      >
                        Parent / Guardian Phone (Optional)
                      </label>
                      <input
                        id="reg-phone"
                        type="tel"
                        value={regPhone}
                        onChange={(e) => setRegPhone(e.target.value)}
                        placeholder="e.g. 0803 123 4567"
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="reg-passcode"
                      className="block text-sm font-medium text-slate-800 mb-1.5"
                    >
                      Student Portal Passcode <span className="text-xs font-normal text-slate-500">(Optional — protects your portal login)</span>
                    </label>
                    <input
                      id="reg-passcode"
                      type="password"
                      value={regPasscode}
                      onChange={(e) => setRegPasscode(e.target.value)}
                      placeholder="Optional 4+ character passcode"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                    />
                  </div>

                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 flex items-center justify-between gap-3">
                    <span>Admission / Exam Number</span>
                    <span className="font-mono font-semibold text-blue-900">
                      Auto-generated (GSS/2026/XXXX)
                    </span>
                  </div>

                  {regError && (
                    <p role="alert" className="text-xs font-medium text-red-700">
                      {regError}
                    </p>
                  )}

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={registering}
                      className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 text-sm sm:text-base font-bold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>
                        {registering
                          ? 'Registering & Generating Number...'
                          : 'Register & Generate Exam Number'}
                      </span>
                    </button>
                  </div>
                </form>
              ))}
          </div>

          {/* Right Paper Details & Briefing */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <h2 className="font-display text-base font-bold text-slate-900">
              Selected Paper Briefing
            </h2>

            {selectedSubject ? (
              <div className="space-y-4">
                <div className="pb-4 border-b border-slate-100">
                  <p className="text-xs font-mono text-blue-900 font-semibold">
                    {selectedSubject.code} · {selectedSubject.term} ·{' '}
                    {selectedSubject.assessmentType || (selectedSubject.isPractice ? 'Practice' : 'Exam')}
                  </p>
                  <p className="font-display text-xl font-bold text-slate-900 mt-1">
                    {selectedSubject.name}
                  </p>
                </div>

                <dl className="space-y-2.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Target Class &amp; Arm</dt>
                    <dd className="font-semibold text-slate-900">
                      {classLevel} (Arm {classArm})
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Total Questions</dt>
                    <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                      {selectedSubject.questionCount} Questions
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Time Allowed</dt>
                    <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                      {selectedSubject.durationMinutes} Minutes
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Pass Mark</dt>
                    <dd className="font-mono font-semibold text-emerald-700 tabular-nums">
                      {selectedSubject.passMark}%
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Allowed Attempts</dt>
                    <dd className="font-semibold text-slate-800">
                      {selectedSubject.isPractice || (selectedSubject.allowedAttempts ?? 1) === 0
                        ? 'Unlimited'
                        : `${selectedSubject.allowedAttempts ?? 1} Attempt(s)`}
                    </dd>
                  </div>
                </dl>

                <div className="pt-4 border-t border-slate-100 space-y-2">
                  <p className="text-xs font-semibold text-slate-700">Instructions</p>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    {selectedSubject.instructions}
                  </p>
                </div>

                <div className="pt-4 border-t border-slate-100 flex items-start gap-2.5 text-xs text-slate-600">
                  {selectedSubject.enableBrowserGuardrails !== false ? (
                    <>
                      <Lock className="w-4 h-4 text-blue-900 shrink-0 mt-0.5" />
                      <p className="leading-relaxed">
                        <strong className="text-slate-800">Exam Lockdown &amp; Autosave:</strong> Your answers are saved automatically as you work. Opening new tabs, minimizing, or switching windows is monitored (limit: {MAX_SECURITY_VIOLATIONS} warnings).
                      </p>
                    </>
                  ) : (
                    <>
                      <BookOpen className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                      <p className="leading-relaxed">
                        <strong className="text-slate-800">Practice Mode · Autosave Active:</strong> Browser tab guardrails are relaxed for comfortable revision, while real-time autosave and instant grading remain enabled.
                      </p>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                Select an available class and subject to view examination duration and instructions.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // RENDER STAGE 2: Distraction-Free CBT Exam Runner
  const questions: PublicQuestion[] = activeSession.questions;
  const currentQuestion = questions[currentIndex];
  const answeredCount = questions.filter((q) => Boolean(answers[q.id]?.trim())).length;
  const unansweredCount = questions.length - answeredCount;
  const flaggedCount = Object.values(flagged).filter(Boolean).length;
  const completionPercentage =
    questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 0;

  const isCriticalTime = secondsLeft <= 60;
  const isWarningTime = secondsLeft > 60 && secondsLeft <= 300;

  const currentType = currentQuestion?.type || 'mcq';
  const currentAnswerValue = currentQuestion ? answers[currentQuestion.id]?.trim() || '' : '';

  return (
    <div
      className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5 ${
        guardrailsEnabled ? 'select-none' : ''
      }`}
    >
      {/* Top Exam Status Bar */}
      <div className="bg-blue-950 text-white rounded-xl px-5 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 border border-blue-900">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-blue-200">
            <span className="font-semibold text-amber-400">{activeSession.subject.code}</span>
            <span aria-hidden="true">·</span>
            <span>{activeSession.subject.name}</span>
            <span aria-hidden="true">·</span>
            <span>
              {activeSession.classLevel} {activeSession.classArm}
            </span>
            <span aria-hidden="true">·</span>
            {guardrailsEnabled ? (
              <span className="inline-flex items-center gap-1 text-emerald-300 font-medium">
                <Lock className="w-3 h-3" />
                <span>Lockdown Active</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-emerald-300 font-medium">
                <BookOpen className="w-3 h-3" />
                <span>Practice Mode</span>
              </span>
            )}
            {guardrailsEnabled && violationCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono font-semibold text-amber-300 tabular-nums">
                  Warnings: {violationCount}/{MAX_SECURITY_VIOLATIONS}
                </span>
              </>
            )}
            {autosaveStatus && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={`inline-flex items-center gap-1 font-medium ${
                    autosaveStatus.tone === 'offline' ? 'text-amber-300' : 'text-blue-200'
                  }`}
                >
                  {autosaveStatus.tone === 'offline' ? (
                    <CloudOff className="w-3 h-3" />
                  ) : (
                    <Save className="w-3 h-3" />
                  )}
                  <span>{autosaveStatus.label}</span>
                </span>
              </>
            )}
          </div>
          <div className="text-sm sm:text-base font-display font-bold text-white flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{activeSession.studentName}</span>
            <span className="font-mono text-xs sm:text-sm font-medium text-blue-200">
              ({activeSession.examNumber})
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between md:justify-end gap-3">
          {guardrailsEnabled && needsFullscreenReentry && (
            <button
              type="button"
              onClick={() => void requestExamFullscreen()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-blue-800 hover:bg-blue-700 border border-blue-600 rounded-lg transition-colors cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Fullscreen</span>
            </button>
          )}

          <div
            className={`px-4 py-2 rounded-lg border flex items-center gap-2.5 ${
              isCriticalTime
                ? 'bg-red-950/90 border-red-400 text-red-100'
                : isWarningTime
                  ? 'bg-amber-950/80 border-amber-400 text-amber-100'
                  : 'bg-blue-900/80 border-blue-700 text-white'
            }`}
          >
            <Clock className="w-4 h-4 shrink-0" />
            <div className="leading-tight">
              <span className="block text-[11px] opacity-85">Time Remaining</span>
              <span className="font-mono text-lg font-bold tabular-nums">
                {formatCountdown(secondsLeft)}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowSubmitModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-blue-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Send className="w-4 h-4" />
            <span>Submit Exam</span>
          </button>
        </div>
      </div>

      {/* Visual Completion Progress Bar */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-3.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
          <span className="font-display font-semibold text-slate-800">
            Examination Completion Progress
          </span>
          <span className="font-mono font-semibold text-slate-700 tabular-nums">
            {answeredCount} of {questions.length} Completed ·{' '}
            <span className="text-emerald-700 font-bold">{completionPercentage}%</span>
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Percentage of questions completed"
          aria-valuenow={completionPercentage}
          aria-valuemin={0}
          aria-valuemax={100}
          className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200/70"
        >
          <div
            className={`h-full rounded-full transition-all duration-200 ${
              completionPercentage === 100 ? 'bg-emerald-700' : 'bg-emerald-600'
            }`}
            style={{ width: `${completionPercentage}%` }}
          />
        </div>
      </div>

      {/* Transient Security Shortcut Alert */}
      {shortcutAlert && (
        <div
          role="alert"
          className="bg-amber-50 border border-amber-300 text-amber-950 rounded-xl px-4 py-3 text-xs sm:text-sm font-medium flex items-center gap-2.5"
        >
          <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
          <span>{shortcutAlert}</span>
        </div>
      )}

      {/* Main Two-Zone CBT Workspace */}
      {currentQuestion && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Question Stage */}
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-display text-sm sm:text-base font-bold text-blue-950 tabular-nums">
                  Question {currentIndex + 1} of {questions.length}
                </span>
                {currentQuestion.topic && (
                  <span className="text-xs font-medium text-slate-500">
                    · {currentQuestion.topic}
                  </span>
                )}
                {currentAnswerValue ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>
                      Answered ({currentType === 'fill_blank' ? 'Entered' : currentAnswerValue})
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">Not yet answered</span>
                )}
              </div>

              <button
                type="button"
                onClick={() => toggleFlag(currentQuestion.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                  flagged[currentQuestion.id]
                    ? 'bg-amber-50 border-amber-300 text-amber-800'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Flag className="w-3.5 h-3.5" />
                <span>
                  {flagged[currentQuestion.id] ? 'Marked for Review' : 'Mark for Review'}
                </span>
              </button>
            </div>

            {/* Comprehension Passage Card */}
            {currentType === 'comprehension' && currentQuestion.passage && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-blue-900">
                  {currentQuestion.passageTitle || 'Reading Passage'}
                </p>
                <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-line max-h-60 overflow-y-auto pr-1">
                  {currentQuestion.passage}
                </div>
              </div>
            )}

            {/* Question Prompt */}
            <div className="text-base sm:text-lg font-medium text-slate-900 leading-relaxed">
              {currentQuestion.prompt}
            </div>

            {/* Answer Input by Question Type */}
            {currentType === 'fill_blank' ? (
              <div className="space-y-2.5 select-text">
                <label
                  htmlFor={`fill-blank-${currentQuestion.id}`}
                  className="block text-xs font-semibold text-slate-700"
                >
                  Type Your Answer
                </label>
                <input
                  id={`fill-blank-${currentQuestion.id}`}
                  type="text"
                  value={answers[currentQuestion.id] || ''}
                  onChange={(e) => updateAnswer(currentQuestion.id, e.target.value)}
                  placeholder="Type your exact answer here..."
                  className="w-full px-4 py-3 text-base border border-slate-300 rounded-xl bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-800"
                />
                <p className="text-xs text-slate-500">
                  Be concise and accurate. Capitalization and extra leading/trailing spaces are ignored during automatic grading.
                </p>
              </div>
            ) : (
              <div className="space-y-3" role="radiogroup" aria-label="Answer options">
                {(currentType === 'true_false' ? TRUE_FALSE_KEYS : ALL_OPTION_KEYS).map(
                  (key) => {
                    const isSelected = answers[currentQuestion.id] === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => updateAnswer(currentQuestion.id, key)}
                        className={`w-full text-left p-4 rounded-xl border transition-colors flex items-start gap-3.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-800 ${
                          isSelected
                            ? 'bg-blue-50 border-blue-900 text-slate-950'
                            : 'bg-white border-slate-200 hover:border-blue-300 hover:bg-slate-50/70 text-slate-800'
                        }`}
                      >
                        <span
                          className={`w-7 h-7 rounded-md font-mono text-sm font-bold flex items-center justify-center shrink-0 transition-colors ${
                            isSelected
                              ? 'bg-blue-900 text-white'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {key}
                        </span>
                        <span className="text-sm sm:text-base leading-relaxed pt-0.5 flex-1">
                          {currentQuestion.options[key]}
                        </span>
                        {isSelected && (
                          <Check className="w-5 h-5 text-blue-900 shrink-0 mt-1" />
                        )}
                      </button>
                    );
                  }
                )}
              </div>
            )}

            {/* Previous / Next Controls */}
            <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
              <button
                type="button"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 rounded-lg transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Previous</span>
              </button>

              <span className="hidden sm:inline text-xs text-slate-400">
                {currentType === 'fill_blank'
                  ? 'Use arrow buttons to move between questions'
                  : currentType === 'true_false'
                    ? 'Tip: Press A/B to select · Left/Right arrows to navigate'
                    : 'Tip: Press A–D to select · Left/Right arrows to navigate'}
              </span>

              {currentIndex < questions.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
                >
                  <span>Next</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowSubmitModal(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-600 rounded-lg transition-colors cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Review &amp; Submit</span>
                </button>
              )}
            </div>
          </div>

          {/* Right: Question Navigator Grid */}
          <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
              <h2 className="font-display text-base font-bold text-slate-900">
                Question Navigator
              </h2>
              <span className="font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                {answeredCount} / {questions.length} Answered
              </span>
            </div>

            <div className="grid grid-cols-5 sm:grid-cols-6 lg:grid-cols-5 gap-2">
              {questions.map((q, idx) => {
                const isCurrent = idx === currentIndex;
                const isAnswered = Boolean(answers[q.id]?.trim());
                const isFlagged = Boolean(flagged[q.id]);

                let btnStyle =
                  'bg-white border-slate-300 text-slate-700 hover:border-blue-400';
                if (isAnswered) {
                  btnStyle = 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700';
                }
                if (isFlagged && !isAnswered) {
                  btnStyle = 'bg-amber-50 border-amber-500 text-amber-900';
                }

                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setCurrentIndex(idx)}
                    aria-label={`Question ${idx + 1}${isAnswered ? ', answered' : ', unanswered'}${isFlagged ? ', marked for review' : ''}`}
                    className={`relative h-10 rounded-lg border font-mono text-sm font-semibold tabular-nums transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-800 ${btnStyle} ${
                      isCurrent ? 'ring-2 ring-blue-900 ring-offset-2' : ''
                    }`}
                  >
                    {idx + 1}
                    {isFlagged && (
                      <span
                        aria-hidden="true"
                        className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500 border border-white"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Status Legend */}
            <div className="pt-3 border-t border-slate-100 grid grid-cols-2 gap-2.5 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded bg-emerald-600 inline-block shrink-0" />
                <span>Answered ({answeredCount})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded bg-white border border-slate-300 inline-block shrink-0" />
                <span>Unanswered ({unansweredCount})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded bg-white border-2 border-blue-900 inline-block shrink-0" />
                <span>Current Item</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded bg-amber-50 border border-amber-500 inline-block shrink-0" />
                <span>Review ({flaggedCount})</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowSubmitModal(true)}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
            >
              Finish &amp; Submit Exam
            </button>
          </aside>
        </div>
      )}

      {/* Confirm Submission Modal */}
      {showSubmitModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-submit-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 id="confirm-submit-title" className="font-display text-lg font-bold text-slate-900">
                  Submit Examination?
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  Once submitted, your answers will be graded immediately and you cannot return to this paper.
                </p>
              </div>
            </div>

            <dl className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">Answered Questions</dt>
                <dd className="font-mono font-bold text-emerald-700 tabular-nums">
                  {answeredCount} / {questions.length}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Unanswered Questions</dt>
                <dd className="font-mono font-bold text-slate-900 tabular-nums">
                  {unansweredCount}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Marked for Review</dt>
                <dd className="font-mono font-bold text-amber-700 tabular-nums">
                  {flaggedCount}
                </dd>
              </div>
            </dl>

            {submitError && (
              <p role="alert" className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {submitError}
              </p>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowSubmitModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                Return to Exam
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submitExam(false)}
                className="px-5 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
              >
                {submitting ? 'Grading...' : 'Confirm & Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Security Lockdown Warning Modal */}
      {guardrailsEnabled && securityModalMessage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-sm p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="security-lockdown-title"
        >
          <div className="w-full max-w-md bg-white border border-red-200 rounded-xl shadow-2xl overflow-hidden">
            <div className="bg-red-700 text-white px-6 py-4 flex items-center gap-3">
              <ShieldAlert className="w-6 h-6 shrink-0" />
              <div>
                <h3 id="security-lockdown-title" className="font-display text-base font-bold">
                  Exam Security Warning ({violationCount} of {MAX_SECURITY_VIOLATIONS})
                </h3>
                <p className="text-xs text-red-100">
                  JAIMAN GOLDENLITE TECH LTD CBT Focus Proctoring Active
                </p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-700 leading-relaxed">
                {securityModalMessage}
              </p>
              <p className="text-xs font-semibold text-red-800 bg-red-50 border border-red-200 rounded-lg p-3">
                Remaining warnings before automatic submission:{' '}
                <span className="font-mono font-bold tabular-nums">
                  {Math.max(0, MAX_SECURITY_VIOLATIONS - violationCount)}
                </span>
              </p>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setSecurityModalMessage(null);
                    void requestExamFullscreen();
                  }}
                  className="w-full px-5 py-2.5 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
                >
                  Acknowledge &amp; Return to Exam
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
