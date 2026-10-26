/** CSS class for a mood value (0..100): colours the dots and bars. */
export function moodClass(mood: number): string {
  if (mood >= 65) return 'mood-good';
  if (mood >= 45) return 'mood-ok';
  if (mood >= 30) return 'mood-low';
  return 'mood-bad';
}
