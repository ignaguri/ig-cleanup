import type { DeckId } from '../../shared/types';

export const DECKS: { id: DeckId; label: string }[] = [
  { id: 'notFollowingBack', label: "Don't follow you back" },
  { id: 'fansNotFollowed', label: "You don't follow back" },
  { id: 'mutual', label: 'Mutuals' },
];
