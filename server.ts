import crypto from 'crypto';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import {
  buildScratchCardBatch,
  computeWaecGrade,
  generateNextExamNumber,
  getStore,
  hashSecret,
  initStore,
  isValidAssessmentType,
  isValidClassArm,
  isValidGender,
  isValidOptionKey,
  isValidQuestionType,
  isValidTermName,
  sanitizeArms,
  sanitizeClasses,
  saveStoreAndSync,
  toPublicTeacher,
  toSafeStudent,
  verifyAdminPassword,
  verifySecretHash,
  type CbtStoreData,
} from './server/store';
import {
  forceFullSyncToSupabase,
  getSupabaseDiagnostics,
  isSupabaseConfigured,
} from './server/supabaseSync';
import {
  CLASS_ARMS,
  type ActiveExamSession,
  type AnswerReviewItem,
  type AssessmentType,
  type ClassArm,
  type ClassLevel,
  type ExamResult,
  type OptionKey,
  type PersistedExamSession,
  type PublicQuestion,
  type Question,
  type QuestionType,
  type ResultCardInfo,
  type Student,
  type Subject,
  type TeacherAccount,
} from './src/types';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const SESSION_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours staff session

const SESSION_SECRET_FALLBACK = crypto.randomBytes(32).toString('hex');

