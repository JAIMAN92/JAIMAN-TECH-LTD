export type ClassLevel = 'JSS1' | 'JSS2' | 'JSS3' | 'SS1' | 'SS2' | 'SS3';

export const CLASS_LEVELS: ClassLevel[] = ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'];

export type ClassArm = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';

export const CLASS_ARMS: ClassArm[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

export type OptionKey = 'A' | 'B' | 'C' | 'D';

export type QuestionType = 'mcq' | 'true_false' | 'fill_blank' | 'comprehension';

export type TermName = 'First Term' | 'Second Term' | 'Third Term';

export const TERM_NAMES: TermName[] = ['First Term', 'Second Term', 'Third Term'];

export type AssessmentType = 'CA' | 'Exam' | 'Mock' | 'Practice';

export type PageId =
  | 'home'
  | 'take-exam'
  | 'check-result'
  | 'about'
  | 'contact'
  | 'admin'
  | 'teacher';

export interface AcademicConfig {
  currentSession: string;
  currentTerm: TermName;
  sessions: string[];
}

export interface TeacherAccount {
  id: string;
  fullName: string;
  username: string;
  passwordHash: string;
  subjectIds: string[];
  classes: ClassLevel[];
  isActive: boolean;
  createdAt: string;
}

export interface TeacherPublicProfile {
  id: string;
  fullName: string;
  username: string;
  subjectIds: string[];
  classes: ClassLevel[];
  isActive: boolean;
  createdAt: string;
}

export interface Subject {
  id: string;
  name: string;
  code: string;
  sessionName?: string;
  term: string;
  assessmentType?: AssessmentType;
  isPractice?: boolean;
  classes: ClassLevel[];
  arms?: ClassArm[];
  durationMinutes: number;
  passMark: number;
  isActive: boolean;
  instructions: string;
  startAt?: string;
  endAt?: string;
  allowedAttempts?: number; // 0 = unlimited
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  showScoreAfterSubmit?: boolean;
  showReviewAfterSubmit?: boolean;
  enableBrowserGuardrails?: boolean;
  questionIds?: string[]; // Optional curated subset from question bank
  createdByTeacherId?: string;
  questionCount?: number;
}

export interface Question {
  id: string;
  subjectId: string;
  type?: QuestionType;
  classLevel?: ClassLevel | 'ALL';
  topic?: string;
  passageTitle?: string;
  passage?: string;
  prompt: string;
  options: Record<OptionKey, string>;
  correctOption: OptionKey;
  acceptableAnswers?: string[]; // For fill_blank questions (case-insensitive)
  explanation?: string;
  createdBy?: string;
}

export interface PublicQuestion {
  id: string;
  subjectId: string;
  type: QuestionType;
  topic?: string;
  passageTitle?: string;
  passage?: string;
  prompt: string;
  options: Record<OptionKey, string>;
}

export interface AnswerReviewItem {
  questionId: string;
  type?: QuestionType;
  prompt: string;
  options: Record<OptionKey, string>;
  selectedOption: OptionKey | null;
  selectedText?: string;
  correctOption: OptionKey;
  correctText?: string;
  isCorrect: boolean;
  explanation?: string;
}

export interface ExamResult {
  id: string;
  referenceCode: string;
  studentName: string;
  examNumber: string;
  classLevel: ClassLevel;
  classArm: ClassArm;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  sessionName?: string;
  term?: string;
  assessmentType?: AssessmentType;
  isPractice?: boolean;
  score: number;
  totalQuestions: number;
  percentage: number;
  passMark: number;
  passed: boolean;
  grade: string;
  durationTakenSeconds: number;
  submittedAt: string;
  autoSubmitted: boolean;
  scoreWithheld?: boolean;
  tabViolations?: number;
  terminationReason?: string;
  review?: AnswerReviewItem[];
}

export interface ScratchCard {
  id: string;
  serialNumber: string;
  pin: string;
  batchLabel: string;
  maxUses: number;
  usedCount: number;
  boundExamNumber?: string;
  isDisabled: boolean;
  createdAt: string;
  lastUsedAt?: string;
}

export interface ResultCardInfo {
  serialNumber: string;
  usedCount: number;
  maxUses: number;
  remainingUses: number;
}

export interface PortalSettings {
  requireScratchCard: boolean;
}

export interface ContactInquiry {
  id: string;
  fullName: string;
  examNumber?: string;
  email: string;
  category: string;
  message: string;
  submittedAt: string;
}

export interface ActiveExamSession {
  sessionId: string;
  studentName: string;
  examNumber: string;
  classLevel: ClassLevel;
  classArm: ClassArm;
  subject: Subject;
  questions: PublicQuestion[];
  savedAnswers?: Record<string, string>;
  savedFlagged?: Record<string, boolean>;
  lastSavedAt?: string;
  startedAt: number;
  expiresAt: number;
}

export interface PersistedExamSession {
  sessionId: string;
  studentName: string;
  examNumber: string;
  classLevel: ClassLevel;
  classArm: ClassArm;
  subjectId: string;
  questionIds: string[];
  optionMaps: Record<string, Record<OptionKey, OptionKey>>;
  savedAnswers: Record<string, string>;
  savedFlagged: Record<string, boolean>;
  lastSavedAt: string;
  startedAt: number;
  expiresAt: number;
}

export type StudentGender = 'Male' | 'Female';

export interface Student {
  id: string;
  fullName: string;
  examNumber: string;
  classLevel: ClassLevel;
  classArm: ClassArm;
  gender: StudentGender;
  guardianPhone?: string;
  passcodeHash?: string;
  hasPasscode?: boolean;
  registeredAt: string;
  registeredBy: 'self' | 'admin';
}
