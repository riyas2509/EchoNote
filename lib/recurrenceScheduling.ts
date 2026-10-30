/**
 * EchoNote Requirement 24.2 - Recurrence Scheduling Calendar Engine
 *
 * Provides deterministic, timezone-aware recurrence validation and next-occurrence calculation.
 * Supports weekly, biweekly (fortnightly), monthly, and quarterly schedules.
 * Handles leap years, month-end clamps, explicit last-day-of-month, and DST transitions cleanly.
 */

import {
  RecurrenceFrequency,
  RecurrenceScheduleConfig,
  RecurrenceValidationResult,
  NextOccurrenceResult,
} from '../types';

export const VALID_FREQUENCIES: readonly RecurrenceFrequency[] = [
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
] as const;

const DAYS_IN_MONTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Checks whether a given calendar year is a leap year.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Returns the maximum number of days in the specified year and month (1-12).
 */
export function getDaysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return DAYS_IN_MONTHS[month - 1];
}

/**
 * Validates an IANA time zone identifier using Intl.DateTimeFormat.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parses 'HH:mm' time string into numbers { hour, minute }.
 */
export function parseTimeOfDay(timeOfDay: string): { hour: number; minute: number } | null {
  if (!timeOfDay || typeof timeOfDay !== 'string') return null;
  const match = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/.exec(timeOfDay.trim());
  if (!match) return null;
  return {
    hour: parseInt(match[1], 10),
    minute: parseInt(match[2], 10),
  };
}

/**
 * Breaks a Date into its local calendar components in the target IANA time zone.
 */
export function getZonedDateParts(
  date: Date,
  timeZone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number; // 0 = Sun, 1 = Mon, ..., 6 = Sat
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: parseInt(partMap.year, 10),
    month: parseInt(partMap.month, 10),
    day: parseInt(partMap.day, 10),
    hour: parseInt(partMap.hour, 10),
    minute: parseInt(partMap.minute, 10),
    second: parseInt(partMap.second, 10),
    dayOfWeek: weekdayMap[partMap.weekday] ?? 0,
  };
}

/**
 * Converts a target local calendar time in a specific time zone to a UTC Date.
 * Handles DST gaps (spring forward) by advancing to the post-transition valid local time,
 * and DST overlaps (fall back) by deterministically selecting the earlier (daylight-saving) instant.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 3; i++) {
    const parts = getZonedDateParts(new Date(guess), timeZone);
    const guessAsLocal = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const targetAsLocal = Date.UTC(year, month - 1, day, hour, minute, second);
    const diff = targetAsLocal - guessAsLocal;
    if (diff === 0) break;
    guess += diff;
  }

  // Check for ambiguous time (fall back overlap: check if guess - 1 hour is also the target local time)
  const earlierCandidate = new Date(guess - 3600000);
  const earlierParts = getZonedDateParts(earlierCandidate, timeZone);
  if (
    earlierParts.year === year &&
    earlierParts.month === month &&
    earlierParts.day === day &&
    earlierParts.hour === hour &&
    earlierParts.minute === minute
  ) {
    return earlierCandidate;
  }

  return new Date(guess);
}

/**
 * Converts local (year, month, day) to a continuous day counter (days since Unix epoch).
 */