function getSessionSecret(): string {
  const fromEnv = (process.env.SESSION_SECRET || '').trim();
  if (fromEnv && !fromEnv.startsWith('REPLACE_WITH_')) {
    return fromEnv;
  }
  const anchor =
    (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() ||
    (process.env.SUPABASE_SECRET_KEY || '').trim() ||
    (process.env.ADMIN_PASSWORD || '').trim();
  if (anchor && anchor !== 'MY_ADMIN_PASSWORD' && anchor !== 'MY_SUPABASE_SERVICE_ROLE_KEY') {
    return crypto
      .createHmac('sha256', 'jaiman-cbt-session-key-v1')
      .update(anchor)
      .digest('hex');
  }
  return SESSION_SECRET_FALLBACK;
}

interface SignedStaffPayload {
  role: 'admin' | 'teacher';
  teacherId?: string;
  iat: number;
  exp: number;
  jti: string;
}

const revokedTokenIds = new Map<string, number>();

function pruneRevokedTokens() {
  const now = Date.now();
  for (const [jti, exp] of revokedTokenIds.entries()) {
    if (exp <= now) {
      revokedTokenIds.delete(jti);
    }
  }
}

function issueSignedStaffToken(payload: Omit<SignedStaffPayload, 'iat' | 'exp' | 'jti'>): {
  token: string;
  expiresAt: number;
} {
  pruneRevokedTokens();
  const iat = Date.now();
  const expiresAt = iat + SESSION_TTL_MS;
  const fullPayload: SignedStaffPayload = {
    ...payload,
    iat,
    exp: expiresAt,
    jti: crypto.randomUUID(),
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return { token: `${encoded}.${signature}`, expiresAt };
}

function verifySignedStaffToken(token: string): SignedStaffPayload | null {
  if (!token || typeof token !== 'string') return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0 || dotIdx === token.length - 1) return null;

  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!encoded || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedStaffPayload;
    if (!parsed || typeof parsed.exp !== 'number' || parsed.exp <= Date.now()) {
      return null;
    }
    if (parsed.jti && revokedTokenIds.has(parsed.jti)) {
      return null;
    }
    if (parsed.role !== 'admin' && parsed.role !== 'teacher') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function revokeStaffToken(token: string) {
  const payload = verifySignedStaffToken(token);
  if (payload?.jti) {
    revokedTokenIds.set(payload.jti, payload.exp);
  }
}

function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  pruneRevokedTokens();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Administrator authentication required.' });
    return;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  const payload = verifySignedStaffToken(token);
  if (!payload || payload.role !== 'admin') {
    res.status(401).json({ error: 'Administrator session expired. Please sign in again.' });
    return;
  }
  next();
}

interface AuthenticatedTeacherRequest extends Request {
  teacher?: TeacherAccount;
}

function requireTeacherAuth(req: AuthenticatedTeacherRequest, res: Response, next: NextFunction) {
  pruneRevokedTokens();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Teacher authentication required.' });
    return;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  const payload = verifySignedStaffToken(token);
  if (!payload || payload.role !== 'teacher' || !payload.teacherId) {
    res.status(401).json({ error: 'Teacher session expired. Please sign in again.' });
    return;
  }
  const store = getStore();
  const teacher = store.teachers.find((t) => t.id === payload.teacherId && t.isActive);
  if (!teacher) {
    res.status(401).json({ error: 'Teacher account is inactive or no longer exists.' });
    return;
  }
  req.teacher = teacher;
  next();
}

function cleanText(value: unknown, maxLength = 300): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

const VALID_CLASSES: ClassLevel[] = ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'];
const OPTION_KEYS: OptionKey[] = ['A', 'B', 'C', 'D'];

function cryptoShuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function resolveCuratedQuestions(store: CbtStoreData, subject: Subject): Question[] {
  const allForSubject = store.questions.filter((q) => q.subjectId === subject.id);
  if (Array.isArray(subject.questionIds) && subject.questionIds.length > 0) {
    const idSet = new Set(subject.questionIds);
    const curated = allForSubject.filter((q) => idSet.has(q.id));
    if (curated.length > 0) return curated;
  }
  return allForSubject;
}

function getEffectiveQuestionCount(store: CbtStoreData, subject: Subject): number {
  return resolveCuratedQuestions(store, subject).length;
}

function buildOptionPermutation(
  q: Question,
  shouldShuffleOptions: boolean
): Record<OptionKey, OptionKey> {
  const qType: QuestionType = q.type || 'mcq';
  if (!shouldShuffleOptions || (qType !== 'mcq' && qType !== 'comprehension')) {
    return { A: 'A', B: 'B', C: 'C', D: 'D' };
  }
  const shuffled = cryptoShuffle(OPTION_KEYS);
  return {
    A: shuffled[0],
    B: shuffled[1],
    C: shuffled[2],
    D: shuffled[3],
  };
}

function toPublicQuestion(
  q: Question,
  optionMap: Record<OptionKey, OptionKey>
): PublicQuestion {
  const qType: QuestionType = q.type || 'mcq';
  let options: Record<OptionKey, string>;
  if (qType === 'true_false') {
    options = { A: 'True', B: 'False', C: '', D: '' };
  } else if (qType === 'fill_blank') {
    options = { A: '', B: '', C: '', D: '' };
  } else {
    options = {
      A: q.options[optionMap.A] || '',
      B: q.options[optionMap.B] || '',
      C: q.options[optionMap.C] || '',
      D: q.options[optionMap.D] || '',
    };
  }

  return {
    id: q.id,
    subjectId: q.subjectId,
    type: qType,
    topic: q.topic,
    passageTitle: q.passageTitle,
    passage: q.passage,
    prompt: q.prompt,
    options,
  };
}

function redactResultForStudent(result: ExamResult, subject?: Subject): ExamResult {
  const hideScore = subject ? subject.showScoreAfterSubmit === false : Boolean(result.scoreWithheld);
  const hideReview = subject ? subject.showReviewAfterSubmit === false : false;

  if (hideScore) {
    return {
      ...result,
      score: 0,
      percentage: 0,
      passed: false,
      grade: 'Withheld',
      scoreWithheld: true,
      review: undefined,
    };
  }

  if (hideReview) {
    return {
      ...result,
      scoreWithheld: false,
      review: undefined,
    };
  }

  return result;
}

function buildQuestionInput(
  body: Record<string, unknown>,
  subjectId: string,
  createdBy?: string
): { question?: Question; error?: string } {
  const rawType = body?.type;
  const type: QuestionType = isValidQuestionType(rawType) ? rawType : 'mcq';
  const prompt = cleanText(body?.prompt, 1200);
  const topic = cleanText(body?.topic, 80) || 'General';
  const rawClassLevel = cleanText(body?.classLevel, 10).toUpperCase();
  const classLevel: ClassLevel | 'ALL' = VALID_CLASSES.includes(rawClassLevel as ClassLevel)
    ? (rawClassLevel as ClassLevel)
    : 'ALL';
  const explanation = cleanText(body?.explanation, 600) || undefined;
  const passageTitle = cleanText(body?.passageTitle, 160) || undefined;
  const passage = cleanText(body?.passage, 4000) || undefined;

  if (!prompt) {
    return { error: 'Question prompt is required.' };
  }

  if (type === 'comprehension' && !passage) {
    return { error: 'Comprehension questions require a reading passage.' };
  }

  if (type === 'true_false') {
    const rawCorrect = cleanText(body?.correctOption, 10).toUpperCase();
    const mappedCorrect: OptionKey =
      rawCorrect === 'B' || rawCorrect === 'FALSE' || rawCorrect === 'F' ? 'B' : 'A';
    return {
      question: {
        id: `q-${crypto.randomUUID().slice(0, 8)}`,
        subjectId,
        type: 'true_false',
        classLevel,
        topic,
        prompt,
        options: { A: 'True', B: 'False', C: '', D: '' },
        correctOption: mappedCorrect,
        explanation,
        createdBy,
      },
    };
  }

  if (type === 'fill_blank') {
    const rawAnswers = Array.isArray(body?.acceptableAnswers)
      ? body.acceptableAnswers
      : typeof body?.acceptableAnswers === 'string'
        ? body.acceptableAnswers.split(/[,;|]/)
        : [];
    const acceptableAnswers = rawAnswers
      .map((a) => cleanText(String(a), 140))
      .filter(Boolean);
    const fallbackA = cleanText((body?.options as Record<string, unknown> | undefined)?.A, 140);
    if (acceptableAnswers.length === 0 && fallbackA) {
      acceptableAnswers.push(fallbackA);
    }
    if (acceptableAnswers.length === 0) {
      return {
        error: 'Fill-in-the-Blank questions require at least one acceptable answer.',
      };
    }
    return {
      question: {
        id: `q-${crypto.randomUUID().slice(0, 8)}`,
        subjectId,
        type: 'fill_blank',
        classLevel,
        topic,
        prompt,
        options: { A: acceptableAnswers[0], B: '', C: '', D: '' },
        correctOption: 'A',
        acceptableAnswers,
        explanation,
        createdBy,
      },
    };
  }

  const opts = (body?.options && typeof body.options === 'object' ? body.options : {}) as Record<
    string,
    unknown
  >;
  const optA = cleanText(opts.A, 400);
  const optB = cleanText(opts.B, 400);
  const optC = cleanText(opts.C, 400);
  const optD = cleanText(opts.D, 400);
  const correctOption = String(body?.correctOption || '').toUpperCase();

  if (!optA || !optB || !optC || !optD || !isValidOptionKey(correctOption)) {
    return {
      error: 'Question prompt, all four options (A–D), and a valid correct option are required.',
    };
  }

  return {
    question: {
      id: `q-${crypto.randomUUID().slice(0, 8)}`,
      subjectId,
      type,
      classLevel,
      topic,
      ...(type === 'comprehension' ? { passageTitle, passage } : {}),
      prompt,
      options: { A: optA, B: optB, C: optC, D: optD },
      correctOption,
      explanation,
      createdBy,
    },
  };
}

function buildSubjectFields(
  body: Record<string, unknown>,
  store: CbtStoreData,
  existing?: Subject
): { subject?: Subject; error?: string } {
  const name =
    body?.name !== undefined ? cleanText(body.name, 100) : existing?.name || '';
  const code =
    body?.code !== undefined
      ? cleanText(body.code, 24).toUpperCase()
      : existing?.code || '';

  if (!name || !code) {
    return { error: 'Subject name and subject code are required.' };
  }

  const classes = body?.classes !== undefined
    ? sanitizeClasses(body.classes)
    : existing?.classes || [];
  if (classes.length === 0) {
    return { error: 'Select at least one target class (JSS1–SS3).' };
  }

  const arms = body?.arms !== undefined
    ? sanitizeArms(body.arms)
    : existing?.arms || [...CLASS_ARMS];

  const durationMinutes =
    body?.durationMinutes !== undefined
      ? Math.min(180, Math.max(1, Number(body.durationMinutes) || 20))
      : existing?.durationMinutes || 20;

  const passMark =
    body?.passMark !== undefined
      ? Math.min(100, Math.max(1, Number(body.passMark) || 50))
      : existing?.passMark || 50;

  const isPractice =
    typeof body?.isPractice === 'boolean'
      ? body.isPractice
      : existing?.isPractice ?? false;

  const assessmentType: AssessmentType = isValidAssessmentType(body?.assessmentType)
    ? body.assessmentType
    : isPractice
      ? 'Practice'
      : existing?.assessmentType || 'Exam';

  const sessionName =
    body?.sessionName !== undefined
      ? cleanText(body.sessionName, 30) || store.academicConfig.currentSession
      : existing?.sessionName || store.academicConfig.currentSession;

  const term =
    body?.term !== undefined
      ? cleanText(body.term, 80) || store.academicConfig.currentTerm
      : existing?.term || store.academicConfig.currentTerm;

  const startAt =
    body?.startAt !== undefined
      ? cleanText(body.startAt, 40) || undefined
      : existing?.startAt;
  const endAt =
    body?.endAt !== undefined
      ? cleanText(body.endAt, 40) || undefined
      : existing?.endAt;

  if (startAt && endAt && new Date(startAt).getTime() >= new Date(endAt).getTime()) {
    return { error: 'Scheduled End Time must be later than Start Time.' };
  }

  const allowedAttempts =
    body?.allowedAttempts !== undefined
      ? Math.min(20, Math.max(0, Math.floor(Number(body.allowedAttempts) || 0)))
      : existing?.allowedAttempts ?? (isPractice ? 0 : 1);

  const shuffleQuestions =
    typeof body?.shuffleQuestions === 'boolean'
      ? body.shuffleQuestions
      : existing?.shuffleQuestions ?? true;

  const shuffleOptions =
    typeof body?.shuffleOptions === 'boolean'
      ? body.shuffleOptions
      : existing?.shuffleOptions ?? true;

  const showScoreAfterSubmit =
    typeof body?.showScoreAfterSubmit === 'boolean'
      ? body.showScoreAfterSubmit
      : existing?.showScoreAfterSubmit ?? true;

  const showReviewAfterSubmit =
    typeof body?.showReviewAfterSubmit === 'boolean'
      ? body.showReviewAfterSubmit
      : existing?.showReviewAfterSubmit ?? true;

  const enableBrowserGuardrails =
    typeof body?.enableBrowserGuardrails === 'boolean'
      ? body.enableBrowserGuardrails
      : existing?.enableBrowserGuardrails ?? !isPractice;

  const questionIds = Array.isArray(body?.questionIds)
    ? body.questionIds.map((id) => cleanText(id, 80)).filter(Boolean)
    : existing?.questionIds;

  const instructions =
    body?.instructions !== undefined
      ? cleanText(body.instructions, 600) ||
        'Read each question carefully and answer within the allocated exam timer.'
      : existing?.instructions ||
        'Read each question carefully and answer within the allocated exam timer.';

  const isActive =
    typeof body?.isActive === 'boolean' ? body.isActive : existing?.isActive ?? true;

  return {
    subject: {
      id: existing?.id || `sub-${crypto.randomUUID().slice(0, 8)}`,
      name,
      code,
      sessionName,
      term,
      assessmentType,
      isPractice,
      classes,
      arms,
      durationMinutes,
      passMark,
      isActive,
      instructions,
      startAt,
      endAt,
      allowedAttempts,
      shuffleQuestions,
      shuffleOptions,
      showScoreAfterSubmit,
      showReviewAfterSubmit,
      enableBrowserGuardrails,
      ...(questionIds && questionIds.length > 0 ? { questionIds } : { questionIds: undefined }),
      createdByTeacherId: existing?.createdByTeacherId,
    },
  };
}

function getScheduleStatus(subject: Subject): 'open' | 'upcoming' | 'closed' {
  const now = Date.now();
  if (subject.startAt) {
    const startMs = new Date(subject.startAt).getTime();
    if (Number.isFinite(startMs) && now < startMs) return 'upcoming';
  }
  if (subject.endAt) {
    const endMs = new Date(subject.endAt).getTime();
    if (Number.isFinite(endMs) && now > endMs) return 'closed';
  }
  return 'open';
}

function teacherCanAccessSubject(teacher: TeacherAccount, subject: Subject): boolean {
  return (
    teacher.subjectIds.includes(subject.id) ||
    subject.createdByTeacherId === teacher.id
  );
}

async function startServer() {
  await initStore();

  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const store = getStore();
    if (process.env.NODE_ENV !== 'production') {
      const diag = await getSupabaseDiagnostics(store);
      res.json({
        status: 'ok',
        school: 'JAIMAN GOLDENLITE TECH LTD',
        storage: isSupabaseConfigured() ? 'supabase' : 'local',
        supabase: {
          configured: diag.configured,
          keyKind: diag.keyKind,
          readOk: diag.readOk,
          writeOk: diag.writeOk,
          remoteCounts: diag.remoteCounts,
          lastError: diag.lastError,
        },
      });
      return;
    }
    res.json({
      status: 'ok',
      school: 'JAIMAN GOLDENLITE TECH LTD',
      storage: isSupabaseConfigured() ? 'supabase' : 'local',
    });
  });

  // Public subjects + active academic session/term endpoint
  app.get('/api/subjects', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const store = getStore();
    const activeSubjects = store.subjects
      .filter((s) => s.isActive)
      .map((s) => ({
        ...s,
        questionCount: getEffectiveQuestionCount(store, s),
      }));
    res.json({
      subjects: activeSubjects,
      academicConfig: store.academicConfig,
    });
  });

  // Student Portal Sign-In (returns assigned tests, practice tests, active drafts, and allowed results)
  app.post('/api/students/login', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const examNumber = cleanText(req.body?.examNumber, 60).toUpperCase();
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';

    if (!examNumber || examNumber.length < 3) {
      res.status(400).json({ error: 'Enter a valid Admission / Exam Number.' });
      return;
    }

    const store = getStore();
    const student = store.students.find((s) => s.examNumber.toUpperCase() === examNumber);
    if (!student) {
      res.status(404).json({
        error: `No student record found for ${examNumber}. Please register first or verify your Admission Number.`,
      });
      return;
    }

    if (student.passcodeHash) {
      if (!passcode || !verifySecretHash(passcode, student.passcodeHash)) {
        res.status(401).json({ error: 'Incorrect Student Portal Passcode.' });
        return;
      }
    }

    const now = Date.now();
    const assignedSubjects = store.subjects
      .filter((s) => {
        if (!s.isActive) return false;
        if (!s.classes.includes(student.classLevel)) return false;
        const arms = s.arms && s.arms.length > 0 ? s.arms : CLASS_ARMS;
        return arms.includes(student.classArm);
      })
      .map((s) => {
        const questionCount = getEffectiveQuestionCount(store, s);
        const attemptsUsed = store.results.filter(
          (r) =>
            r.examNumber.toUpperCase() === student.examNumber.toUpperCase() &&
            r.subjectId === s.id
        ).length;
        const maxAttempts = s.isPractice ? 0 : (s.allowedAttempts ?? 1);
        const attemptsRemaining =
          maxAttempts === 0 ? null : Math.max(0, maxAttempts - attemptsUsed);
        return {
          ...s,
          questionCount,
          attemptsUsed,
          attemptsRemaining,
          scheduleStatus: getScheduleStatus(s),
        };
      });

    const activeDrafts = store.activeSessions
      .filter(
        (sess) =>
          sess.examNumber.toUpperCase() === student.examNumber.toUpperCase() &&
          sess.expiresAt > now
      )
      .map((sess) => ({
        sessionId: sess.sessionId,
        subjectId: sess.subjectId,
        startedAt: sess.startedAt,
        expiresAt: sess.expiresAt,
        lastSavedAt: sess.lastSavedAt,
        answeredCount: Object.keys(sess.savedAnswers || {}).filter(
          (k) => Boolean(sess.savedAnswers[k])
        ).length,
      }));

    const subjectMap = new Map(store.subjects.map((s) => [s.id, s]));
    const allowedResults = store.results
      .filter((r) => r.examNumber.toUpperCase() === student.examNumber.toUpperCase())
      .map((r) => redactResultForStudent(r, subjectMap.get(r.subjectId)));

    res.json({
      student: toSafeStudent(student),
      academicConfig: store.academicConfig,
      assignedSubjects,
      activeDrafts,
      allowedResults,
    });
  });

  // Start or Resume an exam session (persisted on disk for reliability, strips answers)
  app.post('/api/exams/start', async (req, res) => {
    const studentName = cleanText(req.body?.studentName, 120);
    const examNumber = cleanText(req.body?.examNumber, 60).toUpperCase();
    const classLevel = cleanText(req.body?.classLevel, 10) as ClassLevel;
    const rawArm = cleanText(req.body?.classArm, 4).toUpperCase();
    const classArm: ClassArm = isValidClassArm(rawArm) ? rawArm : 'A';
    const subjectId = cleanText(req.body?.subjectId, 80);
    const resumeSessionId = cleanText(req.body?.resumeSessionId, 100);

    if (!studentName || studentName.length < 2) {
      res.status(400).json({ error: 'Please enter your full name.' });
      return;
    }
    if (!examNumber || examNumber.length < 3) {
      res.status(400).json({ error: 'Please enter a valid Admission or Exam Number.' });
      return;
    }
    if (!VALID_CLASSES.includes(classLevel)) {
      res.status(400).json({ error: 'Please select a valid class (JSS1–SS3).' });
      return;
    }
    if (!isValidClassArm(rawArm)) {
      res.status(400).json({ error: 'Please select a valid class arm (A–J).' });
      return;
    }

    const store = getStore();

    // Check if resuming an active persisted exam session
    if (resumeSessionId) {
      const existingSess = store.activeSessions.find(
        (s) =>
          s.sessionId === resumeSessionId &&
          s.examNumber.toUpperCase() === examNumber &&
          s.expiresAt > Date.now()
      );
      if (existingSess) {
        const resumeSub = store.subjects.find((s) => s.id === existingSess.subjectId);
        if (resumeSub) {
          const qMap = new Map(store.questions.map((q) => [q.id, q]));
          const publicQuestions: PublicQuestion[] = existingSess.questionIds
            .map((id) => qMap.get(id))
            .filter((q): q is Question => Boolean(q))
            .map((q) =>
              toPublicQuestion(
                q,
                existingSess.optionMaps[q.id] || { A: 'A', B: 'B', C: 'C', D: 'D' }
              )
            );
          const payload: ActiveExamSession = {
            sessionId: existingSess.sessionId,
            studentName: existingSess.studentName,
            examNumber: existingSess.examNumber,
            classLevel: existingSess.classLevel,
            classArm: existingSess.classArm,
            subject: {
              ...resumeSub,
              questionCount: publicQuestions.length,
            },
            questions: publicQuestions,
            savedAnswers: existingSess.savedAnswers,
            savedFlagged: existingSess.savedFlagged,
            lastSavedAt: existingSess.lastSavedAt,
            startedAt: existingSess.startedAt,
            expiresAt: existingSess.expiresAt,
          };
          res.json(payload);
          return;
        }
      }
    }

    const subject = store.subjects.find((s) => s.id === subjectId);
    if (!subject || !subject.isActive) {
      res.status(404).json({ error: 'Selected examination subject is not currently active.' });
      return;
    }
    if (!subject.classes.includes(classLevel)) {
      res.status(400).json({ error: `${subject.name} is not assigned to ${classLevel}.` });
      return;
    }
    const allowedArms = subject.arms && subject.arms.length > 0 ? subject.arms : CLASS_ARMS;
    if (!allowedArms.includes(classArm)) {
      res.status(400).json({
        error: `${subject.name} is not assigned to ${classLevel} Arm ${classArm}.`,
      });
      return;
    }

    // Scheduling window enforcement
    const scheduleStatus = getScheduleStatus(subject);
    if (scheduleStatus === 'upcoming') {
      res.status(403).json({
        error: `${subject.name} is scheduled to open on ${new Date(subject.startAt!).toLocaleString()}.`,
      });
      return;
    }
    if (scheduleStatus === 'closed') {
      res.status(403).json({
        error: `The examination window for ${subject.name} closed on ${new Date(subject.endAt!).toLocaleString()}.`,
      });
      return;
    }

    // Allowed attempts enforcement (0 = unlimited, Practice tests are always unlimited)
    const maxAttempts = subject.isPractice ? 0 : (subject.allowedAttempts ?? 1);
    if (maxAttempts > 0) {
      const priorAttempts = store.results.filter(
        (r) => r.examNumber.toUpperCase() === examNumber && r.subjectId === subject.id
      ).length;
      if (priorAttempts >= maxAttempts) {
        res.status(403).json({
          error: `Maximum allowed attempts (${maxAttempts}) reached for ${subject.name} under ${examNumber}.`,
        });
        return;
      }
    }

    const baseQuestions = resolveCuratedQuestions(store, subject);
    if (baseQuestions.length === 0) {
      res.status(400).json({ error: 'No questions have been uploaded for this subject yet.' });
      return;
    }

    const orderedQuestions =
      subject.shuffleQuestions !== false ? cryptoShuffle(baseQuestions) : baseQuestions;

    const shouldShuffleOptions = subject.shuffleOptions !== false;
    const optionMaps: Record<string, Record<OptionKey, OptionKey>> = {};
    const publicQuestions: PublicQuestion[] = orderedQuestions.map((q) => {
      const map = buildOptionPermutation(q, shouldShuffleOptions);
      optionMaps[q.id] = map;
      return toPublicQuestion(q, map);
    });

    const startedAt = Date.now();
    const expiresAt = startedAt + subject.durationMinutes * 60 * 1000;
    const sessionId = crypto.randomUUID();

    const persistedSession: PersistedExamSession = {
      sessionId,
      studentName,
      examNumber,
      classLevel,
      classArm,
      subjectId: subject.id,
      questionIds: orderedQuestions.map((q) => q.id),
      optionMaps,
      savedAnswers: {},
      savedFlagged: {},
      lastSavedAt: new Date(startedAt).toISOString(),
      startedAt,
      expiresAt,
    };

    await saveStoreAndSync((current) => {
      const now = Date.now();
      current.activeSessions = current.activeSessions.filter(
        (s) =>
          s.expiresAt + 1000 * 60 * 30 > now &&
          !(s.examNumber.toUpperCase() === examNumber && s.subjectId === subject.id)
      );
      current.activeSessions.unshift(persistedSession);
    });

    const payload: ActiveExamSession = {
      sessionId,
      studentName,
      examNumber,
      classLevel,
      classArm,
      subject: {
        ...subject,
        questionCount: publicQuestions.length,
      },
      questions: publicQuestions,
      savedAnswers: {},
      savedFlagged: {},
      lastSavedAt: persistedSession.lastSavedAt,
      startedAt,
      expiresAt,
    };

    res.json(payload);
  });

  // Real-Time Autosave endpoint
  app.post('/api/exams/autosave', async (req, res) => {
    const sessionId = cleanText(req.body?.sessionId, 100);
    if (!sessionId) {
      res.status(400).json({ error: 'Session ID required.' });
      return;
    }

    const rawAnswers =
      req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
    const rawFlagged =
      req.body?.flagged && typeof req.body.flagged === 'object' ? req.body.flagged : {};

    const cleanAnswers: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawAnswers as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) {
        cleanAnswers[cleanText(k, 80)] = v.trim().slice(0, 200);
      }
    }

    const cleanFlagged: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(rawFlagged as Record<string, unknown>)) {
      if (Boolean(v)) {
        cleanFlagged[cleanText(k, 80)] = true;
      }
    }

    const store = getStore();
    const exists = store.activeSessions.some((s) => s.sessionId === sessionId);
    if (!exists) {
      res.status(404).json({ error: 'Active exam session not found.' });
      return;
    }

    const savedAt = new Date().toISOString();
    await saveStoreAndSync((current) => {
      current.activeSessions = current.activeSessions.map((s) =>
        s.sessionId === sessionId
          ? {
              ...s,
              savedAnswers: cleanAnswers,
              savedFlagged: cleanFlagged,
              lastSavedAt: savedAt,
            }
          : s
      );
    });

    res.json({ ok: true, savedAt });
  });

  // Lookup active resumable exam sessions for a candidate
  app.get('/api/exams/resume', (req, res) => {
    const examNumber = cleanText(req.query.examNumber, 60).toUpperCase();
    if (!examNumber) {
      res.status(400).json({ error: 'Exam Number is required.' });
      return;
    }
    const store = getStore();
    const now = Date.now();
    const drafts = store.activeSessions
      .filter((s) => s.examNumber.toUpperCase() === examNumber && s.expiresAt > now)
      .map((s) => {
        const sub = store.subjects.find((item) => item.id === s.subjectId);
        return {
          sessionId: s.sessionId,
          subjectId: s.subjectId,
          subjectName: sub?.name || 'Examination',
          subjectCode: sub?.code || '',
          startedAt: s.startedAt,
          expiresAt: s.expiresAt,
          lastSavedAt: s.lastSavedAt,
          answeredCount: Object.keys(s.savedAnswers || {}).filter((k) =>
            Boolean(s.savedAnswers[k])
          ).length,
        };
      });
    res.json({ drafts });
  });

  // Grade & submit exam (handles MCQ, True/False, Fill-in-the-Blank, Comprehension, shuffled options, and withheld visibility)
  app.post('/api/exams/submit', async (req, res) => {
    const sessionId = cleanText(req.body?.sessionId, 100);
    const answers = (req.body?.answers && typeof req.body.answers === 'object'
      ? req.body.answers
      : {}) as Record<string, unknown>;
    const autoSubmitted = Boolean(req.body?.autoSubmitted);
    const rawViolations = Number(req.body?.tabViolations);
    const tabViolations =
      Number.isFinite(rawViolations) && rawViolations > 0
        ? Math.min(50, Math.floor(rawViolations))
        : undefined;
    const terminationReason = cleanText(req.body?.terminationReason, 200) || undefined;

    const store = getStore();
    const session = store.activeSessions.find((s) => s.sessionId === sessionId);
    if (!session) {
      res.status(404).json({ error: 'Exam session not found or already submitted.' });
      return;
    }

    const subject = store.subjects.find((s) => s.id === session.subjectId);
    if (!subject) {
      res.status(404).json({ error: 'Subject record no longer exists.' });
      return;
    }

    const questionMap = new Map(store.questions.map((q) => [q.id, q]));
    const review: AnswerReviewItem[] = [];
    let score = 0;

    for (const qId of session.questionIds) {
      const q = questionMap.get(qId);
      if (!q) continue;
      const qType: QuestionType = q.type || 'mcq';
      const rawSelected = answers[q.id];

      if (qType === 'fill_blank') {
        const typed = typeof rawSelected === 'string' ? rawSelected.trim() : '';
        const acceptable =
          q.acceptableAnswers && q.acceptableAnswers.length > 0
            ? q.acceptableAnswers
            : q.options.A
              ? [q.options.A]
              : [];
        const normalizedTyped = typed.toLowerCase().replace(/\s+/g, ' ');
        const isCorrect =
          normalizedTyped.length > 0 &&
          acceptable.some((ans) => ans.trim().toLowerCase().replace(/\s+/g, ' ') === normalizedTyped);
        if (isCorrect) score += 1;

        review.push({
          questionId: q.id,
          type: 'fill_blank',
          prompt: q.prompt,
          options: q.options,
          selectedOption: null,
          selectedText: typed || 'No answer entered',
          correctOption: 'A',
          correctText: acceptable.join(' / '),
          isCorrect,
          explanation: q.explanation,
        });
      } else {
        const optionMap = session.optionMaps[q.id] || { A: 'A', B: 'B', C: 'C', D: 'D' };
        const displayedChoice =
          typeof rawSelected === 'string' && isValidOptionKey(rawSelected.toUpperCase())
            ? (rawSelected.toUpperCase() as OptionKey)
            : null;
        const canonicalSelected: OptionKey | null = displayedChoice
          ? optionMap[displayedChoice]
          : null;
        const isCorrect = canonicalSelected === q.correctOption;
        if (isCorrect) score += 1;

        review.push({
          questionId: q.id,
          type: qType,
          prompt: q.prompt,
          options: q.options,
          selectedOption: canonicalSelected,
          selectedText: canonicalSelected ? q.options[canonicalSelected] : undefined,
          correctOption: q.correctOption,
          correctText: q.options[q.correctOption],
          isCorrect,
          explanation: q.explanation,
        });
      }
    }

    const totalQuestions = review.length;
    const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
    const passed = percentage >= subject.passMark;
    const grade = computeWaecGrade(percentage);

    const now = Date.now();
    const maxSeconds = subject.durationMinutes * 60;
    const elapsedSeconds = Math.min(
      maxSeconds,
      Math.max(1, Math.round((now - session.startedAt) / 1000))
    );

    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const result: ExamResult = {
      id: `res-${crypto.randomUUID().slice(0, 8)}`,
      referenceCode: `GSS-2026-${randomDigits}`,
      studentName: session.studentName,
      examNumber: session.examNumber,
      classLevel: session.classLevel,
      classArm: session.classArm,
      subjectId: subject.id,
      subjectName: subject.name,
      subjectCode: subject.code,
      sessionName: subject.sessionName || store.academicConfig.currentSession,
      term: subject.term || store.academicConfig.currentTerm,
      assessmentType: subject.assessmentType || (subject.isPractice ? 'Practice' : 'Exam'),
      isPractice: Boolean(subject.isPractice),
      score,
      totalQuestions,
      percentage,
      passMark: subject.passMark,
      passed,
      grade,
      durationTakenSeconds: elapsedSeconds,
      submittedAt: new Date(now).toISOString(),
      autoSubmitted,
      scoreWithheld: subject.showScoreAfterSubmit === false,
      ...(tabViolations ? { tabViolations } : {}),
      ...(terminationReason ? { terminationReason } : {}),
      review,
    };

    await saveStoreAndSync((current) => {
      current.activeSessions = current.activeSessions.filter((s) => s.sessionId !== sessionId);
      current.results.unshift(result);
    });

    res.json({ result: redactResultForStudent(result, subject) });
  });

  // Public result checker configuration
  app.get('/api/results/config', (_req, res) => {
    const store = getStore();
    res.json({ requireScratchCard: store.settings.requireScratchCard });
  });

  // Lookup student results with Result Checker Scratch Card validation
  app.post('/api/results/check', async (req, res) => {
    const query = cleanText(req.body?.examNumber, 80).toUpperCase();
    const rawPin = cleanText(req.body?.cardPin, 40).toUpperCase();

    if (!query || query.length < 2) {
      res.status(400).json({ error: 'Enter your Admission / Exam Number to check results.' });
      return;
    }

    const store = getStore();
    const subjectMap = new Map(store.subjects.map((s) => [s.id, s]));
    const matches = store.results
      .filter(
        (r) =>
          r.examNumber.toUpperCase() === query ||
          r.referenceCode.toUpperCase() === query
      )
      .map((r) => redactResultForStudent(r, subjectMap.get(r.subjectId)));

    if (!store.settings.requireScratchCard) {
      res.json({ results: matches, cardInfo: null });
      return;
    }

    if (!rawPin) {
      res.status(400).json({ error: 'Enter your Result Checker Scratch Card PIN.' });
      return;
    }

    const normalizedPin = rawPin.replace(/[^A-Z0-9]/g, '');
    const card = store.scratchCards.find(
      (c) => c.pin.replace(/[^A-Z0-9]/g, '') === normalizedPin
    );

    if (!card) {
      res.status(404).json({
        error: 'Invalid Scratch Card PIN. Please check the digits on your card and try again.',
      });
      return;
    }
    if (card.isDisabled) {
      res.status(403).json({
        error: 'This Scratch Card has been disabled by the Examination Officer.',
      });
      return;
    }
    if (card.usedCount >= card.maxUses) {
      res.status(403).json({
        error: `This Scratch Card has reached its maximum usage limit (${card.maxUses} of ${card.maxUses} checks used).`,
      });
      return;
    }

    const candidateExamNo =
      matches.length > 0 ? matches[0].examNumber.toUpperCase() : query;

    if (card.boundExamNumber && card.boundExamNumber.toUpperCase() !== candidateExamNo) {
      res.status(403).json({
        error: 'This Scratch Card is already bound to a different Admission / Exam Number.',
      });
      return;
    }

    if (matches.length === 0) {
      res.status(404).json({
        error: `No examination records found for ${query}. Your Scratch Card usage was not deducted.`,
      });
      return;
    }

    let cardInfo: ResultCardInfo | null = null;
    await saveStoreAndSync((current) => {
      const target = current.scratchCards.find((c) => c.id === card.id);
      if (target) {
        target.boundExamNumber = target.boundExamNumber || candidateExamNo;
        target.usedCount += 1;
        target.lastUsedAt = new Date().toISOString();
        cardInfo = {
          serialNumber: target.serialNumber,
          usedCount: target.usedCount,
          maxUses: target.maxUses,
          remainingUses: Math.max(0, target.maxUses - target.usedCount),
        };
      }
    });

    res.json({ results: matches, cardInfo });
  });

  // Legacy GET lookup guarded by requireScratchCard setting
  app.get('/api/results/lookup', (req, res) => {
    const store = getStore();
    if (store.settings.requireScratchCard) {
      res.status(403).json({
        error: 'Result Checker Scratch Card PIN is required to look up results.',
      });
      return;
    }
    const query = cleanText(req.query.examNumber, 80).toUpperCase();
    if (!query || query.length < 2) {
      res.status(400).json({ error: 'Enter an Admission / Exam Number to search.' });
      return;
    }
    const subjectMap = new Map(store.subjects.map((s) => [s.id, s]));
    const matches = store.results
      .filter(
        (r) =>
          r.examNumber.toUpperCase() === query ||
          r.referenceCode.toUpperCase() === query
      )
      .map((r) => redactResultForStudent(r, subjectMap.get(r.subjectId)));
    res.json({ results: matches });
  });

  // Contact / Exam Support Desk submission
  app.post('/api/contact', async (req, res) => {
    const fullName = cleanText(req.body?.fullName, 120);
    const examNumber = cleanText(req.body?.examNumber, 60);
    const email = cleanText(req.body?.email, 140);
    const category = cleanText(req.body?.category, 80) || 'General Inquiry';
    const message = cleanText(req.body?.message, 1500);

    if (!fullName || !email || !message) {
      res.status(400).json({ error: 'Name, email address, and message are required.' });
      return;
    }

    const inquiry = {
      id: `inq-${crypto.randomUUID().slice(0, 8)}`,
      fullName,
      examNumber: examNumber || undefined,
      email,
      category,
      message,
      submittedAt: new Date().toISOString(),
    };

    await saveStoreAndSync((current) => {
      current.inquiries.unshift(inquiry);
    });

    res.json({ ok: true, inquiry });
  });

  // Student Registration (Auto-generates Admission / Exam Number & persists to database)
  app.post('/api/students/register', async (req, res) => {
    const fullName = cleanText(req.body?.fullName, 120);
    const classLevel = cleanText(req.body?.classLevel, 10) as ClassLevel;
    const rawArm = cleanText(req.body?.classArm, 4).toUpperCase();
    const rawGender = cleanText(req.body?.gender, 12);
    const guardianPhone = cleanText(req.body?.guardianPhone, 24);
    const rawPasscode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';

    if (!fullName || fullName.length < 2) {
      res.status(400).json({ error: 'Please enter the student full name (Surname First).' });
      return;
    }
    if (!VALID_CLASSES.includes(classLevel)) {
      res.status(400).json({ error: 'Please select a valid class (JSS1–SS3).' });
      return;
    }
    if (!isValidClassArm(rawArm)) {
      res.status(400).json({ error: 'Please select a valid class arm (A–J).' });
      return;
    }
    const gender = isValidGender(rawGender) ? rawGender : null;
    if (!gender) {
      res.status(400).json({ error: 'Please select student gender (Male or Female).' });
      return;
    }
    if (rawPasscode && rawPasscode.length < 4) {
      res.status(400).json({ error: 'Student passcode must be at least 4 characters if set.' });
      return;
    }

    let createdStudent: Student | null = null;
    await saveStoreAndSync((current) => {
      const examNumber = generateNextExamNumber(current);
      createdStudent = {
        id: `stu-${crypto.randomUUID().slice(0, 8)}`,
        fullName,
        examNumber,
        classLevel,
        classArm: rawArm,
        gender,
        guardianPhone: guardianPhone || undefined,
        ...(rawPasscode ? { passcodeHash: hashSecret(rawPasscode) } : {}),
        registeredAt: new Date().toISOString(),
        registeredBy: 'self',
      };
      current.students.unshift(createdStudent);
    });

    res.status(201).json({ student: createdStudent ? toSafeStudent(createdStudent) : null });
  });

  // Student Lookup / Verification by Admission / Exam Number (excludes private contact phone & passcodeHash)
  app.get('/api/students/verify', (req, res) => {
    const query = cleanText(req.query.examNumber, 60).toUpperCase();
    if (!query || query.length < 3) {
      res.status(400).json({ error: 'Enter a valid Admission or Exam Number.' });
      return;
    }

    const store = getStore();
    const match = store.students.find((s) => s.examNumber.toUpperCase() === query);
    if (!match) {
      res.json({ found: false });
      return;
    }

    res.json({
      found: true,
      student: {
        fullName: match.fullName,
        examNumber: match.examNumber,
        classLevel: match.classLevel,
        classArm: match.classArm,
        hasPasscode: Boolean(match.passcodeHash),
      },
    });
  });

  // ==================== TEACHER PORTAL AUTH & API ====================

  app.post('/api/teacher/login', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const username = cleanText(req.body?.username, 60).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }

    const store = getStore();
    const teacher = store.teachers.find((t) => t.username.toLowerCase() === username);
    if (!teacher || !verifySecretHash(password, teacher.passwordHash)) {
      res.status(401).json({ error: 'Invalid teacher username or password.' });
      return;
    }
    if (!teacher.isActive) {
      res.status(403).json({
        error: 'Your teacher account has been deactivated. Contact the Exam Officer.',
      });
      return;
    }

    const { token, expiresAt } = issueSignedStaffToken({
      role: 'teacher',
      teacherId: teacher.id,
    });
    res.json({ token, expiresAt, teacher: toPublicTeacher(teacher) });
  });

  app.post('/api/teacher/logout', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      revokeStaffToken(authHeader.slice('Bearer '.length).trim());
    }
    res.json({ ok: true });
  });

  app.get('/api/teacher/overview', requireTeacherAuth, (req: AuthenticatedTeacherRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const teacher = req.teacher!;
    const store = getStore();

    const subjects = store.subjects
      .filter((s) => teacherCanAccessSubject(teacher, s))
      .map((s) => ({
        ...s,
        questionCount: getEffectiveQuestionCount(store, s),
      }));

    const accessibleSubjectIds = new Set(subjects.map((s) => s.id));
    const questions = store.questions.filter((q) => accessibleSubjectIds.has(q.subjectId));
    const results = store.results.filter(
      (r) =>
        accessibleSubjectIds.has(r.subjectId) ||
        teacher.classes.includes(r.classLevel)
    );
    const students = store.students
      .filter((stu) => teacher.classes.includes(stu.classLevel))
      .map(toSafeStudent);

    res.json({
      teacher: toPublicTeacher(teacher),
      academicConfig: store.academicConfig,
      subjects,
      questions,
      results,
      students,
    });
  });

  app.post('/api/teacher/subjects', requireTeacherAuth, async (req: AuthenticatedTeacherRequest, res) => {
    const teacher = req.teacher!;
    const store = getStore();
    const built = buildSubjectFields(req.body || {}, store);
    if (built.error || !built.subject) {
      res.status(400).json({ error: built.error || 'Invalid test configuration.' });
      return;
    }

    const newSubject: Subject = {
      ...built.subject,
      createdByTeacherId: teacher.id,
    };

    await saveStoreAndSync((current) => {
      current.subjects.push(newSubject);
      const targetTeacher = current.teachers.find((t) => t.id === teacher.id);
      if (targetTeacher && !targetTeacher.subjectIds.includes(newSubject.id)) {
        targetTeacher.subjectIds.push(newSubject.id);
      }
    });

    res.status(201).json({ subject: { ...newSubject, questionCount: 0 } });
  });

  app.patch(
    '/api/teacher/subjects/:id',
    requireTeacherAuth,
    async (req: AuthenticatedTeacherRequest, res) => {
      const teacher = req.teacher!;
      const subjectId = cleanText(req.params.id, 80);
      const store = getStore();
      const existing = store.subjects.find((s) => s.id === subjectId);
      if (!existing) {
        res.status(404).json({ error: 'Subject or test not found.' });
        return;
      }
      if (!teacherCanAccessSubject(teacher, existing)) {
        res.status(403).json({ error: 'You are not assigned to manage this subject.' });
        return;
      }

      const built = buildSubjectFields(req.body || {}, store, existing);
      if (built.error || !built.subject) {
        res.status(400).json({ error: built.error || 'Invalid subject payload.' });
        return;
      }

      await saveStoreAndSync((current) => {
        current.subjects = current.subjects.map((s) =>
          s.id === subjectId ? built.subject! : s
        );
      });

      res.json({
        subject: {
          ...built.subject,
          questionCount: getEffectiveQuestionCount(getStore(), built.subject),
        },
      });
    }
  );

  app.delete(
    '/api/teacher/subjects/:id',
    requireTeacherAuth,
    async (req: AuthenticatedTeacherRequest, res) => {
      const teacher = req.teacher!;
      const subjectId = cleanText(req.params.id, 80);
      const store = getStore();
      const existing = store.subjects.find((s) => s.id === subjectId);
      if (!existing) {
        res.status(404).json({ error: 'Test not found.' });
        return;
      }
      if (existing.createdByTeacherId !== teacher.id) {
        res.status(403).json({
          error: 'Only tests created by your teacher account can be deleted here.',
        });
        return;
      }

      await saveStoreAndSync((current) => {
        current.subjects = current.subjects.filter((s) => s.id !== subjectId);
        current.questions = current.questions.filter((q) => q.subjectId !== subjectId);
      });

      res.json({ ok: true });
    }
  );

  app.post('/api/teacher/questions', requireTeacherAuth, async (req: AuthenticatedTeacherRequest, res) => {
    const teacher = req.teacher!;
    const subjectId = cleanText(req.body?.subjectId, 80);
    const store = getStore();
    const subject = store.subjects.find((s) => s.id === subjectId);
    if (!subject) {
      res.status(404).json({ error: 'Target subject not found.' });
      return;
    }
    if (!teacherCanAccessSubject(teacher, subject)) {
      res.status(403).json({ error: 'You are not assigned to add questions to this subject.' });
      return;
    }

    const built = buildQuestionInput(req.body || {}, subjectId, teacher.fullName);
    if (built.error || !built.question) {
      res.status(400).json({ error: built.error || 'Invalid question payload.' });
      return;
    }

    await saveStoreAndSync((current) => {
      current.questions.push(built.question!);
    });

    res.status(201).json({ question: built.question });
  });

  app.post(
    '/api/teacher/questions/bulk',
    requireTeacherAuth,
    async (req: AuthenticatedTeacherRequest, res) => {
      const teacher = req.teacher!;
      const subjectId = cleanText(req.body?.subjectId, 80);
      const items = Array.isArray(req.body?.questions) ? req.body.questions : [];
      const store = getStore();
      const subject = store.subjects.find((s) => s.id === subjectId);
      if (!subject) {
        res.status(404).json({ error: 'Target subject not found.' });
        return;
      }
      if (!teacherCanAccessSubject(teacher, subject)) {
        res.status(403).json({ error: 'You are not assigned to upload questions for this subject.' });
        return;
      }
      if (items.length === 0 || items.length > 200) {
        res.status(400).json({ error: 'Provide between 1 and 200 questions to import.' });
        return;
      }

      const validQuestions: Question[] = [];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const built = buildQuestionInput(item as Record<string, unknown>, subjectId, teacher.fullName);
        if (built.question) {
          validQuestions.push(built.question);
        }
      }

      if (validQuestions.length === 0) {
        res.status(400).json({ error: 'No valid questions found in upload batch.' });
        return;
      }

      await saveStoreAndSync((current) => {
        current.questions.push(...validQuestions);
      });

      res.status(201).json({ importedCount: validQuestions.length, questions: validQuestions });
    }
  );

  app.patch(
    '/api/teacher/questions/:id',
    requireTeacherAuth,
    async (req: AuthenticatedTeacherRequest, res) => {
      const teacher = req.teacher!;
      const questionId = cleanText(req.params.id, 80);
      const store = getStore();
      const existing = store.questions.find((q) => q.id === questionId);
      if (!existing) {
        res.status(404).json({ error: 'Question not found.' });
        return;
      }
      const subject = store.subjects.find((s) => s.id === existing.subjectId);
      if (!subject || !teacherCanAccessSubject(teacher, subject)) {
        res.status(403).json({ error: 'You are not assigned to edit this question.' });
        return;
      }

      const mergedBody: Record<string, unknown> = {
        ...existing,
        ...(req.body || {}),
        options: {
          ...existing.options,
          ...(req.body?.options || {}),
        },
      };
      const built = buildQuestionInput(mergedBody, existing.subjectId, existing.createdBy);
      if (built.error || !built.question) {
        res.status(400).json({ error: built.error || 'Invalid question update.' });
        return;
      }

      const updated: Question = { ...built.question, id: existing.id };
      await saveStoreAndSync((current) => {
        current.questions = current.questions.map((q) => (q.id === questionId ? updated : q));
      });

      res.json({ question: updated });
    }
  );

  app.delete(
    '/api/teacher/questions/:id',
    requireTeacherAuth,
    async (req: AuthenticatedTeacherRequest, res) => {
      const teacher = req.teacher!;
      const questionId = cleanText(req.params.id, 80);
      const store = getStore();
      const existing = store.questions.find((q) => q.id === questionId);
      if (!existing) {
        res.status(404).json({ error: 'Question not found.' });
        return;
      }
      const subject = store.subjects.find((s) => s.id === existing.subjectId);
      if (!subject || !teacherCanAccessSubject(teacher, subject)) {
        res.status(403).json({ error: 'You are not assigned to delete this question.' });
        return;
      }

      await saveStoreAndSync((current) => {
        current.questions = current.questions.filter((q) => q.id !== questionId);
      });

      res.json({ ok: true });
    }
  );

  // ==================== ADMIN AUTH & API ====================

  app.post('/api/admin/login', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!verifyAdminPassword(password)) {
      res.status(401).json({ error: 'Incorrect administrator password. Please try again.' });
      return;
    }

    const { token, expiresAt } = issueSignedStaffToken({ role: 'admin' });
    res.json({ token, expiresAt });
  });

  app.post('/api/admin/logout', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      revokeStaffToken(authHeader.slice('Bearer '.length).trim());
    }
    res.json({ ok: true });
  });

  app.get('/api/admin/overview', requireAdminAuth, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const store = getStore();
    const subjects = store.subjects.map((s) => ({
      ...s,
      questionCount: getEffectiveQuestionCount(store, s),
    }));
    res.json({
      academicConfig: store.academicConfig,
      teachers: store.teachers.map(toPublicTeacher),
      subjects,
      questions: store.questions,
      results: store.results,
      students: store.students.map(toSafeStudent),
      scratchCards: store.scratchCards,
      settings: store.settings,
      inquiries: store.inquiries,
    });
  });

  // Update Academic Session & Term configuration
  app.patch('/api/admin/academic', requireAdminAuth, async (req, res) => {
    const currentSession = cleanText(req.body?.currentSession, 30);
    const currentTerm = req.body?.currentTerm;
    const rawSessions = Array.isArray(req.body?.sessions) ? req.body.sessions : null;

    const store = getStore();
    let sessions = store.academicConfig.sessions;
    if (rawSessions) {
      const cleaned = rawSessions
        .map((s: unknown) => cleanText(s, 30))
        .filter(Boolean);
      if (cleaned.length > 0) {
        sessions = Array.from(new Set(cleaned));
      }
    }

    const nextSession = currentSession || store.academicConfig.currentSession;
    if (!sessions.includes(nextSession)) {
      sessions = [...sessions, nextSession];
    }

    const nextTerm = isValidTermName(currentTerm)
      ? currentTerm
      : store.academicConfig.currentTerm;

    const updated = await saveStoreAndSync((current) => {
      current.academicConfig = {
        currentSession: nextSession,
        currentTerm: nextTerm,
        sessions,
      };
    });

    res.json({ academicConfig: updated.academicConfig });
  });

  // Teacher Accounts Management
  app.post('/api/admin/teachers', requireAdminAuth, async (req, res) => {
    const fullName = cleanText(req.body?.fullName, 100);
    const username = cleanText(req.body?.username, 50).toLowerCase().replace(/\s+/g, '');
    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    const classes = sanitizeClasses(req.body?.classes);
    const subjectIds = Array.isArray(req.body?.subjectIds)
      ? req.body.subjectIds.map((id: unknown) => cleanText(id, 80)).filter(Boolean)
      : [];

    if (!fullName || !username) {
      res.status(400).json({ error: 'Teacher full name and username are required.' });
      return;
    }
    if (password.length < 4) {
      res.status(400).json({ error: 'Password must be at least 4 characters.' });
      return;
    }

    const store = getStore();
    if (store.teachers.some((t) => t.username.toLowerCase() === username)) {
      res.status(409).json({ error: `Username "${username}" is already in use.` });
      return;
    }

    const teacher: TeacherAccount = {
      id: `tch-${crypto.randomUUID().slice(0, 8)}`,
      fullName,
      username,
      passwordHash: hashSecret(password),
      subjectIds,
      classes: classes.length > 0 ? classes : [...VALID_CLASSES],
      isActive: req.body?.isActive !== false,
      createdAt: new Date().toISOString(),
    };

    await saveStoreAndSync((current) => {
      current.teachers.push(teacher);
    });

    res.status(201).json({ teacher: toPublicTeacher(teacher) });
  });

  app.patch('/api/admin/teachers/:id', requireAdminAuth, async (req, res) => {
    const teacherId = cleanText(req.params.id, 80);
    const store = getStore();
    if (!store.teachers.some((t) => t.id === teacherId)) {
      res.status(404).json({ error: 'Teacher account not found.' });
      return;
    }

    const newPassword = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    if (newPassword && newPassword.length < 4) {
      res.status(400).json({ error: 'New password must be at least 4 characters.' });
      return;
    }

    let updated: TeacherAccount | null = null;
    await saveStoreAndSync((current) => {
      current.teachers = current.teachers.map((t) => {
        if (t.id !== teacherId) return t;
        const nextClasses =
          req.body?.classes !== undefined ? sanitizeClasses(req.body.classes) : t.classes;
        const nextSubjects = Array.isArray(req.body?.subjectIds)
          ? req.body.subjectIds.map((id: unknown) => cleanText(id, 80)).filter(Boolean)
          : t.subjectIds;

        updated = {
          ...t,
          fullName:
            req.body?.fullName !== undefined
              ? cleanText(req.body.fullName, 100) || t.fullName
              : t.fullName,
          classes: nextClasses.length > 0 ? nextClasses : t.classes,
          subjectIds: nextSubjects,
          isActive: typeof req.body?.isActive === 'boolean' ? req.body.isActive : t.isActive,
          passwordHash: newPassword ? hashSecret(newPassword) : t.passwordHash,
        };
        return updated;
      });
    });

    res.json({ teacher: updated ? toPublicTeacher(updated) : null });
  });

  app.delete('/api/admin/teachers/:id', requireAdminAuth, async (req, res) => {
    const teacherId = cleanText(req.params.id, 80);
    const store = getStore();
    if (!store.teachers.some((t) => t.id === teacherId)) {
      res.status(404).json({ error: 'Teacher account not found.' });
      return;
    }

    await saveStoreAndSync((current) => {
      current.teachers = current.teachers.filter((t) => t.id !== teacherId);
    });
    res.json({ ok: true });
  });

  // Create Subject
  app.post('/api/admin/subjects', requireAdminAuth, async (req, res) => {
    const store = getStore();
    const built = buildSubjectFields(req.body || {}, store);
    if (built.error || !built.subject) {
      res.status(400).json({ error: built.error || 'Invalid subject payload.' });
      return;
    }

    await saveStoreAndSync((current) => {
      current.subjects.push(built.subject!);
    });

    res.status(201).json({ subject: { ...built.subject, questionCount: 0 } });
  });

  // Update Subject
  app.patch('/api/admin/subjects/:id', requireAdminAuth, async (req, res) => {
    const subjectId = cleanText(req.params.id, 80);
    const store = getStore();
    const existing = store.subjects.find((s) => s.id === subjectId);
    if (!existing) {
      res.status(404).json({ error: 'Subject not found.' });
      return;
    }

    const built = buildSubjectFields(req.body || {}, store, existing);
    if (built.error || !built.subject) {
      res.status(400).json({ error: built.error || 'Invalid subject update.' });
      return;
    }

    await saveStoreAndSync((current) => {
      current.subjects = current.subjects.map((s) =>
        s.id === subjectId ? built.subject! : s
      );
    });

    res.json({
      subject: {
        ...built.subject,
        questionCount: getEffectiveQuestionCount(getStore(), built.subject),
      },
    });
  });

  // Delete Subject and its questions
  app.delete('/api/admin/subjects/:id', requireAdminAuth, async (req, res) => {
    const subjectId = cleanText(req.params.id, 80);
    const store = getStore();
    if (!store.subjects.some((s) => s.id === subjectId)) {
      res.status(404).json({ error: 'Subject not found.' });
      return;
    }

    await saveStoreAndSync((current) => {
      current.subjects = current.subjects.filter((s) => s.id !== subjectId);
      current.questions = current.questions.filter((q) => q.subjectId !== subjectId);
    });

    res.json({ ok: true });
  });

  // Add single Question (supports all 4 types + topic + classLevel)
  app.post('/api/admin/questions', requireAdminAuth, async (req, res) => {
    const subjectId = cleanText(req.body?.subjectId, 80);
    const store = getStore();
    if (!store.subjects.some((s) => s.id === subjectId)) {
      res.status(404).json({ error: 'Target subject not found.' });
      return;
    }

    const built = buildQuestionInput(req.body || {}, subjectId, 'Exam Officer');
    if (built.error || !built.question) {
      res.status(400).json({ error: built.error || 'Invalid question.' });
      return;
    }

    await saveStoreAndSync((current) => {
      current.questions.push(built.question!);
    });

    res.status(201).json({ question: built.question });
  });

  // Bulk import Questions (all 4 types supported)
  app.post('/api/admin/questions/bulk', requireAdminAuth, async (req, res) => {
    const subjectId = cleanText(req.body?.subjectId, 80);
    const items = Array.isArray(req.body?.questions) ? req.body.questions : [];

    const store = getStore();
    if (!store.subjects.some((s) => s.id === subjectId)) {
      res.status(404).json({ error: 'Target subject not found.' });
      return;
    }
    if (items.length === 0 || items.length > 200) {
      res.status(400).json({ error: 'Provide between 1 and 200 valid questions to import.' });
      return;
    }

    const validQuestions: Question[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const built = buildQuestionInput(item as Record<string, unknown>, subjectId, 'Bulk Import');
      if (built.question) {
        validQuestions.push(built.question);
      }
    }

    if (validQuestions.length === 0) {
      res.status(400).json({ error: 'No valid questions found in the batch.' });
      return;
    }

    await saveStoreAndSync((current) => {
      current.questions.push(...validQuestions);
    });

    res.status(201).json({ importedCount: validQuestions.length, questions: validQuestions });
  });

  // Update Question
  app.patch('/api/admin/questions/:id', requireAdminAuth, async (req, res) => {
    const questionId = cleanText(req.params.id, 80);
    const store = getStore();
    const existing = store.questions.find((q) => q.id === questionId);
    if (!existing) {
      res.status(404).json({ error: 'Question not found.' });
      return;
    }

    const mergedBody: Record<string, unknown> = {
      ...existing,
      ...(req.body || {}),
      options: {
        ...existing.options,
        ...(req.body?.options || {}),
      },
    };
    const built = buildQuestionInput(mergedBody, existing.subjectId, existing.createdBy);
    if (built.error || !built.question) {
      res.status(400).json({ error: built.error || 'Invalid question update.' });
      return;
    }

    const updatedQuestion: Question = { ...built.question, id: existing.id };
    await saveStoreAndSync((current) => {
      current.questions = current.questions.map((q) =>
        q.id === questionId ? updatedQuestion : q
      );
    });

    res.json({ question: updatedQuestion });
  });

  // Delete Question
  app.delete('/api/admin/questions/:id', requireAdminAuth, async (req, res) => {
    const questionId = cleanText(req.params.id, 80);
    const store = getStore();
    if (!store.questions.some((q) => q.id === questionId)) {
      res.status(404).json({ error: 'Question not found.' });
      return;
    }

    await saveStoreAndSync((current) => {
      current.questions = current.questions.filter((q) => q.id !== questionId);
    });

    res.json({ ok: true });
  });

  // Delete Result record
  app.delete('/api/admin/results/:id', requireAdminAuth, async (req, res) => {
    const resultId = cleanText(req.params.id, 80);
    const store = getStore();
    if (!store.results.some((r) => r.id === resultId)) {
      res.status(404).json({ error: 'Result record not found.' });
      return;
    }

    await saveStoreAndSync((current) => {
      current.results = current.results.filter((r) => r.id !== resultId);
    });

    res.json({ ok: true });
  });

  // Admin Portal Settings
  app.patch('/api/admin/settings', requireAdminAuth, async (req, res) => {
    const requireScratchCard = req.body?.requireScratchCard;
    if (typeof requireScratchCard !== 'boolean') {
      res.status(400).json({ error: 'Invalid settings payload.' });
      return;
    }

    const updated = await saveStoreAndSync((current) => {
      current.settings = {
        ...current.settings,
        requireScratchCard,
      };
    });

    res.json({ settings: updated.settings });
  });

  // Admin: Database diagnostics & manual full resync
  app.get('/api/admin/database-status', requireAdminAuth, async (_req, res) => {
    const store = getStore();
    const diag = await getSupabaseDiagnostics(store);
    res.json(diag);
  });

  app.post('/api/admin/database-sync', requireAdminAuth, async (_req, res) => {
    const store = getStore();
    const result = await forceFullSyncToSupabase(store);
    const diag = await getSupabaseDiagnostics(store);
    res.status(result.ok ? 200 : 500).json({ ...result, diagnostics: diag });
  });

  // Generate Scratch Card batch
  app.post('/api/admin/scratch-cards/generate', requireAdminAuth, async (req, res) => {
    const count = Math.min(50, Math.max(1, Math.floor(Number(req.body?.count) || 5)));
    const maxUses = Math.min(20, Math.max(1, Math.floor(Number(req.body?.maxUses) || 5)));
    const batchLabel = cleanText(req.body?.batchLabel, 80) || '2026/2027 Termly Batch';

    const store = getStore();
    const newCards = buildScratchCardBatch(count, maxUses, batchLabel, store.scratchCards.length);

    await saveStoreAndSync((current) => {
      current.scratchCards.unshift(...newCards);
    });

    res.status(201).json({ cards: newCards });
  });

  // Enable / Disable Scratch Card
  app.patch('/api/admin/scratch-cards/:id', requireAdminAuth, async (req, res) => {
    const cardId = cleanText(req.params.id, 80);
    const store = getStore();
    if (!store.scratchCards.some((c) => c.id === cardId)) {
      res.status(404).json({ error: 'Scratch card not found.' });
      return;
    }

    let updatedCard = null;
    await saveStoreAndSync((current) => {
      current.scratchCards = current.scratchCards.map((c) => {
        if (c.id !== cardId) return c;
        updatedCard = {
          ...c,
          isDisabled:
            typeof req.body?.isDisabled === 'boolean' ? req.body.isDisabled : c.isDisabled,
        };
        return updatedCard;
      });
    });

    res.json({ card: updatedCard });
  });

  // Delete Scratch Card
  app.delete('/api/admin/scratch-cards/:id', requireAdminAuth, async (req, res) => {
    const cardId = cleanText(req.params.id, 80);
    const store = getStore();
    if (!store.scratchCards.some((c) => c.id === cardId)) {
      res.status(404).json({ error: 'Scratch card not found.' });
      return;
    }

    await saveStoreAndSync((current) => {
      current.scratchCards = current.scratchCards.filter((c) => c.id !== cardId);
    });

    res.json({ ok: true });
  });

  // Admin: Register Student (auto-generates Admission / Exam Number)
  app.post('/api/admin/students', requireAdminAuth, async (req, res) => {
    const fullName = cleanText(req.body?.fullName, 120);
    const classLevel = cleanText(req.body?.classLevel, 10) as ClassLevel;
    const rawArm = cleanText(req.body?.classArm, 4).toUpperCase();
    const rawGender = cleanText(req.body?.gender, 12);
    const guardianPhone = cleanText(req.body?.guardianPhone, 24);
    const rawPasscode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';

    if (!fullName || fullName.length < 2) {
      res.status(400).json({ error: 'Student full name is required.' });
      return;
    }
    if (!VALID_CLASSES.includes(classLevel)) {
      res.status(400).json({ error: 'Please select a valid class (JSS1–SS3).' });
      return;
    }
    if (!isValidClassArm(rawArm)) {
      res.status(400).json({ error: 'Please select a valid class arm (A–J).' });
      return;
    }
    const gender = isValidGender(rawGender) ? rawGender : null;
    if (!gender) {
      res.status(400).json({ error: 'Please select gender (Male or Female).' });
      return;
    }
    if (rawPasscode && rawPasscode.length < 4) {
      res.status(400).json({ error: 'Passcode must be at least 4 characters if provided.' });
      return;
    }

    let createdStudent: Student | null = null;
    await saveStoreAndSync((current) => {
      const examNumber = generateNextExamNumber(current);
      createdStudent = {
        id: `stu-${crypto.randomUUID().slice(0, 8)}`,
        fullName,
        examNumber,
        classLevel,
        classArm: rawArm,
        gender,
        guardianPhone: guardianPhone || undefined,
        ...(rawPasscode ? { passcodeHash: hashSecret(rawPasscode) } : {}),
        registeredAt: new Date().toISOString(),
        registeredBy: 'admin',
      };
      current.students.unshift(createdStudent);
    });

    res.status(201).json({ student: createdStudent ? toSafeStudent(createdStudent) : null });
  });

  // Admin: Update Student Details (preserves system-generated Exam Number)
  app.patch('/api/admin/students/:id', requireAdminAuth, async (req, res) => {
    const studentId = cleanText(req.params.id, 80);
    const store = getStore();
    if (!store.students.some((s) => s.id === studentId)) {
      res.status(404).json({ error: 'Student record not found.' });
      return;
    }

    const rawPasscode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';
    const clearPasscode = req.body?.clearPasscode === true;
    if (rawPasscode && rawPasscode.length < 4) {
      res.status(400).json({ error: 'Passcode must be at least 4 characters if provided.' });
      return;
    }

    let updatedStudent: Student | null = null;
    await saveStoreAndSync((current) => {
      current.students = current.students.map((s) => {
        if (s.id !== studentId) return s;
        const nextFullName =
          req.body?.fullName !== undefined ? cleanText(req.body.fullName, 120) || s.fullName : s.fullName;
        const nextClass =
          req.body?.classLevel && VALID_CLASSES.includes(req.body.classLevel)
            ? (req.body.classLevel as ClassLevel)
            : s.classLevel;
        const rawArm = cleanText(req.body?.classArm, 4).toUpperCase();
        const nextArm = isValidClassArm(rawArm) ? rawArm : s.classArm;
        const rawGender = cleanText(req.body?.gender, 12);
        const nextGender = isValidGender(rawGender) ? rawGender : s.gender;
        const nextPhone =
          req.body?.guardianPhone !== undefined
            ? cleanText(req.body.guardianPhone, 24) || undefined
            : s.guardianPhone;

        let nextPasscodeHash = s.passcodeHash;
        if (clearPasscode) nextPasscodeHash = undefined;
        else if (rawPasscode) nextPasscodeHash = hashSecret(rawPasscode);

        updatedStudent = {
          ...s,
          fullName: nextFullName,
          classLevel: nextClass,
          classArm: nextArm,
          gender: nextGender,
          guardianPhone: nextPhone,
          passcodeHash: nextPasscodeHash,
        };
        return updatedStudent;
      });
    });

    res.json({ student: updatedStudent ? toSafeStudent(updatedStudent) : null });
  });

  // Admin: Delete Student Record
  app.delete('/api/admin/students/:id', requireAdminAuth, async (req, res) => {
    const studentId = cleanText(req.params.id, 80);
    const store = getStore();
    if (!store.students.some((s) => s.id === studentId)) {
      res.status(404).json({ error: 'Student record not found.' });
      return;
    }

    await saveStoreAndSync((current) => {
      current.students = current.students.filter((s) => s.id !== studentId);
    });

    res.json({ ok: true });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(
      express.static(distDir, {
        index: false,
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`JAIMAN GOLDENLITE TECH LTD CBT server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
