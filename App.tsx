import * as Sharing from 'expo-sharing';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import ViewShot from 'react-native-view-shot';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createHabit, deleteHabit, getDashboardData, initializeDatabase, recordBuildHabitCheckIn, recordBreakHabitCollapse, resetAllData, seedSampleData } from './src/lib/db';
import { buildAchievementLabel, calculateCurrentRunHours, computeLevelFromXp, formatRelativeTime, getBreakProgressPercent, getBuildProgressPercent, getChallengeText, getDifficultyAccent, getEventLabel, getFrequencyLabel, getHabitHeadline, getHabitStatLine, getLevelProgress, getTodayScore, isNearMiss } from './src/lib/game';
import { clearAllHabitNotifications, clearHabitNotifications, requestNotificationAccess, scheduleSnoozeReminder, syncHabitNotifications } from './src/lib/notifications';
import { DashboardData, Difficulty, Frequency, Habit, HabitMode, Schedule, Weekday } from './src/types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const allWeekdays: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type TabKey = 'dashboard' | 'create' | 'stats';

type FormState = {
  name: string;
  mode: HabitMode;
  difficulty: Difficulty;
  challengeTarget: string;
  reminderEnabled: boolean;
  frequency: Frequency;
  timeOfDay: string;
  weekdays: Weekday[];
  dayOfMonth: string;
};

type DialogState = {
  title: string;
  message: string;
  tone?: 'neutral' | 'success' | 'danger';
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => Promise<void> | void;
};

const defaultFormState: FormState = {
  name: '',
  mode: 'break',
  difficulty: 'medium',
  challengeTarget: '',
  reminderEnabled: true,
  frequency: 'daily',
  timeOfDay: '06:30',
  weekdays: ['Mon', 'Wed', 'Fri'],
  dayOfMonth: '1',
};

function isValidTime(value: string) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function buildStoryHeadline(level: number) {
  if (level >= 15) return 'Discipline turned into a superpower';
  if (level >= 10) return 'Quiet consistency is starting to show';
  if (level >= 5) return 'Small wins are stacking into momentum';
  return 'One habit at a time still counts';
}

function buildStorySubline(momentumLabel: string) {
  return momentumLabel === 'No habits yet'
    ? 'Building the game plan.'
    : `${momentumLabel}. Still in the arena.`;
}

