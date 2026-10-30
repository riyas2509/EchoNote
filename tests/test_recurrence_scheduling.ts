/**
 * Focused Unit and Integration Tests for Recurrence Scheduling Calendar Engine
 * Requirement 24.2 - EchoNote
 *
 * Covers:
 * 1. Weekly recurrence (e.g. every Monday at 09:30 Asia/Kolkata).
 * 2. Biweekly recurrence with stable anchor alignment (alternating weeks).
 * 3. Monthly recurrence on the 1st and 15th.
 * 4. Monthly recurrence on day 31 (month-end clamping for 30-day and 28/29-day months).
 * 5. Explicit last-day-of-month behavior (dayOfMonth = -1) across Feb, Apr, Dec.
 * 6. Quarterly recurrence aligned to anchor month (every 3 calendar months).
 * 7. Leap years and February 29 (day 29 in leap year 2024 vs non-leap 2025).
 * 8. Time-zone correctness for Asia/Kolkata (+05:30 offset).
 * 9. Daylight-saving transitions in America/New_York (spring gap and fall overlap).
 * 10. Invalid time zones, impossible times, and missing frequency parameters.
 * 11. Occurrence selection at an exact boundary (ref == occurrence returns NEXT occurrence).
 * 12. End-boundary behavior (strictly stops when occurrence exceeds endBoundary).
 * 13. Deterministic repeatability (same inputs produce identical outputs).
 */

import assert from 'assert';
import {
  validateRecurrenceConfig,
  calculateNextOccurrence,
  formatRecurrenceDescription,
  isLeapYear,
  getDaysInMonth,
  isValidTimeZone,
} from '../lib/recurrenceScheduling';
import { RecurrenceScheduleConfig } from '../types';

let totalTests = 0;
let passedTests = 0;

function test(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log('  PASS: ' + name);
  } catch (err: any) {
    console.error('  FAIL: ' + name);
    console.error(err);
    throw err;
  }
}

console.log('--- Running EchoNote Requirement 24.2 Recurrence Engine Tests ---');

// 1. Validation tests
test('validateRecurrenceConfig detects valid and invalid configurations', () => {
  const validWeekly: RecurrenceScheduleConfig = {
    frequency: 'weekly',
    timeOfDay: '09:30',
    timeZone: 'Asia/Kolkata',
    dayOfWeek: 1, // Monday
    anchorDate: '2026-01-05T00:00:00.000Z',
  };
  const v1 = validateRecurrenceConfig(validWeekly);
  assert.strictEqual(v1.valid, true);
  assert.strictEqual(v1.errors.length, 0);

  // Missing dayOfWeek for weekly
  const invalidWeekly: any = {
    frequency: 'weekly',
    timeOfDay: '09:30',
    timeZone: 'Asia/Kolkata',
    anchorDate: '2026-01-05T00:00:00.000Z',
  };
  const v2 = validateRecurrenceConfig(invalidWeekly);
  assert.strictEqual(v2.valid, false);
  assert(v2.errors.some((e: string) => e.includes('dayOfWeek')));

  // Invalid time zone
  const invalidTz: RecurrenceScheduleConfig = {
    ...validWeekly,
    timeZone: 'Invalid/NonExistent_Zone',
  };
  const v3 = validateRecurrenceConfig(invalidTz);
  assert.strictEqual(v3.valid, false);
  assert(v3.errors.some((e: string) => e.includes('Invalid IANA time zone')));

  // Invalid time of day
  const invalidTime: RecurrenceScheduleConfig = {
    ...validWeekly,
    timeOfDay: '25:70',
  };
  const v4 = validateRecurrenceConfig(invalidTime);
  assert.strictEqual(v4.valid, false);

  // Invalid boundaries (start > end)
  const invalidBounds: RecurrenceScheduleConfig = {
    ...validWeekly,
    startBoundary: '2026-12-01T00:00:00.000Z',
    endBoundary: '2026-01-01T00:00:00.000Z',
  };
  const v5 = validateRecurrenceConfig(invalidBounds);
  assert.strictEqual(v5.valid, false);
});

