import React from 'react';
import {
  ArrowRight,
  BookCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileSearch,
  Laptop,
  ShieldAlert,
} from 'lucide-react';
import { type PageId, type Subject } from '../types';
import { SchoolCrest } from './SchoolCrest';

interface HomePageProps {
  subjects: Subject[];
  loadingSubjects: boolean;
  onNavigate: (page: PageId) => void;
}

const CBT_STEPS = [
  {
    step: '01.',
    title: 'Registration & Sign-In',
    description:
      'Open Take Exam to register as a new student (auto-generating your Admission/Exam Number) or sign in with your Class (JSS1–SS3) and Arm (A–J).',
    icon: ClipboardList,
  },
  {
    step: '02.',
    title: 'Timed Assessment',
    description:
      'Once started, your live countdown timer runs continuously. Read each multiple-choice prompt and select Option A, B, C, or D.',
    icon: Clock,
  },
  {
    step: '03.',
    title: 'Question Navigator',
    description:
      'Use Next, Previous, or the numbered question grid to jump between questions and track answered vs. unanswered items.',
    icon: Laptop,
  },
  {
    step: '04.',
    title: 'Instant Grading & Result',
    description:
      'Submit before the clock runs out—or let the portal auto-submit at 00:00—and view your score, percentage, and pass status immediately.',
    icon: BookCheck,
  },
];

export const HomePage: React.FC<HomePageProps> = ({
  subjects,
  loadingSubjects,
  onNavigate,
}) => {
  const readySubjects = subjects.filter((s) => s.isActive && (s.questionCount ?? 0) > 0);

  return (
    <div className="space-y-12 pb-16">
      {/* Welcome Banner */}
      <section className="bg-blue-950 text-white border-b border-blue-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-8 space-y-6">
              <div className="flex items-center gap-3">
                <SchoolCrest className="w-11 h-11 shrink-0" />
                <p className="text-xs sm:text-sm font-medium text-amber-400">
                  JAIMAN GOLDENLITE TECH LTD · Edo State · JSS1–SS3 CBT Portal
                </p>
              </div>

              <h1 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight text-white text-balance leading-[1.12]">
                Computer-Based Test Examination Portal
              </h1>

              <p className="text-base sm:text-lg text-blue-100 max-w-2xl leading-relaxed">
                Welcome to the official digital assessment platform for Continuous Assessment (CA), Termly Examinations, and WAEC/NECO Mock Preparations at JAIMAN GOLDENLITE TECH LTD.
              </p>

              <div className="flex flex-wrap items-center gap-3.5 pt-1">
                <button
                  type="button"
                  onClick={() => onNavigate('take-exam')}
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm sm:text-base font-bold text-blue-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-blue-950"
                >
                  <span>Start Exam</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => onNavigate('check-result')}
                  className="inline-flex items-center gap-2 px-5 py-3 text-sm sm:text-base font-semibold text-white bg-blue-900 hover:bg-blue-800 border border-blue-700 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <FileSearch className="w-4 h-4 text-emerald-400" />
                  <span>Check Result</span>
                </button>
              </div>
            </div>

            {/* Right Structured Summary Card */}
            <div className="lg:col-span-4 bg-blue-900/60 border border-blue-800 rounded-xl p-6 space-y-5">
              <div>
                <p className="text-xs font-semibold text-amber-400">
                  Current Assessment Window
                </p>
                <h2 className="font-display text-lg font-bold text-white mt-1">
                  2026/2027 Termly &amp; Mock CBT
                </h2>
              </div>

              <dl className="space-y-3 text-sm border-t border-blue-800/80 pt-4">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-blue-200">Active Subjects</dt>
                  <dd className="font-mono font-semibold text-white tabular-nums">
                    {loadingSubjects ? '—' : readySubjects.length}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-blue-200">Eligible Classes</dt>
                  <dd className="font-mono font-semibold text-white">JSS1 – SS3</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-blue-200">Grading Standard</dt>
                  <dd className="font-medium text-emerald-300">Instant Auto-Grade</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-blue-200">Assessment Venue</dt>
                  <dd className="font-medium text-white">ICT Lab &amp; Portal</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </section>

      {/* How the CBT System Works */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="max-w-2xl">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            How the CBT System Works
          </h2>
          <p className="text-sm sm:text-base text-slate-600 mt-1.5">
            Follow these four straightforward steps before and during your computer-based examination.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {CBT_STEPS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.step}
                className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-semibold text-amber-700 tabular-nums">
                      {item.step}
                    </span>
                    <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-900 flex items-center justify-center">
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>
                  <h3 className="font-display text-base font-bold text-slate-900">
                    {item.title}
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Exam Conduct Guidelines */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 text-emerald-800">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <h3 className="font-display text-lg font-bold text-slate-900">
                Candidate Readiness Checklist
              </h3>
            </div>
            <ul className="space-y-2 text-sm text-slate-600 leading-relaxed">
              <li>Verify your official Admission or Examination Number before signing in.</li>
              <li>Confirm you have selected your correct class level (JSS1–SS3) and subject.</li>
              <li>Use the Question Navigator grid on the right to ensure no question is left blank.</li>
              <li>Click Submit Exam before leaving your workstation to record your score.</li>
            </ul>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2.5 text-amber-700">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <h3 className="font-display text-lg font-bold text-slate-900">
                Examination Hall Regulations
              </h3>
            </div>
            <ul className="space-y-2 text-sm text-slate-600 leading-relaxed">
              <li>Do not refresh or close the browser window once your timed session begins.</li>
              <li>Unauthorized devices, textbooks, or external notes are strictly prohibited.</li>
              <li>When the countdown clock reaches 00:00, your responses are automatically submitted.</li>
              <li>Raise your hand immediately to alert the lab invigilator if you need assistance.</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
};
