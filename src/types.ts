export type HabitMode = 'break' | 'build';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Frequency = 'daily' | 'weekly' | 'monthly';
export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export type Schedule = {
  frequency: Frequency;
  timeOfDay: string;
  weekdays?: Weekday[];
  dayOfMonth?: number;
  remindersEnabled: boolean;
};

export type HabitLogKind =
  | 'created'
  | 'relapse'
  | 'new_record'
  | 'completed'
  | 'missed'
  | 'skipped'
  | 'achievement';

export type HabitLog = {
  id: string;
  habitId: string;
  kind: HabitLogKind;
  occurredAt: string;
  value: number;
  points: number;
  note: string;
};

export type Achievement = {
  id: string;
  habitId: string;
  threshold: number;
  mode: HabitMode;
  unlockedAt: string;
};

export type Habit = {
  id: string;
  name: string;
  mode: HabitMode;
  difficulty: Difficulty;
  schedule: Schedule | null;
  challengeTarget: number | null;
  startedAt: string;
  currentRunHours: number;
  bestRecordHours: number;
  currentStreak: number;
  bestRecordStreak: number;
  score: number;
  xp: number;
  comebackBonus: number;
  notificationIds: string[];
  logs: HabitLog[];
  achievements: Achievement[];
  createdAt: string;
  updatedAt: string;
};

export type DashboardStats = {
  totalScore: number;
  totalXp: number;
  totalHabits: number;
  totalAchievements: number;
  recordHabits: number;
  bestRecordLabel: string;
  longestStreakLabel: string;
  momentumLabel: string;
};

export type DashboardData = {
  habits: Habit[];
  timeline: HabitLog[];
  stats: DashboardStats;
};
