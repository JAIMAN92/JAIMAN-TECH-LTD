import React from 'react';
import { Award, BookOpen, Compass, Cpu, GraduationCap, Shield } from 'lucide-react';
import type { PageId } from '../types';
import { SchoolCrest } from './SchoolCrest';

interface AboutPageProps {
  onNavigate: (page: PageId) => void;
}

export const AboutPage: React.FC<AboutPageProps> = ({ onNavigate }) => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
      {/* Header Banner */}
      <section className="bg-blue-950 text-white rounded-2xl p-8 sm:p-12 border border-blue-900">
        <div className="max-w-3xl space-y-4">
          <div className="flex items-center gap-3">
            <SchoolCrest className="w-11 h-11 shrink-0" />
            <p className="text-xs font-medium text-amber-400 tracking-wide">
              JAIMAN GOLDENLITE TECH LTD · Akoko-Edo L.G.A., Edo State
            </p>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-balance">
            Shaping Disciplined Scholars for a Digital Academic Future
          </h1>
          <p className="text-base text-blue-100 leading-relaxed max-w-2xl">
            JAIMAN GOLDENLITE TECH LTD is a premier Junior and Senior Secondary institution committed to moral integrity, rigorous academic preparation, and modern digital assessment across JSS1 to SS3.
          </p>
        </div>
      </section>

      {/* Mission & Digital Excellence */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white border border-slate-200 rounded-xl p-8 space-y-4">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-900 flex items-center justify-center">
            <Compass className="w-5 h-5" />
          </div>
          <h2 className="font-display text-2xl font-bold text-slate-900">
            Our Academic Mission
          </h2>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            Our mission is to nurture analytical thinking, strong character, and mastery of the Nigerian National Secondary Curriculum. From Basic Education Certificate Examination (BECE) readiness in Junior School to WAEC, NECO, and UTME distinction in Senior School, every learner receives structured mentorship and fair evaluation.
          </p>
          <div className="pt-4 border-t border-slate-100 flex flex-wrap gap-6 text-sm text-slate-700">
            <div>
              <span className="block font-display text-xl font-bold text-blue-900 tabular-nums">
                JSS1 – SS3
              </span>
              <span className="text-xs text-slate-500">Full 6-Year Curriculum</span>
            </div>
            <div>
              <span className="block font-display text-xl font-bold text-emerald-700 tabular-nums">
                100%
              </span>
              <span className="text-xs text-slate-500">Objective CBT Auditing</span>
            </div>
            <div>
              <span className="block font-display text-xl font-bold text-amber-700 tabular-nums">
                WAEC / NECO
              </span>
              <span className="text-xs text-slate-500">Standardized Mock Prep</span>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-8 space-y-4">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <Cpu className="w-5 h-5" />
          </div>
          <h2 className="font-display text-2xl font-bold text-slate-900">
            Commitment to Digital Excellence
          </h2>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            Because national qualifying examinations such as JAMB UTME and modern professional certifications rely on Computer-Based Testing, JAIMAN GOLDENLITE TECH LTD integrates timed CBT assessments directly into Continuous Assessment (CA) and terminal examinations.
          </p>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            Students build genuine exam-hall composure: managing countdown timers, flagging questions for review, navigating seamlessly across items, and receiving transparent, instantaneous grading.
          </p>
        </div>
      </section>

      {/* Core Pillars */}
      <section className="space-y-6">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-900">
            Pillars of the JAIMAN GOLDENLITE Standard
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Principles guiding instruction, laboratory practice, and examination conduct.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-900 flex items-center justify-center">
              <Shield className="w-5 h-5" />
            </div>
            <h3 className="font-display text-lg font-semibold text-slate-900">
              Examination Integrity
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Centralized server-side grading ensures tamper-free scoring, objective answer verification, and accurate academic records for every candidate.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
              <BookOpen className="w-5 h-5" />
            </div>
            <h3 className="font-display text-lg font-semibold text-slate-900">
              Curriculum Mastery
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Subject banks in Mathematics, English Language, Sciences, ICT, and Civic Studies are continuously curated by our subject heads.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <Award className="w-5 h-5" />
            </div>
            <h3 className="font-display text-lg font-semibold text-slate-900">
              Instant Feedback
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Immediate score slips and question-by-question answer reviews allow teachers and students to identify strengths and close learning gaps quickly.
            </p>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-blue-900 text-white flex items-center justify-center shrink-0">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display text-lg font-bold text-slate-900">
              Ready for your scheduled CBT paper?
            </h3>
            <p className="text-sm text-slate-600">
              Ensure you have your Admission / Exam Number before signing in to the examination hall portal.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('check-result')}
            className="px-4 py-2 text-sm font-semibold text-blue-900 border border-blue-200 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
          >
            Check Result
          </button>
          <button
            type="button"
            onClick={() => onNavigate('take-exam')}
            className="px-5 py-2 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
          >
            Start Exam
          </button>
        </div>
      </section>
    </div>
  );
};
