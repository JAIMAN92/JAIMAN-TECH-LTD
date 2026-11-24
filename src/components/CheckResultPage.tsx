import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  KeyRound,
  Printer,
  Search,
  XCircle,
} from 'lucide-react';
import type { ExamResult, PageId, ResultCardInfo } from '../types';
import { safeReadJson } from '../utils/http';
import { SchoolCrest } from './SchoolCrest';

interface CheckResultPageProps {
  latestResult: ExamResult | null;
  onNavigate: (page: PageId) => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

export const CheckResultPage: React.FC<CheckResultPageProps> = ({
  latestResult,
  onNavigate,
}) => {
  const [lookupInput, setLookupInput] = useState(latestResult?.examNumber || '');
  const [cardPin, setCardPin] = useState('');
  const [requireScratchCard, setRequireScratchCard] = useState(true);
  const [cardInfo, setCardInfo] = useState<ResultCardInfo | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [lookedUpResults, setLookedUpResults] = useState<ExamResult[] | null>(null);
  const [selectedResult, setSelectedResult] = useState<ExamResult | null>(latestResult);
  const [showReview, setShowReview] = useState(false);

  useEffect(() => {
    if (latestResult) {
      setSelectedResult(latestResult);
      setLookupInput(latestResult.examNumber);
      setShowReview(false);
    }
  }, [latestResult]);

  useEffect(() => {
    let active = true;
    fetch('/api/results/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data && typeof data.requireScratchCard === 'boolean') {
          setRequireScratchCard(data.requireScratchCard);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const displayedResult = selectedResult || latestResult;

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = lookupInput.trim();
    if (!trimmed) {
      setSearchError('Enter your Admission / Exam Number or Reference Code.');
      return;
    }
    if (requireScratchCard && !cardPin.trim()) {
      setSearchError('Enter your Result Checker Scratch Card PIN.');
      return;
    }

    setSearching(true);
    setSearchError('');
    try {
      const res = await fetch('/api/results/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          examNumber: trimmed,
          cardPin: cardPin.trim(),
        }),
      });
      const data = await safeReadJson<{
        results?: ExamResult[];
        cardInfo?: ResultCardInfo | null;
      }>(res);
      if (!res.ok) {
        setSearchError(data.error || `Could not retrieve results (HTTP ${res.status}).`);
        setSearching(false);
        return;
      }
      setSearching(false);
      const results: ExamResult[] = data.results || [];
      setCardInfo(data.cardInfo || null);
      setLookedUpResults(results);
      if (results.length > 0) {
        setSelectedResult(results[0]);
        setShowReview(false);
      } else {
        setSelectedResult(null);
      }
    } catch {
      setSearchError('Network error while checking result.');
      setSearching(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div className="no-print space-y-2 max-w-2xl">
        <p className="text-xs font-semibold text-amber-700 tracking-wide">
          JAIMAN GOLDENLITE TECH LTD · Examination Records
        </p>
        <h1 className="font-display text-3xl font-bold text-slate-900 tracking-tight">
          Check CBT Result
        </h1>
        <p className="text-sm sm:text-base text-slate-600">
          {requireScratchCard
            ? 'View your instant post-exam summary or enter your Admission / Exam Number and Result Checker Scratch Card PIN to unlock previous results.'
            : 'View your instant post-exam score summary or look up previous CBT results using your Admission / Exam Number.'}
        </p>
      </div>

      {/* Lookup Search Form */}
      <form
        onSubmit={handleLookup}
        className="no-print bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className={requireScratchCard ? 'md:col-span-5' : 'md:col-span-9'}>
            <label
              htmlFor="result-lookup-input"
              className="block text-sm font-medium text-slate-800 mb-1.5"
            >
              Admission / Exam Number or Reference
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="result-lookup-input"
                type="text"
                value={lookupInput}
                onChange={(e) => {
                  setLookupInput(e.target.value.toUpperCase());
                  if (searchError) setSearchError('');
                }}
                placeholder="e.g. GSS/2026/0104"
                className="w-full pl-10 pr-4 py-2.5 text-sm font-mono uppercase border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
              />
            </div>
          </div>

          {requireScratchCard && (
            <div className="md:col-span-4">
              <label
                htmlFor="scratch-card-pin-input"
                className="block text-sm font-medium text-slate-800 mb-1.5"
              >
                Scratch Card PIN
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="scratch-card-pin-input"
                  type="text"
                  value={cardPin}
                  onChange={(e) => {
                    setCardPin(e.target.value.toUpperCase());
                    if (searchError) setSearchError('');
                  }}
                  placeholder="GLC-XXXX-XXXX-XXXX"
                  className="w-full pl-10 pr-4 py-2.5 text-sm font-mono uppercase border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                />
              </div>
            </div>
          )}

          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={searching}
              className="w-full px-6 py-2.5 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              {searching ? 'Verifying...' : 'Check Result'}
            </button>
          </div>
        </div>

        {requireScratchCard && (
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <CreditCard className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>
              Each Scratch Card binds to one candidate Exam Number and permits up to its maximum allocated result checks. Obtain your card from the School Bursary or Exam Officer.
            </span>
          </p>
        )}

        {searchError && (
          <p role="alert" className="text-xs font-medium text-red-700">
            {searchError}
          </p>
        )}
      </form>

      {/* Scratch Card Usage Receipt */}
      {cardInfo && (
        <div className="no-print bg-blue-50 border border-blue-200 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm text-blue-950">
          <div className="flex items-center gap-2 font-medium">
            <CreditCard className="w-4 h-4 text-blue-900 shrink-0" />
            <span>
              Scratch Card Verified · Serial:{' '}
              <strong className="font-mono">{cardInfo.serialNumber}</strong>
            </span>
          </div>
          <div className="font-mono font-semibold tabular-nums text-blue-900">
            Checks Used: {cardInfo.usedCount} / {cardInfo.maxUses} ({cardInfo.remainingUses} Remaining)
          </div>
        </div>
      )}

      {/* Multiple Lookup Matches Switcher */}
      {lookedUpResults && lookedUpResults.length > 1 && (
        <div className="no-print bg-white border border-slate-200 rounded-xl p-4 space-y-2">
          <p className="text-xs font-semibold text-slate-600">
            Found {lookedUpResults.length} examination records for {lookupInput}:
          </p>
          <div className="flex flex-wrap gap-2">
            {lookedUpResults.map((item) => {
              const active = displayedResult?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedResult(item);
                    setShowReview(false);
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                    active
                      ? 'bg-blue-900 text-white border-blue-900'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {item.subjectCode} · {item.subjectName} (
                  {item.scoreWithheld ? 'Pending Release' : `${item.percentage}%`})
                </button>
              );
            })}
          </div>
        </div>
      )}

      {lookedUpResults && lookedUpResults.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-2">
          <p className="font-display text-base font-bold text-slate-900">
            No Matching Result Found
          </p>
          <p className="text-sm text-slate-600">
            No CBT submission matches <span className="font-mono font-semibold">{lookupInput}</span>. Check the spelling of your Admission/Exam Number or take an exam first.
          </p>
        </div>
      )}

      {/* Official Result Slip */}
      {displayedResult ? (
        <div className="space-y-6">
          <div className="print-only-card bg-white border border-slate-200 rounded-xl overflow-hidden">
            {/* School Slip Header */}
            <div className="bg-blue-950 text-white px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <SchoolCrest className="w-10 h-10 shrink-0" />
                <div>
                  <h2 className="font-display text-base sm:text-lg font-bold tracking-tight">
                    JAIMAN GOLDENLITE TECH LTD
                  </h2>
                  <p className="text-xs text-blue-200">
                    Official Computer-Based Test (CBT) Result Summary
                  </p>
                </div>
              </div>
              <div className="text-left sm:text-right">
                <span className="block text-[11px] text-blue-200">Result Reference</span>
                <span className="font-mono text-sm font-semibold text-amber-400">
                  {displayedResult.referenceCode}
                </span>
              </div>
            </div>

            {/* Pass/Fail or Score Withheld Status Banner */}
            {displayedResult.scoreWithheld ? (
              <div className="px-6 py-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-amber-50 border-amber-200 text-amber-950">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-6 h-6 text-amber-700 shrink-0" />
                  <div>
                    <p className="font-display text-base font-bold">
                      Examination Submitted — Score Pending Official Release
                    </p>
                    <p className="text-xs opacity-90">
                      Your responses were safely recorded and graded by the server. Immediate score display is disabled for this assessment by your Subject Teacher or Exam Officer.
                      {displayedResult.terminationReason
                        ? ` · ${displayedResult.terminationReason}`
                        : displayedResult.autoSubmitted
                          ? ' · Auto-submitted when timer expired.'
                          : ''}
                    </p>
                  </div>
                </div>
                <div className="font-display text-sm font-bold whitespace-nowrap">
                  Status: Recorded
                </div>
              </div>
            ) : (
              <div
                className={`px-6 py-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  displayedResult.passed
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-900'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {displayedResult.passed ? (
                    <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0" />
                  ) : (
                    <XCircle className="w-6 h-6 text-red-700 shrink-0" />
                  )}
                  <div>
                    <p className="font-display text-base font-bold">
                      Status: {displayedResult.passed ? 'PASS' : 'FAIL'}
                    </p>
                    <p className="text-xs opacity-85">
                      {displayedResult.passed
                        ? `Candidate met the ${displayedResult.passMark}% pass requirement.`
                        : `Score is below the ${displayedResult.passMark}% pass benchmark.`}
                      {displayedResult.terminationReason
                        ? ` · ${displayedResult.terminationReason}`
                        : displayedResult.autoSubmitted
                          ? ' · Auto-submitted when timer expired.'
                          : ''}
                    </p>
                  </div>
                </div>

                <div className="font-display text-sm font-bold">
                  Grade: {displayedResult.grade}
                </div>
              </div>
            )}

            {/* Score & Student Details */}
            <div className="p-6 sm:p-8 space-y-6">
              {/* Primary Metrics */}
              {displayedResult.scoreWithheld ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-6 border-b border-slate-100">
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <span className="text-xs font-medium text-slate-500">Paper Length</span>
                    <p className="font-mono text-2xl font-bold text-slate-900 tabular-nums mt-1">
                      {displayedResult.totalQuestions} Questions Recorded
                    </p>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <span className="text-xs font-medium text-slate-500">Time Spent</span>
                    <p className="font-mono text-2xl font-bold text-blue-950 tabular-nums mt-1">
                      {formatDuration(displayedResult.durationTakenSeconds)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pb-6 border-b border-slate-100">
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <span className="text-xs font-medium text-slate-500">Total Score</span>
                    <p className="font-mono text-3xl font-bold text-slate-900 tabular-nums mt-1">
                      {displayedResult.score}{' '}
                      <span className="text-lg font-medium text-slate-500">
                        / {displayedResult.totalQuestions}
                      </span>
                    </p>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <span className="text-xs font-medium text-slate-500">Percentage Score</span>
                    <p
                      className={`font-mono text-3xl font-bold tabular-nums mt-1 ${
                        displayedResult.passed ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {displayedResult.percentage}%
                    </p>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <span className="text-xs font-medium text-slate-500">Time Spent</span>
                    <p className="font-mono text-2xl font-bold text-blue-950 tabular-nums mt-1.5">
                      {formatDuration(displayedResult.durationTakenSeconds)}
                    </p>
                  </div>
                </div>
              )}

              {/* Candidate Metadata */}
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
                <div className="flex justify-between sm:block border-b border-slate-100 pb-2 sm:pb-0 sm:border-0">
                  <dt className="text-slate-500 text-xs">Candidate Full Name</dt>
                  <dd className="font-semibold text-slate-900 mt-0.5">
                    {displayedResult.studentName}
                  </dd>
                </div>
                <div className="flex justify-between sm:block border-b border-slate-100 pb-2 sm:pb-0 sm:border-0">
                  <dt className="text-slate-500 text-xs">Admission / Exam Number</dt>
                  <dd className="font-mono font-semibold text-slate-900 mt-0.5">
                    {displayedResult.examNumber}
                  </dd>
                </div>
                <div className="flex justify-between sm:block border-b border-slate-100 pb-2 sm:pb-0 sm:border-0">
                  <dt className="text-slate-500 text-xs">Class &amp; Arm</dt>
                  <dd className="font-semibold text-slate-900 mt-0.5">
                    {displayedResult.classLevel} (Arm {displayedResult.classArm || 'A'})
                  </dd>
                </div>
                <div className="flex justify-between sm:block border-b border-slate-100 pb-2 sm:pb-0 sm:border-0">
                  <dt className="text-slate-500 text-xs">Subject &amp; Assessment</dt>
                  <dd className="font-semibold text-slate-900 mt-0.5">
                    {displayedResult.subjectCode} — {displayedResult.subjectName}
                    {displayedResult.assessmentType ? ` · ${displayedResult.assessmentType}` : ''}
                  </dd>
                </div>
                <div className="flex justify-between sm:block border-b border-slate-100 pb-2 sm:pb-0 sm:border-0">
                  <dt className="text-slate-500 text-xs">Session &amp; Term</dt>
                  <dd className="font-semibold text-slate-900 mt-0.5">
                    {displayedResult.sessionName || '2026/2027'} · {displayedResult.term || 'First Term'}
                  </dd>
                </div>
                <div className="flex justify-between sm:block border-b border-slate-100 pb-2 sm:pb-0 sm:border-0">
                  <dt className="text-slate-500 text-xs">Pass Benchmark</dt>
                  <dd className="font-mono text-slate-700 mt-0.5 tabular-nums">
                    {displayedResult.passMark}%
                  </dd>
                </div>
                <div className="flex justify-between sm:block sm:col-span-2">
                  <dt className="text-slate-500 text-xs">Date &amp; Time Submitted</dt>
                  <dd className="font-mono text-slate-700 mt-0.5 tabular-nums">
                    {new Date(displayedResult.submittedAt).toLocaleString()}
                  </dd>
                </div>
              </dl>

              {/* Action Buttons */}
              <div className="no-print pt-5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Print Result Slip</span>
                  </button>

                  {!displayedResult.scoreWithheld &&
                    displayedResult.review &&
                    displayedResult.review.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowReview((prev) => !prev)}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-blue-900 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer"
                      >
                        <span>{showReview ? 'Hide Answer Review' : 'View Answer Review'}</span>
                        {showReview ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                    )}
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate('take-exam')}
                  className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
                >
                  <span>Take Another Exam</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Question-by-Question Review */}
          {!displayedResult.scoreWithheld &&
            showReview &&
            displayedResult.review &&
            displayedResult.review.length > 0 && (
              <div className="no-print bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <h3 className="font-display text-lg font-bold text-slate-900">
                  Question-by-Question Review
                </h3>
                <div className="space-y-4">
                  {displayedResult.review.map((item, idx) => {
                    const isFillBlank = item.type === 'fill_blank';
                    const studentAnswerLabel = isFillBlank
                      ? item.selectedText || 'No answer entered'
                      : item.selectedOption
                        ? `${item.selectedOption}. ${item.selectedText || item.options[item.selectedOption] || ''}`
                        : 'No answer selected';
                    const correctAnswerLabel = isFillBlank
                      ? item.correctText || item.options.A || ''
                      : `${item.correctOption}. ${item.correctText || item.options[item.correctOption] || ''}`;

                    return (
                      <div
                        key={item.questionId}
                        className="p-4 rounded-xl border border-slate-200 space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-900">
                            <span className="font-mono text-blue-900 mr-2">{idx + 1}.</span>
                            {item.prompt}
                          </p>
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-semibold shrink-0 ${
                              item.isCorrect ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {item.isCorrect ? (
                              <>
                                <CheckCircle2 className="w-4 h-4" />
                                <span>Correct</span>
                              </>
                            ) : (
                              <>
                                <XCircle className="w-4 h-4" />
                                <span>Incorrect</span>
                              </>
                            )}
                          </span>
                        </div>

                        <div className="text-xs sm:text-sm space-y-1 text-slate-700">
                          <p>
                            Your Answer:{' '}
                            <span className="font-semibold">{studentAnswerLabel}</span>
                          </p>
                          {!item.isCorrect && (
                            <p className="text-emerald-800">
                              {isFillBlank ? 'Accepted Answer(s)' : 'Correct Answer'}:{' '}
                              <span className="font-semibold">{correctAnswerLabel}</span>
                            </p>
                          )}
                          {item.explanation && (
                            <p className="text-xs text-slate-500 pt-1">
                              Explanation: {item.explanation}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
        </div>
      ) : (
        !lookedUpResults && (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3">
            <p className="font-display text-base font-bold text-slate-900">
              Enter Your Exam Number Above to View Results
            </p>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              Students who have just completed a paper are redirected here automatically. You can also search past CBT records using your Admission Number (for example, <span className="font-mono font-semibold text-slate-800">GSS/2026/0104</span>).
            </p>
          </div>
        )
      )}
    </div>
  );
};
