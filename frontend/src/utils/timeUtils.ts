import { format, formatDistanceToNow } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const EASTERN_TIMEZONE = 'America/New_York';

export function formatLeadTime(dateString: string | null): string {
  if (!dateString) return 'Not scheduled';

  try {
    const date = new Date(dateString);
    
    // Convert to Eastern timezone
    const easternTime = toZonedTime(date, EASTERN_TIMEZONE);
    
    // Format the date and time
    const formattedDate = format(easternTime, 'MMM dd, yyyy');
    const formattedTime = format(easternTime, 'h:mm a');
    
    // Calculate time ago
    const timeAgo = formatDistanceToNow(date, { addSuffix: true });
    
    return `${formattedDate} at ${formattedTime} (${timeAgo})`;
  } catch (error) {
    console.error('Error formatting lead time:', error);
    return 'Invalid date';
  }
}

export function formatScheduledTime(dateString: string | null): string {
  if (!dateString) return 'Not scheduled';

  try {
    const date = new Date(dateString);
    
    // Convert to Eastern timezone
    const easternTime = toZonedTime(date, EASTERN_TIMEZONE);
    
    // Format the date and time
    const formattedDate = format(easternTime, 'MMM dd');
    const formattedTime = format(easternTime, 'h:mm a');
    
    return `${formattedDate} at ${formattedTime}`;
  } catch (error) {
    console.error('Error formatting scheduled time:', error);
    return 'Invalid date';
  }
}

// HOURS-1: the dead getNextValidTime + its isWithinBusinessHours helper (a
// duplicate of the never-used _shared/business-hours.ts, both removed) lived
// here. The live cadence business-hours source of truth is
// trigger/_shared/businessHours.ts.