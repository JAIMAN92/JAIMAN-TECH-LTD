-- =============================================================================
-- JAIMAN GOLDENLITE TECH LTD — Computer-Based Test (CBT) Portal
-- Complete Supabase (PostgreSQL) Schema & Initial Seed Script
-- =============================================================================
-- Run this script once in your Supabase Dashboard -> SQL Editor -> New Query.
-- Then add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to AI Studio Secrets.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Academic Session & Term Configuration (Singleton id = 1)
CREATE TABLE IF NOT EXISTS public.academic_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_session TEXT NOT NULL DEFAULT '2026/2027',
  current_term TEXT NOT NULL DEFAULT 'First Term'
    CHECK (current_term IN ('First Term', 'Second Term', 'Third Term')),
  sessions TEXT[] NOT NULL DEFAULT ARRAY['2025/2026', '2026/2027', '2027/2028'],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Portal Settings (Singleton id = 1)
CREATE TABLE IF NOT EXISTS public.portal_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  require_scratch_card BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Teacher Accounts
CREATE TABLE IF NOT EXISTS public.teachers (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  subject_ids TEXT[] NOT NULL DEFAULT '{}',
  classes TEXT[] NOT NULL DEFAULT ARRAY['JSS1','JSS2','JSS3','SS1','SS2','SS3'],
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Subjects / Examinations / Practice Tests
CREATE TABLE IF NOT EXISTS public.subjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  session_name TEXT NOT NULL DEFAULT '2026/2027',
  term TEXT NOT NULL DEFAULT 'First Term',
  assessment_type TEXT NOT NULL DEFAULT 'Exam'
    CHECK (assessment_type IN ('CA', 'Exam', 'Mock', 'Practice')),
  is_practice BOOLEAN NOT NULL DEFAULT FALSE,
  classes TEXT[] NOT NULL DEFAULT '{}',
  arms TEXT[] NOT NULL DEFAULT ARRAY['A','B','C','D','E','F','G','H','I','J'],
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 1 AND duration_minutes <= 240),
  pass_mark INTEGER NOT NULL CHECK (pass_mark >= 1 AND pass_mark <= 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  instructions TEXT NOT NULL DEFAULT '',
  start_at TIMESTAMPTZ NULL,
  end_at TIMESTAMPTZ NULL,
  allowed_attempts INTEGER NOT NULL DEFAULT 1,
  shuffle_questions BOOLEAN NOT NULL DEFAULT TRUE,
  shuffle_options BOOLEAN NOT NULL DEFAULT TRUE,
  show_score_after_submit BOOLEAN NOT NULL DEFAULT TRUE,
  show_review_after_submit BOOLEAN NOT NULL DEFAULT TRUE,
  enable_browser_guardrails BOOLEAN NOT NULL DEFAULT TRUE,
  question_ids TEXT[] NULL,
  created_by_teacher_id TEXT NULL REFERENCES public.teachers(id) ON DELETE SET NULL
);

-- 5. Question Bank (MCQ, True/False, Fill-in-the-Blank, Comprehension)
CREATE TABLE IF NOT EXISTS public.questions (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'mcq'
    CHECK (type IN ('mcq', 'true_false', 'fill_blank', 'comprehension')),
  class_level TEXT NOT NULL DEFAULT 'ALL',
  topic TEXT NOT NULL DEFAULT 'General',
  passage_title TEXT NULL,
  passage TEXT NULL,
  prompt TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '{"A":"","B":"","C":"","D":""}'::jsonb,
  correct_option TEXT NOT NULL DEFAULT 'A'
    CHECK (correct_option IN ('A', 'B', 'C', 'D')),
  acceptable_answers TEXT[] NOT NULL DEFAULT '{}',
  explanation TEXT NULL,
  created_by TEXT NULL
);

