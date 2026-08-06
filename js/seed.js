// The starter exercise library. Ids are slugs of the name and are stable
// forever — a routine written today must still resolve after any future edit
// here, so rename freely but never change an id.

const L = (name, muscleGroup, equipment, isBodyweight = false) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  name,
  muscleGroup,
  equipment,
  isBodyweight,
  isCustom: false,
  defaultRestSec: null,
  note: '',
  archived: false,
});

export const SEED_EXERCISES = [
  // Chest
  L('Barbell Bench Press', 'Chest', 'Barbell'),
  L('Incline Barbell Bench Press', 'Chest', 'Barbell'),
  L('Decline Barbell Bench Press', 'Chest', 'Barbell'),
  L('Dumbbell Bench Press', 'Chest', 'Dumbbell'),
  L('Incline Dumbbell Bench Press', 'Chest', 'Dumbbell'),
  L('Dumbbell Fly', 'Chest', 'Dumbbell'),
  L('Cable Fly', 'Chest', 'Cable'),
  L('Cable Crossover', 'Chest', 'Cable'),
  L('Chest Press Machine', 'Chest', 'Machine'),
  L('Pec Deck', 'Chest', 'Machine'),
  L('Push-Up', 'Chest', 'Bodyweight', true),
  L('Dip', 'Chest', 'Bodyweight', true),

  // Back
  L('Deadlift', 'Back', 'Barbell'),
  L('Trap Bar Deadlift', 'Back', 'Barbell'),
  L('Romanian Deadlift', 'Hamstrings', 'Barbell'),
  L('Barbell Row', 'Back', 'Barbell'),
  L('Pendlay Row', 'Back', 'Barbell'),
  L('T-Bar Row', 'Back', 'Barbell'),
  L('Dumbbell Row', 'Back', 'Dumbbell'),
  L('Chest Supported Row', 'Back', 'Machine'),
  L('Seated Cable Row', 'Back', 'Cable'),
  L('Lat Pulldown', 'Back', 'Cable'),
  L('Straight Arm Pulldown', 'Back', 'Cable'),
  L('Pull-Up', 'Back', 'Bodyweight', true),
  L('Chin-Up', 'Back', 'Bodyweight', true),
  L('Face Pull', 'Shoulders', 'Cable'),
  L('Shrug', 'Back', 'Barbell'),
  L('Dumbbell Shrug', 'Back', 'Dumbbell'),
  L('Back Extension', 'Back', 'Bodyweight', true),
  L('Good Morning', 'Hamstrings', 'Barbell'),

  // Shoulders
  L('Overhead Press', 'Shoulders', 'Barbell'),
  L('Seated Dumbbell Shoulder Press', 'Shoulders', 'Dumbbell'),
  L('Arnold Press', 'Shoulders', 'Dumbbell'),
  L('Push Press', 'Shoulders', 'Barbell'),
  L('Lateral Raise', 'Shoulders', 'Dumbbell'),
  L('Cable Lateral Raise', 'Shoulders', 'Cable'),
  L('Rear Delt Fly', 'Shoulders', 'Dumbbell'),
  L('Reverse Pec Deck', 'Shoulders', 'Machine'),
  L('Front Raise', 'Shoulders', 'Dumbbell'),
  L('Upright Row', 'Shoulders', 'Barbell'),
  L('Shoulder Press Machine', 'Shoulders', 'Machine'),

  // Arms
  L('Barbell Curl', 'Biceps', 'Barbell'),
  L('EZ Bar Curl', 'Biceps', 'Barbell'),
  L('Dumbbell Curl', 'Biceps', 'Dumbbell'),
  L('Incline Dumbbell Curl', 'Biceps', 'Dumbbell'),
  L('Hammer Curl', 'Biceps', 'Dumbbell'),
  L('Preacher Curl', 'Biceps', 'Barbell'),
  L('Cable Curl', 'Biceps', 'Cable'),
  L('Concentration Curl', 'Biceps', 'Dumbbell'),
  L('Close Grip Bench Press', 'Triceps', 'Barbell'),
  L('Triceps Pushdown', 'Triceps', 'Cable'),
  L('Rope Pushdown', 'Triceps', 'Cable'),
  L('Overhead Triceps Extension', 'Triceps', 'Dumbbell'),
  L('Skullcrusher', 'Triceps', 'Barbell'),
  L('Triceps Dip', 'Triceps', 'Bodyweight', true),
  L('Wrist Curl', 'Forearms', 'Dumbbell'),
  L('Reverse Curl', 'Forearms', 'Barbell'),
  L('Farmer Carry', 'Forearms', 'Dumbbell'),

  // Legs
  L('Back Squat', 'Quads', 'Barbell'),
  L('Front Squat', 'Quads', 'Barbell'),
  L('Box Squat', 'Quads', 'Barbell'),
  L('Hack Squat', 'Quads', 'Machine'),
  L('Leg Press', 'Quads', 'Machine'),
  L('Bulgarian Split Squat', 'Quads', 'Dumbbell'),
  L('Walking Lunge', 'Quads', 'Dumbbell'),
  L('Goblet Squat', 'Quads', 'Dumbbell'),
  L('Step Up', 'Quads', 'Dumbbell'),
  L('Leg Extension', 'Quads', 'Machine'),
  L('Lying Leg Curl', 'Hamstrings', 'Machine'),
  L('Seated Leg Curl', 'Hamstrings', 'Machine'),
  L('Nordic Curl', 'Hamstrings', 'Bodyweight', true),
  L('Hip Thrust', 'Glutes', 'Barbell'),
  L('Glute Bridge', 'Glutes', 'Barbell'),
  L('Cable Kickback', 'Glutes', 'Cable'),
  L('Hip Abduction Machine', 'Glutes', 'Machine'),
  L('Standing Calf Raise', 'Calves', 'Machine'),
  L('Seated Calf Raise', 'Calves', 'Machine'),
  L('Calf Press', 'Calves', 'Machine'),

  // Core
  L('Plank', 'Core', 'Bodyweight', true),
  L('Hanging Leg Raise', 'Core', 'Bodyweight', true),
  L('Cable Crunch', 'Core', 'Cable'),
  L('Ab Wheel Rollout', 'Core', 'Other'),
  L('Russian Twist', 'Core', 'Other'),
  L('Sit-Up', 'Core', 'Bodyweight', true),
  L('Decline Sit-Up', 'Core', 'Bodyweight', true),
  L('Pallof Press', 'Core', 'Cable'),
  L('Side Plank', 'Core', 'Bodyweight', true),

  // Full body / olympic
  L('Power Clean', 'Full body', 'Barbell'),
  L('Hang Clean', 'Full body', 'Barbell'),
  L('Clean and Jerk', 'Full body', 'Barbell'),
  L('Snatch', 'Full body', 'Barbell'),
  L('Kettlebell Swing', 'Full body', 'Kettlebell'),
  L('Thruster', 'Full body', 'Barbell'),
  L('Burpee', 'Full body', 'Bodyweight', true),

  // Cardio
  L('Treadmill', 'Cardio', 'Machine'),
  L('Stationary Bike', 'Cardio', 'Machine'),
  L('Rowing Machine', 'Cardio', 'Machine'),
  L('Stair Climber', 'Cardio', 'Machine'),
  L('Elliptical', 'Cardio', 'Machine'),
  L('Jump Rope', 'Cardio', 'Other'),
];

