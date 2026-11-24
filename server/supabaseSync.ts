import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AcademicConfig,
  AssessmentType,
  ClassArm,
  ClassLevel,
  ContactInquiry,
  ExamResult,
  OptionKey,
  PersistedExamSession,
  PortalSettings,
  Question,
  QuestionType,
  ScratchCard,
  Student,
  StudentGender,
  Subject,
  TeacherAccount,
  TermName,
} from '../src/types.ts';
import type { CbtStoreData } from './store.ts';

let cachedClient: SupabaseClient | null = null;
let cachedCredKey = '';
let syncQueue: Promise<void> = Promise.resolve();
let schemaMissingLogged = false;
let connectionLogged = false;
let lastSyncError: string | null = null;
let lastSyncAt: string | null = null;

function detectSupabaseKeyKind(key: string): 'service_role' | 'anon' | 'sb_secret' | 'sb_publishable' | 'unknown' {
  if (!key) return 'unknown';
  if (key.startsWith('sb_secret_')) return 'sb_secret';
  if (key.startsWith('sb_publishable_')) return 'sb_publishable';
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: string };
      if (payload.role === 'service_role') return 'service_role';
      if (payload.role === 'anon') return 'anon';
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}

function getCredentials(): { url: string; key: string } {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    ''
  ).trim();
  return { url, key };
}

export function isSupabaseConfigured(): boolean {
  const { url, key } = getCredentials();
  return Boolean(url && key && !url.includes('YOUR_PROJECT_ID') && !key.startsWith('MY_'));
}

function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  const { url, key } = getCredentials();
  const credKey = `${url}::${key}`;
  if (!cachedClient || cachedCredKey !== credKey) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        console.warn('[Supabase] Invalid SUPABASE_URL protocol; using local cache.');
        return null;
      }
      cachedClient = createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      cachedCredKey = credKey;
    } catch (err) {
      console.warn(
        '[Supabase] Unable to initialize client (check SUPABASE_URL); using local cache:',
        err instanceof Error ? err.message : String(err)
      );
      return null;
    }
  }
  return cachedClient;
}

function isMissingSchemaError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  const msg = (err.message || '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('could not find the table');
}

// ---------- DB Row Mappers ----------

function toDbAcademicConfig(c: AcademicConfig) {
  return {
    id: 1,
    current_session: c.currentSession,
    current_term: c.currentTerm,
    sessions: c.sessions,
    updated_at: new Date().toISOString(),
  };
}

function fromDbAcademicConfig(row: Record<string, unknown> | undefined): AcademicConfig | null {
  if (!row) return null;
  return {
    currentSession: String(row.current_session || '2026/2027'),
    currentTerm: (row.current_term as TermName) || 'First Term',
    sessions: Array.isArray(row.sessions) ? (row.sessions as string[]) : ['2025/2026', '2026/2027', '2027/2028'],
  };
}

function toDbPortalSettings(s: PortalSettings) {
  return {
    id: 1,
    require_scratch_card: Boolean(s.requireScratchCard),
    updated_at: new Date().toISOString(),
  };
}

function fromDbPortalSettings(row: Record<string, unknown> | undefined): PortalSettings | null {
  if (!row) return null;
  return {
    requireScratchCard: typeof row.require_scratch_card === 'boolean' ? row.require_scratch_card : true,
  };
}

function toDbTeacher(t: TeacherAccount) {
  return {
    id: t.id,
    full_name: t.fullName,
    username: t.username,
    password_hash: t.passwordHash,
    subject_ids: t.subjectIds || [],
    classes: t.classes || [],
    is_active: t.isActive,
    created_at: t.createdAt,
  };
}

function fromDbTeacher(row: Record<string, unknown>): TeacherAccount {
  return {
    id: String(row.id),
    fullName: String(row.full_name || ''),
    username: String(row.username || ''),
    passwordHash: String(row.password_hash || ''),
    subjectIds: Array.isArray(row.subject_ids) ? (row.subject_ids as string[]) : [],
    classes: Array.isArray(row.classes) ? (row.classes as ClassLevel[]) : [],
    isActive: typeof row.is_active === 'boolean' ? row.is_active : true,
    createdAt: String(row.created_at || new Date().toISOString()),
  };
}

