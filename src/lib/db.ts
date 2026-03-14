import * as SQLite from 'expo-sqlite';
import { Achievement, DashboardData, Habit, HabitLog, HabitMode, Schedule } from '../types';
import {
  calculateCurrentRunHours,
  computeNearMissHours,
  getAchievementThresholds,
  getDifficultyBoost,
} from './game';

const dbPromise = SQLite.openDatabaseAsync('habitscore.db');

type HabitRow = {
  id: string;
  name: string;
  mode: HabitMode;
  difficulty: 'easy' | 'medium' | 'hard';
  schedule_json: string | null;
  challenge_target: number | null;
  started_at: string;
  best_record_hours: number;
  current_streak: number;
  best_record_streak: number;
  score: number;
  xp: number;
  comeback_bonus: number;
  notification_ids_json: string | null;
  created_at: string;
  updated_at: string;
};

type HabitLogRow = {
  id: string;
  habit_id: string;
  kind: HabitLog['kind'];
  occurred_at: string;
  value: number;
  points: number;
  note: string;
};

type AchievementRow = {
  id: string;
  habit_id: string;
  achievement_id: string;
  threshold: number;
  mode: HabitMode;
  unlocked_at: string;
};

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function initializeDatabase() {
  const db = await dbPromise;

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      schedule_json TEXT,
      challenge_target INTEGER,
      started_at TEXT NOT NULL,
      best_record_hours REAL NOT NULL DEFAULT 0,
      current_streak INTEGER NOT NULL DEFAULT 0,
      best_record_streak INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      xp INTEGER NOT NULL DEFAULT 0,
      comeback_bonus INTEGER NOT NULL DEFAULT 0,
      notification_ids_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS habit_logs (
      id TEXT PRIMARY KEY NOT NULL,
      habit_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      value REAL NOT NULL DEFAULT 0,
      points INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS achievement_unlocks (
      id TEXT PRIMARY KEY NOT NULL,
      habit_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      threshold INTEGER NOT NULL,
      mode TEXT NOT NULL,
      unlocked_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS score_events (
      id TEXT PRIMARY KEY NOT NULL,
      habit_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      points INTEGER NOT NULL
    );
  `);
}

export async function seedSampleData() {
  const db = await dbPromise;
  const count = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM habits');

  if ((count?.count ?? 0) > 0) return;

  const now = Date.now();
  const smokingId = createId('habit');
  const gymId = createId('habit');
  const meditateId = createId('habit');

  await db.runAsync(
    `INSERT INTO habits (
      id, name, mode, difficulty, schedule_json, challenge_target, started_at,
      best_record_hours, current_streak, best_record_streak, score, xp, comeback_bonus,
      notification_ids_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      smokingId,
      'Smoking',
      'break',
      'hard',
      null,
      72,
      new Date(now - 18 * 60 * 60 * 1000).toISOString(),
      48,
      0,
      0,
      3,
      54,
      0,
      JSON.stringify([]),
      new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
      new Date().toISOString(),
    ],
  );

  await db.runAsync(
    `INSERT INTO habits (
      id, name, mode, difficulty, schedule_json, challenge_target, started_at,
      best_record_hours, current_streak, best_record_streak, score, xp, comeback_bonus,
      notification_ids_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      gymId,
      'Gym',
      'build',
      'medium',
      JSON.stringify({
        frequency: 'weekly',
        timeOfDay: '06:30',
        weekdays: ['Mon', 'Wed', 'Fri'],
        remindersEnabled: true,
      } satisfies Schedule),
      14,
      new Date(now - 16 * 24 * 60 * 60 * 1000).toISOString(),
      0,
      6,
      12,
      4,
      44,
      0,
      JSON.stringify([]),
      new Date(now - 18 * 24 * 60 * 60 * 1000).toISOString(),
      new Date().toISOString(),
    ],
  );

  await db.runAsync(
    `INSERT INTO habits (
      id, name, mode, difficulty, schedule_json, challenge_target, started_at,
      best_record_hours, current_streak, best_record_streak, score, xp, comeback_bonus,
      notification_ids_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      meditateId,
      'Meditation',
      'build',
      'easy',
      JSON.stringify({
        frequency: 'daily',
        timeOfDay: '21:00',
        remindersEnabled: true,
      } satisfies Schedule),
      30,
      new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
      0,
      2,
      7,
      2,
      18,
      0,
      JSON.stringify([]),
      new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
      new Date().toISOString(),
    ],
  );

  const seedLogs: HabitLogRow[] = [
    {
      id: createId('log'),
      habit_id: smokingId,
      kind: 'created',
      occurred_at: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
      value: 0,
      points: 0,
      note: 'Smoking',
    },
    {
      id: createId('log'),
      habit_id: smokingId,
      kind: 'new_record',
      occurred_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
      value: 48,
      points: 10,
      note: 'Reached 48h clean',
    },
    {
      id: createId('log'),
      habit_id: gymId,
      kind: 'created',
      occurred_at: new Date(now - 18 * 24 * 60 * 60 * 1000).toISOString(),
      value: 0,
      points: 0,
      note: 'Gym',
    },
    {
      id: createId('log'),
      habit_id: gymId,
      kind: 'completed',
      occurred_at: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
      value: 6,
      points: 3,
      note: 'Protected the streak',
    },
    {
      id: createId('log'),
      habit_id: meditateId,
      kind: 'completed',
      occurred_at: new Date(now - 10 * 60 * 60 * 1000).toISOString(),
      value: 2,
      points: 2,
      note: 'Took the calm win',
    },
  ];

  for (const log of seedLogs) {
    await db.runAsync(
      'INSERT INTO habit_logs (id, habit_id, kind, occurred_at, value, points, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [log.id, log.habit_id, log.kind, log.occurred_at, log.value, log.points, log.note],
    );
  }

  const seedAchievements: AchievementRow[] = [
    {
      id: createId('achievement'),
      habit_id: smokingId,
      achievement_id: 'break_12',
      threshold: 12,
      mode: 'break',
      unlocked_at: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: createId('achievement'),
      habit_id: smokingId,
      achievement_id: 'break_24',
      threshold: 24,
      mode: 'break',
      unlocked_at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: createId('achievement'),
      habit_id: gymId,
      achievement_id: 'build_3',
      threshold: 3,
      mode: 'build',
      unlocked_at: new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: createId('achievement'),
      habit_id: gymId,
      achievement_id: 'build_7',
      threshold: 7,
      mode: 'build',
      unlocked_at: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];

  for (const achievement of seedAchievements) {
    await db.runAsync(
      `INSERT INTO achievement_unlocks (id, habit_id, achievement_id, threshold, mode, unlocked_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        achievement.id,
        achievement.habit_id,
        achievement.achievement_id,
        achievement.threshold,
        achievement.mode,
        achievement.unlocked_at,
      ],
    );
  }
}

export async function createHabit(input: {
  name: string;
  mode: HabitMode;
  difficulty: 'easy' | 'medium' | 'hard';
  schedule: Schedule | null;
  challengeTarget: number | null;
}) {
  const db = await dbPromise;
  const now = new Date().toISOString();
  const id = createId('habit');

  await db.runAsync(
    `INSERT INTO habits (
      id, name, mode, difficulty, schedule_json, challenge_target, started_at,
      best_record_hours, current_streak, best_record_streak, score, xp, comeback_bonus,
      notification_ids_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.mode,
      input.difficulty,
      input.schedule ? JSON.stringify(input.schedule) : null,
      input.challengeTarget,
      now,
      0,
      0,
      0,
      0,
      0,
      0,
      JSON.stringify([]),
      now,
      now,
    ],
  );

  await insertLog({
    habitId: id,
    kind: 'created',
    value: 0,
    points: 0,
    note: input.name,
  });
}

export async function recordBreakHabitCollapse(habitId: string) {
  const db = await dbPromise;
  const habit = await db.getFirstAsync<HabitRow>('SELECT * FROM habits WHERE id = ?', [habitId]);
  if (!habit) throw new Error('Habit not found');

  const runHours = calculateCurrentRunHours(habit.started_at);
  const beatRecord = runHours > habit.best_record_hours;
  const difficultyPoints = getDifficultyBoost(habit.difficulty);
  const points = beatRecord ? difficultyPoints + habit.comeback_bonus : -difficultyPoints;
  const xpGain = beatRecord ? 10 + difficultyPoints : 2;
  const nextBest = beatRecord ? runHours : habit.best_record_hours;
  const nearMissHours = computeNearMissHours(runHours, habit.best_record_hours);

  await insertLog({
    habitId,
    kind: 'relapse',
    value: runHours,
    points,
    note: `Lasted ${runHours.toFixed(1)}h`,
  });

  if (beatRecord) {
    await insertLog({
      habitId,
      kind: 'new_record',
      value: runHours,
      points: 10,
      note: `New clean run ${runHours.toFixed(1)}h`,
    });
  }

  await db.runAsync(
    `UPDATE habits
     SET started_at = ?, best_record_hours = ?, score = score + ?, xp = xp + ?, comeback_bonus = ?, updated_at = ?
     WHERE id = ?`,
    [new Date().toISOString(), nextBest, points, xpGain, beatRecord ? 0 : 2, new Date().toISOString(), habitId],
  );

  await unlockAchievements(habitId, 'break', nextBest);
  return { beatRecord, nearMissHours };
}

export async function recordBuildHabitCheckIn(habitId: string, action: 'yes' | 'missed' | 'skip') {
  const db = await dbPromise;
  const habit = await db.getFirstAsync<HabitRow>('SELECT * FROM habits WHERE id = ?', [habitId]);
  if (!habit) throw new Error('Habit not found');

  const difficultyPoints = getDifficultyBoost(habit.difficulty);

  if (action === 'skip') {
    await insertLog({
      habitId,
      kind: 'skipped',
      value: habit.current_streak,
      points: 0,
      note: 'Snoozed for later',
    });
    return;
  }

  if (action === 'missed') {
    await insertLog({
      habitId,
      kind: 'missed',
      value: habit.current_streak,
      points: -difficultyPoints,
      note: `Streak dropped from ${habit.current_streak}`,
    });

    await db.runAsync(
      `UPDATE habits
       SET current_streak = 0, score = score + ?, xp = xp + 1, comeback_bonus = 2, updated_at = ?
       WHERE id = ?`,
      [-difficultyPoints, new Date().toISOString(), habitId],
    );
    return;
  }

  const nextStreak = habit.current_streak + 1;
  const beatRecord = nextStreak > habit.best_record_streak;
  const points = difficultyPoints + habit.comeback_bonus;
  const xpGain = 5 + difficultyPoints;

  await insertLog({
    habitId,
    kind: 'completed',
    value: nextStreak,
    points,
    note: `Streak is now ${nextStreak}`,
  });

  if (beatRecord) {
    await insertLog({
      habitId,
      kind: 'new_record',
      value: nextStreak,
      points: 10,
      note: `New streak best ${nextStreak}`,
    });
  }

  await db.runAsync(
    `UPDATE habits
     SET current_streak = ?, best_record_streak = ?, score = score + ?, xp = xp + ?, comeback_bonus = ?, updated_at = ?
     WHERE id = ?`,
    [
      nextStreak,
      beatRecord ? nextStreak : habit.best_record_streak,
      points,
      xpGain,
      0,
      new Date().toISOString(),
      habitId,
    ],
  );

  await unlockAchievements(habitId, 'build', beatRecord ? nextStreak : habit.best_record_streak);
}

export async function saveNotificationIds(habitId: string, notificationIds: string[]) {
  const db = await dbPromise;
  await db.runAsync('UPDATE habits SET notification_ids_json = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(notificationIds),
    new Date().toISOString(),
    habitId,
  ]);
}

export async function deleteHabit(habitId: string) {
  const db = await dbPromise;
  await db.execAsync('BEGIN TRANSACTION;');

  try {
    await db.runAsync('DELETE FROM score_events WHERE habit_id = ?', [habitId]);
    await db.runAsync('DELETE FROM achievement_unlocks WHERE habit_id = ?', [habitId]);
    await db.runAsync('DELETE FROM habit_logs WHERE habit_id = ?', [habitId]);
    await db.runAsync('DELETE FROM habits WHERE id = ?', [habitId]);
    await db.execAsync('COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }
}

export async function resetAllData(seedDemoData = false) {
  const db = await dbPromise;
  await db.execAsync(`
    DELETE FROM score_events;
    DELETE FROM achievement_unlocks;
    DELETE FROM habit_logs;
    DELETE FROM habits;
  `);

  if (seedDemoData) {
    await seedSampleData();
  }
}

async function insertLog(input: {
  habitId: string;
  kind: HabitLog['kind'];
  value: number;
  points: number;
  note: string;
}) {
  const db = await dbPromise;
  await db.runAsync(
    `INSERT INTO habit_logs (id, habit_id, kind, occurred_at, value, points, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [createId('log'), input.habitId, input.kind, new Date().toISOString(), input.value, input.points, input.note],
  );

  if (input.points !== 0) {
    await db.runAsync(
      `INSERT INTO score_events (id, habit_id, occurred_at, points) VALUES (?, ?, ?, ?)`,
      [createId('score'), input.habitId, new Date().toISOString(), input.points],
    );
  }
}

async function unlockAchievements(habitId: string, mode: HabitMode, currentValue: number) {
  const db = await dbPromise;
  const unlocked = await db.getAllAsync<AchievementRow>(
    'SELECT * FROM achievement_unlocks WHERE habit_id = ? AND mode = ?',
    [habitId, mode],
  );
  const unlockedIds = new Set(unlocked.map((entry) => entry.achievement_id));

  for (const threshold of getAchievementThresholds(mode)) {
    const achievementId = `${mode}_${threshold}`;
    if (currentValue >= threshold && !unlockedIds.has(achievementId)) {
      await db.runAsync(
        `INSERT INTO achievement_unlocks (id, habit_id, achievement_id, threshold, mode, unlocked_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [createId('achievement'), habitId, achievementId, threshold, mode, new Date().toISOString()],
      );

      await insertLog({
        habitId,
        kind: 'achievement',
        value: threshold,
        points: 4,
        note: achievementId.replace('_', ' '),
      });
    }
  }
}

function rowToLog(row: HabitLogRow): HabitLog {
  return {
    id: row.id,
    habitId: row.habit_id,
    kind: row.kind,
    occurredAt: row.occurred_at,
    value: row.value,
    points: row.points,
    note: row.note,
  };
}

function rowToAchievement(row: AchievementRow): Achievement {
  return {
    id: row.achievement_id,
    habitId: row.habit_id,
    threshold: row.threshold,
    mode: row.mode,
    unlockedAt: row.unlocked_at,
  };
}

function rowToHabit(row: HabitRow, logs: HabitLog[], achievements: Achievement[]): Habit {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    difficulty: row.difficulty,
    schedule: row.schedule_json ? (JSON.parse(row.schedule_json) as Schedule) : null,
    challengeTarget: row.challenge_target,
    startedAt: row.started_at,
    currentRunHours: row.mode === 'break' ? calculateCurrentRunHours(row.started_at) : 0,
    bestRecordHours: row.best_record_hours,
    currentStreak: row.current_streak,
    bestRecordStreak: row.best_record_streak,
    score: row.score,
    xp: row.xp,
    comebackBonus: row.comeback_bonus,
    notificationIds: row.notification_ids_json ? (JSON.parse(row.notification_ids_json) as string[]) : [],
    logs,
    achievements,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const db = await dbPromise;
  const habitRows = await db.getAllAsync<HabitRow>('SELECT * FROM habits ORDER BY updated_at DESC');
  const logRows = await db.getAllAsync<HabitLogRow>(
    'SELECT * FROM habit_logs ORDER BY datetime(occurred_at) DESC LIMIT 100',
  );
  const achievementRows = await db.getAllAsync<AchievementRow>(
    'SELECT * FROM achievement_unlocks ORDER BY datetime(unlocked_at) DESC',
  );

  const allLogs = logRows.map(rowToLog);
  const allAchievements = achievementRows.map(rowToAchievement);
  const habits = habitRows.map((row) =>
    rowToHabit(
      row,
      allLogs.filter((entry) => entry.habitId === row.id),
      allAchievements.filter((entry) => entry.habitId === row.id),
    ),
  );

  const totalScore = habits.reduce((sum, habit) => sum + habit.score, 0);
  const totalXp = habits.reduce((sum, habit) => sum + habit.xp, 0);
  const breakBest = habits.filter((habit) => habit.mode === 'break').sort((a, b) => b.bestRecordHours - a.bestRecordHours)[0];
  const buildBest = habits.filter((habit) => habit.mode === 'build').sort((a, b) => b.bestRecordStreak - a.bestRecordStreak)[0];

  return {
    habits,
    timeline: allLogs,
    stats: {
      totalScore,
      totalXp,
      totalHabits: habits.length,
      totalAchievements: allAchievements.length,
      recordHabits: habits.filter((habit) => (habit.mode === 'break' ? habit.bestRecordHours > 0 : habit.bestRecordStreak > 0)).length,
      bestRecordLabel: breakBest ? `${breakBest.name} • ${breakBest.bestRecordHours.toFixed(1)}h` : 'No record yet',
      longestStreakLabel: buildBest ? `${buildBest.name} • ${buildBest.bestRecordStreak}` : 'No streak yet',
      momentumLabel:
        habits[0]?.mode === 'break'
          ? `${habits[0].name} ${habits[0].currentRunHours.toFixed(1)}h live`
          : habits[0]
            ? `${habits[0].name} streak ${habits[0].currentStreak}`
            : 'No habits yet',
    },
  };
}
