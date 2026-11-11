// The episodes film mode can play (?film=<id>). A new episode: a file in tools/film/scenes/, one line here.
import type { Scene } from './types';

export const SCENES: Record<string, () => Promise<{ default: Scene }>> = {
  'wi-01': () => import('../../tools/film/scenes/wi-01'),
  'wi-02': () => import('../../tools/film/scenes/wi-02'),
  'wi-03': () => import('../../tools/film/scenes/wi-03'),
  'wi-04': () => import('../../tools/film/scenes/wi-04'),
  'wi-05': () => import('../../tools/film/scenes/wi-05'),
  'wi-06': () => import('../../tools/film/scenes/wi-06'),
  'wi-07': () => import('../../tools/film/scenes/wi-07'),
  'wi-08': () => import('../../tools/film/scenes/wi-08'),
  'wi-09': () => import('../../tools/film/scenes/wi-09'),
  'wi-10': () => import('../../tools/film/scenes/wi-10'),
  'p-01': () => import('../../tools/film/scenes/p-01'),
  'intro-01': () => import('../../tools/film/scenes/intro-01'),
};