function toDbSubject(s: Subject) {
  return {
    id: s.id,
    name: s.name,
    code: s.code,
    session_name: s.sessionName || '2026/2027',
    term: s.term || 'First Term',
    assessment_type: s.assessmentType || (s.isPractice ? 'Practice' : 'Exam'),
    is_practice: Boolean(s.isPractice),
    classes: s.classes || [],
    arms: s.arms || ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
    duration_minutes: s.durationMinutes,
    pass_mark: s.passMark,
    is_active: s.isActive,
    instructions: s.instructions || '',
    start_at: s.startAt || null,
    end_at: s.endAt || null,
    allowed_attempts: typeof s.allowedAttempts === 'number' ? s.allowedAttempts : s.isPractice ? 0 : 1,
    shuffle_questions: typeof s.shuffleQuestions === 'boolean' ? s.shuffleQuestions : true,
    shuffle_options: typeof s.shuffleOptions === 'boolean' ? s.shuffleOptions : true,
    show_score_after_submit: typeof s.showScoreAfterSubmit === 'boolean' ? s.showScoreAfterSubmit : true,
    show_review_after_submit: typeof s.showReviewAfterSubmit === 'boolean' ? s.showReviewAfterSubmit : true,
    enable_browser_guardrails:
      typeof s.enableBrowserGuardrails === 'boolean' ? s.enableBrowserGuardrails : !s.isPractice,
    question_ids: Array.isArray(s.questionIds) && s.questionIds.length > 0 ? s.questionIds : null,
    created_by_teacher_id: s.createdByTeacherId || null,
  };
}

function fromDbSubject(row: Record<string, unknown>): Subject {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    code: String(row.code || ''),
    sessionName: row.session_name ? String(row.session_name) : '2026/2027',
    term: String(row.term || 'First Term'),
    assessmentType: (row.assessment_type as AssessmentType) || 'Exam',
    isPractice: Boolean(row.is_practice),
    classes: Array.isArray(row.classes) ? (row.classes as ClassLevel[]) : [],
    arms: Array.isArray(row.arms) ? (row.arms as ClassArm[]) : ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
    durationMinutes: Number(row.duration_minutes) || 20,
    passMark: Number(row.pass_mark) || 50,
    isActive: typeof row.is_active === 'boolean' ? row.is_active : true,
    instructions: String(row.instructions || ''),
    ...(row.start_at ? { startAt: String(row.start_at) } : {}),
    ...(row.end_at ? { endAt: String(row.end_at) } : {}),
    allowedAttempts: typeof row.allowed_attempts === 'number' ? row.allowed_attempts : 1,
    shuffleQuestions: typeof row.shuffle_questions === 'boolean' ? row.shuffle_questions : true,
    shuffleOptions: typeof row.shuffle_options === 'boolean' ? row.shuffle_options : true,
    showScoreAfterSubmit: typeof row.show_score_after_submit === 'boolean' ? row.show_score_after_submit : true,
    showReviewAfterSubmit: typeof row.show_review_after_submit === 'boolean' ? row.show_review_after_submit : true,
    enableBrowserGuardrails:
      typeof row.enable_browser_guardrails === 'boolean' ? row.enable_browser_guardrails : true,
    ...(Array.isArray(row.question_ids) && row.question_ids.length > 0
      ? { questionIds: row.question_ids as string[] }
      : {}),
    ...(row.created_by_teacher_id ? { createdByTeacherId: String(row.created_by_teacher_id) } : {}),
  };
}

function toDbQuestion(q: Question) {
  return {
    id: q.id,
    subject_id: q.subjectId,
    type: q.type || 'mcq',
    class_level: q.classLevel || 'ALL',
    topic: q.topic || 'General',
    passage_title: q.passageTitle || null,
    passage: q.passage || null,
    prompt: q.prompt,
    options: q.options || { A: '', B: '', C: '', D: '' },
    correct_option: q.correctOption || 'A',
    acceptable_answers: Array.isArray(q.acceptableAnswers) ? q.acceptableAnswers : [],
    explanation: q.explanation || null,
    created_by: q.createdBy || null,
  };
}

