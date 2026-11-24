import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  CLASS_ARMS,
  TERM_NAMES,
  type AcademicConfig,
  type AssessmentType,
  type ClassArm,
  type ClassLevel,
  type ContactInquiry,
  type ExamResult,
  type OptionKey,
  type PersistedExamSession,
  type PortalSettings,
  type Question,
  type QuestionType,
  type ScratchCard,
  type Student,
  type StudentGender,
  type Subject,
  type TeacherAccount,
  type TeacherPublicProfile,
  type TermName,
} from '../src/types.ts';
import {
  flushSupabaseSync,
  hydrateStoreFromSupabase,
  isSupabaseConfigured,
  queueStoreSyncToSupabase,
} from './supabaseSync.ts';

export interface CbtStoreData {
  academicConfig: AcademicConfig;
  teachers: TeacherAccount[];
  subjects: Subject[];
  questions: Question[];
  results: ExamResult[];
  students: Student[];
  nextAdmissionSeq: number;
  scratchCards: ScratchCard[];
  settings: PortalSettings;
  inquiries: ContactInquiry[];
  activeSessions: PersistedExamSession[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'cbt-store.json');

const ADMIN_SALT = 'gss-igarra-cbt-2026';
const DEFAULT_ADMIN_SCRYPT_HEX =
  'a84188ccfc8d69289ec89f5b8d168fb05531659a1847576bdfe2ca32e047ed88945c0f20af41c659fcc24ebd338f21ec6232b95d56df4fcf586a9d0488a06bd4';

export function verifyAdminPassword(candidate: string): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return false;
  }

  let configured = (process.env.ADMIN_PASSWORD || '').trim();
  if (
    configured.length >= 2 &&
    ((configured.startsWith('"') && configured.endsWith('"')) ||
      (configured.startsWith("'") && configured.endsWith("'")))
  ) {
    configured = configured.slice(1, -1).trim();
  }

  if (configured && configured !== 'MY_ADMIN_PASSWORD') {
    const candidateDigest = crypto.createHash('sha256').update(candidate, 'utf8').digest();
    const configuredDigest = crypto.createHash('sha256').update(configured, 'utf8').digest();
    return crypto.timingSafeEqual(candidateDigest, configuredDigest);
  }

  const derived = crypto.scryptSync(candidate, ADMIN_SALT, 64);
  const expected = Buffer.from(DEFAULT_ADMIN_SCRYPT_HEX, 'hex');
  if (derived.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(derived, expected);
}