-- 6. Student Registry & Admission Sequence
CREATE SEQUENCE IF NOT EXISTS public.admission_number_seq START WITH 409 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS public.students (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  exam_number TEXT NOT NULL UNIQUE,
  class_level TEXT NOT NULL CHECK (class_level IN ('JSS1','JSS2','JSS3','SS1','SS2','SS3')),
  class_arm TEXT NOT NULL DEFAULT 'A' CHECK (class_arm IN ('A','B','C','D','E','F','G','H','I','J')),
  gender TEXT NOT NULL CHECK (gender IN ('Male', 'Female')),
  guardian_phone TEXT NULL,
  passcode_hash TEXT NULL,
  registered_by TEXT NOT NULL DEFAULT 'admin' CHECK (registered_by IN ('self', 'admin')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Active Exam Sessions (Real-Time Autosave & Disconnect Resume)
CREATE TABLE IF NOT EXISTS public.active_exam_sessions (
  session_id TEXT PRIMARY KEY,
  student_name TEXT NOT NULL,
  exam_number TEXT NOT NULL,
  class_level TEXT NOT NULL CHECK (class_level IN ('JSS1','JSS2','JSS3','SS1','SS2','SS3')),
  class_arm TEXT NOT NULL CHECK (class_arm IN ('A','B','C','D','E','F','G','H','I','J')),
  subject_id TEXT NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  question_ids TEXT[] NOT NULL DEFAULT '{}',
  option_maps JSONB NOT NULL DEFAULT '{}'::jsonb,
  saved_answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  saved_flagged JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- 8. Submitted Examination Results & Audit Trail
CREATE TABLE IF NOT EXISTS public.exam_results (
  id TEXT PRIMARY KEY,
  reference_code TEXT NOT NULL UNIQUE,
  student_name TEXT NOT NULL,
  exam_number TEXT NOT NULL,
  class_level TEXT NOT NULL CHECK (class_level IN ('JSS1','JSS2','JSS3','SS1','SS2','SS3')),
  class_arm TEXT NOT NULL CHECK (class_arm IN ('A','B','C','D','E','F','G','H','I','J')),
  subject_id TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  subject_code TEXT NOT NULL,
  session_name TEXT NOT NULL DEFAULT '2026/2027',
  term TEXT NOT NULL DEFAULT 'First Term',
  assessment_type TEXT NOT NULL DEFAULT 'Exam'
    CHECK (assessment_type IN ('CA', 'Exam', 'Mock', 'Practice')),
  is_practice BOOLEAN NOT NULL DEFAULT FALSE,
  score INTEGER NOT NULL DEFAULT 0,
  total_questions INTEGER NOT NULL DEFAULT 0,
  percentage INTEGER NOT NULL DEFAULT 0,
  pass_mark INTEGER NOT NULL DEFAULT 50,
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  grade TEXT NOT NULL,
  duration_taken_seconds INTEGER NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  auto_submitted BOOLEAN NOT NULL DEFAULT FALSE,
  score_withheld BOOLEAN NOT NULL DEFAULT FALSE,
  tab_violations INTEGER NOT NULL DEFAULT 0,
  termination_reason TEXT NULL,
  review JSONB NULL
);

-- 9. Result Checker Scratch Cards (PINs)
CREATE TABLE IF NOT EXISTS public.scratch_cards (
  id TEXT PRIMARY KEY,
  serial_number TEXT NOT NULL UNIQUE,
  pin TEXT NOT NULL UNIQUE,
  batch_label TEXT NOT NULL DEFAULT '2026/2027 Termly Batch',
  max_uses INTEGER NOT NULL DEFAULT 5 CHECK (max_uses >= 1),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  bound_exam_number TEXT NULL,
  is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NULL
);

-- 10. Student / Parent Support Inquiries
CREATE TABLE IF NOT EXISTS public.contact_inquiries (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  exam_number TEXT NULL,
  email TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Performance Indexes
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_questions_subject_id ON public.questions(subject_id);
CREATE INDEX IF NOT EXISTS idx_students_exam_number_upper ON public.students(UPPER(exam_number));
CREATE INDEX IF NOT EXISTS idx_students_class_arm ON public.students(class_level, class_arm);
CREATE INDEX IF NOT EXISTS idx_results_exam_number_upper ON public.exam_results(UPPER(exam_number));
CREATE INDEX IF NOT EXISTS idx_results_subject_id ON public.exam_results(subject_id);
CREATE INDEX IF NOT EXISTS idx_results_submitted_at ON public.exam_results(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_active_sessions_exam_number ON public.active_exam_sessions(UPPER(exam_number), subject_id);
CREATE INDEX IF NOT EXISTS idx_scratch_cards_pin_upper ON public.scratch_cards(UPPER(pin));

-- =============================================================================
-- Helper Function: Auto-Generate Admission / Exam Numbers (GSS/2026/XXXX)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.generate_next_exam_number(p_year TEXT DEFAULT '2026')
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_seq BIGINT;
  v_candidate TEXT;
BEGIN
  LOOP
    v_seq := NEXTVAL('public.admission_number_seq');
    v_candidate := 'GSS/' || p_year || '/' || LPAD(v_seq::TEXT, 4, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.students WHERE UPPER(exam_number) = UPPER(v_candidate)
    );
  END LOOP;
  RETURN v_candidate;
END;
$$;

-- =============================================================================
-- Row-Level Security (RLS)
-- Express backend uses SUPABASE_SERVICE_ROLE_KEY which automatically bypasses RLS.
-- Enabling RLS keeps unauthenticated browser requests locked down.
-- =============================================================================
ALTER TABLE public.academic_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_exam_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scratch_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_inquiries ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Initial Portal Singleton Configuration
-- =============================================================================
INSERT INTO public.academic_config (id, current_session, current_term, sessions)
VALUES (1, '2026/2027', 'First Term', ARRAY['2025/2026', '2026/2027', '2027/2028'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.portal_settings (id, require_scratch_card)
VALUES (1, TRUE)
ON CONFLICT (id) DO NOTHING;