function fromDbQuestion(row: Record<string, unknown>): Question {
  const opts = (row.options as Record<OptionKey, string>) || { A: '', B: '', C: '', D: '' };
  return {
    id: String(row.id),
    subjectId: String(row.subject_id),
    type: (row.type as QuestionType) || 'mcq',
    classLevel: (row.class_level as ClassLevel | 'ALL') || 'ALL',
    topic: row.topic ? String(row.topic) : 'General',
    ...(row.passage_title ? { passageTitle: String(row.passage_title) } : {}),
    ...(row.passage ? { passage: String(row.passage) } : {}),
    prompt: String(row.prompt || ''),
    options: {
      A: String(opts.A || ''),
      B: String(opts.B || ''),
      C: String(opts.C || ''),
      D: String(opts.D || ''),
    },
    correctOption: (row.correct_option as OptionKey) || 'A',
    ...(Array.isArray(row.acceptable_answers) && row.acceptable_answers.length > 0
      ? { acceptableAnswers: row.acceptable_answers as string[] }
      : {}),
    ...(row.explanation ? { explanation: String(row.explanation) } : {}),
    ...(row.created_by ? { createdBy: String(row.created_by) } : {}),
  };
}

function toDbStudent(s: Student) {
  return {
    id: s.id,
    full_name: s.fullName,
    exam_number: s.examNumber,
    class_level: s.classLevel,
    class_arm: s.classArm,
    gender: s.gender,
    guardian_phone: s.guardianPhone || null,
    passcode_hash: s.passcodeHash || null,
    registered_by: s.registeredBy || 'admin',
    registered_at: s.registeredAt || new Date().toISOString(),
  };
}

function fromDbStudent(row: Record<string, unknown>): Student {
  return {
    id: String(row.id),
    fullName: String(row.full_name || ''),
    examNumber: String(row.exam_number || ''),
    classLevel: (row.class_level as ClassLevel) || 'JSS1',
    classArm: (row.class_arm as ClassArm) || 'A',
    gender: (row.gender as StudentGender) || 'Male',
    ...(row.guardian_phone ? { guardianPhone: String(row.guardian_phone) } : {}),
    ...(row.passcode_hash ? { passcodeHash: String(row.passcode_hash) } : {}),
    registeredAt: String(row.registered_at || new Date().toISOString()),
    registeredBy: row.registered_by === 'self' ? 'self' : 'admin',
  };
}

function toDbActiveSession(sess: PersistedExamSession) {
  return {
    session_id: sess.sessionId,
    student_name: sess.studentName,
    exam_number: sess.examNumber,
    class_level: sess.classLevel,
    class_arm: sess.classArm,
    subject_id: sess.subjectId,
    question_ids: sess.questionIds || [],
    option_maps: sess.optionMaps || {},
    saved_answers: sess.savedAnswers || {},
    saved_flagged: sess.savedFlagged || {},
    last_saved_at: sess.lastSavedAt || new Date().toISOString(),
    started_at: new Date(sess.startedAt).toISOString(),
    expires_at: new Date(sess.expiresAt).toISOString(),
  };
}

function fromDbActiveSession(row: Record<string, unknown>): PersistedExamSession {
  return {
    sessionId: String(row.session_id),
    studentName: String(row.student_name || ''),
    examNumber: String(row.exam_number || ''),
    classLevel: (row.class_level as ClassLevel) || 'JSS1',
    classArm: (row.class_arm as ClassArm) || 'A',
    subjectId: String(row.subject_id),
    questionIds: Array.isArray(row.question_ids) ? (row.question_ids as string[]) : [],
    optionMaps:
      (row.option_maps as Record<string, Record<OptionKey, OptionKey>>) || {},
    savedAnswers: (row.saved_answers as Record<string, string>) || {},
    savedFlagged: (row.saved_flagged as Record<string, boolean>) || {},
    lastSavedAt: String(row.last_saved_at || new Date().toISOString()),
    startedAt: new Date(String(row.started_at || Date.now())).getTime(),
    expiresAt: new Date(String(row.expires_at || Date.now())).getTime(),
  };
}