export function hashSecret(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifySecretHash(plain: string, stored: string): boolean {
  if (typeof plain !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, hex] = parts;
  if (!salt || !hex) return false;
  try {
    const derived = crypto.scryptSync(plain, salt, 64);
    const expected = Buffer.from(hex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function toPublicTeacher(t: TeacherAccount): TeacherPublicProfile {
  return {
    id: t.id,
    fullName: t.fullName,
    username: t.username,
    subjectIds: t.subjectIds,
    classes: t.classes,
    isActive: t.isActive,
    createdAt: t.createdAt,
  };
}

export function toSafeStudent(s: Student): Student {
  const { passcodeHash, ...rest } = s;
  return {
    ...rest,
    hasPasscode: Boolean(passcodeHash),
  };
}

export function computeWaecGrade(percentage: number): string {
  if (percentage >= 75) return 'A1 (Distinction)';
  if (percentage >= 70) return 'B2 (Very Good)';
  if (percentage >= 65) return 'B3 (Good)';
  if (percentage >= 60) return 'C4 (Credit)';
  if (percentage >= 55) return 'C5 (Credit)';
  if (percentage >= 50) return 'C6 (Credit)';
  if (percentage >= 45) return 'D7 (Pass)';
  if (percentage >= 40) return 'E8 (Pass)';
  return 'F9 (Fail)';
}

function buildDefaultAcademicConfig(): AcademicConfig {
  return {
    currentSession: '2026/2027',
    currentTerm: 'First Term',
    sessions: ['2025/2026', '2026/2027', '2027/2028'],
  };
}

function buildSeedTeachers(): TeacherAccount[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'tch-adebayo',
      fullName: 'Mr. Adebayo Samuel',
      username: 't.adebayo',
      passwordHash: hashSecret('teacher123'),
      subjectIds: ['sub-math', 'sub-bsc', 'sub-phy', 'sub-ict', 'sub-practice'],
      classes: ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'],
      isActive: true,
      createdAt: now,
    },
    {
      id: 'tch-okonkwo',
      fullName: 'Mrs. Okonkwo Ngozi',
      username: 't.okonkwo',
      passwordHash: hashSecret('teacher123'),
      subjectIds: ['sub-eng', 'sub-civic', 'sub-bio', 'sub-chem', 'sub-practice'],
      classes: ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'],
      isActive: true,
      createdAt: now,
    },
  ];
}

function buildExtraMultiTypeQuestions(): Question[] {
  return [
    {
      id: 'q-mth-9',
      subjectId: 'sub-math',
      type: 'true_false',
      classLevel: 'ALL',
      topic: 'Number Theory',
      prompt: 'Every prime number greater than 2 is an odd integer.',
      options: { A: 'True', B: 'False', C: '', D: '' },
      correctOption: 'A',
      explanation: '2 is the only even prime number; all other primes are odd.',
    },
    {
      id: 'q-mth-10',
      subjectId: 'sub-math',
      type: 'fill_blank',
      classLevel: 'ALL',
      topic: 'Geometry',
      prompt: 'A polygon with exactly six sides is called a _______.',
      options: { A: '', B: '', C: '', D: '' },
      correctOption: 'A',
      acceptableAnswers: ['hexagon', 'a hexagon'],
      explanation: 'A six-sided polygon is a hexagon.',
    },
    {
      id: 'q-eng-9',
      subjectId: 'sub-eng',
      type: 'comprehension',
      classLevel: 'ALL',
      topic: 'Reading Comprehension',
      passageTitle: 'Digital Libraries in Nigerian Schools',
      passage:
        'Over the past decade, secondary schools across Edo State have modernized their libraries by introducing offline e-learning servers and Computer-Based Test (CBT) laboratories. Students in rural and semi-urban towns like Igarra can now practise WAEC and NECO past questions without uninterrupted internet access. Teachers report that regular digital drills reduce examination anxiety and improve time management.',
      prompt: 'According to the passage, what is one major benefit of regular CBT drills for students?',
      options: {
        A: 'They replace all classroom textbooks permanently',
        B: 'They reduce examination anxiety and improve time management',
        C: 'They eliminate the need for secondary school teachers',
        D: 'They require continuous international travel',
      },
      correctOption: 'B',
      explanation: 'The final sentence states that regular digital drills reduce examination anxiety and improve time management.',
    },
    {
      id: 'q-civ-7',
      subjectId: 'sub-civic',
      type: 'true_false',
      classLevel: 'ALL',
      topic: 'Nigerian Constitution',
      prompt: 'Nigeria operates a federal system of government with 36 states and the Federal Capital Territory.',
      options: { A: 'True', B: 'False', C: '', D: '' },
      correctOption: 'A',
      explanation: 'The 1999 Constitution establishes Nigeria as a Federation of 36 states and the FCT.',
    },
    {
      id: 'q-prc-1',
      subjectId: 'sub-practice',
      type: 'mcq',
      classLevel: 'ALL',
      topic: 'CBT Orientation',
      prompt: 'Which button in the CBT interface lets you mark a difficult question to revisit before submitting?',
      options: {
        A: 'Sign Out',
        B: 'Mark for Review',
        C: 'Auto-fill Profile',
        D: 'Scratch Card PIN',
      },
      correctOption: 'B',
      explanation: 'The "Mark for Review" toggle highlights the item on the Question Navigator.',
    },
    {
      id: 'q-prc-2',
      subjectId: 'sub-practice',
      type: 'true_false',
      classLevel: 'ALL',
      topic: 'CBT Orientation',
      prompt: 'True or False: Your selected answers are automatically saved during an examination in case of a brief power cut or refresh.',
      options: { A: 'True', B: 'False', C: '', D: '' },
      correctOption: 'A',
      explanation: 'Real-time autosave persists answers locally and on the school CBT server.',
    },
    {
      id: 'q-prc-3',
      subjectId: 'sub-practice',
      type: 'fill_blank',
      classLevel: 'ALL',
      topic: 'General Knowledge',
      prompt: 'Igarra is the administrative headquarters of _______ Local Government Area in Edo State.',
      options: { A: '', B: '', C: '', D: '' },
      correctOption: 'A',
      acceptableAnswers: ['akoko-edo', 'akoko edo', 'akoko-edo lga'],
      explanation: 'Igarra is the headquarters of Akoko-Edo LGA, Edo State.',
    },
    {
      id: 'q-prc-4',
      subjectId: 'sub-practice',
      type: 'comprehension',
      classLevel: 'ALL',
      topic: 'Reading Comprehension',
      passageTitle: 'Examination Readiness',
      passage:
        'Before beginning a timed CBT paper at JAIMAN GOLDENLITE TECH LTD, candidates verify their Admission Number, read the paper instructions carefully, and note the total time allowed. Managing minutes wisely—answering confident questions first and flagging harder items for later—consistently produces higher scores.',
      prompt: 'Based on the passage, what strategy helps candidates achieve higher CBT scores?',
      options: {
        A: 'Spending half the exam time on Question 1',
        B: 'Skipping the instructions completely',
        C: 'Answering confident questions first and flagging harder ones for review',
        D: 'Submitting before checking unanswered items',
      },
      correctOption: 'C',
      explanation: 'The passage highlights answering confident items first and flagging harder ones.',
    },
  ];
}

function buildPracticeSubject(): Subject {
  return {
    id: 'sub-practice',
    name: 'General CBT Practice Test',
    code: 'PRC 101',
    sessionName: '2026/2027',
    term: 'First Term',
    assessmentType: 'Practice',
    isPractice: true,
    classes: ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'],
    arms: [...CLASS_ARMS],
    durationMinutes: 15,
    passMark: 50,
    isActive: true,
    allowedAttempts: 0,
    shuffleQuestions: true,
    shuffleOptions: true,
    showScoreAfterSubmit: true,
    showReviewAfterSubmit: true,
    enableBrowserGuardrails: false,
    instructions:
      'Practice paper featuring Multiple-Choice, True/False, Fill-in-the-Blank, and Comprehension Passage items for unlimited warm-up drills.',
  };
}

function normalizeSubjectRecord(s: Subject): Subject {
  return {
    ...s,
    sessionName: s.sessionName || '2026/2027',
    term: s.term || 'First Term',
    assessmentType: s.assessmentType || (s.isPractice ? 'Practice' : 'Exam'),
    isPractice: Boolean(s.isPractice),
    arms: Array.isArray(s.arms) && s.arms.length > 0 ? sanitizeArms(s.arms) : [...CLASS_ARMS],
    allowedAttempts: typeof s.allowedAttempts === 'number' ? s.allowedAttempts : s.isPractice ? 0 : 1,
    shuffleQuestions: typeof s.shuffleQuestions === 'boolean' ? s.shuffleQuestions : true,
    shuffleOptions: typeof s.shuffleOptions === 'boolean' ? s.shuffleOptions : true,
    showScoreAfterSubmit: typeof s.showScoreAfterSubmit === 'boolean' ? s.showScoreAfterSubmit : true,
    showReviewAfterSubmit: typeof s.showReviewAfterSubmit === 'boolean' ? s.showReviewAfterSubmit : true,
    enableBrowserGuardrails:
      typeof s.enableBrowserGuardrails === 'boolean' ? s.enableBrowserGuardrails : !s.isPractice,
  };
}

function inferTopic(q: Question): string {
  if (q.topic) return q.topic;
  if (q.subjectId === 'sub-math') return 'Algebra & Numeracy';
  if (q.subjectId === 'sub-eng') return 'Lexis & Structure';
  if (q.subjectId === 'sub-civic') return 'Citizenship & Government';
  if (q.subjectId === 'sub-bsc') return 'Matter & Living Systems';
  if (q.subjectId === 'sub-bio') return 'Cell Biology & Ecology';
  if (q.subjectId === 'sub-chem') return 'Atomic Structure & Acids';
  if (q.subjectId === 'sub-phy') return 'Mechanics & Electricity';
  if (q.subjectId === 'sub-ict') return 'Hardware & Data Processing';
  return 'General';
}

function normalizeQuestionRecord(q: Question): Question {
  const type: QuestionType = isValidQuestionType(q.type) ? q.type : 'mcq';
  return {
    ...q,
    type,
    classLevel: q.classLevel || 'ALL',
    topic: inferTopic(q),
    options:
      type === 'true_false'
        ? { A: 'True', B: 'False', C: '', D: '' }
        : {
            A: q.options?.A || '',
            B: q.options?.B || '',
            C: q.options?.C || '',
            D: q.options?.D || '',
          },
  };
}

export function buildSeedData(): CbtStoreData {
  const rawSubjects: Subject[] = [
    {
      id: 'sub-math',
      name: 'Mathematics',
      code: 'MTH 101',
      sessionName: '2026/2027',
      term: 'First Term',
      assessmentType: 'Exam',
      isPractice: false,
      classes: ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'],
      arms: [...CLASS_ARMS],
      durationMinutes: 20,
      passMark: 50,
      isActive: true,
      allowedAttempts: 1,
      shuffleQuestions: true,
      shuffleOptions: true,
      showScoreAfterSubmit: true,
      showReviewAfterSubmit: true,
      enableBrowserGuardrails: true,
      instructions:
        'Attempt all questions carefully. Rough work sheets are permitted on your desk; electronic calculators are not allowed.',
    },
    {
      id: 'sub-eng',
      name: 'English Language',
      code: 'ENG 102',
      sessionName: '2026/2027',
      term: 'First Term',
      assessmentType: 'Exam',
      isPractice: false,
      classes: ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'],
      arms: [...CLASS_ARMS],
      durationMinutes: 20,
      passMark: 50,
      isActive: true,
      allowedAttempts: 1,
      shuffleQuestions: true,
      shuffleOptions: true,
      showScoreAfterSubmit: true,
      showReviewAfterSubmit: true,
      enableBrowserGuardrails: true,
      instructions:
        'Select the option that best completes each sentence, or answer the comprehension passage questions accurately.',
    },
    {
      id: 'sub-civic',
      name: 'Civic Education',
      code: 'CIV 103',
      sessionName: '2026/2027',
      term: 'First Term',
      assessmentType: 'CA',
      isPractice: false,
      classes: ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'],
      arms: [...CLASS_ARMS],
      durationMinutes: 15,
      passMark: 50,
      isActive: true,
      allowedAttempts: 1,
      shuffleQuestions: true,
      shuffleOptions: true,
      showScoreAfterSubmit: true,
      showReviewAfterSubmit: true,
      enableBrowserGuardrails: true,
      instructions:
        'Answer all questions on Nigerian citizenship, constitution, human rights, and national values.',
    },
    {
      id: 'sub-bsc',
      name: 'Basic Science',
      code: 'BSC 201',
      sessionName: '2026/2027',
      term: 'First Term',
      assessmentType: 'Exam',
      isPractice: false,
      classes: ['JSS1', 'JSS2', 'JSS3'],
      arms: [...CLASS_ARMS],
      durationMinutes: 15,
      passMark: 50,
      isActive: true,
      allowedAttempts: 1,
      shuffleQuestions: true,
      shuffleOptions: true,
      showScoreAfterSubmit: true,
      showReviewAfterSubmit: true,
      enableBrowserGuardrails: true,
      instructions:
        'Junior Secondary examination covering living things, matter, energy, and environmental health.',
    },
    {
      id: 'sub-bio',
      name: 'Biology',
      code: 'BIO 301',
      sessionName: '2026/2027',
      term: 'First Term',
      assessmentType: 'Mock',
      isPractice: false,
      classes: ['SS1', 'SS2', 'SS3'],
      arms: [...CLASS_ARMS],
      durationMinutes: 20,
      passMark: 50,
      isActive: true,
      allowedAttempts: 1,
      shuffleQuestions: true,
      shuffleOptions: true,
      showScoreAfterSubmit: true,
      showReviewAfterSubmit: true,
      enableBrowserGuardrails: true,
      instructions:
        'Senior Secondary mock paper covering cell biology, ecology, nutrition, and genetics.',
    },
    {
      id: 'sub-chem',
      name: 'Chemistry',
      code: 'CHM 302',
      sessionName: '2026/2027',
      term: 'First Term',
      assessmentType: 'Mock',
      isPractice: false,
      classes: ['SS1', 'SS2', 'SS3'],
      arms: [...CLASS_ARMS],
      durationMinutes: 20,
      passMark: 50,
      isActive: true,
      allowedAttempts: 1,
      shuffleQuestions: true,
      shuffleOptions: true,
      showScoreAfterSubmit: true,
      showReviewAfterSubmit: true,
      enableBrowserGuardrails: true,
      instructions:
        'Senior Secondary mock paper on atomic structure, chemical bonding, acids, bases, and stoichiometry.',
    },
    {
      id: 'sub-phy',
      name: 'Physics',
      code: 'PHY 303',
      sessionName: '2026/2027',
      term: 'First Term',
      assessmentType: 'Mock',
      isPractice: false,
      classes: ['SS1', 'SS2', 'SS3'],
      arms: [...CLASS_ARMS],
      durationMinutes: 20,
      passMark: 50,
      isActive: true,
      allowedAttempts: 1,
      shuffleQuestions: true,
      shuffleOptions: true,
      showScoreAfterSubmit: true,
      showReviewAfterSubmit: true,
      enableBrowserGuardrails: true,
      instructions:
        'Senior Secondary mock paper covering mechanics, waves, electricity, and fundamental SI units.',
    },
    {
      id: 'sub-ict',
      name: 'Computer Studies (ICT)',
      code: 'ICT 104',
      sessionName: '2026/2027',
      term: 'First Term',
      assessmentType: 'CA',
      isPractice: false,
      classes: ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'],
      arms: [...CLASS_ARMS],
      durationMinutes: 15,
      passMark: 50,
      isActive: true,
      allowedAttempts: 1,
      shuffleQuestions: true,
      shuffleOptions: true,
      showScoreAfterSubmit: true,
      showReviewAfterSubmit: true,
      enableBrowserGuardrails: true,
      instructions:
        'Covers computer hardware, operating systems, data processing, networking, and digital safety.',
    },
    buildPracticeSubject(),
  ];

  const rawQuestions: Question[] = [
    // Mathematics (8 MCQ + 2 extra types)
    {
      id: 'q-mth-1',
      subjectId: 'sub-math',
      topic: 'Algebra',
      prompt: 'Simplify the algebraic expression: 3(2x - 4) + 2(x + 5).',
      options: { A: '8x - 2', B: '8x + 2', C: '6x - 2', D: '8x - 22' },
      correctOption: 'A',
      explanation: '3(2x - 4) + 2(x + 5) = 6x - 12 + 2x + 10 = 8x - 2.',
    },
    {
      id: 'q-mth-2',
      subjectId: 'sub-math',
      topic: 'Percentages',
      prompt: 'Convert 45% to a fraction in its lowest term.',
      options: { A: '9/25', B: '9/20', C: '4/9', D: '11/20' },
      correctOption: 'B',
      explanation: '45/100 divided by 5 in numerator and denominator gives 9/20.',
    },
    {
      id: 'q-mth-3',
      subjectId: 'sub-math',
      topic: 'Algebra',
      prompt: 'Find the value of x if 5x - 7 = 3x + 9.',
      options: { A: '6', B: '7', C: '8', D: '9' },
      correctOption: 'C',
      explanation: '5x - 3x = 9 + 7 => 2x = 16 => x = 8.',
    },
    {
      id: 'q-mth-4',
      subjectId: 'sub-math',
      topic: 'Commercial Arithmetic',
      prompt: 'Calculate the simple interest on ₦25,000 for 2 years at 6% per annum.',
      options: { A: '₦1,500', B: '₦2,500', C: '₦3,000', D: '₦3,500' },
      correctOption: 'C',
      explanation: 'I = (P × R × T) / 100 = (25000 × 6 × 2) / 100 = ₦3,000.',
    },
    {
      id: 'q-mth-5',
      subjectId: 'sub-math',
      topic: 'Geometry',
      prompt: 'The sum of angles in a triangle is:',
      options: { A: '90°', B: '180°', C: '270°', D: '360°' },
      correctOption: 'B',
      explanation: 'The three interior angles of any Euclidean triangle always sum to 180°.',
    },
    {
      id: 'q-mth-6',
      subjectId: 'sub-math',
      topic: 'Statistics',
      prompt: 'What is the median of the data set: 12, 7, 19, 14, 9, 15, 11?',
      options: { A: '11', B: '12', C: '14', D: '15' },
      correctOption: 'B',
      explanation: 'Ordered set: 7, 9, 11, 12, 14, 15, 19. The middle value is 12.',
    },
    {
      id: 'q-mth-7',
      subjectId: 'sub-math',
      topic: 'Mensuration',
      prompt: 'A rectangle has a length of 14 cm and a perimeter of 44 cm. Find its width.',
      options: { A: '6 cm', B: '8 cm', C: '10 cm', D: '16 cm' },
      correctOption: 'B',
      explanation: 'Perimeter = 2(l + w) => 44 = 2(14 + w) => 22 = 14 + w => w = 8 cm.',
    },
    {
      id: 'q-mth-8',
      subjectId: 'sub-math',
      topic: 'Indices & Roots',
      prompt: 'Evaluate √(144) + 3².',
      options: { A: '18', B: '21', C: '23', D: '27' },
      correctOption: 'B',
      explanation: '√144 = 12 and 3² = 9, so 12 + 9 = 21.',
    },

    // English Language (8 MCQ)
    {
      id: 'q-eng-1',
      subjectId: 'sub-eng',
      topic: 'Vocabulary',
      prompt: 'Choose the word that is NEAREST IN MEANING to the underlined word: The principal commended the students for their DILIGENCE.',
      options: { A: 'Hard work', B: 'Punctuality', C: 'Obedience', D: 'Patience' },
      correctOption: 'A',
      explanation: 'Diligence means careful and persistent hard work or effort.',
    },
    {
      id: 'q-eng-2',
      subjectId: 'sub-eng',
      topic: 'Concord & Grammar',
      prompt: 'Fill in the blank with the most suitable option: Neither the teacher nor the students _____ present at the assembly.',
      options: { A: 'was', B: 'is', C: 'were', D: 'has been' },
      correctOption: 'C',
      explanation: 'With "neither...nor", the verb agrees with the nearer subject ("the students", plural), so "were" is correct.',
    },
    {
      id: 'q-eng-3',
      subjectId: 'sub-eng',
      topic: 'Vocabulary',
      prompt: 'Choose the option OPPOSITE IN MEANING to: The witness gave a CANDID account of the incident.',
      options: { A: 'Honest', B: 'Deceitful', C: 'Brief', D: 'Clear' },
      correctOption: 'B',
      explanation: 'Candid means frank and truthful; its opposite is deceitful.',
    },
    {
      id: 'q-eng-4',
      subjectId: 'sub-eng',
      topic: 'Figures of Speech',
      prompt: 'Identify the figure of speech in: "The classroom was a beehive of activity during the science fair."',
      options: { A: 'Simile', B: 'Metaphor', C: 'Personification', D: 'Hyperbole' },
      correctOption: 'B',
      explanation: 'Comparing the classroom directly to a beehive without "like" or "as" is a metaphor.',
    },
    {
      id: 'q-eng-5',
      subjectId: 'sub-eng',
      topic: 'Spelling',
      prompt: 'Select the correctly spelt word:',
      options: { A: 'Accomodation', B: 'Acommodation', C: 'Accommodation', D: 'Acomodation' },
      correctOption: 'C',
      explanation: 'Accommodation has double "c" and double "m".',
    },
    {
      id: 'q-eng-6',
      subjectId: 'sub-eng',
      topic: 'Prepositions',
      prompt: 'Complete the sentence: She has been studying at JAIMAN GOLDENLITE TECH LTD _____ 2023.',
      options: { A: 'for', B: 'from', C: 'since', D: 'during' },
      correctOption: 'C',
      explanation: '"Since" is used with a specific starting point in time (2023).',
    },
    {
      id: 'q-eng-7',
      subjectId: 'sub-eng',
      topic: 'Vocabulary',
      prompt: 'Which of the following is a synonym for "ephemeral"?',
      options: { A: 'Permanent', B: 'Short-lived', C: 'Ancient', D: 'Mysterious' },
      correctOption: 'B',
      explanation: 'Ephemeral describes something lasting for a very short time.',
    },
    {
      id: 'q-eng-8',
      subjectId: 'sub-eng',
      topic: 'Question Tags',
      prompt: 'Choose the correct question tag: You prepared well for the CBT examination, _____?',
      options: { A: "didn't you", B: "weren't you", C: "haven't you", D: 'did you' },
      correctOption: 'A',
      explanation: 'A positive past simple statement ("prepared") takes the negative past simple tag "didn\'t you".',
    },

    // Civic Education (6 MCQ)
    {
      id: 'q-civ-1',
      subjectId: 'sub-civic',
      topic: 'Arms of Government',
      prompt: 'Which arm of government in Nigeria is responsible for interpreting the laws and administering justice?',
      options: { A: 'The Executive', B: 'The Legislature', C: 'The Judiciary', D: 'The Civil Service' },
      correctOption: 'C',
      explanation: 'The Judiciary interprets the constitution and laws through the courts.',
    },
    {
      id: 'q-civ-2',
      subjectId: 'sub-civic',
      topic: 'National Symbols',
      prompt: 'What do the two white horses on the Nigerian Coat of Arms symbolize?',
      options: { A: 'Strength and Pride', B: 'Dignity', C: 'Fertile Soil', D: 'Unity and Faith' },
      correctOption: 'B',
      explanation: 'The two white horses represent dignity; the black shield represents fertile soil.',
    },
    {
      id: 'q-civ-3',
      subjectId: 'sub-civic',
      topic: 'National Unity',
      prompt: 'In what year was the National Youth Service Corps (NYSC) scheme established in Nigeria?',
      options: { A: '1963', B: '1973', C: '1979', D: '1999' },
      correctOption: 'B',
      explanation: 'NYSC was established on 22 May 1973 to foster national unity and reconstruction.',
    },
    {
      id: 'q-civ-4',
      subjectId: 'sub-civic',
      topic: 'Rule of Law',
      prompt: 'The principle that no citizen is above the law and all citizens are equal before the law is called:',
      options: { A: 'Separation of Powers', B: 'Rule of Law', C: 'Federalism', D: 'Checks and Balances' },
      correctOption: 'B',
      explanation: 'The Rule of Law guarantees supremacy of the law and equality before it.',
    },
    {
      id: 'q-civ-5',
      subjectId: 'sub-civic',
      topic: 'Local Governance',
      prompt: 'Igarra is the administrative headquarters of which Local Government Area in Edo State?',
      options: { A: 'Etsako West', B: 'Owan East', C: 'Akoko-Edo', D: 'Esan Central' },
      correctOption: 'C',
      explanation: 'Igarra is the headquarters of Akoko-Edo Local Government Area, Edo State.',
    },
    {
      id: 'q-civ-6',
      subjectId: 'sub-civic',
      topic: 'Civic Duties',
      prompt: 'Which of the following is a fundamental duty of a responsible Nigerian citizen?',
      options: {
        A: 'Evading taxes during inflation',
        B: 'Respecting national symbols and paying taxes promptly',
        C: 'Ignoring traffic regulations',
        D: 'Vandalizing public infrastructure',
      },
      correctOption: 'B',
      explanation: 'Paying taxes promptly and respecting national symbols are civic obligations.',
    },

    // Basic Science (6 questions)
    {
      id: 'q-bsc-1',
      subjectId: 'sub-bsc',
      topic: 'Atmosphere',
      prompt: 'Which gas makes up approximately 78% of the Earth’s atmosphere?',
      options: { A: 'Oxygen', B: 'Carbon dioxide', C: 'Nitrogen', D: 'Argon' },
      correctOption: 'C',
      explanation: 'Dry air consists of roughly 78% nitrogen and 21% oxygen.',
    },
    {
      id: 'q-bsc-2',
      subjectId: 'sub-bsc',
      topic: 'Human Circulatory System',
      prompt: 'Which organ in the human body pumps blood throughout the circulatory system?',
      options: { A: 'Liver', B: 'Kidney', C: 'Heart', D: 'Lung' },
      correctOption: 'C',
      explanation: 'The heart acts as the muscular pump driving blood circulation.',
    },
    {
      id: 'q-bsc-3',
      subjectId: 'sub-bsc',
      topic: 'States of Matter',
      prompt: 'What is the boiling point of pure water at standard atmospheric pressure?',
      options: { A: '0°C', B: '50°C', C: '100°C', D: '212°C' },
      correctOption: 'C',
      explanation: 'Pure water boils at 100°C (212°F) at sea level.',
    },
    {
      id: 'q-bsc-4',
      subjectId: 'sub-bsc',
      topic: 'Plant Nutrition',
      prompt: 'Green plants manufacture their food through a process called:',
      options: { A: 'Respiration', B: 'Photosynthesis', C: 'Transpiration', D: 'Germination' },
      correctOption: 'B',
      explanation: 'Photosynthesis uses sunlight, water, and carbon dioxide to produce glucose.',
    },
    {
      id: 'q-bsc-5',
      subjectId: 'sub-bsc',
      topic: 'Energy Resources',
      prompt: 'Which of the following is a renewable source of energy?',
      options: { A: 'Coal', B: 'Crude oil', C: 'Solar energy', D: 'Natural gas' },
      correctOption: 'C',
      explanation: 'Solar energy is naturally replenished and does not deplete like fossil fuels.',
    },
    {
      id: 'q-bsc-6',
      subjectId: 'sub-bsc',
      topic: 'Scientific Instruments',
      prompt: 'The instrument used to measure temperature is called a:',
      options: { A: 'Barometer', B: 'Thermometer', C: 'Anemometer', D: 'Hygrometer' },
      correctOption: 'B',
      explanation: 'A thermometer measures temperature; a barometer measures atmospheric pressure.',
    },

    // Biology (6 questions)
    {
      id: 'q-bio-1',
      subjectId: 'sub-bio',
      topic: 'Cell Biology',
      prompt: 'Which organelle is known as the powerhouse of a eukaryotic cell because it generates ATP?',
      options: { A: 'Ribosome', B: 'Golgi apparatus', C: 'Mitochondrion', D: 'Lysosome' },
      correctOption: 'C',
      explanation: 'Mitochondria carry out aerobic respiration to produce ATP.',
    },
    {
      id: 'q-bio-2',
      subjectId: 'sub-bio',
      topic: 'Plant Transport',
      prompt: 'The transport tissue in vascular plants responsible for carrying water and mineral salts from roots to leaves is:',
      options: { A: 'Phloem', B: 'Xylem', C: 'Cortex', D: 'Cambium' },
      correctOption: 'B',
      explanation: 'Xylem transports water and dissolved minerals upward; phloem transports sugars.',
    },
    {
      id: 'q-bio-3',
      subjectId: 'sub-bio',
      topic: 'Circulatory System',
      prompt: 'Which blood cells are primarily responsible for defending the body against pathogens?',
      options: { A: 'Erythrocytes', B: 'Leucocytes', C: 'Platelets', D: 'Plasma proteins' },
      correctOption: 'B',
      explanation: 'Leucocytes (white blood cells) fight infection and foreign pathogens.',
    },
    {
      id: 'q-bio-4',
      subjectId: 'sub-bio',
      topic: 'Genetics',
      prompt: 'In human genetics, a male child inherits which pair of sex chromosomes?',
      options: { A: 'XX', B: 'XY', C: 'YY', D: 'XO' },
      correctOption: 'B',
      explanation: 'Human males have one X and one Y chromosome (XY).',
    },
    {
      id: 'q-bio-5',
      subjectId: 'sub-bio',
      topic: 'Nutrition & Health',
      prompt: 'Deficiency of Vitamin C in the human diet causes:',
      options: { A: 'Rickets', B: 'Scurvy', C: 'Beriberi', D: 'Goitre' },
      correctOption: 'B',
      explanation: 'Lack of Vitamin C (ascorbic acid) leads to scurvy, causing bleeding gums.',
    },
    {
      id: 'q-bio-6',
      subjectId: 'sub-bio',
      topic: 'Ecology',
      prompt: 'Which ecological instrument is used to measure light intensity in a habitat?',
      options: { A: 'Photometer', B: 'Secchi disc', C: 'Potometer', D: 'Rain gauge' },
      correctOption: 'A',
      explanation: 'A photometer measures light intensity (a potometer measures transpiration rate).',
    },

    // Chemistry (5 questions)
    {
      id: 'q-chm-1',
      subjectId: 'sub-chem',
      topic: 'Atomic Structure',
      prompt: 'What is the atomic number of Carbon?',
      options: { A: '4', B: '6', C: '12', D: '14' },
      correctOption: 'B',
      explanation: 'Carbon has 6 protons in its nucleus, so its atomic number is 6.',
    },
    {
      id: 'q-chm-2',
      subjectId: 'sub-chem',
      topic: 'Acids & Bases',
      prompt: 'A solution with a pH value of 2 is:',
      options: { A: 'Strongly acidic', B: 'Neutral', C: 'Weakly alkaline', D: 'Strongly alkaline' },
      correctOption: 'A',
      explanation: 'Values below 7 are acidic, and pH 2 indicates a strong acid.',
    },
    {
      id: 'q-chm-3',
      subjectId: 'sub-chem',
      topic: 'Separation Techniques',
      prompt: 'Which separation technique is best used to obtain pure water from sea water?',
      options: { A: 'Filtration', B: 'Simple distillation', C: 'Chromatography', D: 'Sublimation' },
      correctOption: 'B',
      explanation: 'Simple distillation vaporizes and condenses pure water away from dissolved salts.',
    },
    {
      id: 'q-chm-4',
      subjectId: 'sub-chem',
      topic: 'Chemical Formulae',
      prompt: 'The chemical formula for Calcium Trioxocarbonate (IV) is:',
      options: { A: 'CaCO₂', B: 'CaCO₃', C: 'Ca(OH)₂', D: 'CaSO₄' },
      correctOption: 'B',
      explanation: 'Calcium carbonate has the formula CaCO₃.',
    },
    {
      id: 'q-chm-5',
      subjectId: 'sub-chem',
      topic: 'Periodic Table',
      prompt: 'Which of the following is an example of a noble gas?',
      options: { A: 'Chlorine', B: 'Argon', C: 'Nitrogen', D: 'Hydrogen' },
      correctOption: 'B',
      explanation: 'Argon belongs to Group 0 (Group 18) noble gases.',
    },

    // Physics (5 questions)
    {
      id: 'q-phy-1',
      subjectId: 'sub-phy',
      topic: 'Electricity',
      prompt: 'What is the SI unit of electrical resistance?',
      options: { A: 'Volt', B: 'Ampere', C: 'Ohm', D: 'Watt' },
      correctOption: 'C',
      explanation: 'Electrical resistance is measured in Ohms (Ω).',
    },
    {
      id: 'q-phy-2',
      subjectId: 'sub-phy',
      topic: 'Kinematics',
      prompt: 'A car travels 180 metres in 12 seconds at constant speed. What is its speed?',
      options: { A: '12 m/s', B: '15 m/s', C: '18 m/s', D: '20 m/s' },
      correctOption: 'B',
      explanation: 'Speed = Distance / Time = 180 / 12 = 15 m/s.',
    },
    {
      id: 'q-phy-3',
      subjectId: 'sub-phy',
      topic: 'Vectors & Scalars',
      prompt: 'Which of the following quantities is a scalar quantity?',
      options: { A: 'Velocity', B: 'Force', C: 'Mass', D: 'Acceleration' },
      correctOption: 'C',
      explanation: 'Mass has magnitude only and no direction, making it a scalar quantity.',
    },
    {
      id: 'q-phy-4',
      subjectId: 'sub-phy',
      topic: 'Electricity',
      prompt: 'If a resistor of 6 Ω carries a current of 2 A, what is the potential difference across it?',
      options: { A: '3 V', B: '4 V', C: '8 V', D: '12 V' },
      correctOption: 'D',
      explanation: 'By Ohm’s law, V = I × R = 2 A × 6 Ω = 12 V.',
    },
    {
      id: 'q-phy-5',
      subjectId: 'sub-phy',
      topic: 'Waves & Sound',
      prompt: 'Sound waves cannot travel through:',
      options: { A: 'Steel', B: 'Water', C: 'Air', D: 'A vacuum' },
      correctOption: 'D',
      explanation: 'Sound is a mechanical wave that requires a material medium and cannot propagate through a vacuum.',
    },

    // Computer Studies / ICT (6 questions)
    {
      id: 'q-ict-1',
      subjectId: 'sub-ict',
      topic: 'Hardware',
      prompt: 'Which component of the computer is referred to as the brain of the system?',
      options: {
        A: 'Hard Disk Drive',
        B: 'Central Processing Unit (CPU)',
        C: 'Random Access Memory (RAM)',
        D: 'Power Supply Unit',
      },
      correctOption: 'B',
      explanation: 'The CPU executes instructions and coordinates arithmetic and logic operations.',
    },
    {
      id: 'q-ict-2',
      subjectId: 'sub-ict',
      topic: 'Data Representation',
      prompt: 'How many bits make one byte?',
      options: { A: '4 bits', B: '8 bits', C: '16 bits', D: '32 bits' },
      correctOption: 'B',
      explanation: '1 byte equals 8 bits.',
    },
    {
      id: 'q-ict-3',
      subjectId: 'sub-ict',
      topic: 'Input & Output',
      prompt: 'Which of the following is an example of an output device?',
      options: { A: 'Optical Mouse', B: 'Flatbed Scanner', C: 'Laser Printer', D: 'Keyboard' },
      correctOption: 'C',
      explanation: 'A laser printer produces hard-copy output from the computer.',
    },
    {
      id: 'q-ict-4',
      subjectId: 'sub-ict',
      topic: 'Spreadsheets',
      prompt: 'In spreadsheet software, every formula must begin with which symbol?',
      options: { A: '#', B: '@', C: '=', D: '$' },
      correctOption: 'C',
      explanation: 'Formulas in Excel and similar spreadsheet applications start with an equals sign (=).',
    },
    {
      id: 'q-ict-5',
      subjectId: 'sub-ict',
      topic: 'Internet & Networking',
      prompt: 'What does HTTP stand for on the World Wide Web?',
      options: {
        A: 'HyperText Transfer Protocol',
        B: 'High Transmission Text Process',
        C: 'Hyperlink Tracking Terminal Program',
        D: 'Host Transfer Technology Protocol',
      },
      correctOption: 'A',
      explanation: 'HTTP stands for HyperText Transfer Protocol.',
    },
    {
      id: 'q-ict-6',
      subjectId: 'sub-ict',
      topic: 'Computer Memory',
      prompt: 'Which type of memory loses its stored data as soon as electrical power is switched off?',
      options: { A: 'ROM', B: 'SSD', C: 'RAM', D: 'Flash Drive' },
      correctOption: 'C',
      explanation: 'RAM is volatile memory and loses its contents when power is turned off.',
    },
    ...buildExtraMultiTypeQuestions(),
  ];

  const results: ExamResult[] = [
    {
      id: 'res-seed-1',
      referenceCode: 'GSS-2026-8410',
      studentName: 'Okafor Chinedu Samuel',
      examNumber: 'GSS/2026/0104',
      classLevel: 'SS3',
      classArm: 'A',
      subjectId: 'sub-math',
      subjectName: 'Mathematics',
      subjectCode: 'MTH 101',
      sessionName: '2026/2027',
      term: 'First Term',
      assessmentType: 'Exam',
      isPractice: false,
      score: 9,
      totalQuestions: 10,
      percentage: 90,
      passMark: 50,
      passed: true,
      grade: 'A1 (Distinction)',
      durationTakenSeconds: 742,
      submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 28).toISOString(),
      autoSubmitted: false,
    },
    {
      id: 'res-seed-2',
      referenceCode: 'GSS-2026-8411',
      studentName: 'Bello Amina Zainab',
      examNumber: 'GSS/2026/0219',
      classLevel: 'SS2',
      classArm: 'B',
      subjectId: 'sub-bio',
      subjectName: 'Biology',
      subjectCode: 'BIO 301',
      sessionName: '2026/2027',
      term: 'First Term',
      assessmentType: 'Mock',
      isPractice: false,
      score: 5,
      totalQuestions: 6,
      percentage: 83,
      passMark: 50,
      passed: true,
      grade: 'A1 (Distinction)',
      durationTakenSeconds: 615,
      submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 19).toISOString(),
      autoSubmitted: false,
    },
    {
      id: 'res-seed-3',
      referenceCode: 'GSS-2026-8412',
      studentName: 'Momoh Blessing Oshoke',
      examNumber: 'GSS/2026/0342',
      classLevel: 'JSS3',
      classArm: 'A',
      subjectId: 'sub-eng',
      subjectName: 'English Language',
      subjectCode: 'ENG 102',
      sessionName: '2026/2027',
      term: 'First Term',
      assessmentType: 'Exam',
      isPractice: false,
      score: 7,
      totalQuestions: 9,
      percentage: 78,
      passMark: 50,
      passed: true,
      grade: 'A1 (Distinction)',
      durationTakenSeconds: 830,
      submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 7).toISOString(),
      autoSubmitted: false,
    },
    {
      id: 'res-seed-4',
      referenceCode: 'GSS-2026-8413',
      studentName: 'Adeyemi Oluwaseun Daniel',
      examNumber: 'GSS/2026/0408',
      classLevel: 'JSS2',
      classArm: 'C',
      subjectId: 'sub-bsc',
      subjectName: 'Basic Science',
      subjectCode: 'BSC 201',
      sessionName: '2026/2027',
      term: 'First Term',
      assessmentType: 'Exam',
      isPractice: false,
      score: 2,
      totalQuestions: 6,
      percentage: 33,
      passMark: 50,
      passed: false,
      grade: 'F9 (Fail)',
      durationTakenSeconds: 510,
      submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
      autoSubmitted: false,
    },
  ];

  const students = buildSeedStudents();

  return {
    academicConfig: buildDefaultAcademicConfig(),
    teachers: buildSeedTeachers(),
    subjects: rawSubjects.map(normalizeSubjectRecord),
    questions: rawQuestions.map(normalizeQuestionRecord),
    results,
    students,
    nextAdmissionSeq: computeNextSeq(students, results),
    scratchCards: buildSeedScratchCards(),
    settings: { requireScratchCard: true },
    inquiries: [],
    activeSessions: [],
  };
}

