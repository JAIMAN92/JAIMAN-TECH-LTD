import type { ExamResult, OptionKey, QuestionType } from '../types';

export interface ParsedSpreadsheetQuestion {
  type: QuestionType;
  classLevel: string;
  topic: string;
  passageTitle?: string;
  passage?: string;
  prompt: string;
  options: Record<OptionKey, string>;
  correctOption: OptionKey;
  acceptableAnswers?: string[];
  explanation?: string;
}

function normalizeHeaderKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getField(row: Record<string, unknown>, candidates: string[]): string {
  for (const [rawKey, val] of Object.entries(row)) {
    const norm = normalizeHeaderKey(rawKey);
    if (candidates.includes(norm) && val !== undefined && val !== null) {
      return String(val).trim();
    }
  }
  return '';
}

function parseRowToQuestion(row: Record<string, unknown>): ParsedSpreadsheetQuestion | null {
  const rawType = getField(row, ['type', 'questiontype']).toLowerCase();
  let type: QuestionType = 'mcq';
  if (rawType === 'true_false' || rawType === 'truefalse' || rawType === 'tf') {
    type = 'true_false';
  } else if (
    rawType === 'fill_blank' ||
    rawType === 'fillblank' ||
    rawType === 'fillintheblank' ||
    rawType === 'blank'
  ) {
    type = 'fill_blank';
  } else if (rawType === 'comprehension' || rawType === 'passage') {
    type = 'comprehension';
  }

  const prompt = getField(row, ['prompt', 'question', 'questiontext']);
  if (!prompt) return null;

  const topic = getField(row, ['topic', 'subjecttopic', 'unit']) || 'General';
  const classLevel = getField(row, ['class', 'classlevel', 'level']).toUpperCase() || 'ALL';
  const passageTitle = getField(row, ['passagetitle', 'title']) || undefined;
  const passage = getField(row, ['passage', 'comprehensionpassage', 'story']) || undefined;
  const explanation = getField(row, ['explanation', 'note', 'feedback']) || undefined;

  if (type === 'true_false') {
    const rawCorrect = getField(row, ['correct', 'correctoption', 'answer']).toUpperCase();
    const correctOption: OptionKey =
      rawCorrect === 'B' || rawCorrect === 'FALSE' || rawCorrect === 'F' ? 'B' : 'A';
    return {
      type: 'true_false',
      classLevel,
      topic,
      prompt,
      options: { A: 'True', B: 'False', C: '', D: '' },
      correctOption,
      explanation,
    };
  }

  if (type === 'fill_blank') {
    const rawAns = getField(row, [
      'acceptableanswers',
      'acceptableanswer',
      'correct',
      'answer',
      'optiona',
    ]);
    const acceptableAnswers = rawAns
      .split(/[;|,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (acceptableAnswers.length === 0) return null;
    return {
      type: 'fill_blank',
      classLevel,
      topic,
      prompt,
      options: { A: acceptableAnswers[0], B: '', C: '', D: '' },
      correctOption: 'A',
      acceptableAnswers,
      explanation,
    };
  }

  const optA = getField(row, ['optiona', 'a', 'choicea']);
  const optB = getField(row, ['optionb', 'b', 'choiceb']);
  const optC = getField(row, ['optionc', 'c', 'choicec']);
  const optD = getField(row, ['optiond', 'd', 'choiced']);
  const rawCorrect = getField(row, ['correct', 'correctoption', 'answer']).toUpperCase();

  if (
    !optA ||
    !optB ||
    !optC ||
    !optD ||
    (rawCorrect !== 'A' && rawCorrect !== 'B' && rawCorrect !== 'C' && rawCorrect !== 'D')
  ) {
    return null;
  }

  if (type === 'comprehension' && !passage) {
    return null;
  }

  return {
    type,
    classLevel,
    topic,
    ...(type === 'comprehension' ? { passageTitle, passage } : {}),
    prompt,
    options: { A: optA, B: optB, C: optC, D: optD },
    correctOption: rawCorrect as OptionKey,
    explanation,
  };
}

export async function parseQuestionsSpreadsheetFile(
  file: File
): Promise<ParsedSpreadsheetQuestion[]> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];
  const worksheet = workbook.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
  const out: ParsedSpreadsheetQuestion[] = [];
  for (const row of rows) {
    const parsed = parseRowToQuestion(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

const TEMPLATE_ROWS = [
  {
    Type: 'mcq',
    Class: 'ALL',
    Topic: 'Algebra',
    Prompt: 'Simplify 2(x + 3) + 4x.',
    OptionA: '6x + 6',
    OptionB: '6x + 3',
    OptionC: '5x + 6',
    OptionD: '8x + 6',
    Correct: 'A',
    AcceptableAnswers: '',
    PassageTitle: '',
    Passage: '',
    Explanation: 'Expand 2x + 6 + 4x = 6x + 6.',
  },
  {
    Type: 'true_false',
    Class: 'JSS1',
    Topic: 'Number Theory',
    Prompt: 'Zero is a positive prime number.',
    OptionA: 'True',
    OptionB: 'False',
    OptionC: '',
    OptionD: '',
    Correct: 'B',
    AcceptableAnswers: '',
    PassageTitle: '',
    Passage: '',
    Explanation: 'Prime numbers must be integers greater than 1.',
  },
  {
    Type: 'fill_blank',
    Class: 'ALL',
    Topic: 'Geometry',
    Prompt: 'A triangle with all three sides equal is called an _______ triangle.',
    OptionA: '',
    OptionB: '',
    OptionC: '',
    OptionD: '',
    Correct: 'A',
    AcceptableAnswers: 'equilateral;an equilateral',
    PassageTitle: '',
    Passage: '',
    Explanation: 'An equilateral triangle has three equal sides and 60° angles.',
  },
  {
    Type: 'comprehension',
    Class: 'SS1',
    Topic: 'Reading Comprehension',
    Prompt: 'What is the main focus of JAIMAN GOLDENLITE TECH LTD CBT practice?',
    OptionA: 'Preparing students for digital literacy and exams',
    OptionB: 'Canceling classroom teaching',
    OptionC: 'Replacing practical science labs',
    OptionD: 'Avoiding study habits',
    Correct: 'A',
    AcceptableAnswers: '',
    PassageTitle: 'Digital Exams at JAIMAN GOLDENLITE TECH LTD',
    Passage:
      'JAIMAN GOLDENLITE TECH LTD uses structured CBT drills to prepare students for digital literacy and national examinations.',
    Explanation: 'The passage states digital literacy and national exams.',
  },
];

export async function downloadQuestionTemplate(format: 'xlsx' | 'csv'): Promise<void> {
  const XLSX = await import('xlsx');
  const sheet = XLSX.utils.json_to_sheet(TEMPLATE_ROWS);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'QuestionsTemplate');
  if (format === 'xlsx') {
    XLSX.writeFile(workbook, 'jaiman-goldenlite-cbt-questions-template.xlsx');
  } else {
    XLSX.writeFile(workbook, 'jaiman-goldenlite-cbt-questions-template.csv', { bookType: 'csv' });
  }
}

export async function exportResultsSpreadsheet(
  results: ExamResult[],
  filenameBase: string,
  format: 'xlsx' | 'csv'
): Promise<void> {
  const XLSX = await import('xlsx');
  const rows = results.map((r) => ({
    'Reference Code': r.referenceCode,
    'Student Name': r.studentName,
    'Exam Number': r.examNumber,
    Class: r.classLevel,
    Arm: r.classArm || 'A',
    Session: r.sessionName || '2026/2027',
    Term: r.term || 'First Term',
    Type: r.assessmentType || (r.isPractice ? 'Practice' : 'Exam'),
    'Subject Code': r.subjectCode,
    'Subject Name': r.subjectName,
    Score: r.score,
    'Total Questions': r.totalQuestions,
    Percentage: `${r.percentage}%`,
    Grade: r.grade,
    Status: r.passed ? 'PASS' : 'FAIL',
    'Submitted At': new Date(r.submittedAt).toLocaleString(),
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'ScoreSheet');
  if (format === 'xlsx') {
    XLSX.writeFile(workbook, `${filenameBase}.xlsx`);
  } else {
    XLSX.writeFile(workbook, `${filenameBase}.csv`, { bookType: 'csv' });
  }
}