function toDbExamResult(r: ExamResult) {
  return {
    id: r.id,
    reference_code: r.referenceCode,
    student_name: r.studentName,
    exam_number: r.examNumber,
    class_level: r.classLevel,
    class_arm: r.classArm,
    subject_id: r.subjectId,
    subject_name: r.subjectName,
    subject_code: r.subjectCode,
    session_name: r.sessionName || '2026/2027',
    term: r.term || 'First Term',
    assessment_type: r.assessmentType || (r.isPractice ? 'Practice' : 'Exam'),
    is_practice: Boolean(r.isPractice),
    score: r.score,
    total_questions: r.totalQuestions,
    percentage: r.percentage,
    pass_mark: r.passMark,
    passed: r.passed,
    grade: r.grade,
    duration_taken_seconds: r.durationTakenSeconds,
    submitted_at: r.submittedAt,
    auto_submitted: r.autoSubmitted,
    score_withheld: Boolean(r.scoreWithheld),
    tab_violations: r.tabViolations || 0,
    termination_reason: r.terminationReason || null,
    review: r.review ?? null,
  };
}

function fromDbExamResult(row: Record<string, unknown>): ExamResult {
  return {
    id: String(row.id),
    referenceCode: String(row.reference_code || ''),
    studentName: String(row.student_name || ''),
    examNumber: String(row.exam_number || ''),
    classLevel: (row.class_level as ClassLevel) || 'JSS1',
    classArm: (row.class_arm as ClassArm) || 'A',
    subjectId: String(row.subject_id),
    subjectName: String(row.subject_name || ''),
    subjectCode: String(row.subject_code || ''),
    sessionName: row.session_name ? String(row.session_name) : '2026/2027',
    term: row.term ? String(row.term) : 'First Term',
    assessmentType: (row.assessment_type as AssessmentType) || 'Exam',
    isPractice: Boolean(row.is_practice),
    score: Number(row.score) || 0,
    totalQuestions: Number(row.total_questions) || 0,
    percentage: Number(row.percentage) || 0,
    passMark: Number(row.pass_mark) || 50,
    passed: Boolean(row.passed),
    grade: String(row.grade || 'F9 (Fail)'),
    durationTakenSeconds: Number(row.duration_taken_seconds) || 0,
    submittedAt: String(row.submitted_at || new Date().toISOString()),
    autoSubmitted: Boolean(row.auto_submitted),
    ...(row.score_withheld ? { scoreWithheld: true } : {}),
    ...(typeof row.tab_violations === 'number' && row.tab_violations > 0
      ? { tabViolations: row.tab_violations }
      : {}),
    ...(row.termination_reason ? { terminationReason: String(row.termination_reason) } : {}),
    ...(Array.isArray(row.review) ? { review: row.review as ExamResult['review'] } : {}),
  };
}

function toDbScratchCard(c: ScratchCard) {
  return {
    id: c.id,
    serial_number: c.serialNumber,
    pin: c.pin,
    batch_label: c.batchLabel,
    max_uses: c.maxUses,
    used_count: c.usedCount,
    bound_exam_number: c.boundExamNumber || null,
    is_disabled: c.isDisabled,
    created_at: c.createdAt,
    last_used_at: c.lastUsedAt || null,
  };
}

function fromDbScratchCard(row: Record<string, unknown>): ScratchCard {
  return {
    id: String(row.id),
    serialNumber: String(row.serial_number || ''),
    pin: String(row.pin || ''),
    batchLabel: String(row.batch_label || '2026/2027 Termly Batch'),
    maxUses: Number(row.max_uses) || 5,
    usedCount: Number(row.used_count) || 0,
    ...(row.bound_exam_number ? { boundExamNumber: String(row.bound_exam_number) } : {}),
    isDisabled: Boolean(row.is_disabled),
    createdAt: String(row.created_at || new Date().toISOString()),
    ...(row.last_used_at ? { lastUsedAt: String(row.last_used_at) } : {}),
  };
}

function toDbContactInquiry(i: ContactInquiry) {
  return {
    id: i.id,
    full_name: i.fullName,
    exam_number: i.examNumber || null,
    email: i.email,
    category: i.category,
    message: i.message,
    submitted_at: i.submittedAt,
  };
}

