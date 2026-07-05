
export interface RenewalDisplay {
  dateString: string;
  relativeString: string;
}

/**
 * Calculates and formats the subscription renewal display strings.
 * 
 * @param renewalDate The date of renewal (Date object, ISO string, or timestamp)
 * @returns An object containing the formatted date string and relative time string
 */
export function getRenewalDisplay(renewalDate: Date | string | number | null | undefined): RenewalDisplay {
  if (!renewalDate) {
    return {
      dateString: 'No active plan',
      relativeString: ''
    };
  }

  const renewal = new Date(renewalDate);
  // Check for invalid date
  if (isNaN(renewal.getTime())) {
    return {
      dateString: 'No active plan',
      relativeString: ''
    };
  }

  const now = new Date();
  
  // Reset time to midnight for accurate day comparison
  const renewalMidnight = new Date(renewal.getFullYear(), renewal.getMonth(), renewal.getDate());
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  const diffTime = renewalMidnight.getTime() - nowMidnight.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // Format: "1 May 2026"
  const day = renewal.getDate();
  const month = renewal.toLocaleString('en-GB', { month: 'short' });
  const year = renewal.getFullYear();
  const formattedDate = `${day} ${month} ${year}`;

  if (diffDays < 0) {
    return {
      dateString: 'Expired',
      relativeString: 'renew now'
    };
  }

  if (diffDays === 0) {
    return {
      dateString: 'Renews today',
      relativeString: ''
    };
  }

  return {
    dateString: `Renews on ${formattedDate}`,
    relativeString: `in ${diffDays} day${diffDays === 1 ? '' : 's'}`
  };
}
