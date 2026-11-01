// The Fitness tab's starter programs: the six sections, each program's place (home, the center
// or both), level and sessions. Pure data with no React Native or "@/" imports, so the Express
// server seeds its fitness_programs table from it (fitness/programs.js) and the app shows the
// same cards when the server can't be reached. Every program is free.
//
// A session lists the movements it trains (the library's patterns, in order); the server fills
// each with an exercise from the exercise library that the program's kit allows, so every
// exercise has its steps and, once the admin adds it, its video. The admin can rewrite any
// program's sessions with the AI (Admin › Programs) after adding exercises to the library.

export type FitnessSection = 'popular' | 'categories' | 'build_muscle' | 'stay_fit' | 'dance' | 'workplace';
export type ProgramPlace = 'home' | 'center' | 'both';
export type ProgramLevel = 'beginner' | 'intermediate' | 'advanced';
// The equipment a program's sessions are built for (coach/planRules.js EQUIPMENT keys)
export type ProgramKit = 'none' | 'some' | 'full_gym';
export type ProgramIcon = 'yoga' | 'kids' | 'heart' | 'beginner' | 'boxing' | 'women' | 'strength' | 'split' | 'tone' | 'cardio' | 'foundation' | 'dance' | 'desk' | 'posture' | 'energy' | 'walk' | 'mom';
export type ProgramPalette = 'lavender' | 'coral' | 'mint' | 'sky' | 'amber' | 'rose' | 'ink' | 'teal';

export type SeedSession = { title: string; minutes: number; patterns: string[] };
export type SeedProgram = {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  section: FitnessSection;
  place: ProgramPlace;
  level: ProgramLevel;
  kit: ProgramKit;
  icon: ProgramIcon;
  palette: ProgramPalette;
  sessions: SeedSession[];
};

export const SECTION_ORDER: FitnessSection[] = ['popular', 'categories', 'build_muscle', 'stay_fit', 'dance', 'workplace'];

export const SECTION_TITLE: Record<FitnessSection, string> = {
  popular: 'Popular Programs',
  categories: 'Fitness Categories',
  build_muscle: 'Build Muscle',
  stay_fit: 'Stay Fit',
  dance: 'Dance Fitness',
  workplace: 'Workplace Wellness',
};

export const SECTION_NOTE: Record<FitnessSection, string> = {
  popular: 'What members are doing right now',
  categories: 'Start with what you enjoy',
  build_muscle: 'Get stronger, week by week',
  stay_fit: 'Keep your fitness up all year',
  dance: 'Move to the music and burn calories',
  workplace: 'Short sessions for the workday, at your desk or with your team',
};

const S = (title: string, minutes: number, patterns: string[]): SeedSession => ({ title, minutes, patterns });

