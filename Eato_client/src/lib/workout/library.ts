// The exercise library the workout engine draws from (ported from FORMA's
// convex/lib/exerciseLibrary.ts). Pure data: no React Native or "@/" imports, so the
// Express server can load it too (like src/lib/nutrition).

/** The muscle group an exercise is listed under (the admin library's filter chips). */
export type MuscleGroup = 'legs' | 'chest' | 'back' | 'shoulders' | 'arms' | 'core' | 'full_body' | 'cardio';

/**
 * How an exercise moves the body. The engine fills a session's slots by
 * pattern, so every row must carry one; `warmup` and `stretch` bracket a
 * session and `conditioning` is the finisher.
 */
export type MovementPattern =
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'knee_flexion'
  | 'knee_extension'
  | 'calf'
  | 'horizontal_push'
  | 'vertical_push'
  | 'horizontal_pull'
  | 'vertical_pull'
  | 'elbow_flexion'
  | 'elbow_extension'
  | 'shoulder_abduction'
  | 'rear_delt'
  | 'core'
  | 'conditioning'
  | 'warmup'
  | 'stretch';

/** Which half of the body a warm-up or stretch prepares. */
export type BodyRegion = 'lower' | 'upper' | 'any';

/**
 * What the engine reads about an exercise. `difficulty` follows a rubric
 * (complexity, stability, skill, loading), not how hard it feels; `highRisk`
 * marks heavy axial loading and plyometrics; `lowImpact` marks moves safe
 * for heavier bodies; `machine` covers machines and cables.
 */
export type LibraryExercise = {
  name: string;
  muscleGroup: MuscleGroup;
  equipment: string;
  pattern: MovementPattern;
  difficulty: 1 | 2 | 3;
  highRisk: boolean;
  lowImpact: boolean;
  machine: boolean;
  region: BodyRegion;
  /** Held or performed for time rather than counted; the base seconds. */
  timedSec?: number;
  instructions?: string[];
};

type Row = Omit<LibraryExercise, 'highRisk' | 'lowImpact' | 'machine' | 'region'> &
  Partial<Pick<LibraryExercise, 'highRisk' | 'lowImpact' | 'machine' | 'region'>>;

const row = (r: Row): LibraryExercise => ({
  highRisk: false,
  lowImpact: true,
  machine: false,
  region: 'any',
  ...r,
});

/**
 * The starter exercise library. Names are the stable keys the engine emits and
 * the seed resolves to rows, so a rename here must keep old plans readable
 * (rows are only ever added, never deleted). No row invents an image.
 */