// A few ready-made splits so the app is usable the first time it opens rather
// than being an empty shell asking you to do setup at the gym.
export const SEED_ROUTINES = [
  {
    name: 'Push',
    exercises: [
      ['barbell-bench-press', 4, 5, 8],
      ['seated-dumbbell-shoulder-press', 3, 8, 12],
      ['incline-dumbbell-bench-press', 3, 8, 12],
      ['lateral-raise', 3, 12, 15],
      ['rope-pushdown', 3, 10, 15],
    ],
  },
  {
    name: 'Pull',
    exercises: [
      ['barbell-row', 4, 5, 8],
      ['pull-up', 3, 6, 10],
      ['seated-cable-row', 3, 8, 12],
      ['face-pull', 3, 12, 15],
      ['dumbbell-curl', 3, 10, 12],
    ],
  },
  {
    name: 'Legs',
    exercises: [
      ['back-squat', 4, 5, 8],
      ['romanian-deadlift', 3, 8, 10],
      ['leg-press', 3, 10, 12],
      ['lying-leg-curl', 3, 10, 15],
      ['standing-calf-raise', 4, 12, 15],
    ],
  },
  {
    name: 'Upper',
    exercises: [
      ['barbell-bench-press', 4, 5, 8],
      ['barbell-row', 4, 5, 8],
      ['overhead-press', 3, 8, 10],
      ['lat-pulldown', 3, 8, 12],
      ['dumbbell-curl', 3, 10, 12],
      ['rope-pushdown', 3, 10, 15],
    ],
  },
  {
    name: 'Lower',
    exercises: [
      ['back-squat', 4, 5, 8],
      ['deadlift', 3, 3, 5],
      ['bulgarian-split-squat', 3, 8, 12],
      ['seated-leg-curl', 3, 10, 15],
      ['standing-calf-raise', 4, 12, 15],
    ],
  },
];