function buildSeedStudents(): Student[] {
  const now = Date.now();
  return [
    {
      id: 'stu-seed-1',
      fullName: 'Okafor Chinedu Samuel',
      examNumber: 'GSS/2026/0104',
      classLevel: 'SS3',
      classArm: 'A',
      gender: 'Male',
      guardianPhone: '0803 412 8890',
      registeredAt: new Date(now - 1000 * 60 * 60 * 72).toISOString(),
      registeredBy: 'admin',
    },
    {
      id: 'stu-seed-2',
      fullName: 'Bello Amina Zainab',
      examNumber: 'GSS/2026/0219',
      classLevel: 'SS2',
      classArm: 'B',
      gender: 'Female',
      guardianPhone: '0805 729 1044',
      registeredAt: new Date(now - 1000 * 60 * 60 * 64).toISOString(),
      registeredBy: 'admin',
    },
    {
      id: 'stu-seed-3',
      fullName: 'Momoh Blessing Oshoke',
      examNumber: 'GSS/2026/0342',
      classLevel: 'JSS3',
      classArm: 'A',
      gender: 'Female',
      guardianPhone: '0812 604 3318',
      registeredAt: new Date(now - 1000 * 60 * 60 * 48).toISOString(),
      registeredBy: 'admin',
    },
    {
      id: 'stu-seed-4',
      fullName: 'Adeyemi Oluwaseun Daniel',
      examNumber: 'GSS/2026/0408',
      classLevel: 'JSS2',
      classArm: 'C',
      gender: 'Male',
      guardianPhone: '0806 918 5521',
      registeredAt: new Date(now - 1000 * 60 * 60 * 36).toISOString(),
      registeredBy: 'admin',
    },
  ];
}