function fromDbContactInquiry(row: Record<string, unknown>): ContactInquiry {
  return {
    id: String(row.id),
    fullName: String(row.full_name || ''),
    ...(row.exam_number ? { examNumber: String(row.exam_number) } : {}),
    email: String(row.email || ''),
    category: String(row.category || 'General'),
    message: String(row.message || ''),
    submittedAt: String(row.submitted_at || new Date().toISOString()),
  };
}

// ---------- Paginated Fetch & Chunked Writes ----------

async function fetchAllRows(
  client: SupabaseClient,
  table: string,
  orderBy?: string,
  ascending = true
): Promise<{ rows: Record<string, unknown>[]; error: { code?: string; message?: string } | null }> {
  const pageSize = 1000;
  let from = 0;
  const collected: Record<string, unknown>[] = [];

  while (true) {
    let query = client.from(table).select('*').range(from, from + pageSize - 1);
    if (orderBy) {
      query = query.order(orderBy, { ascending });
    }
    const { data, error } = await query;
    if (error) {
      return { rows: [], error };
    }
    const batch = (data as Record<string, unknown>[]) || [];
    collected.push(...batch);
    if (batch.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return { rows: collected, error: null };
}

async function upsertChunked(
  client: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict = 'id'
): Promise<void> {
  if (rows.length === 0) return;
  const chunkSize = 200;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await client.from(table).upsert(chunk, { onConflict });
    if (error) {
      throw new Error(`Supabase upsert failed on ${table}: ${error.message}`);
    }
  }
}

async function deleteByIdsChunked(
  client: SupabaseClient,
  table: string,
  column: string,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { error } = await client.from(table).delete().in(column, chunk);
    if (error) {
      throw new Error(`Supabase delete failed on ${table}: ${error.message}`);
    }
  }
}

function computeCollectionDiff<T>(
  prevItems: T[] | undefined,
  nextItems: T[],
  getKey: (item: T) => string,
  serialize: (item: T) => Record<string, unknown>
): { toUpsert: Record<string, unknown>[]; toDeleteIds: string[] } {
  const prevMap = new Map<string, string>();
  if (prevItems) {
    for (const item of prevItems) {
      prevMap.set(getKey(item), JSON.stringify(serialize(item)));
    }
  }

  const nextKeys = new Set<string>();
  const toUpsert: Record<string, unknown>[] = [];

  for (const item of nextItems) {
    const k = getKey(item);
    nextKeys.add(k);
    const row = serialize(item);
    const serialized = JSON.stringify(row);
    if (!prevItems || prevMap.get(k) !== serialized) {
      toUpsert.push(row);
    }
  }

  const toDeleteIds: string[] = [];
  if (prevItems) {
    for (const k of prevMap.keys()) {
      if (!nextKeys.has(k)) {
        toDeleteIds.push(k);
      }
    }
  }

  return { toUpsert, toDeleteIds };
}

function computeNextAdmissionSeqFromRows(students: Student[], results: ExamResult[]): number {
  let maxSeq = 408;
  const parseSeq = (examNo: string) => {
    const match = /^GSS\/\d{4}\/(\d{1,6})$/i.exec(examNo.trim());
    if (!match) return 0;
    const n = Number(match[1]);
    return Number.isFinite(n) && n < 9000 ? n : 0;
  };
  for (const s of students) maxSeq = Math.max(maxSeq, parseSeq(s.examNumber));
  for (const r of results) maxSeq = Math.max(maxSeq, parseSeq(r.examNumber));
  return maxSeq + 1;
}

// ---------- Public Integration API ----------

