import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  Edit3,
  FileSpreadsheet,
  Lock,
  LogOut,
  Plus,
  Printer,
  Search,
  Trash2,
  Unlock,
  Upload,
  UserCheck,
  UserPlus,
  Users,
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
  type PortalSettings,
  type Question,
  type QuestionType,
  type ScratchCard,
  type Student,
  type StudentGender,
  type Subject,
  type TeacherPublicProfile,
  type TermName,
} from '../types';
import {
  downloadQuestionTemplate,
  exportResultsSpreadsheet,
  parseQuestionsSpreadsheetFile,
  type ParsedSpreadsheetQuestion,
} from '../utils/spreadsheet';
import { safeReadJson } from '../utils/http';

interface AdminDashboardPageProps {
  adminToken: string;
  onSignOut: () => void;
  onSessionExpired: () => void;
  onDataChanged: () => void;
}

type AdminTab = 'subjects' | 'questions' | 'results' | 'cards' | 'students' | 'academic';

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: 'Multiple Choice (A–D)',
  true_false: 'True / False',
  fill_blank: 'Fill-in-the-Blank',
  comprehension: 'Comprehension Passage',
};

function parseBulkInput(raw: string): ParsedSpreadsheetQuestion[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        const out: ParsedSpreadsheetQuestion[] = [];
        for (const item of arr) {
          if (!item?.prompt) continue;
          const type: QuestionType =
            item.type === 'true_false' ||
            item.type === 'fill_blank' ||
            item.type === 'comprehension'
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
            explanation: item.explanation ? String(item.explanation).trim() : undefined,
          });
        }
        return out;
      }
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