function extractAdmissionSeq(examNumber: string): number {
  const match = /^GSS\/\d{4}\/(\d{1,6})$/i.exec(examNumber.trim());
  if (!match) return 0;
  const num = Number(match[1]);
  return Number.isFinite(num) && num < 9000 ? num : 0;
}

function computeNextSeq(students: Student[], results: ExamResult[]): number {
  let maxSeq = 408;
  for (const s of students) {
    maxSeq = Math.max(maxSeq, extractAdmissionSeq(s.examNumber));
  }
  for (const r of results) {
    maxSeq = Math.max(maxSeq, extractAdmissionSeq(r.examNumber));
  }
  return maxSeq + 1;
}

export function generateNextExamNumber(store: CbtStoreData): string {
  const existing = new Set<string>();
  for (const s of store.students) existing.add(s.examNumber.toUpperCase());
  for (const r of store.results) existing.add(r.examNumber.toUpperCase());

  let seq = Math.max(store.nextAdmissionSeq || 409, computeNextSeq(store.students, store.results));
  let candidate = `GSS/2026/${String(seq).padStart(4, '0')}`;
  while (existing.has(candidate)) {
    seq += 1;
    candidate = `GSS/2026/${String(seq).padStart(4, '0')}`;
  }
  store.nextAdmissionSeq = seq + 1;
  return candidate;
}