export async function syncDeltaToSupabase(
  prev: CbtStoreData | null,
  next: CbtStoreData
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  // Compute diffs for every table
  const teachersDiff = computeCollectionDiff(prev?.teachers, next.teachers, (t) => t.id, toDbTeacher);
  const subjectsDiff = computeCollectionDiff(prev?.subjects, next.subjects, (s) => s.id, toDbSubject);
  const questionsDiff = computeCollectionDiff(prev?.questions, next.questions, (q) => q.id, toDbQuestion);
  const studentsDiff = computeCollectionDiff(prev?.students, next.students, (s) => s.id, toDbStudent);
  const sessionsDiff = computeCollectionDiff(
    prev?.activeSessions,
    next.activeSessions,
    (s) => s.sessionId,
    toDbActiveSession
  );
  const resultsDiff = computeCollectionDiff(prev?.results, next.results, (r) => r.id, toDbExamResult);
  const cardsDiff = computeCollectionDiff(prev?.scratchCards, next.scratchCards, (c) => c.id, toDbScratchCard);
  const inquiriesDiff = computeCollectionDiff(prev?.inquiries, next.inquiries, (i) => i.id, toDbContactInquiry);

  // 1. Delete children before parent rows (FK safety)
  await deleteByIdsChunked(client, 'active_exam_sessions', 'session_id', sessionsDiff.toDeleteIds);
  await deleteByIdsChunked(client, 'questions', 'id', questionsDiff.toDeleteIds);
  await deleteByIdsChunked(client, 'exam_results', 'id', resultsDiff.toDeleteIds);
  await deleteByIdsChunked(client, 'students', 'id', studentsDiff.toDeleteIds);
  await deleteByIdsChunked(client, 'scratch_cards', 'id', cardsDiff.toDeleteIds);
  await deleteByIdsChunked(client, 'contact_inquiries', 'id', inquiriesDiff.toDeleteIds);
  await deleteByIdsChunked(client, 'subjects', 'id', subjectsDiff.toDeleteIds);
  await deleteByIdsChunked(client, 'teachers', 'id', teachersDiff.toDeleteIds);

  // 2. Upsert singletons if changed or initial seed
  if (!prev || JSON.stringify(prev.academicConfig) !== JSON.stringify(next.academicConfig)) {
    await upsertChunked(client, 'academic_config', [toDbAcademicConfig(next.academicConfig)], 'id');
  }
  if (!prev || JSON.stringify(prev.settings) !== JSON.stringify(next.settings)) {
    await upsertChunked(client, 'portal_settings', [toDbPortalSettings(next.settings)], 'id');
  }

  // 3. Upsert parents before children (FK safety)
  await upsertChunked(client, 'teachers', teachersDiff.toUpsert, 'id');
  await upsertChunked(client, 'subjects', subjectsDiff.toUpsert, 'id');
  await Promise.all([
    upsertChunked(client, 'questions', questionsDiff.toUpsert, 'id'),
    upsertChunked(client, 'students', studentsDiff.toUpsert, 'id'),
    upsertChunked(client, 'scratch_cards', cardsDiff.toUpsert, 'id'),
    upsertChunked(client, 'contact_inquiries', inquiriesDiff.toUpsert, 'id'),
    upsertChunked(client, 'exam_results', resultsDiff.toUpsert, 'id'),
    upsertChunked(client, 'active_exam_sessions', sessionsDiff.toUpsert, 'session_id'),
  ]);
}

export function queueStoreSyncToSupabase(
  prevSnapshot: CbtStoreData | null,
  nextSnapshot: CbtStoreData
): void {
  if (!isSupabaseConfigured()) return;

  syncQueue = syncQueue
    .then(async () => {
      await syncDeltaToSupabase(prevSnapshot, nextSnapshot);
      lastSyncError = null;
      lastSyncAt = new Date().toISOString();
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      lastSyncError = msg;
      if (msg.toLowerCase().includes('does not exist') || msg.toLowerCase().includes('could not find the table')) {
        if (!schemaMissingLogged) {
          schemaMissingLogged = true;
          console.warn('[Supabase] Schema tables not found yet. Run supabase/schema.sql in Supabase SQL Editor.');
        }
        return;
      }
      console.error('[Supabase Sync Error]:', msg);
    });
}

