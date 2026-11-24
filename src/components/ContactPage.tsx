import React, { useState } from 'react';
import { CheckCircle2, Clock, Mail, MapPin, Phone, Send } from 'lucide-react';

export const ContactPage: React.FC = () => {
  const [fullName, setFullName] = useState('');
  const [examNumber, setExamNumber] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState('CBT Login / Exam Access');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submittedSuccess, setSubmittedSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim() || !message.trim()) {
      setError('Please complete your name, email address, and inquiry message.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          examNumber,
          email,
          category,
          message,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not submit inquiry.');
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      setSubmittedSuccess(true);
      setFullName('');
      setExamNumber('');
      setEmail('');
      setMessage('');
    } catch {
      setError('Network error while sending message. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      <div className="max-w-2xl space-y-2">
        <p className="text-xs font-semibold text-amber-700 tracking-wide">
          Examination & ICT Support Desk
        </p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
          Contact JAIMAN GOLDENLITE TECH LTD
        </h1>
        <p className="text-base text-slate-600 leading-relaxed">
          Reach our Principal’s Office, Examination Officer, or CBT Computer Laboratory Support Desk for candidate verification, result queries, or technical assistance.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* School Contact Directory */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-900 flex items-center justify-center shrink-0">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900">
                  School Campus Address
                </h2>
                <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                  JAIMAN GOLDENLITE TECH LTD
                  <br />
                  Goldenlite Way, Off Momodu Ajayi Road,
                  <br />
                  Igarra, Akoko-Edo L.G.A.,
                  <br />
                  Edo State, Nigeria.
                </p>
              </div>
            </div>

            <div className="pt-5 border-t border-slate-100 flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                <Phone className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900">
                  Official Phone Lines
                </h2>
                <p className="text-sm text-slate-600 mt-1 font-mono tabular-nums">
                  +234 (0) 803 451 2890
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Exam Support Desk Ext: +234 (0) 812 904 6612
                </p>
              </div>
            </div>

            <div className="pt-5 border-t border-slate-100 flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                <Mail className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900">
                  Official Email Addresses
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  exams@jaimangoldenlite.edu.ng
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  General Inquiries: info@jaimangoldenlite.edu.ng
                </p>
              </div>
            </div>

            <div className="pt-5 border-t border-slate-100 flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-display text-sm font-bold text-slate-900">
                  CBT Support Desk Hours
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  Monday – Friday: 7:30 AM – 3:30 PM (WAT)
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Live invigilator assistance during active exam sessions in ICT Lab A &amp; B.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Support Form */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          <h2 className="font-display text-xl font-bold text-slate-900">
            Send a Message to the Exam Support Desk
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Need help with your Admission Number, subject assignment, or result verification? Submit your request below.
          </p>

          {submittedSuccess ? (
            <div className="mt-6 p-6 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3">
              <div className="flex items-center gap-2.5 text-emerald-800 font-semibold">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <span>Support Request Received</span>
              </div>
              <p className="text-sm text-emerald-900 leading-relaxed">
                Thank you for contacting the JAIMAN GOLDENLITE TECH LTD Examination Support Desk. Our Exam Officer will review your request and respond promptly.
              </p>
              <button
                type="button"
                onClick={() => setSubmittedSuccess(false)}
                className="px-4 py-2 text-sm font-semibold text-emerald-900 bg-white border border-emerald-300 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer"
              >
                Send Another Message
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="contact-name"
                    className="block text-sm font-medium text-slate-800 mb-1.5"
                  >
                    Full Name
                  </label>
                  <input
                    id="contact-name"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Momoh Emmanuel"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                  />
                </div>
                <div>
                  <label
                    htmlFor="contact-exam-no"
                    className="block text-sm font-medium text-slate-800 mb-1.5"
                  >
                    Admission / Exam Number (Optional)
                  </label>
                  <input
                    id="contact-exam-no"
                    type="text"
                    value={examNumber}
                    onChange={(e) => setExamNumber(e.target.value)}
                    placeholder="e.g. GSS/2026/0104"
                    className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="contact-email"
                    className="block text-sm font-medium text-slate-800 mb-1.5"
                  >
                    Email Address
                  </label>
                  <input
                    id="contact-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="parent.or.student@example.com"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                  />
                </div>
                <div>
                  <label
                    htmlFor="contact-category"
                    className="block text-sm font-medium text-slate-800 mb-1.5"
                  >
                    Inquiry Category
                  </label>
                  <select
                    id="contact-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-800"
                  >
                    <option value="CBT Login / Exam Access">CBT Login / Exam Access</option>
                    <option value="Result Verification">Result Verification</option>
                    <option value="Subject / Class Assignment">Subject / Class Assignment</option>
                    <option value="Admissions & General">Admissions &amp; General</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="contact-message"
                  className="block text-sm font-medium text-slate-800 mb-1.5"
                >
                  Message
                </label>
                <textarea
                  id="contact-message"
                  rows={4}
                  required
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe your question or examination support request..."
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800"
                />
              </div>

              {error && (
                <p role="alert" className="text-xs font-medium text-red-700">
                  {error}
                </p>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-900 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>{submitting ? 'Sending...' : 'Submit Inquiry'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