function generateCardPin(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const group = (len: number) => {
    let out = '';
    for (let i = 0; i < len; i++) {
      out += chars[crypto.randomInt(0, chars.length)];
    }
    return out;
  };
  return `GLC-${group(4)}-${group(4)}-${group(4)}`;
}

export function buildScratchCardBatch(
  count: number,
  maxUses: number,
  batchLabel: string,
  existingCount: number
): ScratchCard[] {
  const cards: ScratchCard[] = [];
  const now = new Date().toISOString();
  for (let i = 0; i < count; i++) {
    const seq = 1001 + existingCount + i;
    cards.push({
      id: `sc-${crypto.randomUUID().slice(0, 8)}`,
      serialNumber: `GSS-SC-${seq}`,
      pin: generateCardPin(),
      batchLabel: batchLabel || '2026/2027 Termly Batch',
      maxUses,
      usedCount: 0,
      isDisabled: false,
      createdAt: now,
    });
  }
  return cards;
}

function buildSeedScratchCards(): ScratchCard[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'sc-seed-1',
      serialNumber: 'GSS-SC-1001',
      pin: 'GLC-4829-7315-9042',
      batchLabel: '2026/2027 Termly Batch',
      maxUses: 5,
      usedCount: 0,
      isDisabled: false,
      createdAt: now,
    },
    {
      id: 'sc-seed-2',
      serialNumber: 'GSS-SC-1002',
      pin: 'GLC-6194-2058-3741',
      batchLabel: '2026/2027 Termly Batch',
      maxUses: 5,
      usedCount: 0,
      isDisabled: false,
      createdAt: now,
    },
    {
      id: 'sc-seed-3',
      serialNumber: 'GSS-SC-1003',
      pin: 'GLC-9375-8412-6204',
      batchLabel: '2026/2027 Termly Batch',
      maxUses: 5,
      usedCount: 0,
      isDisabled: false,
      createdAt: now,
    },
    {
      id: 'sc-seed-4',
      serialNumber: 'GSS-SC-1004',
      pin: 'GLC-3517-6940-8125',
      batchLabel: '2026/2027 Termly Batch',
      maxUses: 5,
      usedCount: 0,
      isDisabled: false,
      createdAt: now,
    },
    {
      id: 'sc-seed-5',
      serialNumber: 'GSS-SC-1005',
      pin: 'GLC-7402-5183-6490',
      batchLabel: '2026/2027 Termly Batch',
      maxUses: 5,
      usedCount: 0,
      isDisabled: false,
      createdAt: now,
    },
  ];
}