export const AdminDashboardPage: React.FC<AdminDashboardPageProps> = ({
  adminToken,
  onSignOut,
  onSessionExpired,
  onDataChanged,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('subjects');
  const [academicConfig, setAcademicConfig] = useState<AcademicConfig>({
    currentSession: '2026/2027',
    currentTerm: 'First Term',
    sessions: ['2025/2026', '2026/2027', '2027/2028'],
  });
  const [teachers, setTeachers] = useState<TeacherPublicProfile[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [results, setResults] = useState<ExamResult[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [scratchCards, setScratchCards] = useState<ScratchCard[]>([]);
  const [portalSettings, setPortalSettings] = useState<PortalSettings>({
    requireScratchCard: true,
  });
  const [togglingSettings, setTogglingSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState('');

  // Academic Config form state
  const [newSessionInput, setNewSessionInput] = useState('');
  const [savingAcademic, setSavingAcademic] = useState(false);

  // Teacher Account Modal state
  const [teacherModalOpen, setTeacherModalOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<TeacherPublicProfile | null>(null);
  const [tchFullName, setTchFullName] = useState('');
  const [tchUsername, setTchUsername] = useState('');
  const [tchPassword, setTchPassword] = useState('');
  const [tchSubjectIds, setTchSubjectIds] = useState<string[]>([]);
  const [tchClasses, setTchClasses] = useState<ClassLevel[]>([...CLASS_LEVELS]);
  const [tchActive, setTchActive] = useState(true);
  const [savingTeacher, setSavingTeacher] = useState(false);

  // Subject Modal state
  const [subjectModalOpen, setSubjectModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [subName, setSubName] = useState('');
  const [subCode, setSubCode] = useState('');
  const [subAssessmentType, setSubAssessmentType] = useState<AssessmentType>('Exam');
  const [subSessionName, setSubSessionName] = useState('2026/2027');
  const [subTerm, setSubTerm] = useState('First Term');
  const [subIsPractice, setSubIsPractice] = useState(false);
  const [subClasses, setSubClasses] = useState<ClassLevel[]>(['JSS1', 'JSS2', 'JSS3']);
  const [subArms, setSubArms] = useState<ClassArm[]>([...CLASS_ARMS]);
  const [subDuration, setSubDuration] = useState(20);
  const [subPassMark, setSubPassMark] = useState(50);
  const [subAllowedAttempts, setSubAllowedAttempts] = useState(1);
  const [subStartAt, setSubStartAt] = useState('');
  const [subEndAt, setSubEndAt] = useState('');
  const [subShuffleQ, setSubShuffleQ] = useState(true);
  const [subShuffleOpt, setSubShuffleOpt] = useState(true);
  const [subShowScore, setSubShowScore] = useState(true);
  const [subShowReview, setSubShowReview] = useState(true);
  const [subGuardrails, setSubGuardrails] = useState(true);
  const [subCuratedIds, setSubCuratedIds] = useState<string[]>([]);
  const [subActive, setSubActive] = useState(true);
  const [subInstructions, setSubInstructions] = useState('');
  const [savingSubject, setSavingSubject] = useState(false);

  // Question Bank state + filters
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

  // Bulk import state
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkFileQuestions, setBulkFileQuestions] = useState<ParsedSpreadsheetQuestion[]>([]);
  const [bulkFileName, setBulkFileName] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  // Results filter state
  const [resultSearch, setResultSearch] = useState('');
  const [resultSubjectFilter, setResultSubjectFilter] = useState('ALL');
  const [resultClassFilter, setResultClassFilter] = useState('ALL');
  const [resultArmFilter, setResultArmFilter] = useState<'ALL' | ClassArm>('ALL');
  const [resultStatusFilter, setResultStatusFilter] = useState<'ALL' | 'PASS' | 'FAIL'>('ALL');

  // Scratch Cards state
  const [cardSearch, setCardSearch] = useState('');
  const [cardStatusFilter, setCardStatusFilter] = useState<
    'ALL' | 'UNUSED' | 'ACTIVE' | 'EXHAUSTED' | 'DISABLED'
  >('ALL');
  const [cardModalOpen, setCardModalOpen] = useState(false);
  const [cardCount, setCardCount] = useState(10);
  const [cardMaxUses, setCardMaxUses] = useState(5);
  const [cardBatchLabel, setCardBatchLabel] = useState('2026/2027 Termly Batch');
  const [generatingCards, setGeneratingCards] = useState(false);
  const [copiedCardId, setCopiedCardId] = useState<string | null>(null);

  // Students Registry state
  const [studentSearch, setStudentSearch] = useState('');
  const [studentClassFilter, setStudentClassFilter] = useState<'ALL' | ClassLevel>('ALL');
  const [studentArmFilter, setStudentArmFilter] = useState<'ALL' | ClassArm>('ALL');
  const [studentModalOpen, setStudentModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [stuFullName, setStuFullName] = useState('');
  const [stuClass, setStuClass] = useState<ClassLevel>('JSS1');
  const [stuArm, setStuArm] = useState<ClassArm>('A');
  const [stuGender, setStuGender] = useState<StudentGender>('Male');
  const [stuPhone, setStuPhone] = useState('');
  const [stuPasscode, setStuPasscode] = useState('');
  const [savingStudent, setSavingStudent] = useState(false);
  const [copiedStudentId, setCopiedStudentId] = useState<string | null>(null);

  // Confirmation delete modal state
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'subject' | 'question' | 'result' | 'card' | 'student' | 'teacher';
    id: string;
    label: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const authHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    }),
    [adminToken]
  );

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setErrorBanner('');
    try {
      const res = await fetch('/api/admin/overview', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await safeReadJson<{
        academicConfig?: AcademicConfig;
        teachers?: TeacherPublicProfile[];
        subjects?: Subject[];
        questions?: Question[];
        results?: ExamResult[];
        students?: Student[];
        scratchCards?: ScratchCard[];
        settings?: PortalSettings;
      }>(res);
      if (!res.ok) {
        setErrorBanner(data.error || `Failed to load admin overview (HTTP ${res.status}).`);
        setLoading(false);
        return;
      }
      if (data.academicConfig) setAcademicConfig(data.academicConfig);
      setTeachers(data.teachers || []);
      setSubjects(data.subjects || []);
      setQuestions(data.questions || []);
      setResults(data.results || []);
      setStudents(data.students || []);
      setScratchCards(data.scratchCards || []);
      setPortalSettings(data.settings || { requireScratchCard: true });
      setSelectedSubjectId((prev) => {
        if (prev && (data.subjects || []).some((s: Subject) => s.id === prev)) return prev;
        return data.subjects?.[0]?.id || '';
      });
      setLoading(false);
    } catch {
      setErrorBanner('Network error loading dashboard data.');
      setLoading(false);
    }
  }, [adminToken, onSessionExpired]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  // Academic Config update
  const handleUpdateAcademic = async (
    nextSession: string,
    nextTerm: TermName,
    nextSessionsList?: string[]
  ) => {
    setSavingAcademic(true);
    setErrorBanner('');
    try {
      const res = await fetch('/api/admin/academic', {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          currentSession: nextSession,
          currentTerm: nextTerm,
          ...(nextSessionsList ? { sessions: nextSessionsList } : {}),
        }),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Could not update academic configuration.');
      } else {
        setAcademicConfig(data.academicConfig);
        onDataChanged();
      }
    } catch {
      setErrorBanner('Network error updating academic session.');
    } finally {
      setSavingAcademic(false);
    }
  };

  const handleAddSession = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newSessionInput.trim();
    if (!cleaned) return;
    const nextList = Array.from(new Set([...academicConfig.sessions, cleaned]));
    await handleUpdateAcademic(cleaned, academicConfig.currentTerm, nextList);
    setNewSessionInput('');
  };

  // Teacher CRUD
  const openCreateTeacher = () => {
    setEditingTeacher(null);
    setTchFullName('');
    setTchUsername('');
    setTchPassword('');
    setTchSubjectIds(subjects[0] ? [subjects[0].id] : []);
    setTchClasses([...CLASS_LEVELS]);
    setTchActive(true);
    setTeacherModalOpen(true);
  };

  const openEditTeacher = (t: TeacherPublicProfile) => {
    setEditingTeacher(t);
    setTchFullName(t.fullName);
    setTchUsername(t.username);
    setTchPassword('');
    setTchSubjectIds([...t.subjectIds]);
    setTchClasses([...t.classes]);
    setTchActive(t.isActive);
    setTeacherModalOpen(true);
  };

  const handleSaveTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tchFullName.trim() || (!editingTeacher && (!tchUsername.trim() || tchPassword.length < 4)))
      return;
    setSavingTeacher(true);
    setErrorBanner('');
    try {
      const url = editingTeacher
        ? `/api/admin/teachers/${editingTeacher.id}`
        : '/api/admin/teachers';
      const method = editingTeacher ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: authHeaders,
        body: JSON.stringify({
          fullName: tchFullName.trim(),
          username: tchUsername.trim().toLowerCase(),
          ...(tchPassword.trim() ? { password: tchPassword.trim() } : {}),
          subjectIds: tchSubjectIds,
          classes: tchClasses,
          isActive: tchActive,
        }),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Could not save teacher account.');
        setSavingTeacher(false);
        return;
      }
      setSavingTeacher(false);
      setTeacherModalOpen(false);
      await fetchOverview();
    } catch {
      setErrorBanner('Network error saving teacher account.');
      setSavingTeacher(false);
    }
  };

  // Subject CRUD
  const openCreateSubject = () => {
    setEditingSubject(null);
    setSubName('');
    setSubCode('');
    setSubAssessmentType('Exam');
    setSubSessionName(academicConfig.currentSession);
    setSubTerm(academicConfig.currentTerm);
    setSubIsPractice(false);
    setSubClasses(['SS1', 'SS2', 'SS3']);
    setSubArms([...CLASS_ARMS]);
    setSubDuration(20);
    setSubPassMark(50);
    setSubAllowedAttempts(1);
    setSubStartAt('');
    setSubEndAt('');
    setSubShuffleQ(true);
    setSubShuffleOpt(true);
    setSubShowScore(true);
    setSubShowReview(true);
    setSubGuardrails(true);
    setSubCuratedIds([]);
    setSubActive(true);
    setSubInstructions('Read each question carefully and answer before the timer runs out.');
    setSubjectModalOpen(true);
  };

  const openEditSubject = (subject: Subject) => {
    setEditingSubject(subject);
    setSubName(subject.name);
    setSubCode(subject.code);
    setSubAssessmentType(subject.assessmentType || (subject.isPractice ? 'Practice' : 'Exam'));
    setSubSessionName(subject.sessionName || academicConfig.currentSession);
    setSubTerm(subject.term || academicConfig.currentTerm);
    setSubIsPractice(Boolean(subject.isPractice));
    setSubClasses(subject.classes);
    setSubArms(subject.arms && subject.arms.length > 0 ? subject.arms : [...CLASS_ARMS]);
    setSubDuration(subject.durationMinutes);
    setSubPassMark(subject.passMark);
    setSubAllowedAttempts(subject.allowedAttempts ?? (subject.isPractice ? 0 : 1));
    setSubStartAt(subject.startAt ? subject.startAt.slice(0, 16) : '');
    setSubEndAt(subject.endAt ? subject.endAt.slice(0, 16) : '');
    setSubShuffleQ(subject.shuffleQuestions !== false);
    setSubShuffleOpt(subject.shuffleOptions !== false);
    setSubShowScore(subject.showScoreAfterSubmit !== false);
    setSubShowReview(subject.showReviewAfterSubmit !== false);
    setSubGuardrails(subject.enableBrowserGuardrails !== false);
    setSubCuratedIds(subject.questionIds ? [...subject.questionIds] : []);
    setSubActive(subject.isActive);
    setSubInstructions(subject.instructions);
    setSubjectModalOpen(true);
  };

  const handleSaveSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subName.trim() || !subCode.trim() || subClasses.length === 0 || subArms.length === 0) return;

    setSavingSubject(true);
    setErrorBanner('');
    try {
      const url = editingSubject
        ? `/api/admin/subjects/${editingSubject.id}`
        : '/api/admin/subjects';
      const method = editingSubject ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: authHeaders,
        body: JSON.stringify({
          name: subName.trim(),
          code: subCode.trim().toUpperCase(),
          assessmentType: subIsPractice ? 'Practice' : subAssessmentType,
          sessionName: subSessionName,
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
          questionIds: subCuratedIds,
          isActive: subActive,
          instructions: subInstructions.trim(),
        }),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Could not save subject.');
        setSavingSubject(false);
        return;
      }
      setSavingSubject(false);
      setSubjectModalOpen(false);
      await fetchOverview();
      onDataChanged();
    } catch {
      setErrorBanner('Network error while saving subject.');
      setSavingSubject(false);
    }
  };

  const handleToggleSubjectActive = async (subject: Subject) => {
    try {
      const res = await fetch(`/api/admin/subjects/${subject.id}`, {
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
      setErrorBanner('Unable to toggle subject status.');
    }
  };

  // Question CRUD
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
        ? `/api/admin/questions/${editingQuestion.id}`
        : '/api/admin/questions';
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
      setErrorBanner('Could not parse spreadsheet. Please check columns using the template.');
    }
  };

  const parsedBulkPreview = useMemo(() => {
    if (bulkFileQuestions.length > 0) return bulkFileQuestions;
    return parseBulkInput(bulkText);
  }, [bulkFileQuestions, bulkText]);

  const handleBulkImport = async () => {
    if (!selectedSubjectId || parsedBulkPreview.length === 0) return;
    setBulkSaving(true);
    setErrorBanner('');
    try {
      const res = await fetch('/api/admin/questions/bulk', {
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
        setErrorBanner(data.error || 'Bulk import failed.');
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
      setErrorBanner('Network error during bulk import.');
      setBulkSaving(false);
    }
  };

  // Delete execution
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const endpoint =
        deleteTarget.type === 'subject'
          ? `/api/admin/subjects/${deleteTarget.id}`
          : deleteTarget.type === 'question'
            ? `/api/admin/questions/${deleteTarget.id}`
            : deleteTarget.type === 'card'
              ? `/api/admin/scratch-cards/${deleteTarget.id}`
              : deleteTarget.type === 'student'
                ? `/api/admin/students/${deleteTarget.id}`
                : deleteTarget.type === 'teacher'
                  ? `/api/admin/teachers/${deleteTarget.id}`
                  : `/api/admin/results/${deleteTarget.id}`;

      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      setDeleting(false);
      setDeleteTarget(null);
      await fetchOverview();
      onDataChanged();
    } catch {
      setErrorBanner('Unable to delete item.');
      setDeleting(false);
    }
  };

  // Scratch card handlers
  const handleToggleRequireScratchCard = async () => {
    setTogglingSettings(true);
    setErrorBanner('');
    try {
      const nextVal = !portalSettings.requireScratchCard;
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ requireScratchCard: nextVal }),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Could not update scratch card policy.');
      } else {
        setPortalSettings(data.settings);
      }
    } catch {
      setErrorBanner('Network error updating scratch card setting.');
    } finally {
      setTogglingSettings(false);
    }
  };

  const handleGenerateCards = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneratingCards(true);
    setErrorBanner('');
    try {
      const res = await fetch('/api/admin/scratch-cards/generate', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          count: Number(cardCount),
          maxUses: Number(cardMaxUses),
          batchLabel: cardBatchLabel.trim() || `${academicConfig.currentSession} Termly Batch`,
        }),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Failed to generate scratch cards.');
        setGeneratingCards(false);
        return;
      }
      setGeneratingCards(false);
      setCardModalOpen(false);
      await fetchOverview();
    } catch {
      setErrorBanner('Network error generating scratch cards.');
      setGeneratingCards(false);
    }
  };

  const handleToggleCardDisabled = async (card: ScratchCard) => {
    try {
      const res = await fetch(`/api/admin/scratch-cards/${card.id}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ isDisabled: !card.isDisabled }),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      if (res.ok) {
        await fetchOverview();
      }
    } catch {
      setErrorBanner('Unable to update scratch card status.');
    }
  };

  const handleCopyPin = async (card: ScratchCard) => {
    try {
      await navigator.clipboard.writeText(card.pin);
      setCopiedCardId(card.id);
      window.setTimeout(() => {
        setCopiedCardId((prev) => (prev === card.id ? null : prev));
      }, 2000);
    } catch {
      setErrorBanner('Clipboard access blocked by browser.');
    }
  };

  // Student Registry handlers
  const openCreateStudent = () => {
    setEditingStudent(null);
    setStuFullName('');
    setStuClass('JSS1');
    setStuArm('A');
    setStuGender('Male');
    setStuPhone('');
    setStuPasscode('');
    setStudentModalOpen(true);
  };

  const openEditStudent = (student: Student) => {
    setEditingStudent(student);
    setStuFullName(student.fullName);
    setStuClass(student.classLevel);
    setStuArm(student.classArm);
    setStuGender(student.gender);
    setStuPhone(student.guardianPhone || '');
    setStuPasscode('');
    setStudentModalOpen(true);
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stuFullName.trim().length < 2) return;

    setSavingStudent(true);
    setErrorBanner('');
    try {
      const url = editingStudent
        ? `/api/admin/students/${editingStudent.id}`
        : '/api/admin/students';
      const method = editingStudent ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: authHeaders,
        body: JSON.stringify({
          fullName: stuFullName.trim(),
          classLevel: stuClass,
          classArm: stuArm,
          gender: stuGender,
          guardianPhone: stuPhone.trim(),
          ...(stuPasscode.trim() ? { passcode: stuPasscode.trim() } : {}),
        }),
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Could not save student record.');
        setSavingStudent(false);
        return;
      }
      setSavingStudent(false);
      setStudentModalOpen(false);
      await fetchOverview();
    } catch {
      setErrorBanner('Network error while saving student record.');
      setSavingStudent(false);
    }
  };

  const handleCopyStudentExamNo = async (student: Student) => {
    try {
      await navigator.clipboard.writeText(student.examNumber);
      setCopiedStudentId(student.id);
      window.setTimeout(() => {
        setCopiedStudentId((prev) => (prev === student.id ? null : prev));
      }, 2000);
    } catch {
      setErrorBanner('Clipboard access blocked by browser.');
    }
  };

  // Filtered Questions, Results & Cards
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

  const selectedSubjectObj = useMemo(
    () => subjects.find((s) => s.id === selectedSubjectId) || null,
    [subjects, selectedSubjectId]
  );

  const bankForEditedSubject = useMemo(() => {
    if (!editingSubject) return [];
    return questions.filter((q) => q.subjectId === editingSubject.id);
  }, [editingSubject, questions]);

  const filteredResults = useMemo(() => {
    const q = resultSearch.trim().toLowerCase();
    return results.filter((r) => {
      if (resultSubjectFilter !== 'ALL' && r.subjectId !== resultSubjectFilter) return false;
      if (resultClassFilter !== 'ALL' && r.classLevel !== resultClassFilter) return false;
      if (resultArmFilter !== 'ALL' && (r.classArm || 'A') !== resultArmFilter) return false;
      if (resultStatusFilter === 'PASS' && !r.passed) return false;
      if (resultStatusFilter === 'FAIL' && r.passed) return false;
      if (q) {
        const matchesName = r.studentName.toLowerCase().includes(q);
        const matchesExamNo = r.examNumber.toLowerCase().includes(q);
        const matchesRef = r.referenceCode.toLowerCase().includes(q);
        if (!matchesName && !matchesExamNo && !matchesRef) return false;
      }
      return true;
    });
  }, [
    results,
    resultSearch,
    resultSubjectFilter,
    resultClassFilter,
    resultArmFilter,
    resultStatusFilter,
  ]);

  const resultsMetrics = useMemo(() => {
    if (filteredResults.length === 0) {
      return { total: 0, avgPercentage: 0, passRate: 0 };
    }
    const sumPct = filteredResults.reduce((acc, r) => acc + r.percentage, 0);
    const passedCount = filteredResults.filter((r) => r.passed).length;
    return {
      total: filteredResults.length,
      avgPercentage: Math.round(sumPct / filteredResults.length),
      passRate: Math.round((passedCount / filteredResults.length) * 100),
    };
  }, [filteredResults]);

  const filteredCards = useMemo(() => {
    const q = cardSearch.trim().toLowerCase();
    return scratchCards.filter((card) => {
      const status = card.isDisabled
        ? 'DISABLED'
        : card.usedCount >= card.maxUses
          ? 'EXHAUSTED'
          : card.usedCount > 0
            ? 'ACTIVE'
            : 'UNUSED';
      if (cardStatusFilter !== 'ALL' && status !== cardStatusFilter) return false;
      if (q) {
        const matchesPin = card.pin.toLowerCase().includes(q);
        const matchesSerial = card.serialNumber.toLowerCase().includes(q);
        const matchesBatch = card.batchLabel.toLowerCase().includes(q);
        const matchesExam = (card.boundExamNumber || '').toLowerCase().includes(q);
        if (!matchesPin && !matchesSerial && !matchesBatch && !matchesExam) return false;
      }
      return true;
    });
  }, [scratchCards, cardSearch, cardStatusFilter]);

  const cardMetrics = useMemo(() => {
    let unused = 0;
    let active = 0;
    let closed = 0;
    for (const card of scratchCards) {
      if (card.isDisabled || card.usedCount >= card.maxUses) closed += 1;
      else if (card.usedCount > 0) active += 1;
      else unused += 1;
    }
    return { total: scratchCards.length, unused, active, closed };
  }, [scratchCards]);

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return students.filter((stu) => {
      if (studentClassFilter !== 'ALL' && stu.classLevel !== studentClassFilter) return false;
      if (studentArmFilter !== 'ALL' && stu.classArm !== studentArmFilter) return false;
      if (q) {
        const matchesName = stu.fullName.toLowerCase().includes(q);
        const matchesNo = stu.examNumber.toLowerCase().includes(q);
        const matchesPhone = (stu.guardianPhone || '').toLowerCase().includes(q);
        if (!matchesName && !matchesNo && !matchesPhone) return false;
      }
      return true;
    });
  }, [students, studentSearch, studentClassFilter, studentArmFilter]);

  const studentMetrics = useMemo(() => {
    let jss = 0;
    let sss = 0;
    for (const stu of filteredStudents) {
      if (stu.classLevel.startsWith('JSS')) jss += 1;
      else sss += 1;
    }
    return { total: filteredStudents.length, jss, sss };
  }, [filteredStudents]);

  const handleExportCardsCsv = () => {
    const headers = [
      'Serial Number',
      'Scratch Card PIN',
      'Batch Label',
      'Uses Used',
      'Max Uses',
      'Bound Exam Number',
      'Status',
      'Created At',
    ];
    const escapeCell = (val: string | number) => {
      const s = String(val).replace(/"/g, '""');
      return `"${s}"`;
    };
    const rows = filteredCards.map((c) => {
      const status = c.isDisabled
        ? 'DISABLED'
        : c.usedCount >= c.maxUses
          ? 'EXHAUSTED'
          : c.usedCount > 0
            ? 'ACTIVE'
            : 'UNUSED';
      return [
        c.serialNumber,
        c.pin,
        c.batchLabel,
        c.usedCount,
        c.maxUses,
        c.boundExamNumber || 'Unbound',
        status,
        new Date(c.createdAt).toISOString(),
      ]
        .map(escapeCell)
        .join(',');
    });

    const csv = [headers.map(escapeCell).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jaiman-goldenlite-scratch-cards-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportStudentsCsv = () => {
    const headers = [
      'Admission / Exam Number',
      'Full Name',
      'Class',
      'Arm',
      'Gender',
      'Guardian Phone',
      'Registered Source',
      'Registered At',
    ];
    const escapeCell = (val: string | number) => {
      const s = String(val).replace(/"/g, '""');
      return `"${s}"`;
    };
    const rows = filteredStudents.map((s) =>
      [
        s.examNumber,
        s.fullName,
        s.classLevel,
        s.classArm,
        s.gender,
        s.guardianPhone || '',
        s.registeredBy === 'self' ? 'Student Portal' : 'Admin Desk',
        new Date(s.registeredAt).toISOString(),
      ]
        .map(escapeCell)
        .join(',')
    );

    const csv = [headers.map(escapeCell).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jaiman-goldenlite-students-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header Bar */}
      <div className="no-print bg-blue-950 text-white rounded-xl px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-blue-900">
        <div>
          <p className="text-xs font-medium text-amber-400">
            JAIMAN GOLDENLITE TECH LTD · {academicConfig.currentSession} ·{' '}
            {academicConfig.currentTerm}
          </p>
          <h1 className="font-display text-2xl font-bold tracking-tight mt-0.5">
            Admin &amp; Exam Officer Dashboard
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 border border-blue-700 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
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

      {/* Segmented Navigation Tabs */}
      <div className="no-print flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('subjects')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'subjects'
                ? 'bg-white text-blue-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Subjects &amp; Timers ({subjects.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('questions')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'questions'
                ? 'bg-white text-blue-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Question Bank ({questions.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('results')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'results'
                ? 'bg-white text-blue-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Results ({results.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('cards')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'cards'
                ? 'bg-white text-blue-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Scratch Cards ({scratchCards.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('students')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'students'
                ? 'bg-white text-blue-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Students ({students.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('academic')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab === 'academic'
                ? 'bg-white text-blue-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Sessions &amp; Staff ({teachers.length})
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-500">
          Loading administrative workspace...
        </div>
      ) : (
        <>
          {/* TAB 1: SUBJECTS & TIMERS */}
          {activeTab === 'subjects' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  Manage subjects, scheduling windows, attempt limits, anti-malpractice randomization, and immediate score release policies.
                </p>
                <button
                  type="button"
                  onClick={openCreateSubject}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-auto"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Subject</span>
                </button>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-3.5 px-4">Code</th>
                        <th className="py-3.5 px-4">Subject &amp; Term</th>
                        <th className="py-3.5 px-4">Classes</th>
                        <th className="py-3.5 px-4">Controls</th>
                        <th className="py-3.5 px-4 text-right">Qs</th>
                        <th className="py-3.5 px-4 text-right">Timer</th>
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
                              {!sub.arms || sub.arms.length === CLASS_ARMS.length
                                ? 'Arms A–J'
                                : `Arms ${sub.arms.join(', ')}`}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-600">
                            <div>
                              {sub.isPractice || (sub.allowedAttempts ?? 1) === 0
                                ? 'Unlimited tries'
                                : `${sub.allowedAttempts ?? 1} attempt`}{' '}
                              · {sub.showScoreAfterSubmit === false ? 'Score withheld' : 'Instant score'}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {sub.shuffleQuestions !== false ? 'Shuffled Qs' : 'Ordered'} ·{' '}
                              {sub.enableBrowserGuardrails !== false ? 'Guardrails ON' : 'Practice'}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-800">
                            {sub.questionCount ?? 0}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                            {sub.durationMinutes} min
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => void handleToggleSubjectActive(sub)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                                sub.isActive
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                                  : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              {sub.isActive ? (
                                <>
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Active</span>
                                </>
                              ) : (
                                <>
                                  <XCircle className="w-3.5 h-3.5" />
                                  <span>Inactive</span>
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
                                onClick={() => openEditSubject(sub)}
                                title="Edit Subject & Rules"
                                className="p-1.5 text-slate-600 hover:text-blue-900 hover:bg-blue-50 rounded-md cursor-pointer"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteTarget({
                                    type: 'subject',
                                    id: sub.id,
                                    label: `${sub.code} — ${sub.name} (and its ${sub.questionCount ?? 0} questions)`,
                                  })
                                }
                                title="Delete Subject"
                                className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-md cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
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
                <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-1">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Subject Bank
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
                        Class Filter
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
                        Topic Filter
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
                        <option value="mcq">Multiple Choice (A–D)</option>
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
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                    >
                      <Upload className="w-4 h-4" />
                      <span>Bulk Upload (Excel/CSV)</span>
                    </button>
                    <button
                      type="button"
                      disabled={!selectedSubjectId}
                      onClick={openCreateQuestion}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Add Question</span>
                    </button>
                  </div>
                </div>
              </div>

              {filteredQuestions.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
                  <p className="font-display text-base font-bold text-slate-900">
                    No Questions Match Filter in {selectedSubjectObj?.name || 'This Subject'}
                  </p>
                  <p className="text-sm text-slate-600">
                    Add MCQs, True/False, Fill-in-the-Blank, or Comprehension questions individually or upload via Excel/CSV.
                  </p>
                  <button
                    type="button"
                    onClick={openCreateQuestion}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 rounded-lg cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Question</span>
                  </button>
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
                          <p className="text-sm sm:text-base font-semibold text-slate-900 leading-relaxed pt-1">
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
                                label: `Question ${idx + 1}: "${q.prompt.slice(0, 60)}..."`,
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
                          {(['A', 'B'] as OptionKey[]).map((optKey) => {
                            const isCorrect = q.correctOption === optKey;
                            return (
                              <div
                                key={optKey}
                                className={`px-3 py-2 rounded-lg border flex items-center justify-between ${
                                  isCorrect
                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-semibold'
                                    : 'bg-slate-50 border-slate-200 text-slate-700'
                                }`}
                              >
                                <span>{optKey === 'A' ? 'True' : 'False'}</span>
                                {isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-700" />}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                          {(['A', 'B', 'C', 'D'] as OptionKey[]).map((optKey) => {
                            const isCorrect = q.correctOption === optKey;
                            return (
                              <div
                                key={optKey}
                                className={`px-3 py-2 rounded-lg border flex items-center justify-between gap-2 ${
                                  isCorrect
                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-medium'
                                    : 'bg-slate-50 border-slate-200 text-slate-700'
                                }`}
                              >
                                <span>
                                  <strong className="font-mono mr-1.5">{optKey}.</strong>
                                  {q.options[optKey]}
                                </span>
                                {isCorrect && (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {q.explanation && (
                        <p className="text-xs text-slate-500">Explanation: {q.explanation}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: STUDENT RESULTS & EXPORT */}
          {activeTab === 'results' && (
            <div className="space-y-5">
              {/* Printable Official Header */}
              <div className="hidden print:block border-b-2 border-blue-950 pb-4 mb-4">
                <h2 className="font-display text-xl font-bold text-blue-950">
                  JAIMAN GOLDENLITE TECH LTD — OFFICIAL CBT SCORE SHEET
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  Session: {academicConfig.currentSession} · Term: {academicConfig.currentTerm} ·
                  Printed {new Date().toLocaleString()}
                </p>
              </div>

              {/* Summary Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <span className="text-xs font-medium text-slate-500">
                    Matching Submissions
                  </span>
                  <p className="font-mono text-2xl font-bold text-slate-900 tabular-nums mt-1">
                    {resultsMetrics.total}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <span className="text-xs font-medium text-slate-500">
                    Average Percentage Score
                  </span>
                  <p className="font-mono text-2xl font-bold text-blue-900 tabular-nums mt-1">
                    {resultsMetrics.avgPercentage}%
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <span className="text-xs font-medium text-slate-500">Overall Pass Rate</span>
                  <p className="font-mono text-2xl font-bold text-emerald-700 tabular-nums mt-1">
                    {resultsMetrics.passRate}%
                  </p>
                </div>
              </div>

              {/* Filter Bar & Excel / CSV / Print Exports */}
              <div className="no-print bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={resultSearch}
                      onChange={(e) => setResultSearch(e.target.value)}
                      placeholder="Search name or exam no."
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                    />
                  </div>

                  <select
                    value={resultSubjectFilter}
                    onChange={(e) => setResultSubjectFilter(e.target.value)}
                    aria-label="Filter by subject"
                    className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="ALL">All Subjects</option>
                    {subjects.map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {sub.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={resultClassFilter}
                    onChange={(e) => setResultClassFilter(e.target.value)}
                    aria-label="Filter by class"
                    className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="ALL">All Classes</option>
                    {CLASS_LEVELS.map((cls) => (
                      <option key={cls} value={cls}>
                        {cls}
                      </option>
                    ))}
                  </select>

                  <select
                    value={resultArmFilter}
                    onChange={(e) => setResultArmFilter(e.target.value as 'ALL' | ClassArm)}
                    aria-label="Filter by arm"
                    className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="ALL">All Arms (A–J)</option>
                    {CLASS_ARMS.map((arm) => (
                      <option key={arm} value={arm}>
                        Arm {arm}
                      </option>
                    ))}
                  </select>

                  <select
                    value={resultStatusFilter}
                    onChange={(e) =>
                      setResultStatusFilter(e.target.value as 'ALL' | 'PASS' | 'FAIL')
                    }
                    aria-label="Filter by status"
                    className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="PASS">PASS Only</option>
                    <option value="FAIL">FAIL Only</option>
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
                        `jaiman-goldenlite-cbt-results-${new Date().toISOString().slice(0, 10)}`,
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
                        `jaiman-goldenlite-cbt-results-${new Date().toISOString().slice(0, 10)}`,
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

              {/* Results Data Table */}
              <div className="print-only-card bg-white border border-slate-200 rounded-xl overflow-hidden">
                {filteredResults.length === 0 ? (
                  <div className="p-10 text-center space-y-2">
                    <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto" />
                    <p className="text-sm font-semibold text-slate-800">
                      No Student Results Match Your Filter
                    </p>
                    <p className="text-xs text-slate-500">
                      Adjust your search criteria or wait for students to submit examinations.
                    </p>
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
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Submitted</th>
                          <th className="no-print py-3 px-4 text-right">Remove</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {filteredResults.map((res) => (
                          <tr key={res.id} className="hover:bg-slate-50/70">
                            <td className="py-3 px-4 font-semibold text-slate-900">
                              {res.studentName}
                            </td>
                            <td className="py-3 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                              {res.examNumber}
                            </td>
                            <td className="py-3 px-4 text-xs font-medium text-slate-700 whitespace-nowrap">
                              {res.classLevel} {res.classArm || 'A'}
                            </td>
                            <td className="py-3 px-4 text-slate-700">
                              <div className="font-medium text-slate-900">{res.subjectName}</div>
                              <div className="text-[11px] text-slate-500">
                                {res.assessmentType || 'Exam'} · {res.term || academicConfig.currentTerm}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900">
                              {res.score}/{res.totalQuestions}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold tabular-nums text-slate-900">
                              {res.percentage}%
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-1 text-xs font-semibold ${
                                  res.passed ? 'text-emerald-700' : 'text-red-700'
                                }`}
                              >
                                {res.passed ? (
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                ) : (
                                  <XCircle className="w-3.5 h-3.5" />
                                )}
                                <span>{res.passed ? 'PASS' : 'FAIL'}</span>
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-xs text-slate-500 whitespace-nowrap tabular-nums">
                              {new Date(res.submittedAt).toLocaleDateString()}
                            </td>
                            <td className="no-print py-3 px-4 text-right">
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteTarget({
                                    type: 'result',
                                    id: res.id,
                                    label: `result for ${res.studentName} (${res.subjectName})`,
                                  })
                                }
                                title="Delete Result"
                                className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
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

          {/* TAB 4: RESULT CHECKER SCRATCH CARDS */}
          {activeTab === 'cards' && (
            <div className="space-y-5">
              <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <CreditCard className="w-5 h-5 text-blue-900 shrink-0" />
                    <h2 className="font-display text-base font-bold text-slate-900">
                      Result Checker Scratch Card System
                    </h2>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-600">
                    Each scratch card PIN binds automatically to the first candidate Exam Number checked and tracks remaining checks.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={togglingSettings}
                    onClick={() => void handleToggleRequireScratchCard()}
                    className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg border transition-colors cursor-pointer ${
                      portalSettings.requireScratchCard
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900 hover:bg-emerald-100'
                        : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {portalSettings.requireScratchCard ? (
                      <>
                        <Lock className="w-4 h-4 text-emerald-700" />
                        <span>Card PIN Required: ON</span>
                      </>
                    ) : (
                      <>
                        <Unlock className="w-4 h-4 text-slate-600" />
                        <span>Card PIN Required: OFF</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={filteredCards.length === 0}
                    onClick={handleExportCardsCsv}
                    className="inline-flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Export PINs</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCardModalOpen(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Generate Cards</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
                  <span className="text-xs font-medium text-slate-500">Total Cards Issued</span>
                  <p className="font-mono text-2xl font-bold text-slate-900 tabular-nums mt-1">
                    {cardMetrics.total}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
                  <span className="text-xs font-medium text-slate-500">Unused PINs</span>
                  <p className="font-mono text-2xl font-bold text-emerald-700 tabular-nums mt-1">
                    {cardMetrics.unused}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
                  <span className="text-xs font-medium text-slate-500">Active (Bound)</span>
                  <p className="font-mono text-2xl font-bold text-blue-900 tabular-nums mt-1">
                    {cardMetrics.active}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
                  <span className="text-xs font-medium text-slate-500">Exhausted / Disabled</span>
                  <p className="font-mono text-2xl font-bold text-slate-600 tabular-nums mt-1">
                    {cardMetrics.closed}
                  </p>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={cardSearch}
                    onChange={(e) => setCardSearch(e.target.value)}
                    placeholder="Search Serial No., PIN, Batch, or Bound Exam Number..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                  />
                </div>
                <select
                  value={cardStatusFilter}
                  onChange={(e) =>
                    setCardStatusFilter(
                      e.target.value as 'ALL' | 'UNUSED' | 'ACTIVE' | 'EXHAUSTED' | 'DISABLED'
                    )
                  }
                  aria-label="Filter scratch cards by status"
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="ALL">All Card Statuses</option>
                  <option value="UNUSED">Unused Only</option>
                  <option value="ACTIVE">Active (Bound)</option>
                  <option value="EXHAUSTED">Exhausted</option>
                  <option value="DISABLED">Disabled</option>
                </select>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                {filteredCards.length === 0 ? (
                  <div className="p-10 text-center space-y-2">
                    <CreditCard className="w-8 h-8 text-slate-400 mx-auto" />
                    <p className="text-sm font-semibold text-slate-800">No Scratch Cards Found</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                          <th className="py-3 px-4">Serial No.</th>
                          <th className="py-3 px-4">Card PIN</th>
                          <th className="py-3 px-4">Batch</th>
                          <th className="py-3 px-4">Bound Exam No.</th>
                          <th className="py-3 px-4 text-right">Usage</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {filteredCards.map((card) => {
                          const isExhausted = card.usedCount >= card.maxUses;
                          const statusLabel = card.isDisabled
                            ? 'Disabled'
                            : isExhausted
                              ? 'Exhausted'
                              : card.usedCount > 0
                                ? 'Active'
                                : 'Unused';
                          const statusTone = card.isDisabled
                            ? 'text-red-700'
                            : isExhausted
                              ? 'text-slate-500'
                              : card.usedCount > 0
                                ? 'text-blue-900'
                                : 'text-emerald-700';

                          return (
                            <tr key={card.id} className="hover:bg-slate-50/70">
                              <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-800 whitespace-nowrap">
                                {card.serialNumber}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <div className="inline-flex items-center gap-2">
                                  <code className="font-mono text-xs font-bold text-blue-950 bg-slate-100 px-2 py-1 rounded">
                                    {card.pin}
                                  </code>
                                  <button
                                    type="button"
                                    onClick={() => void handleCopyPin(card)}
                                    title="Copy PIN"
                                    className="p-1 text-slate-500 hover:text-blue-900 hover:bg-blue-50 rounded cursor-pointer"
                                  >
                                    {copiedCardId === card.id ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>
                              </td>
                              <td className="py-3 px-4 text-xs text-slate-600">{card.batchLabel}</td>
                              <td className="py-3 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                                {card.boundExamNumber || (
                                  <span className="font-sans text-slate-400">Unbound</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-semibold text-slate-800 whitespace-nowrap">
                                {card.usedCount} / {card.maxUses}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center gap-1 text-xs font-semibold ${statusTone}`}
                                >
                                  {card.isDisabled ? (
                                    <XCircle className="w-3.5 h-3.5" />
                                  ) : (
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                  )}
                                  <span>{statusLabel}</span>
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => void handleToggleCardDisabled(card)}
                                    className="px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-blue-900 bg-slate-100 hover:bg-blue-50 rounded-md cursor-pointer"
                                  >
                                    {card.isDisabled ? 'Enable' : 'Disable'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDeleteTarget({
                                        type: 'card',
                                        id: card.id,
                                        label: `scratch card ${card.serialNumber} (${card.pin})`,
                                      })
                                    }
                                    className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md cursor-pointer"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: STUDENTS REGISTRY */}
          {activeTab === 'students' && (
            <div className="space-y-5">
              <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <Users className="w-5 h-5 text-blue-900 shrink-0" />
                    <h2 className="font-display text-base font-bold text-slate-900">
                      Registered Students Database
                    </h2>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-600">
                    Every registered student automatically receives a unique sequential Admission / Exam Number and optional Student Portal passcode.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={filteredStudents.length === 0}
                    onClick={handleExportStudentsCsv}
                    className="inline-flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Export Students CSV</span>
                  </button>

                  <button
                    type="button"
                    onClick={openCreateStudent}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>Register Student</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <span className="text-xs font-medium text-slate-500">
                    Matching Registered Students
                  </span>
                  <p className="font-mono text-2xl font-bold text-slate-900 tabular-nums mt-1">
                    {studentMetrics.total}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <span className="text-xs font-medium text-slate-500">
                    Junior Secondary (JSS1–JSS3)
                  </span>
                  <p className="font-mono text-2xl font-bold text-blue-900 tabular-nums mt-1">
                    {studentMetrics.jss}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <span className="text-xs font-medium text-slate-500">
                    Senior Secondary (SS1–SS3)
                  </span>
                  <p className="font-mono text-2xl font-bold text-emerald-700 tabular-nums mt-1">
                    {studentMetrics.sss}
                  </p>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2 relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    placeholder="Search student name, Admission/Exam No., or phone..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                  />
                </div>

                <select
                  value={studentClassFilter}
                  onChange={(e) => setStudentClassFilter(e.target.value as 'ALL' | ClassLevel)}
                  aria-label="Filter students by class"
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="ALL">All Classes (JSS1–SS3)</option>
                  {CLASS_LEVELS.map((cls) => (
                    <option key={cls} value={cls}>
                      {cls}
                    </option>
                  ))}
                </select>

                <select
                  value={studentArmFilter}
                  onChange={(e) => setStudentArmFilter(e.target.value as 'ALL' | ClassArm)}
                  aria-label="Filter students by arm"
                  className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="ALL">All Arms (A–J)</option>
                  {CLASS_ARMS.map((arm) => (
                    <option key={arm} value={arm}>
                      Arm {arm}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                {filteredStudents.length === 0 ? (
                  <div className="p-10 text-center space-y-2">
                    <Users className="w-8 h-8 text-slate-400 mx-auto" />
                    <p className="text-sm font-semibold text-slate-800">
                      No Registered Students Found
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                          <th className="py-3 px-4">Admission / Exam No.</th>
                          <th className="py-3 px-4">Student Full Name</th>
                          <th className="py-3 px-4">Class &amp; Arm</th>
                          <th className="py-3 px-4">Portal Passcode</th>
                          <th className="py-3 px-4">Guardian Phone</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {filteredStudents.map((stu) => (
                          <tr key={stu.id} className="hover:bg-slate-50/70">
                            <td className="py-3 px-4 whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">
                                <code className="font-mono text-xs font-bold text-blue-950 bg-slate-100 px-2 py-1 rounded">
                                  {stu.examNumber}
                                </code>
                                <button
                                  type="button"
                                  onClick={() => void handleCopyStudentExamNo(stu)}
                                  title="Copy Exam Number"
                                  className="p-1 text-slate-500 hover:text-blue-900 hover:bg-blue-50 rounded cursor-pointer"
                                >
                                  {copiedStudentId === stu.id ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-700" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            </td>
                            <td className="py-3 px-4 font-semibold text-slate-900">
                              {stu.fullName}
                            </td>
                            <td className="py-3 px-4 text-xs font-medium text-slate-700 whitespace-nowrap">
                              {stu.classLevel} {stu.classArm} · {stu.gender}
                            </td>
                            <td className="py-3 px-4 text-xs whitespace-nowrap">
                              {stu.hasPasscode ? (
                                <span className="text-emerald-700 font-semibold">Protected</span>
                              ) : (
                                <span className="text-slate-400">Not set</span>
                              )}
                            </td>
                            <td className="py-3 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                              {stu.guardianPhone || '—'}
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openEditStudent(stu)}
                                  title="Edit Student"
                                  className="p-1.5 text-slate-600 hover:text-blue-900 hover:bg-blue-50 rounded-md cursor-pointer"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDeleteTarget({
                                      type: 'student',
                                      id: stu.id,
                                      label: `student ${stu.fullName} (${stu.examNumber})`,
                                    })
                                  }
                                  title="Delete Student"
                                  className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
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

          {/* TAB 6: ACADEMIC SESSIONS, TERMS & TEACHER USER ACCOUNTS */}
          {activeTab === 'academic' && (
            <div className="space-y-6">
              {/* Academic Session & Term Management */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <div className="flex items-center gap-2.5">
                  <CalendarClock className="w-5 h-5 text-blue-900" />
                  <div>
                    <h2 className="font-display text-base font-bold text-slate-900">
                      Academic Session &amp; Term Settings
                    </h2>
                    <p className="text-xs text-slate-500">
                      Controls the active school calendar stamped on newly created assessments and score sheets.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Active Academic Session
                    </label>
                    <select
                      disabled={savingAcademic}
                      value={academicConfig.currentSession}
                      onChange={(e) =>
                        void handleUpdateAcademic(e.target.value, academicConfig.currentTerm)
                      }
                      className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      {academicConfig.sessions.map((sess) => (
                        <option key={sess} value={sess}>
                          {sess}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Active School Term
                    </label>
                    <select
                      disabled={savingAcademic}
                      value={academicConfig.currentTerm}
                      onChange={(e) =>
                        void handleUpdateAcademic(
                          academicConfig.currentSession,
                          e.target.value as TermName
                        )
                      }
                      className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      {TERM_NAMES.map((term) => (
                        <option key={term} value={term}>
                          {term}
                        </option>
                      ))}
                    </select>
                  </div>

                  <form onSubmit={handleAddSession} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newSessionInput}
                      onChange={(e) => setNewSessionInput(e.target.value)}
                      placeholder="Add session e.g. 2028/2029"
                      className="flex-1 px-3 py-2.5 text-sm border border-slate-300 rounded-lg"
                    />
                    <button
                      type="submit"
                      disabled={savingAcademic || !newSessionInput.trim()}
                      className="px-4 py-2.5 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 disabled:opacity-50 rounded-lg whitespace-nowrap cursor-pointer"
                    >
                      Add Session
                    </button>
                  </form>
                </div>
              </div>

              {/* Teacher Accounts Registry */}
              <div className="space-y-4">
                <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <UserCheck className="w-5 h-5 text-blue-900 shrink-0" />
                    <div>
                      <h2 className="font-display text-base font-bold text-slate-900">
                        Subject Teacher Accounts
                      </h2>
                      <p className="text-xs text-slate-500">
                        Assign subjects and classes so teachers can create tests, manage question banks, and export class score sheets.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={openCreateTeacher}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 rounded-lg whitespace-nowrap cursor-pointer self-start sm:self-auto"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Teacher Account</span>
                  </button>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                          <th className="py-3 px-4">Teacher Full Name</th>
                          <th className="py-3 px-4">Username</th>
                          <th className="py-3 px-4">Assigned Subjects</th>
                          <th className="py-3 px-4">Classes</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {teachers.map((t) => {
                          const assignedNames = t.subjectIds
                            .map((id) => subjects.find((s) => s.id === id)?.name)
                            .filter(Boolean);
                          return (
                            <tr key={t.id} className="hover:bg-slate-50/70">
                              <td className="py-3 px-4 font-semibold text-slate-900">
                                {t.fullName}
                              </td>
                              <td className="py-3 px-4 font-mono text-xs text-blue-900">
                                {t.username}
                              </td>
                              <td className="py-3 px-4 text-xs text-slate-600">
                                {assignedNames.length > 0 ? assignedNames.join(', ') : 'None assigned'}
                              </td>
                              <td className="py-3 px-4 text-xs text-slate-600">
                                {t.classes.length === 6 ? 'JSS1–SS3' : t.classes.join(', ')}
                              </td>
                              <td className="py-3 px-4 text-xs font-semibold">
                                {t.isActive ? (
                                  <span className="text-emerald-700">Active</span>
                                ) : (
                                  <span className="text-slate-400">Disabled</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => openEditTeacher(t)}
                                    title="Edit Teacher Account"
                                    className="p-1.5 text-slate-600 hover:text-blue-900 hover:bg-blue-50 rounded-md cursor-pointer"
                                  >
                                    <Edit3 className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDeleteTarget({
                                        type: 'teacher',
                                        id: t.id,
                                        label: `teacher account ${t.fullName} (${t.username})`,
                                      })
                                    }
                                    title="Delete Teacher"
                                    className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md cursor-pointer"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* MODAL: Create / Edit Subject (with Scheduling, Rules & Bank Curation) */}
      {subjectModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-blue-950 text-white px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-base font-bold">
                {editingSubject ? 'Edit Examination Subject & Rules' : 'Create Examination Subject'}
              </h2>
              <button
                type="button"
                onClick={() => setSubjectModalOpen(false)}
                className="p-1 text-blue-200 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSubject} className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Subject Name
                  </label>
                  <input
                    type="text"
                    required
                    value={subName}
                    onChange={(e) => setSubName(e.target.value)}
                    placeholder="e.g. Agricultural Science"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Subject Code
                  </label>
                  <input
                    type="text"
                    required
                    value={subCode}
                    onChange={(e) => setSubCode(e.target.value.toUpperCase())}
                    placeholder="e.g. AGR 204"
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
                      setSubIsPractice(val === 'Practice');
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
                    Session
                  </label>
                  <select
                    value={subSessionName}
                    onChange={(e) => setSubSessionName(e.target.value)}
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
                    Select All (JSS1–SS3)
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
                        className={`py-1.5 px-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
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
                  <span className="text-xs font-semibold text-slate-700">Target Class Arms</span>
                  <button
                    type="button"
                    onClick={() => setSubArms([...CLASS_ARMS])}
                    className="text-xs font-semibold text-blue-900 hover:underline cursor-pointer"
                  >
                    Select All (A–J)
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
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
                        className={`py-1.5 px-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Scheduled Start (Optional)
                  </label>
                  <input
                    type="datetime-local"
                    value={subStartAt}
                    onChange={(e) => setSubStartAt(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Scheduled Close (Optional)
                  </label>
                  <input
                    type="datetime-local"
                    value={subEndAt}
                    onChange={(e) => setSubEndAt(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>
              </div>

              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-slate-700">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={subShuffleQ}
                    onChange={(e) => setSubShuffleQ(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-900"
                  />
                  <span>Shuffle questions per student</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={subShuffleOpt}
                    onChange={(e) => setSubShuffleOpt(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-900"
                  />
                  <span>Shuffle MCQ options (A–D)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={subShowScore}
                    onChange={(e) => setSubShowScore(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-900"
                  />
                  <span>Release score immediately</span>
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
                  <span>Enforce tab/fullscreen guardrails</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={subActive}
                    onChange={(e) => setSubActive(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-900"
                  />
                  <span>Exam active and visible to students</span>
                </label>
              </div>

              {editingSubject && bankForEditedSubject.length > 0 && (
                <div className="p-3.5 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800">
                      Question Selection ({subCuratedIds.length === 0 ? `All ${bankForEditedSubject.length} in bank` : `${subCuratedIds.length} curated`})
                    </span>
                    {subCuratedIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSubCuratedIds([])}
                        className="font-semibold text-blue-900 hover:underline cursor-pointer"
                      >
                        Reset to Full Bank
                      </button>
                    )}
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1.5 pr-1">
                    {bankForEditedSubject.map((q) => (
                      <label
                        key={q.id}
                        className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={subCuratedIds.includes(q.id)}
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
                          <strong>[{q.topic || 'General'}]</strong> {q.prompt}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Candidate Instructions
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
                  onClick={() => setSubjectModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSubject || subClasses.length === 0 || subArms.length === 0}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  {savingSubject ? 'Saving...' : editingSubject ? 'Save Changes' : 'Create Subject'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Add / Edit Question (All 4 Types) */}
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
                    <option value="ALL">All Classes</option>
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
                    placeholder="e.g. Algebra"
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
                  placeholder="Type the question text here..."
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
                    Acceptable Answers (Separate variants with semicolon ;)
                  </label>
                  <input
                    type="text"
                    required
                    value={qAcceptableAnswers}
                    onChange={(e) => setQAcceptableAnswers(e.target.value)}
                    placeholder="e.g. hexagon; a hexagon"
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
                          className={`py-2 text-sm font-mono font-bold rounded-lg border transition-colors cursor-pointer ${
                            qCorrect === k
                              ? 'bg-emerald-700 border-emerald-700 text-white'
                              : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
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
                  placeholder="Brief note shown during post-exam review"
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

      {/* MODAL: Bulk Upload Questions (Excel / CSV / Pipe / JSON) */}
      {bulkModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-blue-950 text-white px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-base font-bold">
                Bulk Upload Questions — {selectedSubjectObj?.name}
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
                    Upload Excel (.xlsx / .xls) or CSV File
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
                    Loaded file: {bulkFileName} ({bulkFileQuestions.length} valid questions)
                  </p>
                )}
              </div>

              <div>
                <p className="text-xs text-slate-600 leading-relaxed mb-1.5">
                  Or paste one MCQ per line using pipe separators:{' '}
                  <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                    Question | Option A | Option B | Option C | Option D | Correct(A-D)
                  </code>
                </p>

                <textarea
                  rows={6}
                  value={bulkText}
                  onChange={(e) => {
                    setBulkText(e.target.value);
                    if (bulkFileQuestions.length > 0) {
                      setBulkFileQuestions([]);
                      setBulkFileName('');
                    }
                  }}
                  placeholder="What is the capital of Edo State? | Igarra | Benin City | Auchi | Ekpoma | B"
                  className="w-full px-3.5 py-2.5 text-xs sm:text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                />
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600">
                  Detected Valid Questions:{' '}
                  <strong className="font-mono text-emerald-700">
                    {parsedBulkPreview.length}
                  </strong>
                </span>
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
                  {bulkSaving
                    ? 'Importing...'
                    : `Import ${parsedBulkPreview.length} Question${parsedBulkPreview.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Create / Edit Teacher Account */}
      {teacherModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-blue-950 text-white px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-base font-bold">
                {editingTeacher ? 'Edit Teacher Account' : 'Create Subject Teacher Account'}
              </h2>
              <button
                type="button"
                onClick={() => setTeacherModalOpen(false)}
                className="p-1 text-blue-200 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveTeacher} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Teacher Full Name
                </label>
                <input
                  type="text"
                  required
                  value={tchFullName}
                  onChange={(e) => setTchFullName(e.target.value)}
                  placeholder="e.g. Mr. Musa Ibrahim"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editingTeacher)}
                    value={tchUsername}
                    onChange={(e) => setTchUsername(e.target.value.toLowerCase())}
                    placeholder="e.g. t.musa"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {editingTeacher ? 'New Password (Optional)' : 'Login Password'}
                  </label>
                  <input
                    type="password"
                    required={!editingTeacher}
                    value={tchPassword}
                    onChange={(e) => setTchPassword(e.target.value)}
                    placeholder={editingTeacher ? 'Leave blank to keep' : 'Min 4 characters'}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Assigned Subjects
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-32 overflow-y-auto p-2.5 border border-slate-200 rounded-lg">
                  {subjects.map((sub) => (
                    <label
                      key={sub.id}
                      className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={tchSubjectIds.includes(sub.id)}
                        onChange={() =>
                          setTchSubjectIds((prev) =>
                            prev.includes(sub.id)
                              ? prev.filter((id) => id !== sub.id)
                              : [...prev, sub.id]
                          )
                        }
                        className="w-3.5 h-3.5 rounded border-slate-300 text-blue-900"
                      />
                      <span>
                        {sub.code} — {sub.name}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Assigned Classes
                </span>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {CLASS_LEVELS.map((cls) => {
                    const checked = tchClasses.includes(cls);
                    return (
                      <button
                        key={cls}
                        type="button"
                        onClick={() =>
                          setTchClasses((prev) =>
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

              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tchActive}
                  onChange={(e) => setTchActive(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-900"
                />
                <span>Teacher account active (can sign in)</span>
              </label>

              <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setTeacherModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTeacher}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  {savingTeacher
                    ? 'Saving...'
                    : editingTeacher
                      ? 'Save Changes'
                      : 'Create Teacher'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Generate Scratch Cards */}
      {cardModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            <div className="bg-blue-950 text-white px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-base font-bold">
                Generate Result Scratch Cards
              </h2>
              <button
                type="button"
                onClick={() => setCardModalOpen(false)}
                className="p-1 text-blue-200 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGenerateCards} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Batch Label
                </label>
                <input
                  type="text"
                  required
                  value={cardBatchLabel}
                  onChange={(e) => setCardBatchLabel(e.target.value)}
                  placeholder="e.g. 2026/2027 Second Term"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Number of Cards (1–50)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    required
                    value={cardCount}
                    onChange={(e) => setCardCount(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Max Checks per Card
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    required
                    value={cardMaxUses}
                    onChange={(e) => setCardMaxUses(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCardModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={generatingCards}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  {generatingCards ? 'Generating...' : `Generate ${cardCount} Cards`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Register / Edit Student */}
      {studentModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            <div className="bg-blue-950 text-white px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-base font-bold">
                {editingStudent
                  ? 'Edit Registered Student'
                  : 'Register Student (Auto-Generate Exam No.)'}
              </h2>
              <button
                type="button"
                onClick={() => setStudentModalOpen(false)}
                className="p-1 text-blue-200 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStudent} className="p-6 space-y-4">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs flex items-center justify-between gap-2">
                <span className="text-slate-600 font-medium">Admission / Exam Number</span>
                <span className="font-mono font-bold text-blue-950">
                  {editingStudent
                    ? editingStudent.examNumber
                    : 'Auto-generated (GSS/2026/XXXX)'}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Student Full Name (Surname First)
                </label>
                <input
                  type="text"
                  required
                  value={stuFullName}
                  onChange={(e) => setStuFullName(e.target.value)}
                  placeholder="e.g. Oshiomhole Faith Ese"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Class
                  </label>
                  <select
                    value={stuClass}
                    onChange={(e) => setStuClass(e.target.value as ClassLevel)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {CLASS_LEVELS.map((cls) => (
                      <option key={cls} value={cls}>
                        {cls}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Arm</label>
                  <select
                    value={stuArm}
                    onChange={(e) => setStuArm(e.target.value as ClassArm)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {CLASS_ARMS.map((arm) => (
                      <option key={arm} value={arm}>
                        Arm {arm}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Gender
                  </label>
                  <select
                    value={stuGender}
                    onChange={(e) => setStuGender(e.target.value as StudentGender)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Guardian Phone (Optional)
                  </label>
                  <input
                    type="tel"
                    value={stuPhone}
                    onChange={(e) => setStuPhone(e.target.value)}
                    placeholder="e.g. 0803 123 4567"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Student Portal Passcode (Optional · Min 4 chars)
                </label>
                <input
                  type="password"
                  value={stuPasscode}
                  onChange={(e) => setStuPasscode(e.target.value)}
                  placeholder={
                    editingStudent?.hasPasscode
                      ? 'Leave blank to keep existing passcode'
                      : 'Set optional portal passcode'
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setStudentModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingStudent || stuFullName.trim().length < 2}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  {savingStudent
                    ? 'Saving...'
                    : editingStudent
                      ? 'Save Changes'
                      : 'Register & Generate No.'}
                </button>
              </div>
            </form>
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
                  Are you sure you want to permanently remove {deleteTarget.label}?
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
