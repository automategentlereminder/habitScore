import { Achievement, Difficulty, Frequency, Habit, HabitLog, HabitMode } from '../types';

const difficultyBoost: Record<Difficulty, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

const weekdayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const breakThresholds = [12, 24, 72, 168, 720];
export const buildThresholds = [3, 7, 14, 30, 100];

export function getDifficultyAccent(difficulty: Difficulty) {
  if (difficulty === 'easy') return '#8fff85';
  if (difficulty === 'medium') return '#55d9ff';
  return '#ff8f4a';
}

export function getDifficultyBoost(difficulty: Difficulty) {
  return difficultyBoost[difficulty];
}

export function computeLevelFromXp(xp: number) {
  return Math.max(1, Math.floor(Math.sqrt(xp / 12)) + 1);
}

export function getLevelProgress(xp: number) {
  const level = computeLevelFromXp(xp);
  const previousLevelFloor = Math.pow(level - 1, 2) * 12;
  const nextLevelFloor = Math.pow(level, 2) * 12;
  const delta = nextLevelFloor - previousLevelFloor;
  return Math.max(0, Math.min(100, Math.round(((xp - previousLevelFloor) / delta) * 100)));
}

export function calculateCurrentRunHours(startedAt: string) {
  const diff = Date.now() - new Date(startedAt).getTime();
  return Math.max(0, Number((diff / (1000 * 60 * 60)).toFixed(1)));
}

export function getBreakProgressPercent(current: number, record: number) {
  if (record <= 0) return current > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((current / record) * 100)));
}

export function getBuildProgressPercent(current: number, record: number) {
  if (record <= 0) return current > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((current / record) * 100)));
}

export function getHabitHeadline(habit: Habit) {
  return habit.mode === 'break' ? 'Beat your clean run record' : 'Protect the streak and push the best';
}

export function getHabitStatLine(habit: Habit) {
  if (habit.mode === 'break') {
    return `Current ${habit.currentRunHours.toFixed(1)}h  •  Best ${habit.bestRecordHours.toFixed(1)}h`;
  }

  return `Current ${habit.currentStreak}  •  Best ${habit.bestRecordStreak}`;
}

export function getChallengeText(habit: Habit) {
  if (!habit.challengeTarget) return 'Open challenge';
  return habit.mode === 'break' ? `${habit.challengeTarget}h quest` : `${habit.challengeTarget} streak quest`;
}

export function getFrequencyLabel(frequency: Frequency) {
  if (frequency === 'daily') return 'Daily';
  if (frequency === 'weekly') return 'Weekly';
  return 'Monthly';
}

export function getAchievementThresholds(mode: HabitMode) {
  return mode === 'break' ? breakThresholds : buildThresholds;
}

export function buildAchievementLabel(achievement: Achievement) {
  if (achievement.mode === 'break') {
    if (achievement.threshold >= 720) return 'First month';
    if (achievement.threshold >= 168) return 'First week';
    if (achievement.threshold >= 72) return 'First 3 days';
    return `First ${achievement.threshold} hours`;
  }

  return `${achievement.threshold} streak`;
}

export function getEventLabel(event: HabitLog) {
  switch (event.kind) {
    case 'created':
      return `Challenge created: ${event.note}`;
    case 'relapse':
      return `Collapse logged: ${event.note}`;
    case 'new_record':
      return `New record: ${event.note}`;
    case 'completed':
      return `Completed: ${event.note}`;
    case 'missed':
      return `Missed: ${event.note}`;
    case 'skipped':
      return `Delayed reminder: ${event.note}`;
    case 'achievement':
      return `Achievement unlocked: ${event.note}`;
    default:
      return event.note;
  }
}

export function formatRelativeTime(dateString: string) {
  const diff = Date.now() - new Date(dateString).getTime();
  const minutes = Math.floor(diff / (1000 * 60));

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function isNearMiss(habit: Habit) {
  if (habit.mode !== 'break' || habit.logs.length === 0) return false;

  const latestRelapse = habit.logs.find((entry) => entry.kind === 'relapse');
  if (!latestRelapse || habit.bestRecordHours <= 0) return false;

  return latestRelapse.value >= habit.bestRecordHours * 0.85;
}

export function computeNearMissHours(runHours: number, bestRecordHours: number) {
  if (bestRecordHours <= 0 || runHours >= bestRecordHours) return 0;
  const delta = bestRecordHours - runHours;
  return delta <= Math.max(3, bestRecordHours * 0.15) ? Number(delta.toFixed(1)) : 0;
}

export function getTodayScore(logs: HabitLog[]) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  return logs
    .filter((entry) => new Date(entry.occurredAt).getTime() >= start.getTime())
    .reduce((sum, entry) => sum + entry.points, 0);
}

export function getWeekdayIndex(weekday: string) {
  return weekdayMap.findIndex((value) => value === weekday) + 1;
}