let cachedStore: CbtStoreData | null = null;

function ensureStoreLoaded(): CbtStoreData {
  if (cachedStore) return cachedStore;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(STORE_PATH)) {
    try {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<CbtStoreData>;
      if (
        Array.isArray(parsed.subjects) &&
        Array.isArray(parsed.questions) &&
        Array.isArray(parsed.results)
      ) {
        const normalizedResults: ExamResult[] = parsed.results.map((r) => ({
          ...r,
          classArm: isValidClassArm(r.classArm) ? r.classArm : 'A',
          sessionName: r.sessionName || '2026/2027',
          term: r.term || 'First Term',
          assessmentType: r.assessmentType || 'Exam',
        }));

        const normalizedSubjects: Subject[] = parsed.subjects.map(normalizeSubjectRecord);
        if (!normalizedSubjects.some((s) => s.id === 'sub-practice')) {
          normalizedSubjects.push(buildPracticeSubject());
        }

        const existingQuestionIds = new Set(parsed.questions.map((q) => q.id));
        const normalizedQuestions: Question[] = parsed.questions.map(normalizeQuestionRecord);
        for (const extraQ of buildExtraMultiTypeQuestions()) {
          if (!existingQuestionIds.has(extraQ.id)) {
            normalizedQuestions.push(normalizeQuestionRecord(extraQ));
          }
        }

        const normalizedStudents: Student[] = Array.isArray(parsed.students)
          ? parsed.students.map((stu) => ({
              ...stu,
              classArm: isValidClassArm(stu.classArm) ? stu.classArm : 'A',
              gender: isValidGender(stu.gender) ? stu.gender : 'Male',
              registeredBy: stu.registeredBy === 'self' ? 'self' : 'admin',
            }))
          : buildSeedStudents();

        const computedNext = computeNextSeq(normalizedStudents, normalizedResults);
        const storedNext =
          typeof parsed.nextAdmissionSeq === 'number' && parsed.nextAdmissionSeq > 0
            ? parsed.nextAdmissionSeq
            : computedNext;

        const now = Date.now();
        const validActiveSessions: PersistedExamSession[] = Array.isArray(parsed.activeSessions)
          ? parsed.activeSessions.filter((sess) => sess && sess.expiresAt + 1000 * 60 * 30 > now)
          : [];

        cachedStore = {
          academicConfig:
            parsed.academicConfig &&
            typeof parsed.academicConfig.currentSession === 'string' &&
            isValidTermName(parsed.academicConfig.currentTerm) &&
            Array.isArray(parsed.academicConfig.sessions)
              ? parsed.academicConfig
              : buildDefaultAcademicConfig(),
          teachers:
            Array.isArray(parsed.teachers) && parsed.teachers.length > 0
              ? parsed.teachers
              : buildSeedTeachers(),
          subjects: normalizedSubjects,
          questions: normalizedQuestions,
          results: normalizedResults,
          students: normalizedStudents,
          nextAdmissionSeq: Math.max(storedNext, computedNext),
          scratchCards: Array.isArray(parsed.scratchCards)
            ? parsed.scratchCards
            : buildSeedScratchCards(),
          settings:
            parsed.settings && typeof parsed.settings.requireScratchCard === 'boolean'
              ? parsed.settings
              : { requireScratchCard: true },
          inquiries: Array.isArray(parsed.inquiries) ? parsed.inquiries : [],
          activeSessions: validActiveSessions,
        };
        return cachedStore;
      }
    } catch {
      // Fall back to fresh seed if file is corrupted
    }
  }

  cachedStore = buildSeedData();
  persistStore(cachedStore);
  return cachedStore;
}