export default function App() {
  const [tab, setTab] = useState<TabKey>('dashboard');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [notificationsReady, setNotificationsReady] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const refresh = async (notificationsGranted = notificationsReady) => {
    const data = await getDashboardData();
    setDashboard(data);

    if (notificationsGranted) {
      await syncHabitNotifications(data.habits);
    }
  };

  useEffect(() => {
    const boot = async () => {
      await initializeDatabase();
      await seedSampleData();
      const granted = await requestNotificationAccess();
      setNotificationsReady(granted);
      await refresh(granted);
      setLoading(false);
    };

    void boot();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setClock(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const liveDashboard = useMemo(() => {
    if (!dashboard) return null;

    return {
      ...dashboard,
      habits: dashboard.habits.map((habit) =>
        habit.mode === 'break'
          ? {
              ...habit,
              currentRunHours: calculateCurrentRunHours(habit.startedAt),
            }
          : habit,
      ),
    };
  }, [clock, dashboard]);

  const totalXp = liveDashboard?.stats.totalXp ?? 0;
  const level = computeLevelFromXp(totalXp);
  const levelProgress = getLevelProgress(totalXp);
  const todayScore = getTodayScore(liveDashboard?.timeline ?? []);
  const detailHabit = useMemo(
    () => liveDashboard?.habits.find((habit) => habit.id === selectedHabitId) ?? null,
    [liveDashboard?.habits, selectedHabitId],
  );

  const submitHabit = async () => {
    if (!form.name.trim()) {
      Alert.alert('Need a name', 'Give your challenge a name so it feels real.');
      return;
    }

    const challengeTarget = form.challengeTarget ? Number(form.challengeTarget) : null;
    if (form.challengeTarget && Number.isNaN(challengeTarget)) {
      Alert.alert('Invalid target', 'Challenge target needs to be a number.');
      return;
    }

    let schedule: Schedule | null = null;
    if (form.mode === 'build') {
      if (!isValidTime(form.timeOfDay)) {
        Alert.alert('Invalid time', 'Use a 24-hour time like 06:30 or 21:00.');
        return;
      }

      if (form.frequency === 'weekly' && form.weekdays.length === 0) {
        Alert.alert('Choose days', 'Pick at least one weekday for a weekly challenge.');
        return;
      }

      if (form.frequency === 'monthly') {
        const day = Number(form.dayOfMonth || 1);
        if (!Number.isInteger(day) || day < 1 || day > 28) {
          Alert.alert('Invalid day', 'Choose a day from 1 to 28 for monthly reminders.');
          return;
        }
      }

      schedule = {
        frequency: form.frequency,
        timeOfDay: form.timeOfDay,
        weekdays: form.frequency === 'weekly' ? form.weekdays : undefined,
        dayOfMonth: form.frequency === 'monthly' ? Number(form.dayOfMonth || 1) : undefined,
        remindersEnabled: form.reminderEnabled,
      };
    }

    await createHabit({
      name: form.name.trim(),
      mode: form.mode,
      difficulty: form.difficulty,
      challengeTarget,
      schedule,
    });

    setForm(defaultFormState);
    setTab('dashboard');
    await refresh();
  };

  const onBreakHabitCollapse = async (habit: Habit) => {
    const result = await recordBreakHabitCollapse(habit.id);
    const nearMissText = result.nearMissHours > 0 ? `\n\nYou were only ${result.nearMissHours}h away from your record.` : '';

    await refresh();
    setDialog({
      title: result.beatRecord ? 'New record' : 'Run ended',
      message: `${result.beatRecord ? 'You beat your previous best.' : 'Reset and come back stronger.'}${nearMissText}`,
      tone: result.beatRecord ? 'success' : 'danger',
      confirmLabel: 'Continue',
    });
  };

  const onBuildHabitAction = async (habit: Habit, action: 'yes' | 'missed' | 'skip') => {
    await recordBuildHabitCheckIn(habit.id, action);
    if (action === 'skip' && notificationsReady) {
      await scheduleSnoozeReminder(habit, 2);
    }
    await refresh();

    if (action === 'skip') {
      setDialog({
        title: 'Reminder delayed',
        message: 'We will ping you again later to protect the streak.',
        tone: 'neutral',
        confirmLabel: 'Nice',
      });
    }
  };

  const onDeleteHabitRequested = (habit: Habit) => {
    setDialog({
      title: 'Delete habit?',
      message:
        'We hope you are deleting it because you no longer need it and not because you collapsed. Delete it?',
      tone: 'danger',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      onConfirm: async () => {
        await clearHabitNotifications(habit.notificationIds);
        await deleteHabit(habit.id);
        if (selectedHabitId === habit.id) {
          setShowDetail(false);
          setSelectedHabitId(null);
        }
        await refresh();
      },
    });
  };

  return (
    <GestureHandlerRootView style={styles.safeArea}>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <LinearGradient colors={['#07111f', '#0d1730', '#090b14']} style={styles.background}>
          <View style={styles.appShell}>
          <Header level={level} levelProgress={levelProgress} todayScore={todayScore} totalScore={liveDashboard?.stats.totalScore ?? 0} />
          <TabBar current={tab} onChange={setTab} />

          {loading || !liveDashboard ? (
            <View style={styles.loadingCard}>
              <Text style={styles.loadingTitle}>Spinning up your arena...</Text>
              <Text style={styles.loadingText}>Loading local save data and challenge loop.</Text>
            </View>
          ) : (
            <>
              {tab === 'dashboard' ? (
                <DashboardTab
                  dashboard={liveDashboard}
                  onOpenHabit={(habit) => {
                    setSelectedHabitId(habit.id);
                    setShowDetail(true);
                  }}
                  onDeleteHabit={onDeleteHabitRequested}
                />
              ) : null}
              {tab === 'create' ? <CreateTab form={form} setForm={setForm} onSubmit={submitHabit} /> : null}
              {tab === 'stats' ? (
                <StatsTab
                  dashboard={liveDashboard}
                  level={level}
                  onResetWithDemo={async () => {
                    await clearAllHabitNotifications();
                    await resetAllData(true);
                    await refresh();
                  }}
                  onResetEmpty={async () => {
                    await clearAllHabitNotifications();
                    await resetAllData(false);
                    await refresh();
                  }}
                />
              ) : null}
            </>
          )}
          </View>

          <HabitDetailModal
            habit={detailHabit}
            visible={showDetail}
            onClose={() => setShowDetail(false)}
            onBreakHabitCollapse={onBreakHabitCollapse}
            onBuildHabitAction={onBuildHabitAction}
          />
          <GameDialog dialog={dialog} onClose={() => setDialog(null)} />
        </LinearGradient>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

function Header({
  level,
  levelProgress,
  todayScore,
  totalScore,
}: {
  level: number;
  levelProgress: number;
  todayScore: number;
  totalScore: number;
}) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.kicker}>HabitScore</Text>
        <Text style={styles.heroTitle}>You vs your previous self</Text>
      </View>

      <View style={styles.heroStats}>
        <View style={styles.levelBadge}>
          <Text style={styles.levelBadgeLabel}>LVL {level}</Text>
          <View style={styles.levelTrack}>
            <View style={[styles.levelFill, { width: `${levelProgress}%` }]} />
          </View>
        </View>

        <View style={styles.headerScoreCard}>
          <Text style={styles.headerScoreLabel}>Today</Text>
          <Text style={styles.headerScoreValue}>{todayScore >= 0 ? `+${todayScore}` : todayScore}</Text>
        </View>

        <View style={styles.headerScoreCard}>
          <Text style={styles.headerScoreLabel}>Total</Text>
          <Text style={styles.headerScoreValue}>{totalScore >= 0 ? `+${totalScore}` : totalScore}</Text>
        </View>
      </View>
    </View>
  );
}

function TabBar({ current, onChange }: { current: TabKey; onChange: (tab: TabKey) => void }) {
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'dashboard', label: 'Arena' },
    { key: 'create', label: 'Forge' },
    { key: 'stats', label: 'Vault' },
  ];

  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => (
        <Pressable
          key={tab.key}
          onPress={() => onChange(tab.key)}
          style={[styles.tabPill, current === tab.key ? styles.tabPillActive : null]}
        >
          <Text style={[styles.tabLabel, current === tab.key ? styles.tabLabelActive : null]}>{tab.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ScoreTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.scoreTile}>
      <Text style={styles.scoreTileLabel}>{label}</Text>
      <Text style={styles.scoreTileValue}>{value}</Text>
    </View>
  );
}

