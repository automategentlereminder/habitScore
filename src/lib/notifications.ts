import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { Habit } from '../types';
import { saveNotificationIds } from './db';
import { getWeekdayIndex } from './game';

function parseTime(timeOfDay: string) {
  const [hourPart, minutePart] = timeOfDay.split(':');
  const hour = Number(hourPart ?? '8');
  const minute = Number(minutePart ?? '0');

  return {
    hour: Number.isNaN(hour) ? 8 : Math.max(0, Math.min(23, hour)),
    minute: Number.isNaN(minute) ? 0 : Math.max(0, Math.min(59, minute)),
  };
}

export async function requestNotificationAccess() {
  if (!Device.isDevice) return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('habitscore-main', {
      name: 'HabitScore',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;

  const next = await Notifications.requestPermissionsAsync();
  return next.granted;
}

export async function clearAllHabitNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function clearHabitNotifications(notificationIds: string[]) {
  for (const id of notificationIds) {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => null);
  }
}

export async function scheduleSnoozeReminder(habit: Habit, hours = 2) {
  if (habit.mode !== 'build') return;

  const triggerAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${habit.name} check-in`,
      body: 'Not yet is not a fail. Protect the streak.',
      sound: false,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerAt,
    },
  });
}

export async function syncHabitNotifications(habits: Habit[]) {
  for (const habit of habits) {
    if (habit.notificationIds.length > 0) {
      for (const id of habit.notificationIds) {
        await Notifications.cancelScheduledNotificationAsync(id).catch(() => null);
      }
    }

    const nextIds: string[] = [];

    if (habit.mode === 'build' && habit.schedule?.remindersEnabled) {
      const title = `${habit.name} time`;
      const body = 'Protect your streak. Beat your best.';
      const { hour, minute } = parseTime(habit.schedule.timeOfDay);

      if (habit.schedule.frequency === 'daily') {
        const id = await Notifications.scheduleNotificationAsync({
          content: { title, body, sound: false },
          trigger: {
            channelId: 'habitscore-main',
            type: Notifications.SchedulableTriggerInputTypes.DAILY,
            hour,
            minute,
          },
        });
        nextIds.push(id);
      }

      if (habit.schedule.frequency === 'weekly') {
        for (const weekday of habit.schedule.weekdays ?? []) {
          const id = await Notifications.scheduleNotificationAsync({
            content: { title, body, sound: false },
            trigger: {
              channelId: 'habitscore-main',
              type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
              weekday: getWeekdayIndex(weekday),
              hour,
              minute,
            },
          });
          nextIds.push(id);
        }
      }

      if (habit.schedule.frequency === 'monthly') {
        const day = Math.max(1, Math.min(28, habit.schedule.dayOfMonth ?? 1));
        const date = new Date();
        date.setDate(day);
        date.setHours(hour, minute, 0, 0);
        if (date.getTime() <= Date.now()) date.setMonth(date.getMonth() + 1);

        const id = await Notifications.scheduleNotificationAsync({
          content: { title, body, sound: false },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date,
          },
        });
        nextIds.push(id);
      }
    }

    if (habit.mode === 'break' && habit.bestRecordHours > 0) {
      const triggerAt = new Date(new Date(habit.startedAt).getTime() + habit.bestRecordHours * 0.9 * 60 * 60 * 1000);
      if (triggerAt.getTime() > Date.now()) {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: `${habit.name}: near your record`,
            body: 'You are close. Finish the run and beat your best.',
            sound: false,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: triggerAt,
          },
        });
        nextIds.push(id);
      }
    }

    await saveNotificationIds(habit.id, nextIds);
  }
}