export async function hydrateStoreFromSupabase(
  fallbackLocal: CbtStoreData,
  defaultSeed: CbtStoreData = fallbackLocal
): Promise<CbtStoreData | null> {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  const { key } = getCredentials();
  const keyKind = detectSupabaseKeyKind(key);
  if (keyKind === 'anon' || keyKind === 'sb_publishable') {
    lastSyncError =
      'The configured SUPABASE_SERVICE_ROLE_KEY appears to be a public/anon key. Replace it with your Supabase service_role (secret) key in AI Studio Secrets.';
    console.error('[Supabase Auth Warning]:', lastSyncError);
  }

  try {
    const fetchAllPromise = Promise.all([
      fetchAllRows(client, 'academic_config'),
      fetchAllRows(client, 'portal_settings'),
      fetchAllRows(client, 'teachers'),
      fetchAllRows(client, 'subjects'),
      fetchAllRows(client, 'questions'),
      fetchAllRows(client, 'students'),
      fetchAllRows(client, 'active_exam_sessions'),
      fetchAllRows(client, 'exam_results', 'submitted_at', false),
      fetchAllRows(client, 'scratch_cards'),
      fetchAllRows(client, 'contact_inquiries', 'submitted_at', false),
    ]);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Supabase startup hydration timed out after 6000ms')), 6000);
    });

    const [
      configRes,
      settingsRes,
      teachersRes,
      subjectsRes,
      questionsRes,
      studentsRes,
      sessionsRes,
      resultsRes,
      cardsRes,
      inquiriesRes,
    ] = await Promise.race([fetchAllPromise, timeoutPromise]);

    const firstError =
      configRes.error ||
      settingsRes.error ||
      teachersRes.error ||
      subjectsRes.error ||
      questionsRes.error ||
      studentsRes.error ||
      sessionsRes.error ||
      resultsRes.error ||
      cardsRes.error ||
      inquiriesRes.error;

    if (firstError) {
      lastSyncError = firstError.message || 'Unknown Supabase read error';
      if (isMissingSchemaError(firstError)) {
        if (!schemaMissingLogged) {
          schemaMissingLogged = true;
          console.warn(
            '[Supabase] Connected to Supabase project, waiting for supabase/schema.sql to be executed in SQL Editor. Using local cache in the meantime.'
          );
        }
        return null;
      }
      console.error('[Supabase Hydration Error]:', firstError.message);
      return null;
    }

    const isDatabaseEmpty =
      subjectsRes.rows.length === 0 &&
      teachersRes.rows.length === 0 &&
      studentsRes.rows.length === 0 &&
      questionsRes.rows.length === 0;

    if (isDatabaseEmpty) {
      console.log('[Supabase] Empty CBT tables detected. Auto-seeding Supabase from initial store...');
      await syncDeltaToSupabase(null, defaultSeed);
      lastSyncError = null;
      lastSyncAt = new Date().toISOString();
      console.log('[Supabase] Connected & auto-seeded successfully.');
      connectionLogged = true;
      return defaultSeed;
    }

    const now = Date.now();
    let teachers = teachersRes.rows.map(fromDbTeacher);
    let subjects = subjectsRes.rows.map(fromDbSubject);
    let questions = questionsRes.rows.map(fromDbQuestion);
    const students = studentsRes.rows.map(fromDbStudent);
    let results = resultsRes.rows.map(fromDbExamResult);
    let scratchCards = cardsRes.rows.map(fromDbScratchCard);
    const inquiries = inquiriesRes.rows.map(fromDbContactInquiry);
    const activeSessions = sessionsRes.rows
      .map(fromDbActiveSession)
      .filter((sess) => sess.expiresAt + 1000 * 60 * 30 > now);

    const academicConfig =
      fromDbAcademicConfig(configRes.rows[0]) || defaultSeed.academicConfig;
    const settings =
      fromDbPortalSettings(settingsRes.rows[0]) || defaultSeed.settings;

    // Backfill partial SQL setups (e.g., if initial script only created 3 subjects & 0 questions/teachers)
    let needsBackfill = false;
    if (teachers.length === 0) {
      teachers = [...defaultSeed.teachers];
      needsBackfill = true;
    }
    if (questions.length === 0 && results.length === 0) {
      const existingSubjectIds = new Set(subjects.map((s) => s.id));
      for (const seedSub of defaultSeed.subjects) {
        if (!existingSubjectIds.has(seedSub.id)) {
          subjects.push(seedSub);
          existingSubjectIds.add(seedSub.id);
        }
      }
      questions = [...defaultSeed.questions];
      if (results.length === 0) {
        results = [...defaultSeed.results];
      }
      if (scratchCards.length === 0) {
        scratchCards = [...defaultSeed.scratchCards];
      }
      needsBackfill = true;
    }

    const hydrated: CbtStoreData = {
      academicConfig,
      teachers,
      subjects,
      questions,
      results,
      students,
      nextAdmissionSeq: Math.max(
        defaultSeed.nextAdmissionSeq,
        computeNextAdmissionSeqFromRows(students, results)
      ),
      scratchCards,
      settings,
      inquiries,
      activeSessions,
    };

    if (needsBackfill) {
      console.log('[Supabase] Partial seed detected. Backfilling teachers, subjects & questions to Supabase...');
      try {
        await syncDeltaToSupabase(null, hydrated);
        lastSyncError = null;
        lastSyncAt = new Date().toISOString();
      } catch (backfillErr) {
        const msg = backfillErr instanceof Error ? backfillErr.message : String(backfillErr);
        lastSyncError = msg;
        console.error('[Supabase Backfill Error]:', msg);
      }
    } else {
      lastSyncError = null;
      lastSyncAt = new Date().toISOString();
    }

    if (!connectionLogged) {
      connectionLogged = true;
      console.log(
        `[Supabase] Connected & hydrated (${hydrated.subjects.length} subjects, ${hydrated.questions.length} questions, ${hydrated.students.length} students, ${hydrated.results.length} results).`
      );
    }

    return hydrated;
  } catch (err) {
    lastSyncError = err instanceof Error ? err.message : String(err);
    console.error('[Supabase Hydration Exception]:', lastSyncError);
    return null;
  }
}