function DashboardTab({
  dashboard,
  onOpenHabit,
  onDeleteHabit,
}: {
  dashboard: DashboardData;
  onOpenHabit: (habit: Habit) => void;
  onDeleteHabit: (habit: Habit) => void;
}) {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <View style={styles.scoreboardRow}>
        <ScoreTile label="Best Record" value={dashboard.stats.bestRecordLabel} />
        <ScoreTile label="Longest Streak" value={dashboard.stats.longestStreakLabel} />
        <ScoreTile label="Habits" value={`${dashboard.stats.totalHabits}`} />
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Active challenges</Text>
        <Text style={styles.sectionHint}>Records, streaks, pressure, comeback energy.</Text>
      </View>

      {dashboard.habits.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No challenges yet</Text>
          <Text style={styles.emptyText}>Head to Forge and create your first break-or-build habit.</Text>
        </View>
      ) : (
        dashboard.habits.map((habit) => (
          <HabitCard
            key={habit.id}
            habit={habit}
            onPress={() => onOpenHabit(habit)}
            onDelete={() => onDeleteHabit(habit)}
          />
        ))
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Latest timeline</Text>
        <Text style={styles.sectionHint}>Proof that the game is moving.</Text>
      </View>

      <View style={styles.timelineCard}>
        {dashboard.timeline.length === 0 ? (
          <Text style={styles.emptyText}>Your timeline will start filling as soon as you play a habit.</Text>
        ) : (
          dashboard.timeline.slice(0, 8).map((event) => (
            <View key={event.id} style={styles.timelineRow}>
              <View style={styles.timelineDot} />
              <View style={styles.timelineTextWrap}>
                <Text style={styles.timelineTitle}>{getEventLabel(event)}</Text>
                <Text style={styles.timelineMeta}>{formatRelativeTime(event.occurredAt)}</Text>
              </View>
              <Text style={[styles.timelinePoints, event.points >= 0 ? styles.positive : styles.negative]}>
                {event.points >= 0 ? `+${event.points}` : event.points}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function HabitCard({
  habit,
  onPress,
  onDelete,
}: {
  habit: Habit;
  onPress: () => void;
  onDelete: () => void;
}) {
  const progress =
    habit.mode === 'break'
      ? getBreakProgressPercent(habit.currentRunHours, habit.bestRecordHours)
      : getBuildProgressPercent(habit.currentStreak, habit.bestRecordStreak);
  const accent = getDifficultyAccent(habit.difficulty);

  return (
    <Swipeable
      overshootRight={false}
      renderRightActions={() => (
        <View style={styles.deleteActionWrap}>
          <Pressable onPress={onDelete} style={styles.deleteAction}>
            <Text style={styles.deleteActionLabel}>Delete</Text>
          </Pressable>
        </View>
      )}
    >
      <Pressable onPress={onPress} style={styles.habitCard}>
        <LinearGradient colors={['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.04)']} style={styles.habitCardOverlay} />
        <View style={styles.habitCardTop}>
          <View>
            <Text style={styles.habitEmoji}>{habit.mode === 'break' ? '🚫' : '🔥'}</Text>
            <Text style={styles.habitName}>{habit.name}</Text>
            <Text style={styles.habitMode}>{getHabitHeadline(habit)}</Text>
          </View>

          <View style={[styles.difficultyBadge, { borderColor: accent }]}>
            <Text style={[styles.difficultyText, { color: accent }]}>{habit.difficulty.toUpperCase()}</Text>
          </View>
        </View>

        <Text style={styles.habitStatLine}>{getHabitStatLine(habit)}</Text>

        <View style={styles.meterMeta}>
          <Text style={styles.meterLabel}>Progress to record</Text>
          <Text style={styles.meterValue}>{progress}%</Text>
        </View>

        <View style={styles.meterTrack}>
          <LinearGradient colors={['#47f5cf', '#6ea8ff', '#d2fd5f']} style={[styles.meterFill, { width: `${progress}%` }]} />
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.cardScore}>Score {habit.score >= 0 ? `+${habit.score}` : habit.score}</Text>
          <Text style={styles.cardChallenge}>{getChallengeText(habit)}</Text>
        </View>
      </Pressable>
    </Swipeable>
  );
}

function CreateTab({
  form,
  setForm,
  onSubmit,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
  onSubmit: () => void;
}) {
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm({ ...form, [key]: value });

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Forge a new challenge</Text>
        <Text style={styles.sectionHint}>Turn a habit into something you can beat.</Text>

        <Text style={styles.fieldLabel}>Habit name</Text>
        <TextInput
          placeholder="Smoking, Gym, Doomscrolling..."
          placeholderTextColor="#6e779b"
          style={styles.input}
          value={form.name}
          onChangeText={(value) => update('name', value)}
        />

        <Text style={styles.fieldLabel}>Mode</Text>
        <OptionRow
          value={form.mode}
          options={[
            { value: 'break', label: 'Break a Habit' },
            { value: 'build', label: 'Build a Habit' },
          ]}
          onChange={(value) => update('mode', value as HabitMode)}
        />

        <Text style={styles.fieldLabel}>Difficulty</Text>
        <OptionRow
          value={form.difficulty}
          options={[
            { value: 'easy', label: 'Easy' },
            { value: 'medium', label: 'Medium' },
            { value: 'hard', label: 'Hard' },
          ]}
          onChange={(value) => update('difficulty', value as Difficulty)}
        />

        <Text style={styles.fieldLabel}>
          {form.mode === 'break' ? 'Challenge target (hours)' : 'Challenge target (streak count)'}
        </Text>
        <TextInput
          placeholder={form.mode === 'break' ? '72' : '30'}
          placeholderTextColor="#6e779b"
          keyboardType="numeric"
          style={styles.input}
          value={form.challengeTarget}
          onChangeText={(value) => update('challengeTarget', value.replace(/[^0-9]/g, ''))}
        />

        {form.mode === 'build' ? (
          <>
            <View style={styles.switchRow}>
              <View>
                <Text style={styles.fieldLabel}>Motivation reminders</Text>
                <Text style={styles.smallHint}>Local notifications only. No cloud. No tracking.</Text>
              </View>
              <Switch
                value={form.reminderEnabled}
                onValueChange={(value) => update('reminderEnabled', value)}
                trackColor={{ true: '#3ce2ff', false: '#374059' }}
              />
            </View>

            <Text style={styles.fieldLabel}>Frequency</Text>
            <OptionRow
              value={form.frequency}
              options={[
                { value: 'daily', label: 'Daily' },
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
              ]}
              onChange={(value) => update('frequency', value as Frequency)}
            />

            <Text style={styles.fieldLabel}>Reminder time</Text>
            <TextInput
              placeholder="06:30"
              placeholderTextColor="#6e779b"
              style={styles.input}
              value={form.timeOfDay}
              onChangeText={(value) => update('timeOfDay', value)}
            />

            {form.frequency === 'weekly' ? (
              <>
                <Text style={styles.fieldLabel}>Days</Text>
                <View style={styles.weekdayGrid}>
                  {allWeekdays.map((weekday) => {
                    const active = form.weekdays.includes(weekday);
                    return (
                      <Pressable
                        key={weekday}
                        onPress={() =>
                          update(
                            'weekdays',
                            active ? form.weekdays.filter((value) => value !== weekday) : [...form.weekdays, weekday],
                          )
                        }
                        style={[styles.weekdayChip, active ? styles.weekdayChipActive : null]}
                      >
                        <Text style={[styles.weekdayLabel, active ? styles.weekdayLabelActive : null]}>{weekday}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            {form.frequency === 'monthly' ? (
              <>
                <Text style={styles.fieldLabel}>Day of month</Text>
                <TextInput
                  placeholder="1"
                  placeholderTextColor="#6e779b"
                  keyboardType="numeric"
                  style={styles.input}
                  value={form.dayOfMonth}
                  onChangeText={(value) => update('dayOfMonth', value.replace(/[^0-9]/g, ''))}
                />
              </>
            ) : null}
          </>
        ) : null}

        <Pressable onPress={onSubmit} style={styles.submitButton}>
          <Text style={styles.submitLabel}>Start the challenge</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function OptionRow({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.optionRow}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          onPress={() => onChange(option.value)}
          style={[styles.optionChip, value === option.value ? styles.optionChipActive : null]}
        >
          <Text style={[styles.optionLabel, value === option.value ? styles.optionLabelActive : null]}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function StatsTab({
  dashboard,
  level,
  onResetWithDemo,
  onResetEmpty,
}: {
  dashboard: DashboardData;
  level: number;
  onResetWithDemo: () => Promise<void>;
  onResetEmpty: () => Promise<void>;
}) {
  const [aboutOpen, setAboutOpen] = useState(false);
  const shareRef = useRef<ViewShot | null>(null);
  const storyHeadline = buildStoryHeadline(level);
  const storySubline = buildStorySubline(dashboard.stats.momentumLabel);

  const shareSnapshot = async () => {
    const available = await Sharing.isAvailableAsync();
    if (!available || !shareRef.current) {
      Alert.alert('Sharing unavailable', 'Sharing is not available on this device right now.');
      return;
    }

    const uri = await shareRef.current.capture?.();
    if (!uri) {
      Alert.alert('Snapshot failed', 'Could not generate a share image this time.');
      return;
    }

    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      dialogTitle: 'Share HabitScore snapshot',
    });
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <ViewShot ref={shareRef} options={{ format: 'png', quality: 1, result: 'tmpfile' }}>
        <View style={styles.sharePoster} collapsable={false}>
          <LinearGradient colors={['#0a1223', '#101a31', '#09101d']} style={styles.sharePosterGradient}>
            <View style={styles.sharePosterGlowOne} />
            <View style={styles.sharePosterGlowTwo} />
            <View style={styles.shareTopRow}>
              <View style={styles.sharePill}>
                <Text style={styles.sharePillLabel}>OFFLINE ONLY</Text>
              </View>
              <Text style={styles.shareBrand}>HABITSCORE</Text>
            </View>

            <View style={styles.shareHeroCard}>
              <Text style={styles.shareLevelCaption}>LEVEL</Text>
              <Text style={styles.shareLevelValue}>{level}</Text>
              <Text style={styles.shareHeroTitle}>{storyHeadline}</Text>
              <Text style={styles.shareHeroSubtitle}>{storySubline}</Text>
            </View>

            <View style={styles.shareMetricsRow}>
              <View style={styles.shareMetricCard}>
                <Text style={styles.shareMetricLabel}>XP earned</Text>
                <Text style={styles.shareMetricValue}>{dashboard.stats.totalXp}</Text>
              </View>
              <View style={styles.shareMetricCard}>
                <Text style={styles.shareMetricLabel}>Achievements</Text>
                <Text style={styles.shareMetricValue}>{dashboard.stats.totalAchievements}</Text>
              </View>
            </View>

            <View style={styles.shareFeatureCard}>
              <Text style={styles.shareFeatureLabel}>Best habit record</Text>
              <Text style={styles.shareFeatureValue}>{dashboard.stats.bestRecordLabel}</Text>
              <Text style={styles.shareFeatureHint}>Longest clean run or highest record chase</Text>
            </View>

            <View style={styles.shareFeatureCardAlt}>
              <Text style={styles.shareFeatureLabel}>Longest streak ever</Text>
              <Text style={styles.shareFeatureValue}>
                {dashboard.stats.longestStreakLabel.includes('•')
                  ? `${dashboard.stats.longestStreakLabel} days`
                  : dashboard.stats.longestStreakLabel}
              </Text>
              <Text style={styles.shareFeatureHint}>The streak that pushed furthest</Text>
            </View>

            <View style={styles.shareMomentumBar}>
              <Text style={styles.shareMomentumTitle}>Current momentum</Text>
              <Text style={styles.shareMomentumValue}>{dashboard.stats.momentumLabel}</Text>
            </View>

            <View style={styles.shareFooterRow}>
              <Text style={styles.shareFooter}>No ads. No subscription. Just you vs your previous self.</Text>
              <Text style={styles.shareFooterTag}>Play your discipline</Text>
            </View>
          </LinearGradient>
        </View>
      </ViewShot>

      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Player vault</Text>
        <Text style={styles.sectionHint}>A snapshot of your offline grind.</Text>

        <View style={styles.scoreboardRow}>
          <ScoreTile label="Level" value={`${level}`} />
          <ScoreTile label="XP" value={`${dashboard.stats.totalXp}`} />
          <ScoreTile label="Achievements" value={`${dashboard.stats.totalAchievements}`} />
        </View>

        <View style={styles.statsBlock}>
          <Text style={styles.statsLabel}>Best habit record</Text>
          <Text style={styles.statsValue}>{dashboard.stats.bestRecordLabel}</Text>
        </View>

        <View style={styles.statsBlock}>
          <Text style={styles.statsLabel}>Longest streak ever</Text>
          <Text style={styles.statsValue}>
            {dashboard.stats.longestStreakLabel.includes('•')
              ? `${dashboard.stats.longestStreakLabel} days`
              : dashboard.stats.longestStreakLabel}
          </Text>
        </View>

        <View style={styles.statsBlock}>
          <Text style={styles.statsLabel}>Current momentum</Text>
          <Text style={styles.statsValue}>{dashboard.stats.momentumLabel}</Text>
        </View>
      </View>

      <Pressable style={styles.secondaryButton} onPress={() => void shareSnapshot()}>
        <Text style={styles.secondaryButtonLabel}>Share story snapshot</Text>
      </Pressable>

      <View style={styles.aboutDock}>
        <Pressable style={styles.infoTrigger} onPress={() => setAboutOpen((value) => !value)}>
          <Text style={styles.infoTriggerIcon}>ⓘ</Text>
          <Text style={styles.infoTriggerLabel}>About</Text>
        </Pressable>

        {aboutOpen ? (
          <View style={styles.aboutPanel}>
            <Text style={styles.aboutText}>
              We developed HabitScore for gamifying discipline. There are no ads and no subscription.
            </Text>
            <Text style={styles.aboutText}>We are into IT automation business.</Text>
            <Pressable onPress={() => void Linking.openURL('https://gentlereminder.in/')}>
              <Text style={styles.aboutLink}>https://gentlereminder.in/</Text>
            </Pressable>

            <Pressable
              style={styles.secondaryButton}
              onPress={() =>
                Alert.alert(
                  'Fuse demo data?',
                  'This will overwrite your current app data with demo data. It is useful for understanding the app and taking screenshots.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Fuse demo data', style: 'destructive', onPress: () => void onResetWithDemo() },
                  ],
                )
              }
            >
              <Text style={styles.secondaryButtonLabel}>Fuse demo data</Text>
            </Pressable>

            <Pressable style={styles.ghostButton} onPress={() => void onResetEmpty()}>
              <Text style={styles.ghostButtonLabel}>Wipe app data</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function HabitDetailModal({
  habit,
  visible,
  onClose,
  onBreakHabitCollapse,
  onBuildHabitAction,
}: {
  habit: Habit | null;
  visible: boolean;
  onClose: () => void;
  onBreakHabitCollapse: (habit: Habit) => Promise<void>;
  onBuildHabitAction: (habit: Habit, action: 'yes' | 'missed' | 'skip') => Promise<void>;
}) {
  if (!habit) return null;

  const progress =
    habit.mode === 'break'
      ? getBreakProgressPercent(habit.currentRunHours, habit.bestRecordHours)
      : getBuildProgressPercent(habit.currentStreak, habit.bestRecordStreak);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.habitName}>{habit.name}</Text>
              <Text style={styles.habitMode}>{getHabitHeadline(habit)}</Text>
            </View>
            <Pressable onPress={onClose}>
              <Text style={styles.closeLabel}>Close</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent}>
            <View style={styles.detailHero}>
              <Text style={styles.detailBigStat}>
                {habit.mode === 'break' ? `${habit.currentRunHours.toFixed(1)}h` : `${habit.currentStreak} streak`}
              </Text>
              <Text style={styles.habitStatLine}>{getHabitStatLine(habit)}</Text>
            </View>

            <View style={styles.meterMeta}>
              <Text style={styles.meterLabel}>Progress to your best</Text>
              <Text style={styles.meterValue}>{progress}%</Text>
            </View>
            <View style={styles.meterTrack}>
              <LinearGradient colors={['#47f5cf', '#6ea8ff', '#d2fd5f']} style={[styles.meterFill, { width: `${progress}%` }]} />
            </View>

            <View style={styles.detailStatsGrid}>
              <ScoreTile label="Score" value={habit.score >= 0 ? `+${habit.score}` : `${habit.score}`} />
              <ScoreTile label="XP" value={`${habit.xp}`} />
              <ScoreTile label="Challenge" value={getChallengeText(habit)} />
            </View>

            <View style={styles.detailInfoBlock}>
              <Text style={styles.statsLabel}>Reminder rhythm</Text>
              <Text style={styles.statsValue}>{habit.schedule ? getFrequencyLabel(habit.schedule.frequency) : 'Live timer'}</Text>
            </View>

            {habit.comebackBonus > 0 ? (
              <View style={styles.comebackCard}>
                <Text style={styles.comebackTitle}>Comeback bonus active</Text>
                <Text style={styles.comebackText}>Beat your record or protect the streak for an extra +{habit.comebackBonus}.</Text>
              </View>
            ) : null}

            {habit.mode === 'break' ? (
              <Pressable style={styles.collapseButton} onPress={() => void onBreakHabitCollapse(habit)}>
                <Text style={styles.collapseLabel}>I Collapsed</Text>
              </Pressable>
            ) : (
              <View style={styles.actionStack}>
                <Pressable style={styles.completeButton} onPress={() => void onBuildHabitAction(habit, 'yes')}>
                  <Text style={styles.actionLabel}>I Completed It</Text>
                </Pressable>
                <Pressable style={styles.delayButton} onPress={() => void onBuildHabitAction(habit, 'skip')}>
                  <Text style={styles.actionLabel}>Not Yet</Text>
                </Pressable>
                <Pressable style={styles.collapseButton} onPress={() => void onBuildHabitAction(habit, 'missed')}>
                  <Text style={styles.collapseLabel}>I Missed It</Text>
                </Pressable>
              </View>
            )}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Achievements</Text>
              <Text style={styles.sectionHint}>Small trophies that keep the loop hot.</Text>
            </View>

            <View style={styles.achievementWrap}>
              {habit.achievements.map((achievement) => (
                <View key={achievement.id} style={styles.achievementChip}>
                  <Text style={styles.achievementText}>{buildAchievementLabel(achievement)}</Text>
                </View>
              ))}
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent history</Text>
              <Text style={styles.sectionHint}>
                {isNearMiss(habit) ? 'That last attempt was painfully close. Try again.' : 'Keep stacking proof.'}
              </Text>
            </View>

            <View style={styles.timelineCard}>
              {habit.logs.length === 0 ? (
                <Text style={styles.emptyText}>Your history will start filling as you play this habit.</Text>
              ) : (
                habit.logs.slice(0, 8).map((event) => (
                  <View key={event.id} style={styles.timelineRow}>
                    <View style={styles.timelineDot} />
                    <View style={styles.timelineTextWrap}>
                      <Text style={styles.timelineTitle}>{getEventLabel(event)}</Text>
                      <Text style={styles.timelineMeta}>{formatRelativeTime(event.occurredAt)}</Text>
                    </View>
                    <Text style={[styles.timelinePoints, event.points >= 0 ? styles.positive : styles.negative]}>
                      {event.points >= 0 ? `+${event.points}` : event.points}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function GameDialog({
  dialog,
  onClose,
}: {
  dialog: DialogState | null;
  onClose: () => void;
}) {
  if (!dialog) return null;

  const toneStyle =
    dialog.tone === 'success'
      ? styles.dialogCardSuccess
      : dialog.tone === 'danger'
        ? styles.dialogCardDanger
        : styles.dialogCardNeutral;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.dialogBackdrop}>
        <View style={[styles.dialogCard, toneStyle]}>
          <Text style={styles.dialogTitle}>{dialog.title}</Text>
          <Text style={styles.dialogMessage}>{dialog.message}</Text>

          <View style={styles.dialogActions}>
            {dialog.cancelLabel ? (
              <Pressable style={styles.dialogSecondaryButton} onPress={onClose}>
                <Text style={styles.dialogSecondaryLabel}>{dialog.cancelLabel}</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[
                styles.dialogPrimaryButton,
                dialog.tone === 'danger' ? styles.dialogPrimaryDanger : styles.dialogPrimarySuccess,
              ]}
              onPress={async () => {
                const action = dialog.onConfirm;
                onClose();
                if (action) {
                  await action();
                }
              }}
            >
              <Text style={styles.dialogPrimaryLabel}>{dialog.confirmLabel ?? 'OK'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#050914' },
  background: { flex: 1 },
  appShell: { flex: 1, paddingHorizontal: 18, paddingTop: 12 },
  header: { marginBottom: 18 },
  kicker: { color: '#55d9ff', fontSize: 13, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  heroTitle: { color: '#f5f7ff', fontSize: 28, fontWeight: '900', marginTop: 6 },
  heroStats: { flexDirection: 'row', gap: 10, marginTop: 18, alignItems: 'center' },
  levelBadge: { flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12 },
  levelBadgeLabel: { color: '#fdfec4', fontWeight: '800', marginBottom: 8 },
  levelTrack: { height: 8, borderRadius: 99, backgroundColor: '#1d2843', overflow: 'hidden' },
  levelFill: { height: '100%', borderRadius: 99, backgroundColor: '#d6fe4c' },
  headerScoreCard: { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, minWidth: 88 },
  headerScoreLabel: { color: '#93a2d0', fontSize: 12 },
  headerScoreValue: { color: '#f5f7ff', fontSize: 22, fontWeight: '900', marginTop: 4 },
  tabBar: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  tabPill: { flex: 1, borderRadius: 999, paddingVertical: 12, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  tabPillActive: { backgroundColor: '#53ddff' },
  tabLabel: { color: '#bbc5e3', fontWeight: '800' },
  tabLabelActive: { color: '#07111f' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 120, gap: 18 },
  loadingCard: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 28, padding: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  loadingTitle: { color: '#f5f7ff', fontSize: 20, fontWeight: '900' },
  loadingText: { color: '#93a2d0', marginTop: 8 },
  scoreboardRow: { flexDirection: 'row', gap: 10 },
  scoreTile: { flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 20, padding: 14 },
  scoreTileLabel: { color: '#93a2d0', fontSize: 12, marginBottom: 6 },
  scoreTileValue: { color: '#f5f7ff', fontSize: 17, fontWeight: '900' },
  sharePoster: {
    borderRadius: 30,
    overflow: 'hidden',
    marginBottom: 18,
    backgroundColor: '#09101d',
    aspectRatio: 9 / 16,
  },
  sharePosterGradient: {
    padding: 22,
    minHeight: 620,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  sharePosterGlowOne: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 999,
    top: -70,
    right: -20,
    backgroundColor: 'rgba(83,221,255,0.16)',
  },
  sharePosterGlowTwo: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 999,
    bottom: -40,
    left: -20,
    backgroundColor: 'rgba(215,255,83,0.14)',
  },
  shareEyebrow: {
    color: '#62dcff',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.6,
    marginBottom: 6,
  },
  shareTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  sharePill: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  sharePillLabel: { color: '#d7ff53', fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  shareBrand: { color: '#7d8cb3', fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  shareHeroCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 28,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 14,
  },
  shareLevelCaption: { color: '#95a4cb', fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  shareLevelValue: { color: '#f7fbff', fontSize: 72, lineHeight: 78, fontWeight: '900', marginTop: 6 },
  shareHeroTitle: { color: '#f7fbff', fontSize: 26, lineHeight: 31, fontWeight: '900', marginTop: 8 },
  shareHeroSubtitle: { color: '#b7c4e7', marginTop: 10, lineHeight: 21, fontSize: 15 },
  shareTitle: { color: '#f7fbff', fontSize: 28, fontWeight: '900' },
  shareSubtitle: { color: '#b7c4e7', marginTop: 8, lineHeight: 21, marginBottom: 18 },
  shareMetricsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  shareMetricCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  shareMetricLabel: { color: '#95a4cb', fontSize: 12, marginBottom: 8 },
  shareMetricValue: { color: '#f7fbff', fontSize: 24, fontWeight: '900' },
  shareFeatureCard: {
    backgroundColor: 'rgba(11,22,52,0.94)',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(83,221,255,0.14)',
  },
  shareFeatureCardAlt: {
    backgroundColor: 'rgba(19,26,55,0.9)',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(215,255,83,0.12)',
  },
  shareFeatureLabel: { color: '#95a4cb', fontSize: 12, marginBottom: 8 },
  shareFeatureValue: { color: '#ffffff', fontSize: 23, fontWeight: '900', lineHeight: 29 },
  shareFeatureHint: { color: '#a7b6d8', marginTop: 6, fontSize: 12 },
  shareMomentumBar: {
    marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  shareMomentumTitle: { color: '#d9ff6f', fontWeight: '900', fontSize: 12, marginBottom: 8, letterSpacing: 1.1 },
  shareMomentumValue: { color: '#f7fbff', fontSize: 20, fontWeight: '900', lineHeight: 26 },
  shareFooterRow: { marginTop: 16, gap: 8 },
  shareFooter: { color: '#8ea2ca', fontSize: 12, lineHeight: 18 },
  shareFooterTag: { color: '#62dcff', fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },
  sectionHeader: { marginTop: 8 },
  sectionTitle: { color: '#f5f7ff', fontSize: 20, fontWeight: '900' },
  sectionHint: { color: '#8897c3', marginTop: 4 },
  habitCard: { borderRadius: 28, padding: 18, backgroundColor: 'rgba(14,23,48,0.92)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  deleteActionWrap: { justifyContent: 'center', marginBottom: 18 },
  deleteAction: { width: 108, marginLeft: 12, backgroundColor: '#ff5f6d', borderRadius: 24, alignItems: 'center', justifyContent: 'center', height: '100%' },
  deleteActionLabel: { color: '#fff5f5', fontWeight: '900', fontSize: 15 },
  habitCardOverlay: { ...StyleSheet.absoluteFillObject },
  habitCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  habitEmoji: { fontSize: 20, marginBottom: 8 },
  habitName: { color: '#f5f7ff', fontSize: 24, fontWeight: '900' },
  habitMode: { color: '#93a2d0', marginTop: 4 },
  difficultyBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  difficultyText: { fontWeight: '900', fontSize: 12 },
  habitStatLine: { color: '#dfe5ff', marginTop: 16, fontSize: 16 },
  meterMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 8 },
  meterLabel: { color: '#93a2d0' },
  meterValue: { color: '#d6fe4c', fontWeight: '900' },
  meterTrack: { height: 12, borderRadius: 999, backgroundColor: '#16233f', overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: 999 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  cardScore: { color: '#fdfec4', fontWeight: '900' },
  cardChallenge: { color: '#55d9ff', fontWeight: '700' },
  timelineCard: { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 24, padding: 16, gap: 12 },
  emptyCard: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 24, padding: 18 },
  emptyTitle: { color: '#f5f7ff', fontWeight: '900', fontSize: 18, marginBottom: 8 },
  emptyText: { color: '#93a2d0', lineHeight: 21 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timelineDot: { width: 10, height: 10, borderRadius: 999, backgroundColor: '#4bf7cb' },
  timelineTextWrap: { flex: 1 },
  timelineTitle: { color: '#f5f7ff', fontWeight: '700' },
  timelineMeta: { color: '#93a2d0', marginTop: 2, fontSize: 12 },
  timelinePoints: { fontWeight: '900' },
  positive: { color: '#9ffe76' },
  negative: { color: '#ff7b7b' },
  formCard: { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 28, padding: 18, gap: 14 },
  fieldLabel: { color: '#f5f7ff', fontWeight: '800' },
  input: { backgroundColor: '#10192e', borderRadius: 16, borderWidth: 1, borderColor: '#24324e', color: '#f5f7ff', paddingHorizontal: 14, paddingVertical: 14 },
  optionRow: { flexDirection: 'row', gap: 10 },
  optionChip: { flex: 1, borderRadius: 16, backgroundColor: '#10192e', borderWidth: 1, borderColor: '#24324e', paddingVertical: 14, alignItems: 'center' },
  optionChipActive: { borderColor: '#53ddff', backgroundColor: 'rgba(83,221,255,0.16)' },
  optionLabel: { color: '#9aa9d2', fontWeight: '800' },
  optionLabelActive: { color: '#f5f7ff' },
  submitButton: { marginTop: 10, backgroundColor: '#d7ff53', borderRadius: 18, paddingVertical: 16, alignItems: 'center' },
  submitLabel: { color: '#09101f', fontWeight: '900', fontSize: 16 },
  secondaryButton: { marginTop: 8, backgroundColor: '#53ddff', borderRadius: 18, paddingVertical: 16, alignItems: 'center' },
  secondaryButtonLabel: { color: '#07111f', fontWeight: '900', fontSize: 16 },
  ghostButton: { borderRadius: 18, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: '#33415f' },
  ghostButtonLabel: { color: '#d7dff9', fontWeight: '800', fontSize: 16 },
  aboutDock: { marginTop: 8, alignItems: 'flex-end' },
  infoTrigger: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 6 },
  infoTriggerIcon: { color: '#68728f', fontSize: 14 },
  infoTriggerLabel: { color: '#68728f', fontSize: 12, fontWeight: '700' },
  aboutPanel: { alignSelf: 'stretch', marginTop: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 22, padding: 16, gap: 12 },
  aboutText: { color: '#aab4d2', lineHeight: 20 },
  aboutLink: { color: '#8fdfff', fontWeight: '700' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  smallHint: { color: '#7f8db7', marginTop: 4 },
  weekdayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  weekdayChip: { width: '22%', minWidth: 60, borderRadius: 14, backgroundColor: '#10192e', borderWidth: 1, borderColor: '#24324e', paddingVertical: 12, alignItems: 'center' },
  weekdayChipActive: { backgroundColor: 'rgba(83,221,255,0.16)', borderColor: '#53ddff' },
  weekdayLabel: { color: '#9aa9d2', fontWeight: '800' },
  weekdayLabelActive: { color: '#f5f7ff' },
  statsBlock: { backgroundColor: '#10192e', borderRadius: 20, borderWidth: 1, borderColor: '#24324e', padding: 16 },
  statsLabel: { color: '#93a2d0', marginBottom: 8 },
  statsValue: { color: '#f5f7ff', fontWeight: '900', fontSize: 18 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(2, 5, 14, 0.72)', justifyContent: 'flex-end' },
  modalCard: { maxHeight: '88%', borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: '#07111f', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 18, paddingTop: 18 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  closeLabel: { color: '#55d9ff', fontWeight: '800' },
  modalContent: { paddingBottom: 48 },
  detailHero: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 24, padding: 18, marginBottom: 18 },
  detailBigStat: { color: '#fdfec4', fontSize: 34, fontWeight: '900' },
  detailStatsGrid: { flexDirection: 'row', gap: 10, marginTop: 14 },
  detailInfoBlock: { marginTop: 12, backgroundColor: '#10192e', borderRadius: 20, borderWidth: 1, borderColor: '#24324e', padding: 16 },
  comebackCard: { marginTop: 18, backgroundColor: 'rgba(215,255,83,0.12)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(215,255,83,0.4)', padding: 16 },
  comebackTitle: { color: '#fdfec4', fontWeight: '900', fontSize: 16 },
  comebackText: { color: '#dbe3ff', marginTop: 6 },
  actionStack: { gap: 10, marginTop: 18 },
  completeButton: { backgroundColor: '#47f5cf', borderRadius: 18, paddingVertical: 15, alignItems: 'center' },
  delayButton: { backgroundColor: '#55d9ff', borderRadius: 18, paddingVertical: 15, alignItems: 'center' },
  collapseButton: { backgroundColor: '#ff5f6d', borderRadius: 18, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  actionLabel: { color: '#07111f', fontWeight: '900', fontSize: 16 },
  collapseLabel: { color: '#fff5f5', fontWeight: '900', fontSize: 16 },
  achievementWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12, marginBottom: 6 },
  achievementChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'rgba(83,221,255,0.12)', borderWidth: 1, borderColor: 'rgba(83,221,255,0.34)' },
  achievementText: { color: '#dcf9ff', fontWeight: '800' },
  dialogBackdrop: { flex: 1, backgroundColor: 'rgba(2, 5, 14, 0.75)', justifyContent: 'center', paddingHorizontal: 24 },
  dialogCard: { borderRadius: 28, padding: 20, borderWidth: 1 },
  dialogCardNeutral: { backgroundColor: '#0b1325', borderColor: 'rgba(255,255,255,0.09)' },
  dialogCardSuccess: { backgroundColor: '#091a22', borderColor: 'rgba(71,245,207,0.32)' },
  dialogCardDanger: { backgroundColor: '#211019', borderColor: 'rgba(255,95,109,0.28)' },
  dialogTitle: { color: '#f5f7ff', fontSize: 24, fontWeight: '900' },
  dialogMessage: { color: '#d5dcf4', marginTop: 10, lineHeight: 22 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 20 },
  dialogSecondaryButton: { borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: '#3a4766' },
  dialogSecondaryLabel: { color: '#d5dcf4', fontWeight: '800' },
  dialogPrimaryButton: { borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 },
  dialogPrimarySuccess: { backgroundColor: '#47f5cf' },
  dialogPrimaryDanger: { backgroundColor: '#ff5f6d' },
  dialogPrimaryLabel: { color: '#07111f', fontWeight: '900' },
});