export function localDateToDayNumber(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function formatLocalDate(year: number, month: number, day: number, hour: number, minute: number): string {
  const y = String(year);
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  const h = String(hour).padStart(2, '0');
  const min = String(minute).padStart(2, '0');
  return y + '-' + m + '-' + d + ' ' + h + ':' + min;
}

/**
 * Validates a recurrence schedule configuration.
 */
export function validateRecurrenceConfig(config: RecurrenceScheduleConfig): RecurrenceValidationResult {
  const errors: string[] = [];

  if (!config) {
    return { valid: false, errors: ['Configuration is required'] };
  }

  // Validate frequency
  if (!config.frequency || !VALID_FREQUENCIES.includes(config.frequency)) {
    errors.push('Invalid recurrence frequency. Must be one of: ' + VALID_FREQUENCIES.join(', '));
  }

  // Validate timeZone
  if (!config.timeZone || !isValidTimeZone(config.timeZone)) {
    errors.push('Invalid IANA time zone: ' + JSON.stringify(config.timeZone));
  }

  // Validate timeOfDay
  if (!config.timeOfDay || !parseTimeOfDay(config.timeOfDay)) {
    errors.push('Invalid timeOfDay: ' + JSON.stringify(config.timeOfDay) + '. Must be in 24-hour HH:mm format (00:00 - 23:59)');
  }

  // Validate anchorDate
  if (!config.anchorDate) {
    errors.push('anchorDate is required for recurrence alignment');
  } else {
    const anchor = new Date(config.anchorDate);
    if (isNaN(anchor.getTime())) {
      errors.push('Invalid anchorDate: ' + JSON.stringify(config.anchorDate) + '. Must be a valid ISO 8601 or YYYY-MM-DD string');
    }
  }

  // Validate frequency-specific day requirements
  if (config.frequency === 'weekly' || config.frequency === 'biweekly') {
    if (config.dayOfWeek === undefined || config.dayOfWeek === null) {
      errors.push('dayOfWeek (0-6, Sunday-Saturday) is required for frequency ' + JSON.stringify(config.frequency));
    } else if (!Number.isInteger(config.dayOfWeek) || config.dayOfWeek < 0 || config.dayOfWeek > 6) {
      errors.push('dayOfWeek must be an integer between 0 (Sunday) and 6 (Saturday). Received: ' + config.dayOfWeek);
    }
  }

  if (config.frequency === 'monthly' || config.frequency === 'quarterly') {
    if (config.dayOfMonth === undefined || config.dayOfMonth === null) {
      errors.push('dayOfMonth (1-31, or -1 for last day) is required for frequency ' + JSON.stringify(config.frequency));
    } else if (!Number.isInteger(config.dayOfMonth) || (config.dayOfMonth !== -1 && (config.dayOfMonth < 1 || config.dayOfMonth > 31))) {
      errors.push('dayOfMonth must be an integer between 1 and 31, or -1 for last day of month. Received: ' + config.dayOfMonth);
    }
  }

  // Validate startBoundary and endBoundary
  let startMs: number | null = null;
  let endMs: number | null = null;

  if (config.startBoundary) {
    const start = new Date(config.startBoundary);
    if (isNaN(start.getTime())) {
      errors.push('Invalid startBoundary: ' + JSON.stringify(config.startBoundary));
    } else {
      startMs = start.getTime();
    }
  }

  if (config.endBoundary) {
    const end = new Date(config.endBoundary);
    if (isNaN(end.getTime())) {
      errors.push('Invalid endBoundary: ' + JSON.stringify(config.endBoundary));
    } else {
      endMs = end.getTime();
    }
  }

  if (startMs !== null && endMs !== null && startMs > endMs) {
    errors.push('startBoundary must be before or equal to endBoundary');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Calculates the next occurrence strictly after referenceInstant that satisfies config.
 * Deterministic and respects local time, time zone, boundaries, leap years, and DST.
 * Returns null if no occurrence exists or if next occurrence exceeds endBoundary.
 */
export function calculateNextOccurrence(
  config: RecurrenceScheduleConfig,
  referenceInstant: Date | string
): NextOccurrenceResult | null {
  const validation = validateRecurrenceConfig(config);
  if (!validation.valid) {
    throw new Error('Invalid recurrence configuration: ' + validation.errors.join('; '));
  }

  const refDate = typeof referenceInstant === 'string' ? new Date(referenceInstant) : referenceInstant;
  if (isNaN(refDate.getTime())) {
    throw new Error('Invalid referenceInstant: ' + JSON.stringify(referenceInstant));
  }

  const parsedTime = parseTimeOfDay(config.timeOfDay)!;
  const timeZone = config.timeZone;
  const anchorDateObj = new Date(config.anchorDate);
  const anchorParts = getZonedDateParts(anchorDateObj, timeZone);
  const anchorDayNum = localDateToDayNumber(anchorParts.year, anchorParts.month, anchorParts.day);
  const anchorSunday = anchorDayNum - anchorParts.dayOfWeek;

  const startBoundaryMs = config.startBoundary ? new Date(config.startBoundary).getTime() : null;
  const endBoundaryMs = config.endBoundary ? new Date(config.endBoundary).getTime() : null;

  const refParts = getZonedDateParts(refDate, timeZone);

  // If frequency is weekly or biweekly:
  if (config.frequency === 'weekly' || config.frequency === 'biweekly') {
    const targetDayOfWeek = config.dayOfWeek!;
    const maxDaysToScan = 365 * 5; // 5 years

    for (let dayOffset = 0; dayOffset <= maxDaysToScan; dayOffset++) {
      const candDayNum = localDateToDayNumber(refParts.year, refParts.month, refParts.day) + dayOffset;
      const dateFromDayNum = new Date(candDayNum * 86400000);
      const year = dateFromDayNum.getUTCFullYear();
      const month = dateFromDayNum.getUTCMonth() + 1;
      const day = dateFromDayNum.getUTCDate();
      const dayOfWeek = (candDayNum % 7 + 4) % 7; // Unix epoch 1970-01-01 was Thursday (4)

      if (dayOfWeek !== targetDayOfWeek) {
        continue;
      }

      // Check biweekly anchor alignment if biweekly
      let cycleIndex: number | undefined;
      if (config.frequency === 'biweekly') {
        const candSunday = candDayNum - dayOfWeek;
        const weekDiff = Math.floor((candSunday - anchorSunday) / 7);
        if (weekDiff % 2 !== 0) {
          continue; // Not on the aligned 2-week cycle
        }
        cycleIndex = Math.floor(weekDiff / 2);
      } else {
        const candSunday = candDayNum - dayOfWeek;
        cycleIndex = Math.floor((candSunday - anchorSunday) / 7);
      }

      // Compute occurrence instant in UTC
      const occurrenceDate = zonedTimeToUtc(
        year,
        month,
        day,
        parsedTime.hour,
        parsedTime.minute,
        0,
        timeZone
      );

      // Must be strictly after referenceInstant
      if (occurrenceDate.getTime() <= refDate.getTime()) {
        continue;
      }

      // Must be >= startBoundary if provided
      if (startBoundaryMs !== null && occurrenceDate.getTime() < startBoundaryMs) {
        continue;
      }

      // Must be <= endBoundary if provided
      if (endBoundaryMs !== null && occurrenceDate.getTime() > endBoundaryMs) {
        return null; // Exceeded end boundary
      }

      const occParts = getZonedDateParts(occurrenceDate, timeZone);
      return {
        nextOccurrence: occurrenceDate.toISOString(),
        localOccurrence: {
          year: occParts.year,
          month: occParts.month,
          day: occParts.day,
          hour: occParts.hour,
          minute: occParts.minute,
          timeZone,
          formatted: formatLocalDate(occParts.year, occParts.month, occParts.day, occParts.hour, occParts.minute),
        },
        cycleIndex,
      };
    }

    return null;
  }

  // Monthly or Quarterly
  if (config.frequency === 'monthly' || config.frequency === 'quarterly') {
    const targetDay = config.dayOfMonth!;
    const maxMonthsToScan = 12 * 5; // 5 years

    for (let mOffset = 0; mOffset <= maxMonthsToScan; mOffset++) {
      let scanYear = refParts.year;
      let scanMonth = refParts.month + mOffset;
      while (scanMonth > 12) {
        scanMonth -= 12;
        scanYear += 1;
      }

      const totalMonthsFromAnchor = (scanYear - anchorParts.year) * 12 + (scanMonth - anchorParts.month);

      if (config.frequency === 'quarterly') {
        if (totalMonthsFromAnchor % 3 !== 0) {
          continue; // Not an aligned quarterly month
        }
      }

      // Resolve calendar day for this month
      const maxDaysInMonth = getDaysInMonth(scanYear, scanMonth);
      let resolvedDay: number;
      if (targetDay === -1) {
        resolvedDay = maxDaysInMonth; // Explicit last day of month
      } else {
        // Target day clamped to month maximum (e.g. 31 in April becomes 30)
        resolvedDay = Math.min(targetDay, maxDaysInMonth);
      }

      const occurrenceDate = zonedTimeToUtc(
        scanYear,
        scanMonth,
        resolvedDay,
        parsedTime.hour,
        parsedTime.minute,
        0,
        timeZone
      );

      // Must be strictly after referenceInstant
      if (occurrenceDate.getTime() <= refDate.getTime()) {
        continue;
      }

      // Must be >= startBoundary if provided
      if (startBoundaryMs !== null && occurrenceDate.getTime() < startBoundaryMs) {
        continue;
      }

      // Must be <= endBoundary if provided
      if (endBoundaryMs !== null && occurrenceDate.getTime() > endBoundaryMs) {
        return null; // Exceeded end boundary
      }

      const occParts = getZonedDateParts(occurrenceDate, timeZone);
      const cycleIndex = config.frequency === 'quarterly'
        ? Math.floor(totalMonthsFromAnchor / 3)
        : totalMonthsFromAnchor;

      return {
        nextOccurrence: occurrenceDate.toISOString(),
        localOccurrence: {
          year: occParts.year,
          month: occParts.month,
          day: occParts.day,
          hour: occParts.hour,
          minute: occParts.minute,
          timeZone,
          formatted: formatLocalDate(occParts.year, occParts.month, occParts.day, occParts.hour, occParts.minute),
        },
        cycleIndex,
      };
    }

    return null;
  }

  return null;
}

/**
 * Returns a human-readable description of a recurrence schedule.
 */
export function formatRecurrenceDescription(config: RecurrenceScheduleConfig): string {
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  let scheduleText = '';
  switch (config.frequency) {
    case 'weekly':
      scheduleText = 'Every ' + (weekdayNames[config.dayOfWeek ?? 0]) + ' at ' + config.timeOfDay;
      break;
    case 'biweekly':
      scheduleText = 'Every two weeks on ' + (weekdayNames[config.dayOfWeek ?? 0]) + ' at ' + config.timeOfDay;
      break;
    case 'monthly':
      if (config.dayOfMonth === -1) {
        scheduleText = 'Monthly on the last day at ' + config.timeOfDay;
      } else {
        scheduleText = 'Monthly on day ' + config.dayOfMonth + ' at ' + config.timeOfDay;
      }
      break;
    case 'quarterly':
      if (config.dayOfMonth === -1) {
        scheduleText = 'Quarterly on the last day at ' + config.timeOfDay;
      } else {
        scheduleText = 'Quarterly on day ' + config.dayOfMonth + ' at ' + config.timeOfDay;
      }
      break;
  }

  return scheduleText + ' (' + config.timeZone + ')';
}