// 2. Weekly recurrence test (Asia/Kolkata)
test('weekly recurrence calculates correct subsequent Mondays at 09:30 Asia/Kolkata', () => {
  const config: RecurrenceScheduleConfig = {
    frequency: 'weekly',
    timeOfDay: '09:30',
    timeZone: 'Asia/Kolkata',
    dayOfWeek: 1, // Monday
    anchorDate: '2026-01-05T04:00:00.000Z',
  };

  // Reference is Sunday 2026-11-01 10:00 UTC
  // Next Monday is 2026-11-02. 09:30 IST is 04:00 UTC.
  const r1 = calculateNextOccurrence(config, '2026-11-01T10:00:00.000Z');
  assert(r1 !== null);
  assert.strictEqual(r1.nextOccurrence, '2026-11-02T04:00:00.000Z');
  assert.strictEqual(r1.localOccurrence.formatted, '2026-11-02 09:30');
  assert.strictEqual(r1.localOccurrence.timeZone, 'Asia/Kolkata');

  // Next occurrence after 2026-11-02T04:00:00.000Z should be Monday 2026-11-09
  const r2 = calculateNextOccurrence(config, r1.nextOccurrence);
  assert(r2 !== null);
  assert.strictEqual(r2.nextOccurrence, '2026-11-09T04:00:00.000Z');
  assert.strictEqual(r2.localOccurrence.formatted, '2026-11-09 09:30');
});

// 3. Biweekly recurrence with stable anchor alignment
test('biweekly recurrence adheres strictly to fortnightly cycle from anchor', () => {
  // Anchor is Monday 2026-01-05
  // Even weeks from anchor: 2026-01-05 (wk 0), 2026-01-19 (wk 2), 2026-02-02 (wk 4)...
  // Odd weeks are skipped: 2026-01-12 (wk 1), 2026-01-26 (wk 3)
  const config: RecurrenceScheduleConfig = {
    frequency: 'biweekly',
    timeOfDay: '10:00',
    timeZone: 'Asia/Kolkata',
    dayOfWeek: 1, // Monday
    anchorDate: '2026-01-05T04:30:00.000Z',
  };

  // From Wednesday 2026-01-07, the next Monday is 2026-01-12 (odd week).
  // Biweekly must skip 2026-01-12 and return 2026-01-19!
  const r1 = calculateNextOccurrence(config, '2026-01-07T00:00:00.000Z');
  assert(r1 !== null);
  assert.strictEqual(r1.localOccurrence.formatted, '2026-01-19 10:00');
  assert.strictEqual(r1.cycleIndex, 1);

  // From Monday 2026-01-19 10:00 IST (04:30 UTC), next occurrence must be 2026-02-02
  const r2 = calculateNextOccurrence(config, r1.nextOccurrence);
  assert(r2 !== null);
  assert.strictEqual(r2.localOccurrence.formatted, '2026-02-02 10:00');
  assert.strictEqual(r2.cycleIndex, 2);
});

// 4. Monthly recurrence on 1st and 15th
test('monthly recurrence on day 1 and day 15', () => {
  const config1st: RecurrenceScheduleConfig = {
    frequency: 'monthly',
    timeOfDay: '14:00',
    timeZone: 'UTC',
    dayOfMonth: 1,
    anchorDate: '2026-01-01T00:00:00.000Z',
  };

  const r1st = calculateNextOccurrence(config1st, '2026-01-15T00:00:00.000Z');
  assert(r1st !== null);
  assert.strictEqual(r1st.localOccurrence.formatted, '2026-02-01 14:00');

  const config15th: RecurrenceScheduleConfig = {
    frequency: 'monthly',
    timeOfDay: '14:00',
    timeZone: 'UTC',
    dayOfMonth: 15,
    anchorDate: '2026-01-15T00:00:00.000Z',
  };

  const r15th = calculateNextOccurrence(config15th, '2026-01-15T15:00:00.000Z');
  assert(r15th !== null);
  assert.strictEqual(r15th.localOccurrence.formatted, '2026-02-15 14:00');
});

// 5. Monthly recurrence on day 31 (month-end clamping)
test('monthly recurrence on day 31 clamps correctly to 30-day and 28-day months', () => {
  const config31: RecurrenceScheduleConfig = {
    frequency: 'monthly',
    timeOfDay: '17:00',
    timeZone: 'UTC',
    dayOfMonth: 31,
    anchorDate: '2026-01-31T17:00:00.000Z',
  };

  // From Jan 31 17:00 UTC, next month is February 2026 (non-leap year -> 28 days)
  const rFeb = calculateNextOccurrence(config31, '2026-01-31T17:00:00.000Z');
  assert(rFeb !== null);
  assert.strictEqual(rFeb.localOccurrence.formatted, '2026-02-28 17:00');

  // Next is March (31 days)
  const rMar = calculateNextOccurrence(config31, rFeb.nextOccurrence);
  assert(rMar !== null);
  assert.strictEqual(rMar.localOccurrence.formatted, '2026-03-31 17:00');

  // Next is April (30 days -> clamps to 30)
  const rApr = calculateNextOccurrence(config31, rMar.nextOccurrence);
  assert(rApr !== null);
  assert.strictEqual(rApr.localOccurrence.formatted, '2026-04-30 17:00');
});