export async function forceFullSyncToSupabase(store: CbtStoreData): Promise<{
  ok: boolean;
  error: string | null;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      ok: false,
      error: 'Supabase environment variables (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) are not configured.',
    };
  }
  try {
    await syncDeltaToSupabase(null, store);
    lastSyncError = null;
    lastSyncAt = new Date().toISOString();
    return { ok: true, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lastSyncError = msg;
    return { ok: false, error: msg };
  }
}

export async function getSupabaseDiagnostics(store: CbtStoreData): Promise<{
  configured: boolean;
  keyKind: string;
  readOk: boolean;
  writeOk: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  remoteCounts: Record<string, number> | null;
}> {
  const configured = isSupabaseConfigured();
  const { key } = getCredentials();
  const keyKind = detectSupabaseKeyKind(key);

  if (!configured) {
    return {
      configured: false,
      keyKind,
      readOk: false,
      writeOk: false,
      lastSyncAt,
      lastError: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.',
      remoteCounts: null,
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      configured: true,
      keyKind,
      readOk: false,
      writeOk: false,
      lastSyncAt,
      lastError: 'Invalid SUPABASE_URL format.',
      remoteCounts: null,
    };
  }

  let readOk = false;
  let writeOk = false;
  let errorMsg = lastSyncError;
  let remoteCounts: Record<string, number> | null = null;

  try {
    const tables = [
      'teachers',
      'subjects',
      'questions',
      'students',
      'exam_results',
      'scratch_cards',
      'active_exam_sessions',
      'contact_inquiries',
    ] as const;

    const results = await Promise.all(
      tables.map(async (t) => {
        const { count, error } = await client.from(t).select('*', { count: 'exact', head: true });
        return { t, count: count ?? 0, error };
      })
    );

    const readErr = results.find((r) => r.error)?.error;
    if (readErr) {
      errorMsg = readErr.message;
    } else {
      readOk = true;
      remoteCounts = Object.fromEntries(results.map((r) => [r.t, r.count]));
    }

    const { error: writeErr } = await client
      .from('portal_settings')
      .upsert([toDbPortalSettings(store.settings)], { onConflict: 'id' });

    if (writeErr) {
      errorMsg = writeErr.message;
    } else {
      writeOk = true;
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  return {
    configured,
    keyKind,
    readOk,
    writeOk,
    lastSyncAt,
    lastError: errorMsg,
    remoteCounts,
  };
}

export function flushSupabaseSync(): Promise<void> {
  return syncQueue;
}
