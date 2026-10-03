/**
 * The exercise library: common movements for fast search. Metadata is descriptive only
 * (primary muscle, equipment) — it is never used to recommend or program anything.
 * A library exercise becomes a row in the user's own `exercises` table the first time they use it.
 */

export type Muscle =
  | 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'forearms' | 'core' | 'quads' | 'hamstrings'
  | 'glutes' | 'calves' | 'full_body' | 'cardio' | 'other';
export type Equipment = 'barbell' | 'dumbbell' | 'cable' | 'machine' | 'bodyweight' | 'kettlebell' | 'band' | 'other';

export interface CatalogExercise {
  key: string;
  name: string;
  muscle: Muscle;
  equipment: Equipment;
}

export const MUSCLE_LABEL: Record<Muscle, string> = {
  chest: 'Chest', back: 'Back', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps', forearms: 'Forearms',
  core: 'Core', quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes', calves: 'Calves', full_body: 'Full body',
  cardio: 'Cardio', other: 'Other',
};

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  barbell: 'Barbell', dumbbell: 'Dumbbell', cable: 'Cable', machine: 'Machine', bodyweight: 'Bodyweight',
  kettlebell: 'Kettlebell', band: 'Band', other: 'Other',
};

const E = (key: string, name: string, muscle: Muscle, equipment: Equipment): CatalogExercise => ({ key, name, muscle, equipment });