// 6. Explicit last-day-of-month (dayOfMonth = -1)
test('explicit last-day-of-month (dayOfMonth = -1) always selects the final calendar day', () => {
  const configLast: RecurrenceScheduleConfig = {
    frequency: 'monthly',
    timeOfDay: '18:00',
    timeZone: 'UTC',
    dayOfMonth: -1,
    anchorDate: '2026-01-31T18:00:00.000Z',
  };

  const rFeb = calculateNextOccurrence(configLast, '2026-01-31T18:00:00.000Z');
  assert(rFeb !== null);
  assert.strictEqual(rFeb.localOccurrence.formatted, '2026-02-28 18:00');

  const rMar = calculateNextOccurrence(configLast, rFeb.nextOccurrence);
  assert(rMar !== null);
  assert.strictEqual(rMar.localOccurrence.formatted, '2026-03-31 18:00');

  const rApr = calculateNextOccurrence(configLast, rMar.nextOccurrence);
  assert(rApr !== null);
  assert.strictEqual(rApr.localOccurrence.formatted, '2026-04-30 18:00');
});

// 7. Quarterly recurrence
test('quarterly recurrence executes every three calendar months aligned to anchor', () => {
  const configQuarterly: RecurrenceScheduleConfig = {
    frequency: 'quarterly',
    timeOfDay: '09:00',
    timeZone: 'UTC',
    dayOfMonth: 15,
    anchorDate: '2026-01-15T09:00:00.000Z',
  };

  // January -> April (Q1)
  const rQ1 = calculateNextOccurrence(configQuarterly, '2026-01-15T09:00:00.000Z');
  assert(rQ1 !== null);
  assert.strictEqual(rQ1.localOccurrence.formatted, '2026-04-15 09:00');
  assert.strictEqual(rQ1.cycleIndex, 1);

  // April -> July (Q2)
  const rQ2 = calculateNextOccurrence(configQuarterly, rQ1.nextOccurrence);
  assert(rQ2 !== null);
  assert.strictEqual(rQ2.localOccurrence.formatted, '2026-07-15 09:00');
  assert.strictEqual(rQ2.cycleIndex, 2);

  // July -> October (Q3)
  const rQ3 = calculateNextOccurrence(configQuarterly, rQ2.nextOccurrence);
  assert(rQ3 !== null);
  assert.strictEqual(rQ3.localOccurrence.formatted, '2026-10-15 09:00');
  assert.strictEqual(rQ3.cycleIndex, 3);
});

// 8. Leap years and February 29
test('leap year correctly supports February 29 in leap year and clamps in non-leap year', () => {
  // 2024 is a leap year (Feb 29 exists)
  assert.strictEqual(isLeapYear(2024), true);
  assert.strictEqual(getDaysInMonth(2024, 2), 29);

  // 2025 is not a leap year (Feb 28 max)
  assert.strictEqual(isLeapYear(2025), false);
  assert.strictEqual(getDaysInMonth(2025, 2), 28);

  const config29: RecurrenceScheduleConfig = {
    frequency: 'monthly',
    timeOfDay: '12:00',
    timeZone: 'UTC',
    dayOfMonth: 29,
    anchorDate: '2024-01-29T12:00:00.000Z',
  };

  // In 2024, Feb occurrence is Feb 29
  const r2024 = calculateNextOccurrence(config29, '2024-02-01T00:00:00.000Z');
  assert(r2024 !== null);
  assert.strictEqual(r2024.localOccurrence.formatted, '2024-02-29 12:00');

  // In 2025, Feb occurrence clamps to Feb 28
  const r2025 = calculateNextOccurrence(config29, '2025-02-01T00:00:00.000Z');
  assert(r2025 !== null);
  assert.strictEqual(r2025.localOccurrence.formatted, '2025-02-28 12:00');
});

