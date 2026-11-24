import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Download,
  Edit3,
  FileSpreadsheet,
  LogOut,
  Plus,
  Printer,
  Search,
  Sliders,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import {
  CLASS_ARMS,
  CLASS_LEVELS,
  TERM_NAMES,
  type AcademicConfig,
  type AssessmentType,
  type ClassArm,
  type ClassLevel,
  type ExamResult,
  type OptionKey,
  type Question,
  type QuestionType,
  type Subject,
  type TeacherPublicProfile,
} from '../types';
import {
  downloadQuestionTemplate,
  exportResultsSpreadsheet,
  parseQuestionsSpreadsheetFile,
  type ParsedSpreadsheetQuestion,
} from '../utils/spreadsheet';
import { safeReadJson } from '../utils/http';

interface TeacherPortalPageProps {
  teacherToken: string;
  teacherProfile: TeacherPublicProfile;
  onSignOut: () => void;
  onSessionExpired: () => void;
  onDataChanged: () => void;
}

type TeacherTab = 'tests' | 'questions' | 'scores';

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: 'Multiple Choice (A–D)',
  true_false: 'True / False',
  fill_blank: 'Fill-in-the-Blank',
  comprehension: 'Comprehension Passage',
};

function parsePipeOrJsonQuestions(raw: string): ParsedSpreadsheetQuestion[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (!Array.isArray(arr)) return [];
      const out: ParsedSpreadsheetQuestion[] = [];
      for (const item of arr) {
        if (!item?.prompt) continue;
        const type: QuestionType =
          item.type === 'true_false' || item.type === 'fill_blank' || item.type === 'comprehension'
            ? item.type
            : 'mcq';
        out.push({
          type,
          classLevel: String(item.classLevel || 'ALL').toUpperCase(),
          topic: String(item.topic || 'General'),
          passageTitle: item.passageTitle ? String(item.passageTitle) : undefined,
          passage: item.passage ? String(item.passage) : undefined,
          prompt: String(item.prompt).trim(),
          options: {
            A: String(item.options?.A || ''),
            B: String(item.options?.B || ''),
            C: String(item.options?.C || ''),
            D: String(item.options?.D || ''),
          },
          correctOption: (String(item.correctOption || 'A').toUpperCase() as OptionKey) || 'A',
          acceptableAnswers: Array.isArray(item.acceptableAnswers)
            ? item.acceptableAnswers.map(String)
            : undefined,
          explanation: item.explanation ? String(item.explanation) : undefined,
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  const parsed: ParsedSpreadsheetQuestion[] = [];
  for (const line of lines) {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length >= 6) {
      const correct = parts[5].toUpperCase();
      if (correct === 'A' || correct === 'B' || correct === 'C' || correct === 'D') {
        parsed.push({
          type: 'mcq',
          classLevel: 'ALL',
          topic: parts[6] || 'General',
          prompt: parts[0],
          options: { A: parts[1], B: parts[2], C: parts[3], D: parts[4] },
          correctOption: correct as OptionKey,
          explanation: parts[7] || undefined,
        });
      }
    }
  }
  return parsed;
}

export const TeacherPortalPage: React.FC<TeacherPortalPageProps> = ({
  teacherToken,
  teacherProfile,
  onSignOut,
  onSessionExpired,
  onDataChanged,
}) => {
  const [activeTab, setActiveTab] = useState<TeacherTab>('tests');
  const [academicConfig, setAcademicConfig] = useState<AcademicConfig>({
    currentSession: '2026/2027',
    currentTerm: 'First Term',
    sessions: ['2026/2027'],
  });
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [results, setResults] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState('');

  // Test / Exam Configuration modal state
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [subName, setSubName] = useState('');
  const [subCode, setSubCode] = useState('');
  const [subAssessmentType, setSubAssessmentType] = useState<AssessmentType>('CA');
  const [subTerm, setSubTerm] = useState('First Term');
  const [subSession, setSubSession] = useState('2026/2027');
  const [subClasses, setSubClasses] = useState<ClassLevel[]>(['JSS1', 'JSS2', 'JSS3']);
  const [subArms, setSubArms] = useState<ClassArm[]>([...CLASS_ARMS]);
  const [subDuration, setSubDuration] = useState(20);
  const [subPassMark, setSubPassMark] = useState(50);
  const [subAllowedAttempts, setSubAllowedAttempts] = useState(1);
  const [subStartAt, setSubStartAt] = useState('');
  const [subEndAt, setSubEndAt] = useState('');
  const [subIsPractice, setSubIsPractice] = useState(false);
  const [subShuffleQ, setSubShuffleQ] = useState(true);
  const [subShuffleOpt, setSubShuffleOpt] = useState(true);
  const [subShowScore, setSubShowScore] = useState(true);
  const [subShowReview, setSubShowReview] = useState(true);
  const [subGuardrails, setSubGuardrails] = useState(true);
  const [subActive, setSubActive] = useState(true);
  const [subInstructions, setSubInstructions] = useState('');
  const [subCuratedIds, setSubCuratedIds] = useState<string[]>([]);
  const [savingSubject, setSavingSubject] = useState(false);

  // Question Bank filters + modal
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [qClassFilter, setQClassFilter] = useState<'ALL' | ClassLevel>('ALL');
  const [qTopicFilter, setQTopicFilter] = useState('ALL');
  const [qTypeFilter, setQTypeFilter] = useState<'ALL' | QuestionType>('ALL');
  const [questionModalOpen, setQuestionModalOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [qType, setQType] = useState<QuestionType>('mcq');
  const [qClassLevel, setQClassLevel] = useState<ClassLevel | 'ALL'>('ALL');
  const [qTopic, setQTopic] = useState('General');
  const [qPassageTitle, setQPassageTitle] = useState('');
  const [qPassage, setQPassage] = useState('');
  const [qPrompt, setQPrompt] = useState('');
  const [qOptA, setQOptA] = useState('');
  const [qOptB, setQOptB] = useState('');
  const [qOptC, setQOptC] = useState('');
  const [qOptD, setQOptD] = useState('');
  const [qCorrect, setQCorrect] = useState<OptionKey>('A');
  const [qAcceptableAnswers, setQAcceptableAnswers] = useState('');
  const [qExplanation, setQExplanation] = useState('');
  const [savingQuestion, setSavingQuestion] = useState(false);

  // Bulk Upload state
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkFileQuestions, setBulkFileQuestions] = useState<ParsedSpreadsheetQuestion[]>([]);
  const [bulkFileName, setBulkFileName] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  // Score sheet filters
  const [scoreSearch, setScoreSearch] = useState('');
  const [scoreSubjectFilter, setScoreSubjectFilter] = useState('ALL');
  const [scoreClassFilter, setScoreClassFilter] = useState('ALL');
  const [scoreArmFilter, setScoreArmFilter] = useState<'ALL' | ClassArm>('ALL');
  const [scoreTypeFilter, setScoreTypeFilter] = useState<'ALL' | AssessmentType>('ALL');

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'subject' | 'question';
    id: string;
    label: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const authHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherToken}`,
    }),
    [teacherToken]
  );

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setErrorBanner('');
    try {
      const res = await fetch('/api/teacher/overview', {
        headers: { Authorization: `Bearer ${teacherToken}` },
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await safeReadJson<{
        academicConfig?: AcademicConfig;
        subjects?: Subject[];
        questions?: Question[];
        results?: ExamResult[];
      }>(res);
      if (!res.ok) {
        setErrorBanner(data.error || `Failed to load Teacher Portal (HTTP ${res.status}).`);
        setLoading(false);
        return;
      }
      if (data.academicConfig) setAcademicConfig(data.academicConfig);
      setSubjects(data.subjects || []);
      setQuestions(data.questions || []);
      setResults(data.results || []);
      setSelectedSubjectId((prev) => {
        if (prev && (data.subjects || []).some((s: Subject) => s.id === prev)) return prev;
        return data.subjects?.[0]?.id || '';
      });
      setLoading(false);
    } catch {
      setErrorBanner('Network error loading Teacher Portal.');
      setLoading(false);
    }
  }, [teacherToken, onSessionExpired]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const openCreateTest = () => {
    setEditingSubject(null);
    setSubName('');
    setSubCode('');
    setSubAssessmentType('CA');
    setSubSession(academicConfig.currentSession);
    setSubTerm(academicConfig.currentTerm);
    setSubClasses(teacherProfile.classes.length > 0 ? [...teacherProfile.classes] : ['SS1']);
    setSubArms([...CLASS_ARMS]);
    setSubDuration(20);
    setSubPassMark(50);
    setSubAllowedAttempts(1);
    setSubStartAt('');
    setSubEndAt('');
    setSubIsPractice(false);
    setSubShuffleQ(true);
    setSubShuffleOpt(true);
    setSubShowScore(true);
    setSubShowReview(true);
    setSubGuardrails(true);
    setSubActive(true);
    setSubInstructions('Read each question carefully and submit before the timer expires.');
    setSubCuratedIds([]);
    setTestModalOpen(true);
  };

  const openEditTest = (sub: Subject) => {
    setEditingSubject(sub);
    setSubName(sub.name);
    setSubCode(sub.code);
    setSubAssessmentType(sub.assessmentType || (sub.isPractice ? 'Practice' : 'Exam'));
    setSubSession(sub.sessionName || academicConfig.currentSession);
    setSubTerm(sub.term || academicConfig.currentTerm);
    setSubClasses(sub.classes);
    setSubArms(sub.arms && sub.arms.length > 0 ? sub.arms : [...CLASS_ARMS]);
    setSubDuration(sub.durationMinutes);
    setSubPassMark(sub.passMark);
    setSubAllowedAttempts(sub.allowedAttempts ?? (sub.isPractice ? 0 : 1));
    setSubStartAt(sub.startAt ? sub.startAt.slice(0, 16) : '');
    setSubEndAt(sub.endAt ? sub.endAt.slice(0, 16) : '');
    setSubIsPractice(Boolean(sub.isPractice));
    setSubShuffleQ(sub.shuffleQuestions !== false);
    setSubShuffleOpt(sub.shuffleOptions !== false);
    setSubShowScore(sub.showScoreAfterSubmit !== false);
    setSubShowReview(sub.showReviewAfterSubmit !== false);
    setSubGuardrails(sub.enableBrowserGuardrails !== false);
    setSubActive(sub.isActive);
    setSubInstructions(sub.instructions);
    setSubCuratedIds(sub.questionIds ? [...sub.questionIds] : []);
    setTestModalOpen(true);
  };

  const handleSaveTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subName.trim() || !subCode.trim() || subClasses.length === 0 || subArms.length === 0) return;

    setSavingSubject(true);
    setErrorBanner('');
    try {
      const url = editingSubject
        ? `/api/teacher/subjects/${editingSubject.id}`
        : '/api/teacher/subjects';
      const method = editingSubject ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: authHeaders,
        body: JSON.stringify({
          name: subName.trim(),
          code: subCode.trim().toUpperCase(),
          assessmentType: subIsPractice ? 'Practice' : subAssessmentType,
          sessionName: subSession,
          term: subTerm,
          isPractice: subIsPractice,
          classes: subClasses,
          arms: subArms,
          durationMinutes: Number(subDuration),
          passMark: Number(subPassMark),
          allowedAttempts: subIsPractice ? 0 : Number(subAllowedAttempts),
          startAt: subStartAt ? new Date(subStartAt).toISOString() : '',
          endAt: subEndAt ? new Date(subEndAt).toISOString() : '',
          shuffleQuestions: subShuffleQ,
          shuffleOptions: subShuffleOpt,
          showScoreAfterSubmit: subShowScore,
          showReviewAfterSubmit: subShowReview,
          enableBrowserGuardrails: subGuardrails,
          isActive: subActive,
          instructions: subInstructions.trim(),
          questionIds: subCuratedIds,
        }),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Could not save test settings.');
        setSavingSubject(false);
        return;
      }
      setSavingSubject(false);
      setTestModalOpen(false);
      await fetchOverview();
      onDataChanged();
    } catch {
      setErrorBanner('Network error while saving test configuration.');
      setSavingSubject(false);
    }
  };

  const handleToggleSubjectActive = async (subject: Subject) => {
    try {
      const res = await fetch(`/api/teacher/subjects/${subject.id}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ isActive: !subject.isActive }),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      if (res.ok) {
        await fetchOverview();
        onDataChanged();
      }
    } catch {
      setErrorBanner('Unable to toggle test status.');
    }
  };

  const openCreateQuestion = () => {
    setEditingQuestion(null);
    setQType('mcq');
    setQClassLevel('ALL');
    setQTopic('General');
    setQPassageTitle('');
    setQPassage('');
    setQPrompt('');
    setQOptA('');
    setQOptB('');
    setQOptC('');
    setQOptD('');
    setQCorrect('A');
    setQAcceptableAnswers('');
    setQExplanation('');
    setQuestionModalOpen(true);
  };

  const openEditQuestion = (q: Question) => {
    setEditingQuestion(q);
    setQType(q.type || 'mcq');
    setQClassLevel(q.classLevel || 'ALL');
    setQTopic(q.topic || 'General');
    setQPassageTitle(q.passageTitle || '');
    setQPassage(q.passage || '');
    setQPrompt(q.prompt);
    setQOptA(q.options.A || '');
    setQOptB(q.options.B || '');
    setQOptC(q.options.C || '');
    setQOptD(q.options.D || '');
    setQCorrect(q.correctOption || 'A');
    setQAcceptableAnswers((q.acceptableAnswers || []).join('; '));
    setQExplanation(q.explanation || '');
    setQuestionModalOpen(true);
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubjectId || !qPrompt.trim()) return;
    setSavingQuestion(true);
    setErrorBanner('');
    try {
      const url = editingQuestion
        ? `/api/teacher/questions/${editingQuestion.id}`
        : '/api/teacher/questions';
      const method = editingQuestion ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: authHeaders,
        body: JSON.stringify({
          subjectId: selectedSubjectId,
          type: qType,
          classLevel: qClassLevel,
          topic: qTopic.trim() || 'General',
          passageTitle: qType === 'comprehension' ? qPassageTitle.trim() : undefined,
          passage: qType === 'comprehension' ? qPassage.trim() : undefined,
          prompt: qPrompt.trim(),
          options:
            qType === 'true_false'
              ? { A: 'True', B: 'False', C: '', D: '' }
              : qType === 'fill_blank'
                ? { A: qAcceptableAnswers.split(';')[0]?.trim() || '', B: '', C: '', D: '' }
                : { A: qOptA.trim(), B: qOptB.trim(), C: qOptC.trim(), D: qOptD.trim() },
          correctOption: qCorrect,
          acceptableAnswers:
            qType === 'fill_blank'
              ? qAcceptableAnswers
                  .split(/[;|,]/)
                  .map((s) => s.trim())
                  .filter(Boolean)
              : undefined,
          explanation: qExplanation.trim(),
        }),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Could not save question.');
        setSavingQuestion(false);
        return;
      }
      setSavingQuestion(false);
      setQuestionModalOpen(false);
      await fetchOverview();
      onDataChanged();
    } catch {
      setErrorBanner('Network error while saving question.');
      setSavingQuestion(false);
    }
  };

  const handleSpreadsheetUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorBanner('');
    try {
      const parsed = await parseQuestionsSpreadsheetFile(file);
      setBulkFileName(file.name);
      setBulkFileQuestions(parsed);
    } catch {
      setErrorBanner('Could not read spreadsheet file. Use the downloadable .xlsx or .csv template.');
    }
  };

  const parsedBulkPreview = useMemo(() => {
    if (bulkFileQuestions.length > 0) return bulkFileQuestions;
    return parsePipeOrJsonQuestions(bulkText);
  }, [bulkFileQuestions, bulkText]);

  const handleBulkImport = async () => {
    if (!selectedSubjectId || parsedBulkPreview.length === 0) return;
    setBulkSaving(true);
    setErrorBanner('');
    try {
      const res = await fetch('/api/teacher/questions/bulk', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          subjectId: selectedSubjectId,
          questions: parsedBulkPreview,
        }),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Bulk upload failed.');
        setBulkSaving(false);
        return;
      }
      setBulkSaving(false);
      setBulkModalOpen(false);
      setBulkText('');
      setBulkFileQuestions([]);
      setBulkFileName('');
      await fetchOverview();
      onDataChanged();
    } catch {
      setErrorBanner('Network error during bulk upload.');
      setBulkSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const endpoint =
        deleteTarget.type === 'subject'
          ? `/api/teacher/subjects/${deleteTarget.id}`
          : `/api/teacher/questions/${deleteTarget.id}`;
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${teacherToken}` },
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Could not remove item.');
      }
      setDeleting(false);
      setDeleteTarget(null);
      await fetchOverview();
      onDataChanged();
    } catch {
      setErrorBanner('Network error while deleting item.');
      setDeleting(false);
    }
  };

  const subjectQuestions = useMemo(
    () => questions.filter((q) => q.subjectId === selectedSubjectId),
    [questions, selectedSubjectId]
  );

  const availableTopics = useMemo(() => {
    const set = new Set<string>();
    for (const q of subjectQuestions) {
      if (q.topic) set.add(q.topic);
    }
    return Array.from(set).sort();
  }, [subjectQuestions]);

  const filteredQuestions = useMemo(() => {
    return subjectQuestions.filter((q) => {
      if (qClassFilter !== 'ALL' && (q.classLevel || 'ALL') !== qClassFilter && q.classLevel !== 'ALL') {
        return false;
      }
      if (qTopicFilter !== 'ALL' && (q.topic || 'General') !== qTopicFilter) return false;
      if (qTypeFilter !== 'ALL' && (q.type || 'mcq') !== qTypeFilter) return false;
      return true;
    });
  }, [subjectQuestions, qClassFilter, qTopicFilter, qTypeFilter]);

  const filteredResults = useMemo(() => {
    const q = scoreSearch.trim().toLowerCase();
    return results.filter((r) => {
      if (scoreSubjectFilter !== 'ALL' && r.subjectId !== scoreSubjectFilter) return false;
      if (scoreClassFilter !== 'ALL' && r.classLevel !== scoreClassFilter) return false;
      if (scoreArmFilter !== 'ALL' && (r.classArm || 'A') !== scoreArmFilter) return false;
      if (scoreTypeFilter !== 'ALL' && (r.assessmentType || 'Exam') !== scoreTypeFilter)
        return false;
      if (q) {
        const hit =
          r.studentName.toLowerCase().includes(q) ||
          r.examNumber.toLowerCase().includes(q) ||
          r.referenceCode.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [results, scoreSearch, scoreSubjectFilter, scoreClassFilter, scoreArmFilter, scoreTypeFilter]);

  const scoreStats = useMemo(() => {
    if (filteredResults.length === 0) return { count: 0, avg: 0, passRate: 0 };
    const totalPct = filteredResults.reduce((acc, r) => acc + r.percentage, 0);
    const passes = filteredResults.filter((r) => r.passed).length;
    return {
      count: filteredResults.length,
      avg: Math.round(totalPct / filteredResults.length),
      passRate: Math.round((passes / filteredResults.length) * 100),
    };
  }, [filteredResults]);

  const bankForTestSubject = useMemo(() => {
    if (!editingSubject) return [];
    return questions.filter((q) => q.subjectId === editingSubject.id);
  }, [editingSubject, questions]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="no-print bg-blue-950 text-white rounded-xl px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-blue-900">
        <div>
          <p className="text-xs font-medium text-amber-400">
            JAIMAN GOLDENLITE TECH LTD · {academicConfig.currentSession} ({academicConfig.currentTerm})
          </p>
          <h1 className="font-display text-2xl font-bold tracking-tight mt-0.5">
            Teacher Portal — {teacherProfile.fullName}
          </h1>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 border border-blue-700 rounded-lg transition-colors cursor-pointer self-start sm:self-auto"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </button>
      </div>

      {errorBanner && (
        <div
          role="alert"
          className="no-print bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3 text-sm flex items-center justify-between"
        >
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner('')}
            className="p-1 hover:bg-red-100 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Segmented Tabs */}
      <div className="no-print flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('tests')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'tests'
                ? 'bg-white text-blue-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            My Tests &amp; Rules ({subjects.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('questions')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'questions'
                ? 'bg-white text-blue-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Question Bank ({questions.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('scores')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'scores'
                ? 'bg-white text-blue-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Class Score Sheets ({results.length})
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-500">
          Loading Teacher Portal...
        </div>
      ) : (
        <>
          {/* TAB 1: MY TESTS & EXAM RULES */}
          {activeTab === 'tests' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  Create Continuous Assessment (CA), Exam, Mock, or Practice tests, set schedules and exam rules, and curate questions.
                </p>
                <button
                  type="button"
                  onClick={openCreateTest}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-auto"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create New Test</span>
                </button>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-3.5 px-4">Code &amp; Type</th>
                        <th className="py-3.5 px-4">Test Title</th>
                        <th className="py-3.5 px-4">Classes</th>
                        <th className="py-3.5 px-4">Rules Summary</th>
                        <th className="py-3.5 px-4 text-right">Questions</th>
                        <th className="py-3.5 px-4">Status</th>
                        <th className="py-3.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {subjects.map((sub) => (
                        <tr key={sub.id} className="hover:bg-slate-50/70">
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <div className="font-mono text-xs font-semibold text-blue-900">
                              {sub.code}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {sub.assessmentType || (sub.isPractice ? 'Practice' : 'Exam')}
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-slate-900">{sub.name}</div>
                            <div className="text-xs text-slate-500">
                              {sub.sessionName || academicConfig.currentSession} · {sub.term}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-600">
                            <div>
                              {sub.classes.length === 6 ? 'JSS1–SS3' : sub.classes.join(', ')}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {sub.durationMinutes} min · Pass {sub.passMark}%
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-600 space-y-0.5">
                            <div>
                              Attempts:{' '}
                              <span className="font-mono font-semibold text-slate-800">
                                {sub.isPractice || (sub.allowedAttempts ?? 1) === 0
                                  ? 'Unlimited'
                                  : sub.allowedAttempts ?? 1}
                              </span>
                              {' · '}
                              {sub.showScoreAfterSubmit === false ? 'Score Withheld' : 'Instant Score'}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {sub.shuffleQuestions !== false ? 'Shuffled' : 'Fixed Order'} ·{' '}
                              {sub.enableBrowserGuardrails !== false ? 'Guardrails ON' : 'Practice Mode'}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-800">
                            {sub.questionCount ?? 0}
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => void handleToggleSubjectActive(sub)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                                sub.isActive
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                  : 'bg-slate-100 border-slate-200 text-slate-600'
                              }`}
                            >
                              {sub.isActive ? (
                                <>
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Open</span>
                                </>
                              ) : (
                                <>
                                  <XCircle className="w-3.5 h-3.5" />
                                  <span>Closed</span>
                                </>
                              )}
                            </button>
                          </td>
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedSubjectId(sub.id);
                                  setActiveTab('questions');
                                }}
                                title="Manage Questions"
                                className="p-1.5 text-slate-600 hover:text-blue-900 hover:bg-blue-50 rounded-md cursor-pointer"
                              >
                                <BookOpen className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditTest(sub)}
                                title="Edit Test Rules & Schedule"
                                className="p-1.5 text-slate-600 hover:text-blue-900 hover:bg-blue-50 rounded-md cursor-pointer"
                              >
                                <Sliders className="w-4 h-4" />
                              </button>
                              {sub.createdByTeacherId === teacherProfile.id && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDeleteTarget({
                                      type: 'subject',
                                      id: sub.id,
                                      label: `${sub.code} — ${sub.name}`,
                                    })
                                  }
                                  title="Delete Test"
                                  className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-md cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: QUESTION BANK */}
          {activeTab === 'questions' && (
            <div className="space-y-5">
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-1">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Subject
                      </label>
                      <select
                        value={selectedSubjectId}
                        onChange={(e) => {
                          setSelectedSubjectId(e.target.value);
                          setQTopicFilter('ALL');
                        }}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        {subjects.map((sub) => (
                          <option key={sub.id} value={sub.id}>
                            {sub.code} — {sub.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Class Level
                      </label>
                      <select
                        value={qClassFilter}
                        onChange={(e) => setQClassFilter(e.target.value as 'ALL' | ClassLevel)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="ALL">All Classes</option>
                        {CLASS_LEVELS.map((cls) => (
                          <option key={cls} value={cls}>
                            {cls}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Topic
                      </label>
                      <select
                        value={qTopicFilter}
                        onChange={(e) => setQTopicFilter(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="ALL">All Topics</option>
                        {availableTopics.map((topic) => (
                          <option key={topic} value={topic}>
                            {topic}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Question Type
                      </label>
                      <select
                        value={qTypeFilter}
                        onChange={(e) => setQTypeFilter(e.target.value as 'ALL' | QuestionType)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="ALL">All Types</option>
                        <option value="mcq">Multiple Choice</option>
                        <option value="true_false">True / False</option>
                        <option value="fill_blank">Fill-in-the-Blank</option>
                        <option value="comprehension">Comprehension</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      disabled={!selectedSubjectId}
                      onClick={() => setBulkModalOpen(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 disabled:opacity-50 rounded-lg cursor-pointer"
                    >
                      <Upload className="w-4 h-4" />
                      <span>Bulk Upload (Excel/CSV)</span>
                    </button>
                    <button
                      type="button"
                      disabled={!selectedSubjectId}
                      onClick={openCreateQuestion}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 disabled:opacity-50 rounded-lg cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Add Question</span>
                    </button>
                  </div>
                </div>
              </div>

              {filteredQuestions.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
                  <p className="font-display text-base font-bold text-slate-900">
                    No Matching Questions Found
                  </p>
                  <p className="text-sm text-slate-600">
                    Add a question directly or upload an Excel/CSV batch to populate this Question Bank.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredQuestions.map((q, idx) => (
                    <div
                      key={q.id}
                      className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-slate-500">
                            <span className="font-mono font-bold text-blue-900">Q{idx + 1}</span>
                            {' · '}
                            <span className="text-slate-700 font-semibold">
                              {QUESTION_TYPE_LABELS[q.type || 'mcq']}
                            </span>
                            {' · '}
                            <span>Topic: {q.topic || 'General'}</span>
                            {' · '}
                            <span>Class: {q.classLevel || 'ALL'}</span>
                          </div>
                          {q.passage && (
                            <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 leading-relaxed">
                              {q.passageTitle && (
                                <p className="font-bold text-slate-900 mb-1">{q.passageTitle}</p>
                              )}
                              <p>{q.passage}</p>
                            </div>
                          )}
                          <p className="text-sm sm:text-base font-semibold text-slate-900 pt-1">
                            {q.prompt}
                          </p>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEditQuestion(q)}
                            title="Edit Question"
                            className="p-1.5 text-slate-600 hover:text-blue-900 hover:bg-blue-50 rounded-md cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteTarget({
                                type: 'question',
                                id: q.id,
                                label: `Question "${q.prompt.slice(0, 50)}..."`,
                              })
                            }
                            title="Delete Question"
                            className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-md cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {q.type === 'fill_blank' ? (
                        <div className="text-xs sm:text-sm bg-emerald-50 border border-emerald-200 text-emerald-950 rounded-lg px-3 py-2">
                          Accepted Answers:{' '}
                          <span className="font-mono font-semibold">
                            {(q.acceptableAnswers || [q.options.A]).join(' | ')}
                          </span>
                        </div>
                      ) : q.type === 'true_false' ? (
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          {(['A', 'B'] as OptionKey[]).map((k) => {
                            const isCorrect = q.correctOption === k;
                            return (
                              <div
                                key={k}
                                className={`px-3 py-2 rounded-lg border flex items-center justify-between ${
                                  isCorrect
                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-semibold'
                                    : 'bg-slate-50 border-slate-200 text-slate-700'
                                }`}
                              >
                                <span>{k === 'A' ? 'True' : 'False'}</span>
                                {isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-700" />}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                          {(['A', 'B', 'C', 'D'] as OptionKey[]).map((k) => {
                            const isCorrect = q.correctOption === k;
                            return (
                              <div
                                key={k}
                                className={`px-3 py-2 rounded-lg border flex items-center justify-between gap-2 ${
                                  isCorrect
                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-medium'
                                    : 'bg-slate-50 border-slate-200 text-slate-700'
                                }`}
                              >
                                <span>
                                  <strong className="font-mono mr-1.5">{k}.</strong>
                                  {q.options[k]}
                                </span>
                                {isCorrect && (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: CLASS SCORE SHEETS */}
          {activeTab === 'scores' && (
            <div className="space-y-5">
              {/* Printable Official Header */}
              <div className="hidden print:block border-b-2 border-blue-950 pb-4 mb-4">
                <h2 className="font-display text-xl font-bold text-blue-950">
                  JAIMAN GOLDENLITE TECH LTD — CLASS SCORE SHEET
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  Teacher: {teacherProfile.fullName} · Session: {academicConfig.currentSession} (
                  {academicConfig.currentTerm}) · Generated {new Date().toLocaleDateString()}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <span className="text-xs font-medium text-slate-500">Total Scripts</span>
                  <p className="font-mono text-2xl font-bold text-slate-900 tabular-nums mt-1">
                    {scoreStats.count}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <span className="text-xs font-medium text-slate-500">Class Average</span>
                  <p className="font-mono text-2xl font-bold text-blue-900 tabular-nums mt-1">
                    {scoreStats.avg}%
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <span className="text-xs font-medium text-slate-500">Pass Rate</span>
                  <p className="font-mono text-2xl font-bold text-emerald-700 tabular-nums mt-1">
                    {scoreStats.passRate}%
                  </p>
                </div>
              </div>

              {/* Filter & Export Controls */}
              <div className="no-print bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={scoreSearch}
                      onChange={(e) => setScoreSearch(e.target.value)}
                      placeholder="Student name / Exam No."
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <select
                    value={scoreSubjectFilter}
                    onChange={(e) => setScoreSubjectFilter(e.target.value)}
                    className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="ALL">All Assigned Subjects</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={scoreClassFilter}
                    onChange={(e) => setScoreClassFilter(e.target.value)}
                    className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="ALL">All Classes</option>
                    {CLASS_LEVELS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select
                    value={scoreArmFilter}
                    onChange={(e) => setScoreArmFilter(e.target.value as 'ALL' | ClassArm)}
                    className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="ALL">All Arms</option>
                    {CLASS_ARMS.map((arm) => (
                      <option key={arm} value={arm}>
                        Arm {arm}
                      </option>
                    ))}
                  </select>
                  <select
                    value={scoreTypeFilter}
                    onChange={(e) => setScoreTypeFilter(e.target.value as 'ALL' | AssessmentType)}
                    className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="ALL">All Assessment Types</option>
                    <option value="CA">Continuous Assessment (CA)</option>
                    <option value="Exam">Termly Exam</option>
                    <option value="Mock">Mock</option>
                    <option value="Practice">Practice</option>
                  </select>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={filteredResults.length === 0}
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-lg cursor-pointer"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Print Score Sheet</span>
                  </button>
                  <button
                    type="button"
                    disabled={filteredResults.length === 0}
                    onClick={() =>
                      void exportResultsSpreadsheet(
                        filteredResults,
                        `jaiman-goldenlite-scoresheet-${new Date().toISOString().slice(0, 10)}`,
                        'csv'
                      )
                    }
                    className="inline-flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-semibold text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 disabled:opacity-50 rounded-lg cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Export CSV</span>
                  </button>
                  <button
                    type="button"
                    disabled={filteredResults.length === 0}
                    onClick={() =>
                      void exportResultsSpreadsheet(
                        filteredResults,
                        `jaiman-goldenlite-scoresheet-${new Date().toISOString().slice(0, 10)}`,
                        'xlsx'
                      )
                    }
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-lg cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>Export Excel (.xlsx)</span>
                  </button>
                </div>
              </div>

              <div className="print-only-card bg-white border border-slate-200 rounded-xl overflow-hidden">
                {filteredResults.length === 0 ? (
                  <div className="p-10 text-center space-y-2">
                    <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto" />
                    <p className="text-sm font-semibold text-slate-800">No Score Records Found</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                          <th className="py-3 px-4">Student Name</th>
                          <th className="py-3 px-4">Exam No.</th>
                          <th className="py-3 px-4">Class</th>
                          <th className="py-3 px-4">Subject &amp; Type</th>
                          <th className="py-3 px-4 text-right">Score</th>
                          <th className="py-3 px-4 text-right">%</th>
                          <th className="py-3 px-4">Grade</th>
                          <th className="py-3 px-4">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {filteredResults.map((r) => (
                          <tr key={r.id} className="hover:bg-slate-50/70">
                            <td className="py-3 px-4 font-semibold text-slate-900">
                              {r.studentName}
                            </td>
                            <td className="py-3 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                              {r.examNumber}
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                              {r.classLevel} {r.classArm}
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-700">
                              <div className="font-semibold text-slate-800">{r.subjectName}</div>
                              <div className="text-slate-500">
                                {r.assessmentType || 'Exam'} · {r.term || academicConfig.currentTerm}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900">
                              {r.score}/{r.totalQuestions}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold tabular-nums text-slate-900">
                              {r.percentage}%
                            </td>
                            <td className="py-3 px-4 text-xs font-medium text-slate-700 whitespace-nowrap">
                              {r.grade}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              <span
                                className={`text-xs font-semibold ${
                                  r.passed ? 'text-emerald-700' : 'text-red-700'
                                }`}
                              >
                                {r.passed ? 'PASS' : 'FAIL'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* MODAL: Create / Edit Test & Rules */}
      {testModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-blue-950 text-white px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-base font-bold">
                {editingSubject ? `Configure Test — ${editingSubject.name}` : 'Create New Assessment'}
              </h2>
              <button
                type="button"
                onClick={() => setTestModalOpen(false)}
                className="p-1 text-blue-200 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveTest} className="p-6 space-y-5 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Test / Subject Name
                  </label>
                  <input
                    type="text"
                    required
                    value={subName}
                    onChange={(e) => setSubName(e.target.value)}
                    placeholder="e.g. Mathematics Mid-Term CA"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Test Code
                  </label>
                  <input
                    type="text"
                    required
                    value={subCode}
                    onChange={(e) => setSubCode(e.target.value.toUpperCase())}
                    placeholder="e.g. MTH 202"
                    className="w-full px-3 py-2 text-sm font-mono uppercase border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Assessment Type
                  </label>
                  <select
                    value={subAssessmentType}
                    onChange={(e) => {
                      const val = e.target.value as AssessmentType;
                      setSubAssessmentType(val);
                      if (val === 'Practice') setSubIsPractice(true);
                      else setSubIsPractice(false);
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="CA">Continuous Assessment (CA)</option>
                    <option value="Exam">Termly Examination</option>
                    <option value="Mock">WAEC / NECO Mock</option>
                    <option value="Practice">Practice Test</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Academic Session
                  </label>
                  <select
                    value={subSession}
                    onChange={(e) => setSubSession(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {academicConfig.sessions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Term</label>
                  <select
                    value={subTerm}
                    onChange={(e) => setSubTerm(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {TERM_NAMES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-slate-700">Target Classes</span>
                  <button
                    type="button"
                    onClick={() => setSubClasses([...CLASS_LEVELS])}
                    className="text-xs font-semibold text-blue-900 hover:underline cursor-pointer"
                  >
                    Select All
                  </button>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {CLASS_LEVELS.map((cls) => {
                    const checked = subClasses.includes(cls);
                    return (
                      <button
                        key={cls}
                        type="button"
                        onClick={() =>
                          setSubClasses((prev) =>
                            prev.includes(cls) ? prev.filter((c) => c !== cls) : [...prev, cls]
                          )
                        }
                        className={`py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                          checked
                            ? 'bg-blue-900 border-blue-900 text-white'
                            : 'bg-white border-slate-300 text-slate-700'
                        }`}
                      >
                        {cls}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-slate-700">Target Arms</span>
                  <button
                    type="button"
                    onClick={() => setSubArms([...CLASS_ARMS])}
                    className="text-xs font-semibold text-blue-900 hover:underline cursor-pointer"
                  >
                    All Arms (A–J)
                  </button>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {CLASS_ARMS.map((arm) => {
                    const checked = subArms.includes(arm);
                    return (
                      <button
                        key={arm}
                        type="button"
                        onClick={() =>
                          setSubArms((prev) =>
                            prev.includes(arm) ? prev.filter((a) => a !== arm) : [...prev, arm]
                          )
                        }
                        className={`py-1 text-xs font-semibold rounded-lg border cursor-pointer ${
                          checked
                            ? 'bg-blue-900 border-blue-900 text-white'
                            : 'bg-white border-slate-300 text-slate-700'
                        }`}
                      >
                        Arm {arm}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Duration (Minutes)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={180}
                    required
                    value={subDuration}
                    onChange={(e) => setSubDuration(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Pass Mark (%)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    required
                    value={subPassMark}
                    onChange={(e) => setSubPassMark(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Allowed Attempts (0 = Unlimited)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    disabled={subIsPractice}
                    value={subIsPractice ? 0 : subAllowedAttempts}
                    onChange={(e) => setSubAllowedAttempts(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
              </div>

              {/* Scheduling Window */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                  <CalendarClock className="w-4 h-4 text-blue-900" />
                  <span>Schedule Window (Optional — Leave blank to stay open anytime)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Opens At
                    </label>
                    <input
                      type="datetime-local"
                      value={subStartAt}
                      onChange={(e) => setSubStartAt(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Closes At
                    </label>
                    <input
                      type="datetime-local"
                      value={subEndAt}
                      onChange={(e) => setSubEndAt(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Anti-Malpractice & Result Review Controls */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                <p className="text-xs font-bold text-slate-800">
                  Delivery, Randomization &amp; Review Rules
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-slate-700">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={subShuffleQ}
                      onChange={(e) => setSubShuffleQ(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-900"
                    />
                    <span>Shuffle question order per student</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={subShuffleOpt}
                      onChange={(e) => setSubShuffleOpt(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-900"
                    />
                    <span>Shuffle MCQ options (A–D) per student</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={subShowScore}
                      onChange={(e) => setSubShowScore(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-900"
                    />
                    <span>Release score immediately after submit</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={subShowReview}
                      onChange={(e) => setSubShowReview(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-900"
                    />
                    <span>Show corrections &amp; explanations</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={subGuardrails}
                      onChange={(e) => setSubGuardrails(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-900"
                    />
                    <span>Enforce tab-switch &amp; fullscreen guardrails</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={subActive}
                      onChange={(e) => setSubActive(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-900"
                    />
                    <span>Open &amp; visible to students</span>
                  </label>
                </div>
              </div>

              {/* Curate Questions from Bank (when editing existing test with bank items) */}
              {editingSubject && bankForTestSubject.length > 0 && (
                <div className="p-4 border border-slate-200 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">
                      Question Bank Selection ({subCuratedIds.length === 0 ? `Using all ${bankForTestSubject.length}` : `${subCuratedIds.length} selected`})
                    </span>
                    {subCuratedIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSubCuratedIds([])}
                        className="text-xs font-semibold text-blue-900 hover:underline cursor-pointer"
                      >
                        Use Full Bank
                      </button>
                    )}
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                    {bankForTestSubject.map((q) => {
                      const checked = subCuratedIds.includes(q.id);
                      return (
                        <label
                          key={q.id}
                          className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSubCuratedIds((prev) =>
                                prev.includes(q.id)
                                  ? prev.filter((id) => id !== q.id)
                                  : [...prev, q.id]
                              )
                            }
                            className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-blue-900"
                          />
                          <span className="line-clamp-1">
                            <strong className="text-slate-900">[{q.topic || 'General'}]</strong>{' '}
                            {q.prompt}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Exam Instructions
                </label>
                <textarea
                  rows={2}
                  value={subInstructions}
                  onChange={(e) => setSubInstructions(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setTestModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSubject || subClasses.length === 0 || subArms.length === 0}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  {savingSubject ? 'Saving...' : editingSubject ? 'Save Test Rules' : 'Create Test'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Add / Edit Question (4 Core Types) */}
      {questionModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-blue-950 text-white px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-base font-bold">
                {editingQuestion ? 'Edit Question' : 'Add Question to Bank'}
              </h2>
              <button
                type="button"
                onClick={() => setQuestionModalOpen(false)}
                className="p-1 text-blue-200 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveQuestion} className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Question Type
                  </label>
                  <select
                    value={qType}
                    onChange={(e) => setQType(e.target.value as QuestionType)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="mcq">Multiple Choice (A–D)</option>
                    <option value="true_false">True / False</option>
                    <option value="fill_blank">Fill-in-the-Blank</option>
                    <option value="comprehension">Comprehension Passage</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Class</label>
                  <select
                    value={qClassLevel}
                    onChange={(e) => setQClassLevel(e.target.value as ClassLevel | 'ALL')}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="ALL">All Assigned Classes</option>
                    {CLASS_LEVELS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Topic</label>
                  <input
                    type="text"
                    value={qTopic}
                    onChange={(e) => setQTopic(e.target.value)}
                    placeholder="e.g. Algebra, Ecology"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {qType === 'comprehension' && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Passage Title (Optional)
                    </label>
                    <input
                      type="text"
                      value={qPassageTitle}
                      onChange={(e) => setQPassageTitle(e.target.value)}
                      placeholder="e.g. Climate Adaptation in West Africa"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Reading Passage
                    </label>
                    <textarea
                      rows={4}
                      required
                      value={qPassage}
                      onChange={(e) => setQPassage(e.target.value)}
                      placeholder="Paste or type the comprehension passage..."
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Question Prompt
                </label>
                <textarea
                  rows={3}
                  required
                  value={qPrompt}
                  onChange={(e) => setQPrompt(e.target.value)}
                  placeholder={
                    qType === 'fill_blank'
                      ? 'Use _______ to indicate the blank (e.g. The capital of Edo State is _______.)'
                      : 'Enter the question prompt...'
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              {qType === 'true_false' ? (
                <div>
                  <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Correct Answer
                  </span>
                  <div className="grid grid-cols-2 gap-3">
                    {(['A', 'B'] as OptionKey[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setQCorrect(k)}
                        className={`py-2.5 text-sm font-bold rounded-lg border cursor-pointer ${
                          qCorrect === k
                            ? 'bg-emerald-700 border-emerald-700 text-white'
                            : 'bg-white border-slate-300 text-slate-700'
                        }`}
                      >
                        {k === 'A' ? 'True' : 'False'}
                      </button>
                    ))}
                  </div>
                </div>
              ) : qType === 'fill_blank' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Acceptable Answers (Separate multiple valid answers with semicolon ;)
                  </label>
                  <input
                    type="text"
                    required
                    value={qAcceptableAnswers}
                    onChange={(e) => setQAcceptableAnswers(e.target.value)}
                    placeholder="e.g. Benin City; Benin"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Option A
                      </label>
                      <input
                        type="text"
                        required
                        value={qOptA}
                        onChange={(e) => setQOptA(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Option B
                      </label>
                      <input
                        type="text"
                        required
                        value={qOptB}
                        onChange={(e) => setQOptB(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Option C
                      </label>
                      <input
                        type="text"
                        required
                        value={qOptC}
                        onChange={(e) => setQOptC(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Option D
                      </label>
                      <input
                        type="text"
                        required
                        value={qOptD}
                        onChange={(e) => setQOptD(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                  <div>
                    <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Correct Answer
                    </span>
                    <div className="grid grid-cols-4 gap-2">
                      {(['A', 'B', 'C', 'D'] as OptionKey[]).map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setQCorrect(k)}
                          className={`py-2 text-sm font-mono font-bold rounded-lg border cursor-pointer ${
                            qCorrect === k
                              ? 'bg-emerald-700 border-emerald-700 text-white'
                              : 'bg-white border-slate-300 text-slate-700'
                          }`}
                        >
                          Option {k}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Answer Explanation (Optional)
                </label>
                <input
                  type="text"
                  value={qExplanation}
                  onChange={(e) => setQExplanation(e.target.value)}
                  placeholder="Shown to students when post-exam review is enabled"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setQuestionModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingQuestion}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  {savingQuestion ? 'Saving...' : editingQuestion ? 'Update Question' : 'Save Question'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Bulk Upload (Excel / CSV / Pipe / JSON) */}
      {bulkModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-blue-950 text-white px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-base font-bold">
                Bulk Import Questions (Excel, CSV, or Text)
              </h2>
              <button
                type="button"
                onClick={() => setBulkModalOpen(false)}
                className="p-1 text-blue-200 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800">
                    Option 1: Upload Excel (.xlsx / .xls) or CSV Template
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void downloadQuestionTemplate('xlsx')}
                      className="text-xs font-semibold text-blue-900 hover:underline cursor-pointer"
                    >
                      Download .xlsx Template
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => void downloadQuestionTemplate('csv')}
                      className="text-xs font-semibold text-blue-900 hover:underline cursor-pointer"
                    >
                      Download .csv Template
                    </button>
                  </div>
                </div>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => void handleSpreadsheetUpload(e)}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-900 file:text-white hover:file:bg-blue-800 cursor-pointer"
                />
                {bulkFileName && (
                  <p className="text-xs text-emerald-700 font-medium">
                    Loaded spreadsheet: {bulkFileName} ({bulkFileQuestions.length} valid questions)
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">
                  Option 2: Paste Pipe-Separated MCQ Lines or JSON Array
                </label>
                <textarea
                  rows={5}
                  value={bulkText}
                  onChange={(e) => {
                    setBulkText(e.target.value);
                    if (bulkFileQuestions.length > 0) {
                      setBulkFileQuestions([]);
                      setBulkFileName('');
                    }
                  }}
                  placeholder="What is the capital of Edo State? | Igarra | Benin City | Auchi | Ekpoma | B | Nigerian Geography"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>

              <div className="text-xs font-medium text-slate-600">
                Detected Valid Questions:{' '}
                <strong className="font-mono text-emerald-700">{parsedBulkPreview.length}</strong>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setBulkModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={bulkSaving || parsedBulkPreview.length === 0}
                  onClick={() => void handleBulkImport()}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  {bulkSaving ? 'Importing...' : `Import ${parsedBulkPreview.length} Questions`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Delete Confirmation */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-50 text-red-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Confirm Deletion
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  Are you sure you want to remove {deleteTarget.label}?
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded-lg cursor-pointer"
              >
                {deleting ? 'Removing...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