export const EXERCISE_CATALOG: CatalogExercise[] = [
  // chest
  E('bench_press', 'Bench Press', 'chest', 'barbell'),
  E('incline_bench_press', 'Incline Bench Press', 'chest', 'barbell'),
  E('decline_bench_press', 'Decline Bench Press', 'chest', 'barbell'),
  E('db_bench_press', 'Dumbbell Bench Press', 'chest', 'dumbbell'),
  E('incline_db_press', 'Incline Dumbbell Press', 'chest', 'dumbbell'),
  E('db_fly', 'Dumbbell Fly', 'chest', 'dumbbell'),
  E('cable_fly', 'Cable Fly', 'chest', 'cable'),
  E('chest_press_machine', 'Chest Press Machine', 'chest', 'machine'),
  E('pec_deck', 'Pec Deck', 'chest', 'machine'),
  E('push_up', 'Push-up', 'chest', 'bodyweight'),
  E('dips', 'Dips', 'chest', 'bodyweight'),
  // back
  E('deadlift', 'Deadlift', 'back', 'barbell'),
  E('barbell_row', 'Barbell Row', 'back', 'barbell'),
  E('pendlay_row', 'Pendlay Row', 'back', 'barbell'),
  E('t_bar_row', 'T-Bar Row', 'back', 'barbell'),
  E('db_row', 'Dumbbell Row', 'back', 'dumbbell'),
  E('pull_up', 'Pull-up', 'back', 'bodyweight'),
  E('chin_up', 'Chin-up', 'back', 'bodyweight'),
  E('lat_pulldown', 'Lat Pulldown', 'back', 'cable'),
  E('seated_cable_row', 'Seated Cable Row', 'back', 'cable'),
  E('straight_arm_pulldown', 'Straight-Arm Pulldown', 'back', 'cable'),
  E('machine_row', 'Machine Row', 'back', 'machine'),
  E('back_extension', 'Back Extension', 'back', 'bodyweight'),
  // shoulders
  E('overhead_press', 'Overhead Press', 'shoulders', 'barbell'),
  E('db_shoulder_press', 'Dumbbell Shoulder Press', 'shoulders', 'dumbbell'),
  E('arnold_press', 'Arnold Press', 'shoulders', 'dumbbell'),
  E('lateral_raise', 'Lateral Raise', 'shoulders', 'dumbbell'),
  E('cable_lateral_raise', 'Cable Lateral Raise', 'shoulders', 'cable'),
  E('rear_delt_fly', 'Rear Delt Fly', 'shoulders', 'dumbbell'),
  E('face_pull', 'Face Pull', 'shoulders', 'cable'),
  E('shoulder_press_machine', 'Shoulder Press Machine', 'shoulders', 'machine'),
  E('upright_row', 'Upright Row', 'shoulders', 'barbell'),
  E('shrug', 'Shrug', 'back', 'dumbbell'),
  // arms
  E('barbell_curl', 'Barbell Curl', 'biceps', 'barbell'),
  E('db_curl', 'Dumbbell Curl', 'biceps', 'dumbbell'),
  E('hammer_curl', 'Hammer Curl', 'biceps', 'dumbbell'),
  E('incline_db_curl', 'Incline Dumbbell Curl', 'biceps', 'dumbbell'),
  E('preacher_curl', 'Preacher Curl', 'biceps', 'machine'),
  E('cable_curl', 'Cable Curl', 'biceps', 'cable'),
  E('triceps_pushdown', 'Triceps Pushdown', 'triceps', 'cable'),
  E('overhead_triceps_extension', 'Overhead Triceps Extension', 'triceps', 'cable'),
  E('skull_crusher', 'Skull Crusher', 'triceps', 'barbell'),
  E('close_grip_bench', 'Close-Grip Bench Press', 'triceps', 'barbell'),
  E('wrist_curl', 'Wrist Curl', 'forearms', 'dumbbell'),
  // legs
  E('squat', 'Squat', 'quads', 'barbell'),
  E('front_squat', 'Front Squat', 'quads', 'barbell'),
  E('hack_squat', 'Hack Squat', 'quads', 'machine'),
  E('leg_press', 'Leg Press', 'quads', 'machine'),
  E('leg_extension', 'Leg Extension', 'quads', 'machine'),
  E('bulgarian_split_squat', 'Bulgarian Split Squat', 'quads', 'dumbbell'),
  E('lunge', 'Lunge', 'quads', 'dumbbell'),
  E('goblet_squat', 'Goblet Squat', 'quads', 'dumbbell'),
  E('romanian_deadlift', 'Romanian Deadlift', 'hamstrings', 'barbell'),
  E('lying_leg_curl', 'Lying Leg Curl', 'hamstrings', 'machine'),
  E('seated_leg_curl', 'Seated Leg Curl', 'hamstrings', 'machine'),
  E('good_morning', 'Good Morning', 'hamstrings', 'barbell'),
  E('hip_thrust', 'Hip Thrust', 'glutes', 'barbell'),
  E('glute_bridge', 'Glute Bridge', 'glutes', 'bodyweight'),
  E('cable_kickback', 'Cable Kickback', 'glutes', 'cable'),
  E('hip_abduction', 'Hip Abduction', 'glutes', 'machine'),
  E('standing_calf_raise', 'Standing Calf Raise', 'calves', 'machine'),
  E('seated_calf_raise', 'Seated Calf Raise', 'calves', 'machine'),
  // core
  E('plank', 'Plank', 'core', 'bodyweight'),
  E('hanging_leg_raise', 'Hanging Leg Raise', 'core', 'bodyweight'),
  E('cable_crunch', 'Cable Crunch', 'core', 'cable'),
  E('ab_wheel', 'Ab Wheel Rollout', 'core', 'other'),
  E('russian_twist', 'Russian Twist', 'core', 'bodyweight'),
  E('crunch', 'Crunch', 'core', 'bodyweight'),
  // full body / conditioning
  E('kettlebell_swing', 'Kettlebell Swing', 'full_body', 'kettlebell'),
  E('clean', 'Power Clean', 'full_body', 'barbell'),
  E('farmers_carry', 'Farmer’s Carry', 'full_body', 'dumbbell'),
  E('burpee', 'Burpee', 'full_body', 'bodyweight'),
  E('rowing_machine', 'Rowing Machine', 'cardio', 'machine'),
  E('treadmill', 'Treadmill', 'cardio', 'machine'),
  E('stationary_bike', 'Stationary Bike', 'cardio', 'machine'),
  E('stair_climber', 'Stair Climber', 'cardio', 'machine'),
];

export const CATALOG_BY_KEY = new Map(EXERCISE_CATALOG.map((e) => [e.key, e]));

/** Search: whole-name prefix first, then word prefix, then substring. */
export function searchCatalog(query: string, limit = 12): CatalogExercise[] {
  const q = query.trim().toLowerCase();
  if (!q) return EXERCISE_CATALOG.slice(0, limit);
  const name = (e: CatalogExercise) => e.name.toLowerCase();
  const scored = EXERCISE_CATALOG.map((e) => {
    const n = name(e);
    const score = n.startsWith(q) ? 0 : n.split(/[\s-]+/).some((w) => w.startsWith(q)) ? 1 : n.includes(q) ? 2 : MUSCLE_LABEL[e.muscle].toLowerCase().startsWith(q) ? 3 : 9;
    return { e, score };
  }).filter((x) => x.score < 9);
  return scored.sort((a, b) => a.score - b.score || a.e.name.localeCompare(b.e.name)).slice(0, limit).map((x) => x.e);
}