export const EXERCISE_LIBRARY: LibraryExercise[] = [
  // ---- Squat pattern -------------------------------------------------------
  row({ name: 'Bodyweight Squat', muscleGroup: 'legs', equipment: 'Bodyweight', pattern: 'squat', difficulty: 1, region: 'lower', instructions: ['Feet shoulder-width apart, toes slightly out.', 'Sit back and down until thighs are parallel.', 'Drive through your heels to stand.'] }),
  row({ name: 'Dumbbell Goblet Squat', muscleGroup: 'legs', equipment: 'Dumbbell', pattern: 'squat', difficulty: 1, region: 'lower', instructions: ['Hold one dumbbell at your chest.', 'Squat between your knees, chest tall.', 'Stand up without letting the knees cave.'] }),
  row({ name: 'Leg Press', muscleGroup: 'legs', equipment: 'Machine', pattern: 'squat', difficulty: 1, machine: true, region: 'lower', instructions: ['Feet mid-platform, hip-width apart.', 'Lower until knees reach ninety degrees.', 'Press back without locking the knees.'] }),
  row({ name: 'Hack Squat', muscleGroup: 'legs', equipment: 'Machine', pattern: 'squat', difficulty: 2, machine: true, region: 'lower', instructions: ['Shoulders under the pads, feet mid-platform.', 'Lower under control, drive up through the whole foot.'] }),
  row({ name: 'Barbell Back Squat', muscleGroup: 'legs', equipment: 'Barbell', pattern: 'squat', difficulty: 3, highRisk: true, region: 'lower', instructions: ['Bar on the upper back, brace hard.', 'Sit down between the hips, knees tracking the toes.', 'Drive up keeping the chest tall.'] }),
  row({ name: 'Barbell Front Squat', muscleGroup: 'legs', equipment: 'Barbell', pattern: 'squat', difficulty: 3, highRisk: true, region: 'lower', instructions: ['Bar on the front delts, elbows high.', 'Squat deep with an upright torso.'] }),
  // ---- Hinge pattern -------------------------------------------------------
  row({ name: 'Glute Bridge', muscleGroup: 'legs', equipment: 'Bodyweight', pattern: 'hinge', difficulty: 1, region: 'lower', instructions: ['Lie on your back, knees bent.', 'Drive the hips up and squeeze the glutes.'] }),
  row({ name: 'Kettlebell Deadlift', muscleGroup: 'legs', equipment: 'Kettlebell', pattern: 'hinge', difficulty: 1, region: 'lower', instructions: ['Bell between the feet, flat back.', 'Push the floor away and stand tall.'] }),
  row({ name: 'Back Extension', muscleGroup: 'legs', equipment: 'Machine', pattern: 'hinge', difficulty: 1, machine: true, region: 'lower', instructions: ['Hips on the pad, hinge down with a flat back.', 'Squeeze the glutes to come up level.'] }),
  row({ name: 'Romanian Deadlift', muscleGroup: 'legs', equipment: 'Dumbbell', pattern: 'hinge', difficulty: 2, region: 'lower', instructions: ['Soft knees, dumbbells against the thighs.', 'Hinge at the hips, back flat, until you feel the hamstrings.', 'Squeeze the glutes to return.'] }),
  row({ name: 'Hip Thrust', muscleGroup: 'legs', equipment: 'Barbell', pattern: 'hinge', difficulty: 2, highRisk: true, region: 'lower', instructions: ['Upper back on a bench, bar across the hips.', 'Drive the hips to full extension, chin tucked.'] }),
  row({ name: 'Barbell Romanian Deadlift', muscleGroup: 'legs', equipment: 'Barbell', pattern: 'hinge', difficulty: 3, highRisk: true, region: 'lower', instructions: ['Bar against the thighs, shoulders back.', 'Hinge until the hamstrings load, then stand.'] }),
  // ---- Lunge / step pattern -----------------------------------------------
  row({ name: 'Reverse Lunge', muscleGroup: 'legs', equipment: 'Bodyweight', pattern: 'lunge', difficulty: 1, region: 'lower', instructions: ['Step back and lower the back knee towards the floor.', 'Push through the front heel to return.'] }),
  row({ name: 'Dumbbell Step-Up', muscleGroup: 'legs', equipment: 'Dumbbell', pattern: 'lunge', difficulty: 1, region: 'lower', instructions: ['Whole foot on the box.', 'Drive through the top leg, control the way down.'] }),
  row({ name: 'Walking Lunge', muscleGroup: 'legs', equipment: 'Bodyweight', pattern: 'lunge', difficulty: 2, region: 'lower', instructions: ['Step forward and lower the back knee towards the floor.', 'Push through the front heel into the next step.'] }),
  row({ name: 'Bulgarian Split Squat', muscleGroup: 'legs', equipment: 'Dumbbell', pattern: 'lunge', difficulty: 3, region: 'lower', instructions: ['Rear foot on a bench.', 'Lower straight down, front knee over the toes.'] }),
  // ---- Knee flexion / extension / calf ------------------------------------
  row({ name: 'Leg Curl', muscleGroup: 'legs', equipment: 'Machine', pattern: 'knee_flexion', difficulty: 1, machine: true, region: 'lower', instructions: ['Pad just above the heels.', 'Curl towards the glutes, then lower slowly.'] }),
  row({ name: 'Nordic Hamstring Curl', muscleGroup: 'legs', equipment: 'Bodyweight', pattern: 'knee_flexion', difficulty: 3, region: 'lower', instructions: ['Ankles anchored, lower the body slowly.', 'Push back up with the hands as needed.'] }),
  row({ name: 'Leg Extension', muscleGroup: 'legs', equipment: 'Machine', pattern: 'knee_extension', difficulty: 1, machine: true, region: 'lower', instructions: ['Pad on the shins.', 'Extend until the legs are straight, pause, lower under control.'] }),
  row({ name: 'Calf Raise', muscleGroup: 'legs', equipment: 'Bodyweight', pattern: 'calf', difficulty: 1, region: 'lower', instructions: ['Rise onto the balls of the feet.', 'Pause at the top, lower slowly.'] }),
  row({ name: 'Seated Calf Raise', muscleGroup: 'legs', equipment: 'Machine', pattern: 'calf', difficulty: 1, machine: true, region: 'lower', instructions: ['Pads on the knees.', 'Full stretch at the bottom, squeeze at the top.'] }),
  // ---- Horizontal push -----------------------------------------------------
  row({ name: 'Incline Push-Up', muscleGroup: 'chest', equipment: 'Bodyweight', pattern: 'horizontal_push', difficulty: 1, region: 'upper', instructions: ['Hands on a bench, body in one line.', 'Lower the chest to the bench, press away.'] }),
  row({ name: 'Chest Press Machine', muscleGroup: 'chest', equipment: 'Machine', pattern: 'horizontal_push', difficulty: 1, machine: true, region: 'upper', instructions: ['Handles level with the mid-chest.', 'Press out without locking the elbows.'] }),
  row({ name: 'Pec Deck', muscleGroup: 'chest', equipment: 'Machine', pattern: 'horizontal_push', difficulty: 1, machine: true, region: 'upper', instructions: ['Slight bend in the elbows.', 'Bring the pads together, control the return.'] }),
  row({ name: 'Push-Up', muscleGroup: 'chest', equipment: 'Bodyweight', pattern: 'horizontal_push', difficulty: 2, region: 'upper', instructions: ['Hands under the shoulders, body in one line.', 'Lower the chest to the floor, press back up.'] }),
  row({ name: 'Dumbbell Bench Press', muscleGroup: 'chest', equipment: 'Dumbbell', pattern: 'horizontal_push', difficulty: 2, region: 'upper', instructions: ['Lie flat, dumbbells over the chest.', 'Lower to the sides of the chest, press up and slightly in.'] }),
  row({ name: 'Incline Dumbbell Press', muscleGroup: 'chest', equipment: 'Dumbbell', pattern: 'horizontal_push', difficulty: 2, region: 'upper', instructions: ['Bench at thirty degrees.', 'Press from the upper chest, elbows at forty-five degrees.'] }),
  row({ name: 'Cable Fly', muscleGroup: 'chest', equipment: 'Cable', pattern: 'horizontal_push', difficulty: 2, machine: true, region: 'upper', instructions: ['Slight bend in the elbows.', 'Bring the hands together in front of the chest, control the return.'] }),
  row({ name: 'Barbell Bench Press', muscleGroup: 'chest', equipment: 'Barbell', pattern: 'horizontal_push', difficulty: 3, region: 'upper', instructions: ['Shoulder blades pinned, feet planted.', 'Lower the bar to the lower chest, press up.'] }),
  // ---- Vertical push -------------------------------------------------------
  row({ name: 'Shoulder Press Machine', muscleGroup: 'shoulders', equipment: 'Machine', pattern: 'vertical_push', difficulty: 1, machine: true, region: 'upper', instructions: ['Handles at ear height.', 'Press up without shrugging.'] }),
  row({ name: 'Dumbbell Shoulder Press', muscleGroup: 'shoulders', equipment: 'Dumbbell', pattern: 'vertical_push', difficulty: 2, region: 'upper', instructions: ['Dumbbells at ear height.', 'Press overhead without arching the lower back.'] }),
  row({ name: 'Barbell Overhead Press', muscleGroup: 'shoulders', equipment: 'Barbell', pattern: 'vertical_push', difficulty: 3, highRisk: true, region: 'upper', instructions: ['Bar on the front delts, glutes tight.', 'Press overhead and bring the head through.'] }),
  // ---- Horizontal pull -----------------------------------------------------
  row({ name: 'Seated Cable Row', muscleGroup: 'back', equipment: 'Cable', pattern: 'horizontal_pull', difficulty: 1, machine: true, region: 'upper', instructions: ['Sit tall, chest up.', 'Row to the stomach, squeeze the shoulder blades.'] }),
  row({ name: 'Chest-Supported Row', muscleGroup: 'back', equipment: 'Machine', pattern: 'horizontal_pull', difficulty: 1, machine: true, region: 'upper', instructions: ['Chest on the pad.', 'Row the handles back, elbows close.'] }),
  row({ name: 'Dumbbell Row', muscleGroup: 'back', equipment: 'Dumbbell', pattern: 'horizontal_pull', difficulty: 2, region: 'upper', instructions: ['One hand on the bench, flat back.', 'Row the dumbbell to the hip, lower slowly.'] }),
  row({ name: 'Inverted Row', muscleGroup: 'back', equipment: 'Bodyweight', pattern: 'horizontal_pull', difficulty: 2, region: 'upper', instructions: ['Hang under a bar, body straight.', 'Pull the chest to the bar.'] }),
  row({ name: 'Barbell Row', muscleGroup: 'back', equipment: 'Barbell', pattern: 'horizontal_pull', difficulty: 3, highRisk: true, region: 'upper', instructions: ['Hinge to forty-five degrees, flat back.', 'Row the bar to the lower ribs.'] }),
  // ---- Vertical pull -------------------------------------------------------
  row({ name: 'Lat Pulldown', muscleGroup: 'back', equipment: 'Cable', pattern: 'vertical_pull', difficulty: 1, machine: true, region: 'upper', instructions: ['Grip just wider than the shoulders.', 'Pull the bar to the upper chest, elbows down and back.'] }),
  row({ name: 'Assisted Pull-Up', muscleGroup: 'back', equipment: 'Machine', pattern: 'vertical_pull', difficulty: 2, machine: true, region: 'upper', instructions: ['Knees on the pad.', 'Pull the chin over the bar, lower slowly.'] }),
  row({ name: 'Pull-Up', muscleGroup: 'back', equipment: 'Bodyweight', pattern: 'vertical_pull', difficulty: 3, region: 'upper', instructions: ['Hang with a full grip.', 'Pull the chin over the bar, lower with control.'] }),
  // ---- Shoulder isolation --------------------------------------------------
  row({ name: 'Lateral Raise', muscleGroup: 'shoulders', equipment: 'Dumbbell', pattern: 'shoulder_abduction', difficulty: 1, region: 'upper', instructions: ['Slight bend in the elbows.', 'Raise to shoulder height, lower slowly.'] }),
  row({ name: 'Cable Lateral Raise', muscleGroup: 'shoulders', equipment: 'Cable', pattern: 'shoulder_abduction', difficulty: 2, machine: true, region: 'upper', instructions: ['Cable low, arm across the body.', 'Raise to the side, control the return.'] }),
  row({ name: 'Face Pull', muscleGroup: 'back', equipment: 'Cable', pattern: 'rear_delt', difficulty: 1, machine: true, region: 'upper', instructions: ['Rope at face height.', 'Pull towards the forehead, elbows high.'] }),
  row({ name: 'Reverse Pec Deck', muscleGroup: 'shoulders', equipment: 'Machine', pattern: 'rear_delt', difficulty: 1, machine: true, region: 'upper', instructions: ['Chest on the pad, handles in front.', 'Sweep the arms back, squeeze the rear delts.'] }),
  row({ name: 'Rear Delt Fly', muscleGroup: 'shoulders', equipment: 'Dumbbell', pattern: 'rear_delt', difficulty: 2, region: 'upper', instructions: ['Hinge forward, dumbbells hanging.', 'Raise out to the sides, thumbs down.'] }),
  // ---- Arms ----------------------------------------------------------------
  row({ name: 'Dumbbell Bicep Curl', muscleGroup: 'arms', equipment: 'Dumbbell', pattern: 'elbow_flexion', difficulty: 1, region: 'upper', instructions: ['Elbows pinned to the sides.', 'Curl up, lower under control.'] }),
  row({ name: 'Hammer Curl', muscleGroup: 'arms', equipment: 'Dumbbell', pattern: 'elbow_flexion', difficulty: 1, region: 'upper', instructions: ['Palms facing each other.', 'Curl without swinging.'] }),
  row({ name: 'Cable Curl', muscleGroup: 'arms', equipment: 'Cable', pattern: 'elbow_flexion', difficulty: 1, machine: true, region: 'upper', instructions: ['Bar at the thighs, elbows still.', 'Curl to the shoulders, lower slowly.'] }),
  row({ name: 'Triceps Pushdown', muscleGroup: 'arms', equipment: 'Cable', pattern: 'elbow_extension', difficulty: 1, machine: true, region: 'upper', instructions: ['Elbows at the sides.', 'Push down until the arms are straight.'] }),
  row({ name: 'Overhead Triceps Extension', muscleGroup: 'arms', equipment: 'Dumbbell', pattern: 'elbow_extension', difficulty: 2, region: 'upper', instructions: ['Dumbbell overhead, elbows pointing forward.', 'Lower behind the head, press back up.'] }),
  row({ name: 'Dip', muscleGroup: 'arms', equipment: 'Bodyweight', pattern: 'elbow_extension', difficulty: 3, region: 'upper', instructions: ['Support on the bars, lean slightly forward.', 'Lower until the shoulders reach the elbows, press up.'] }),
  // ---- Core ----------------------------------------------------------------
  row({ name: 'Plank', muscleGroup: 'core', equipment: 'Bodyweight', pattern: 'core', difficulty: 1, timedSec: 30, instructions: ['Forearms down, body in one line.', 'Brace the stomach and breathe.'] }),
  row({ name: 'Dead Bug', muscleGroup: 'core', equipment: 'Bodyweight', pattern: 'core', difficulty: 1, timedSec: 30, instructions: ['Lower back pressed into the floor.', 'Extend the opposite arm and leg, then switch.'] }),
  row({ name: 'Pallof Press', muscleGroup: 'core', equipment: 'Cable', pattern: 'core', difficulty: 2, machine: true, instructions: ['Cable at chest height, stand side-on.', 'Press the handle out and resist the twist.'] }),
  row({ name: 'Cable Crunch', muscleGroup: 'core', equipment: 'Cable', pattern: 'core', difficulty: 2, machine: true, instructions: ['Kneel under the rope.', 'Crunch the ribs towards the hips.'] }),
  row({ name: 'Hanging Knee Raise', muscleGroup: 'core', equipment: 'Bodyweight', pattern: 'core', difficulty: 2, instructions: ['Hang from the bar.', 'Raise the knees to hip height, lower slowly.'] }),
  // ---- Conditioning --------------------------------------------------------
  row({ name: 'Stationary Bike', muscleGroup: 'cardio', equipment: 'Machine', pattern: 'conditioning', difficulty: 1, machine: true, timedSec: 600, instructions: ['Steady pace you could hold a conversation at.'] }),
  row({ name: 'Rowing Machine', muscleGroup: 'cardio', equipment: 'Machine', pattern: 'conditioning', difficulty: 1, machine: true, timedSec: 600, instructions: ['Legs, then body, then arms. Reverse on the way back.'] }),
  row({ name: 'Incline Treadmill Walk', muscleGroup: 'cardio', equipment: 'Machine', pattern: 'conditioning', difficulty: 1, machine: true, timedSec: 600, instructions: ['Brisk walk at a steep incline, no hands on the rails.'] }),
  row({ name: 'Stair Climber', muscleGroup: 'cardio', equipment: 'Machine', pattern: 'conditioning', difficulty: 2, machine: true, timedSec: 600, instructions: ['Stand tall, light touch on the rails.'] }),
  row({ name: 'Battle Ropes', muscleGroup: 'cardio', equipment: 'Battle rope', pattern: 'conditioning', difficulty: 2, timedSec: 600, instructions: ['Alternating waves in twenty-second bursts.'] }),
  row({ name: 'Jump Rope', muscleGroup: 'cardio', equipment: 'Rope', pattern: 'conditioning', difficulty: 2, highRisk: true, lowImpact: false, timedSec: 600, instructions: ['Light bounces, wrists turning the rope.'] }),
  row({ name: 'Burpee', muscleGroup: 'full_body', equipment: 'Bodyweight', pattern: 'conditioning', difficulty: 3, highRisk: true, lowImpact: false, timedSec: 600, instructions: ['Squat, kick back, push-up, jump.'] }),
  // ---- Warm-ups ------------------------------------------------------------
  row({ name: 'Treadmill Walk', muscleGroup: 'cardio', equipment: 'Machine', pattern: 'warmup', difficulty: 1, machine: true, region: 'lower', timedSec: 180 }),
  row({ name: 'Leg Swings', muscleGroup: 'full_body', equipment: 'Bodyweight', pattern: 'warmup', difficulty: 1, region: 'lower', timedSec: 60 }),
  row({ name: 'Arm Circles', muscleGroup: 'full_body', equipment: 'Bodyweight', pattern: 'warmup', difficulty: 1, region: 'upper', timedSec: 45 }),
  row({ name: 'Band Pull-Apart', muscleGroup: 'back', equipment: 'Resistance band', pattern: 'warmup', difficulty: 1, region: 'upper', timedSec: 60 }),
  row({ name: 'Jumping Jacks', muscleGroup: 'cardio', equipment: 'Bodyweight', pattern: 'warmup', difficulty: 1, lowImpact: false, region: 'any', timedSec: 60 }),
  row({ name: "World's Greatest Stretch", muscleGroup: 'full_body', equipment: 'Bodyweight', pattern: 'warmup', difficulty: 1, region: 'any', timedSec: 60 }),
  // ---- Stretches (cool-downs) ---------------------------------------------
  row({ name: 'Standing Quad Stretch: Left', muscleGroup: 'legs', equipment: 'Bodyweight', pattern: 'stretch', difficulty: 1, region: 'lower', timedSec: 40, instructions: ['Hold the left foot behind you, knees together.', 'Breathe and keep the hips forward.'] }),
  row({ name: 'Standing Quad Stretch: Right', muscleGroup: 'legs', equipment: 'Bodyweight', pattern: 'stretch', difficulty: 1, region: 'lower', timedSec: 40, instructions: ['Hold the right foot behind you, knees together.', 'Breathe and keep the hips forward.'] }),
  row({ name: 'Standing Hamstring Stretch', muscleGroup: 'legs', equipment: 'Bodyweight', pattern: 'stretch', difficulty: 1, region: 'lower', timedSec: 40, instructions: ['One heel forward, hinge at the hips with a flat back.'] }),
  row({ name: 'Chest Doorway Stretch', muscleGroup: 'chest', equipment: 'Bodyweight', pattern: 'stretch', difficulty: 1, region: 'upper', timedSec: 40, instructions: ['Forearm on the frame, step through until the chest opens.'] }),
  row({ name: 'Lat Stretch', muscleGroup: 'back', equipment: 'Bodyweight', pattern: 'stretch', difficulty: 1, region: 'upper', timedSec: 40, instructions: ['Hold a post, sit the hips back and let the side of the back lengthen.'] }),
  row({ name: 'Cross-Body Shoulder Stretch', muscleGroup: 'shoulders', equipment: 'Bodyweight', pattern: 'stretch', difficulty: 1, region: 'upper', timedSec: 40, instructions: ['Pull one arm across the chest with the other.'] }),
  row({ name: "Child's Pose", muscleGroup: 'full_body', equipment: 'Bodyweight', pattern: 'stretch', difficulty: 1, region: 'any', timedSec: 40, instructions: ['Knees wide, hips to heels, arms long.', 'Breathe into the lower back.'] }),
  row({ name: 'Cat-Cow', muscleGroup: 'core', equipment: 'Bodyweight', pattern: 'stretch', difficulty: 1, region: 'any', timedSec: 40, instructions: ['On all fours, alternate rounding and arching the spine.'] }),
];