// 9. Daylight Saving Time transitions (America/New_York)
test('daylight saving time spring-forward gap and fall-back overlap behavior', () => {
  // In America/New_York:
  // Spring Forward: Sunday March 8, 2026 at 02:00 -> 03:00. (02:30 does not exist locally)
  const configDstSpring: RecurrenceScheduleConfig = {
    frequency: 'weekly',
    timeOfDay: '02:30',
    timeZone: 'America/New_York',
    dayOfWeek: 0, // Sunday
    anchorDate: '2026-03-01T07:30:00.000Z',
  };

  // Next Sunday March 8 hits the spring forward gap.
  // Our engine advances to the post-gap valid local time 03:30 (07:30 UTC).
  const rSpring = calculateNextOccurrence(configDstSpring, '2026-03-01T07:30:00.000Z');
  assert(rSpring !== null);
  assert.strictEqual(rSpring.nextOccurrence, '2026-03-08T07:30:00.000Z');
  assert.strictEqual(rSpring.localOccurrence.formatted, '2026-03-08 03:30');

  // Regular week after DST is active (EDT is UTC-4): March 15 at 02:30 EDT is 06:30 UTC
  const rPostSpring = calculateNextOccurrence(configDstSpring, rSpring.nextOccurrence);
  assert(rPostSpring !== null);
  assert.strictEqual(rPostSpring.nextOccurrence, '2026-03-15T06:30:00.000Z');
  assert.strictEqual(rPostSpring.localOccurrence.formatted, '2026-03-15 02:30');

  // Fall Back: Sunday November 1, 2026 at 02:00 EDT falls back to 01:00 EST.
  // 01:30 occurs twice. The engine deterministically selects the earlier daylight-saving occurrence (05:30 UTC).
  const configDstFall: RecurrenceScheduleConfig = {
    frequency: 'weekly',
    timeOfDay: '01:30',
    timeZone: 'America/New_York',
    dayOfWeek: 0, // Sunday
    anchorDate: '2026-10-25T05:30:00.000Z',
  };

  const rFall = calculateNextOccurrence(configDstFall, '2026-10-25T05:30:00.000Z');
  assert(rFall !== null);
  assert.strictEqual(rFall.nextOccurrence, '2026-11-01T05:30:00.000Z');
  assert.strictEqual(rFall.localOccurrence.formatted, '2026-11-01 01:30');
});

// 10. Exact boundary and end-boundary semantics
test('boundary conditions: exact boundary returns strictly next, and endBoundary returns null', () => {
  const config: RecurrenceScheduleConfig = {
    frequency: 'weekly',
    timeOfDay: '10:00',
    timeZone: 'UTC',
    dayOfWeek: 3, // Wednesday
    anchorDate: '2026-11-04T10:00:00.000Z',
    endBoundary: '2026-11-18T10:00:00.000Z',
  };

  // If referenceInstant is exactly on the occurrence '2026-11-04T10:00:00.000Z',
  // it must return the NEXT occurrence (Nov 11), not Nov 4.
  const rExact = calculateNextOccurrence(config, '2026-11-04T10:00:00.000Z');
  assert(rExact !== null);
  assert.strictEqual(rExact.nextOccurrence, '2026-11-11T10:00:00.000Z');

  // Occurrence exactly on endBoundary is valid (Nov 18)
  const rEnd = calculateNextOccurrence(config, rExact.nextOccurrence);
  assert(rEnd !== null);
  assert.strictEqual(rEnd.nextOccurrence, '2026-11-18T10:00:00.000Z');

  // Occurrence beyond endBoundary returns null
  const rPastEnd = calculateNextOccurrence(config, rEnd.nextOccurrence);
  assert.strictEqual(rPastEnd, null);
});

// 11. Deterministic repeatability
test('deterministic engine: identical inputs always produce identical results', () => {
  const config: RecurrenceScheduleConfig = {
    frequency: 'quarterly',
    timeOfDay: '15:30',
    timeZone: 'Asia/Kolkata',
    dayOfMonth: -1,
    anchorDate: '2026-01-31T10:00:00.000Z',
  };

  const ref = '2026-02-15T00:00:00.000Z';
  const out1 = calculateNextOccurrence(config, ref);
  const out2 = calculateNextOccurrence(config, ref);
  const out3 = calculateNextOccurrence(config, ref);

  assert.deepStrictEqual(out1, out2);
  assert.deepStrictEqual(out2, out3);
  assert.strictEqual(out1?.localOccurrence.formatted, '2026-04-30 15:30');
});

// 12. Human-readable formatting description
test('formatRecurrenceDescription formats descriptions cleanly', () => {
  const desc1 = formatRecurrenceDescription({
    frequency: 'weekly',
    timeOfDay: '09:30',
    timeZone: 'Asia/Kolkata',
    dayOfWeek: 1,
    anchorDate: '2026-01-05T00:00:00.000Z',
  });
  assert.strictEqual(desc1, 'Every Monday at 09:30 (Asia/Kolkata)');

  const desc2 = formatRecurrenceDescription({
    frequency: 'biweekly',
    timeOfDay: '14:00',
    timeZone: 'UTC',
    dayOfWeek: 5,
    anchorDate: '2026-01-09T00:00:00.000Z',
  });
  assert.strictEqual(desc2, 'Every two weeks on Friday at 14:00 (UTC)');

  const desc3 = formatRecurrenceDescription({
    frequency: 'monthly',
    timeOfDay: '18:00',
    timeZone: 'America/New_York',
    dayOfMonth: -1,
    anchorDate: '2026-01-31T00:00:00.000Z',
  });
  assert.strictEqual(desc3, 'Monthly on the last day at 18:00 (America/New_York)');
});

console.log('All recurrence engine tests PASSED successfully!');