function persistStore(data: CbtStoreData): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpPath = path.join(DATA_DIR, `cbt-store.${process.pid}.tmp.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, STORE_PATH);
}

export async function initStore(): Promise<CbtStoreData> {
  const local = ensureStoreLoaded();
  const remote = await hydrateStoreFromSupabase(local, buildSeedData());
  if (remote) {
    cachedStore = remote;
    persistStore(remote);
    return remote;
  }
  return local;
}

export function getStore(): CbtStoreData {
  return ensureStoreLoaded();
}

export function saveStore(updater: (current: CbtStoreData) => CbtStoreData | void): CbtStoreData {
  const current = ensureStoreLoaded();
  const shouldSync = isSupabaseConfigured();
  const prevSnapshot = shouldSync ? structuredClone(current) : null;
  const next = updater(current) || current;
  cachedStore = next;
  persistStore(next);
  if (shouldSync) {
    queueStoreSyncToSupabase(prevSnapshot, structuredClone(next));
  }
  return next;
}

export async function saveStoreAndSync(
  updater: (current: CbtStoreData) => CbtStoreData | void
): Promise<CbtStoreData> {
  const next = saveStore(updater);
  if (isSupabaseConfigured()) {
    await Promise.race([
      flushSupabaseSync(),
      new Promise<void>((resolve) => setTimeout(resolve, 4000)),
    ]);
  }
  return next;
}

export function sanitizeClasses(input: unknown): ClassLevel[] {
  const valid: ClassLevel[] = ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'];
  if (!Array.isArray(input)) return [];
  const filtered = input.filter((c): c is ClassLevel => valid.includes(c as ClassLevel));
  return Array.from(new Set(filtered));
}

export function isValidClassArm(value: unknown): value is ClassArm {
  return typeof value === 'string' && (CLASS_ARMS as string[]).includes(value);
}

export function sanitizeArms(input: unknown): ClassArm[] {
  if (!Array.isArray(input)) return [...CLASS_ARMS];
  const filtered = input.filter((a): a is ClassArm => isValidClassArm(a));
  return filtered.length > 0 ? Array.from(new Set(filtered)) : [...CLASS_ARMS];
}

export function isValidOptionKey(value: unknown): value is OptionKey {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D';
}

export function isValidGender(value: unknown): value is StudentGender {
  return value === 'Male' || value === 'Female';
}

export function isValidQuestionType(value: unknown): value is QuestionType {
  return (
    value === 'mcq' ||
    value === 'true_false' ||
    value === 'fill_blank' ||
    value === 'comprehension'
  );
}

export function isValidAssessmentType(value: unknown): value is AssessmentType {
  return value === 'CA' || value === 'Exam' || value === 'Mock' || value === 'Practice';
}

export function isValidTermName(value: unknown): value is TermName {
  return typeof value === 'string' && (TERM_NAMES as string[]).includes(value);
}