export const PROGRAMS: SeedProgram[] = [
  // ---- Popular ----------------------------------------------------------------------------
  {
    slug: 'strong-mom', title: 'Strong Mom', subtitle: 'Gentle strength for busy mothers',
    description: 'Low-impact sessions that rebuild your core, legs and posture, in under half an hour at home. Check with your doctor first if you had a baby recently.',
    section: 'popular', place: 'home', level: 'beginner', kit: 'none', icon: 'mom', palette: 'rose',
    sessions: [S('Core and posture', 20, ['core', 'hinge', 'horizontal_pull', 'core']), S('Legs and glutes', 20, ['squat', 'lunge', 'hinge', 'calf']), S('Full body flow', 25, ['squat', 'horizontal_push', 'core', 'lunge'])],
  },
  {
    slug: 'yoga-for-kids', title: 'Yoga for Kids', subtitle: 'Playful stretches for 6 to 12 year olds',
    description: 'Short, fun stretching sessions children can follow with a parent: balance, flexibility and calm. A grown-up should stay close by.',
    section: 'popular', place: 'home', level: 'beginner', kit: 'none', icon: 'kids', palette: 'amber',
    sessions: [S('Morning stretch', 15, ['stretch', 'core', 'stretch']), S('Balance play', 15, ['lunge', 'core', 'stretch']), S('Calm-down time', 15, ['stretch', 'stretch', 'core'])],
  },
  {
    slug: 'blood-sugar-balance', title: 'Blood Sugar Balance', subtitle: 'Daily movement that supports healthy sugar levels',
    description: 'Regular walking-pace cardio and simple strength work, the kind of activity that supports healthy blood sugar. Follow your doctor\'s advice on medicines and diet.',
    section: 'popular', place: 'both', level: 'beginner', kit: 'none', icon: 'heart', palette: 'teal',
    sessions: [S('Steady cardio', 25, ['conditioning', 'squat', 'horizontal_push', 'conditioning']), S('Strength basics', 25, ['squat', 'horizontal_pull', 'hinge', 'core']), S('After-meal moves', 15, ['conditioning', 'calf', 'core'])],
  },

  // ---- Fitness categories -------------------------------------------------------------------
  {
    slug: 'yoga-for-beginners', title: 'Yoga for Beginners', subtitle: 'Flexibility, breath and balance',
    description: 'Slow, steady sessions that open up tight hips, hamstrings and shoulders and strengthen your core.',
    section: 'categories', place: 'both', level: 'beginner', kit: 'none', icon: 'yoga', palette: 'lavender',
    sessions: [S('Wake up your body', 20, ['stretch', 'core', 'stretch', 'lunge']), S('Hips and hamstrings', 20, ['stretch', 'hinge', 'stretch', 'core']), S('Core and calm', 20, ['core', 'stretch', 'core', 'stretch'])],
  },
  {
    slug: 'workout-for-beginners', title: 'Workout for Beginners', subtitle: 'Your first four weeks of training',
    description: 'Learn the basic movements (squat, push, pull, hinge) with simple full-body sessions that build confidence.',
    section: 'categories', place: 'both', level: 'beginner', kit: 'none', icon: 'beginner', palette: 'sky',
    sessions: [S('Full body A', 30, ['squat', 'horizontal_push', 'horizontal_pull', 'core']), S('Full body B', 30, ['hinge', 'vertical_push', 'lunge', 'core']), S('Full body C', 30, ['squat', 'horizontal_push', 'hinge', 'conditioning'])],
  },
  {
    slug: 'cardio-boxing', title: 'Cardio Boxing', subtitle: 'Punch, move and sweat',
    description: 'High-energy rounds of conditioning and core work inspired by boxing training. No bag needed.',
    section: 'categories', place: 'both', level: 'intermediate', kit: 'none', icon: 'boxing', palette: 'coral',
    sessions: [S('Rounds 1', 25, ['conditioning', 'core', 'conditioning', 'horizontal_push']), S('Rounds 2', 25, ['conditioning', 'lunge', 'conditioning', 'core']), S('Fight-ready core', 20, ['core', 'conditioning', 'core'])],
  },
  {
    slug: 'womens-fitness', title: "Women's Fitness", subtitle: 'Strength and tone, at your pace',
    description: 'Balanced strength sessions for the lower body, upper body and core, designed for women starting or returning to training.',
    section: 'categories', place: 'both', level: 'beginner', kit: 'some', icon: 'women', palette: 'rose',
    sessions: [S('Lower body', 30, ['squat', 'hinge', 'lunge', 'calf']), S('Upper body', 30, ['horizontal_push', 'horizontal_pull', 'shoulder_abduction', 'elbow_flexion']), S('Core and cardio', 25, ['core', 'conditioning', 'core'])],
  },

  // ---- Build muscle -------------------------------------------------------------------------
  {
    slug: 'strength-and-burn', title: 'Strength & Burn', subtitle: 'Lift heavy, finish strong',
    description: 'Gym sessions that pair compound lifts with a short conditioning finisher, for muscle and fat loss together.',
    section: 'build_muscle', place: 'center', level: 'intermediate', kit: 'full_gym', icon: 'strength', palette: 'ink',
    sessions: [S('Lower body and burn', 45, ['squat', 'hinge', 'lunge', 'knee_flexion', 'conditioning']), S('Upper body and burn', 45, ['horizontal_push', 'horizontal_pull', 'vertical_push', 'vertical_pull', 'conditioning']), S('Full body and burn', 45, ['hinge', 'horizontal_push', 'vertical_pull', 'lunge', 'conditioning'])],
  },
  {
    slug: 'push-pull-legs', title: 'Push Pull Legs', subtitle: 'The classic muscle-building split',
    description: 'Three gym days: chest, shoulders and triceps; back and biceps; legs. Train each twice a week as you progress.',
    section: 'build_muscle', place: 'center', level: 'intermediate', kit: 'full_gym', icon: 'split', palette: 'sky',
    sessions: [S('Push', 50, ['horizontal_push', 'vertical_push', 'horizontal_push', 'shoulder_abduction', 'elbow_extension']), S('Pull', 50, ['vertical_pull', 'horizontal_pull', 'horizontal_pull', 'rear_delt', 'elbow_flexion']), S('Legs', 50, ['squat', 'hinge', 'lunge', 'knee_extension', 'knee_flexion', 'calf'])],
  },
  {
    slug: 'total-tone', title: 'Total Tone', subtitle: 'Shape up with dumbbells at home',
    description: 'Higher-rep dumbbell and bodyweight circuits that build lean muscle at home.',
    section: 'build_muscle', place: 'home', level: 'beginner', kit: 'some', icon: 'tone', palette: 'lavender',
    sessions: [S('Upper tone', 30, ['horizontal_push', 'horizontal_pull', 'shoulder_abduction', 'elbow_flexion', 'elbow_extension']), S('Lower tone', 30, ['squat', 'lunge', 'hinge', 'calf']), S('Total body', 30, ['squat', 'horizontal_push', 'hinge', 'horizontal_pull', 'core'])],
  },

  // ---- Stay fit -----------------------------------------------------------------------------
  {
    slug: 'cardio-rush', title: 'Cardio Rush', subtitle: 'Heart-pumping sessions in 25 minutes',
    description: 'Intervals and full-body moves that build stamina. Pick your pace and keep moving.',
    section: 'stay_fit', place: 'both', level: 'intermediate', kit: 'none', icon: 'cardio', palette: 'coral',
    sessions: [S('Intervals', 25, ['conditioning', 'squat', 'conditioning', 'core']), S('Stamina builder', 25, ['conditioning', 'lunge', 'horizontal_push', 'conditioning']), S('Sweat circuit', 25, ['squat', 'conditioning', 'core', 'conditioning'])],
  },
  {
    slug: 'strength-foundations', title: 'Strength Foundations', subtitle: 'Master the big lifts',
    description: 'Learn and progress the squat, hinge, push and pull with steady weekly increases.',
    section: 'stay_fit', place: 'both', level: 'beginner', kit: 'some', icon: 'foundation', palette: 'mint',
    sessions: [S('Squat and push', 40, ['squat', 'horizontal_push', 'lunge', 'core']), S('Hinge and pull', 40, ['hinge', 'horizontal_pull', 'vertical_pull', 'core']), S('Full strength', 40, ['squat', 'hinge', 'vertical_push', 'horizontal_pull'])],
  },

  // ---- Dance fitness ------------------------------------------------------------------------
  {
    slug: 'bollywood-dance-cardio', title: 'Bollywood Dance Cardio', subtitle: 'Dance to your favourite filmi beats',
    description: 'Fun, high-energy cardio sessions with dance-style moves. Put on your playlist and go.',
    section: 'dance', place: 'home', level: 'beginner', kit: 'none', icon: 'dance', palette: 'amber',
    sessions: [S('Warm-up groove', 20, ['warmup', 'conditioning', 'lunge', 'conditioning']), S('Full dance cardio', 30, ['conditioning', 'squat', 'conditioning', 'core', 'conditioning']), S('Cool-down flow', 15, ['conditioning', 'stretch', 'stretch'])],
  },
  {
    slug: 'bhangra-burn', title: 'Bhangra Burn', subtitle: 'Big moves, big energy',
    description: 'Bhangra-inspired cardio that works your legs, shoulders and lungs.',
    section: 'dance', place: 'home', level: 'intermediate', kit: 'none', icon: 'dance', palette: 'coral',
    sessions: [S('Bhangra basics', 25, ['conditioning', 'lunge', 'shoulder_abduction', 'conditioning']), S('Burn session', 30, ['conditioning', 'squat', 'conditioning', 'calf', 'conditioning'])],
  },
  {
    slug: 'latin-dance-party', title: 'Latin Dance Party', subtitle: 'Salsa-style steps for a full-body sweat',
    description: 'Latin rhythms and simple steps that keep your heart rate up and your core working.',
    section: 'dance', place: 'both', level: 'beginner', kit: 'none', icon: 'dance', palette: 'rose',
    sessions: [S('Party warm-up', 20, ['warmup', 'conditioning', 'core']), S('Dance party', 30, ['conditioning', 'lunge', 'conditioning', 'core', 'conditioning'])],
  },

  // ---- Workplace wellness -------------------------------------------------------------------
  {
    slug: 'desk-stretch-break', title: 'Desk Stretch Break', subtitle: '10 minutes at your desk',
    description: 'Release your neck, shoulders, back and hips without leaving your workspace. Perfect between meetings.',
    section: 'workplace', place: 'both', level: 'beginner', kit: 'none', icon: 'desk', palette: 'sky',
    sessions: [S('Neck and shoulders', 10, ['stretch', 'rear_delt', 'stretch']), S('Back and hips', 10, ['stretch', 'hinge', 'stretch'])],
  },
  {
    slug: 'posture-fix', title: 'Posture Fix', subtitle: 'Undo hours of sitting',
    description: 'Strengthen your upper back and core and open your chest, for better posture at work.',
    section: 'workplace', place: 'both', level: 'beginner', kit: 'none', icon: 'posture', palette: 'mint',
    sessions: [S('Upper back and chest', 15, ['horizontal_pull', 'rear_delt', 'stretch', 'core']), S('Core and hips', 15, ['core', 'hinge', 'stretch'])],
  },
  {
    slug: 'energy-boost', title: '10-Minute Energy Boost', subtitle: 'Beat the afternoon slump',
    description: 'A quick burst of movement to wake up body and mind, no changing clothes needed.',
    section: 'workplace', place: 'both', level: 'beginner', kit: 'none', icon: 'energy', palette: 'amber',
    sessions: [S('Wake-up circuit', 10, ['warmup', 'squat', 'conditioning', 'stretch'])],
  },
  {
    slug: 'team-step-challenge', title: 'Team Fitness Hour', subtitle: 'A group session for your office',
    description: 'An easy-to-lead workout for colleagues to do together, in a meeting room or the office lawn.',
    section: 'workplace', place: 'both', level: 'beginner', kit: 'none', icon: 'walk', palette: 'teal',
    sessions: [S('Group warm-up and circuit', 30, ['warmup', 'squat', 'horizontal_push', 'lunge', 'core', 'stretch'])],
  },
];
