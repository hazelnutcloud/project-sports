export type SportId = 'bowling' | 'tennis' | 'golf' | 'badminton';

export interface SportDefinition {
  id: SportId;
  name: string;
  tagline: string;
  players: string;
  format: string;
  status: 'playable' | 'coming-soon';
  accentHex: string;
  surfaceTint: string;
  borderTint: string;
  comingSoonNote?: string;
}

export const SPORTS_CATALOG: SportDefinition[] = [
  {
    id: 'bowling',
    name: 'Bowling',
    tagline: 'Line up your shot, swing smoothly, and twist your wrist to hook into the pocket.',
    players: '1–4 Players',
    format: '10 Frames',
    status: 'playable',
    accentHex: '#ee5656',
    surfaceTint: '#fff5f5',
    borderTint: '#fbd5d5',
  },
  {
    id: 'tennis',
    name: 'Tennis',
    tagline: 'Fast baseline rallies, crisp volleys, and topspin winners on sunlit courts.',
    players: '1–4 Players',
    format: 'Best of 3',
    status: 'playable',
    accentHex: '#58b947',
    surfaceTint: '#f2fbf1',
    borderTint: '#cdecc7',
  },
  {
    id: 'golf',
    name: 'Golf',
    tagline: 'Read the breeze, dial in your swing power, and sink long putts on the green.',
    players: '1–4 Players',
    format: '9 Holes',
    status: 'coming-soon',
    accentHex: '#18a374',
    surfaceTint: '#effbf6',
    borderTint: '#c3eedd',
    comingSoonNote: 'Fairways are getting trimmed — Golf tees off in a future update!',
  },
  {
    id: 'badminton',
    name: 'Badminton',
    tagline: 'Quick overhead smashes, delicate drop shots, and lightning reflexes at the net.',
    players: '1–2 Players',
    format: 'First to 5',
    status: 'coming-soon',
    accentHex: '#2b90e8',
    surfaceTint: '#f0f8ff',
    borderTint: '#c6e2fb',
    comingSoonNote: 'Setting up the nets — Badminton joins the plaza in a future update!',
  },
];
