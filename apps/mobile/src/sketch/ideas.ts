/** Sketch ideas, saved as one JSON file in the app's documents folder. Nothing leaves the phone unless you export. */
import { File, Paths } from 'expo-file-system';
import { exampleIdea, newIdea, tidyRows, type Idea } from '@ghostgrid/core';

export interface IdeaStore { ideas: Idea[]; current: string }

const file = () => new File(Paths.document, 'ghostgrid-ideas.json');

export function loadIdeas(): IdeaStore {
  try {
    const f = file();
    if (f.exists) {
      const s = JSON.parse(f.textSync()) as IdeaStore;
      if (s.ideas?.length) {
        // reopening tidies away rows that were left empty
        const ideas = s.ideas.map(tidyRows);
        return { ideas, current: ideas.some((i) => i.id === s.current) ? s.current : ideas[0].id };
      }
    }
  } catch { /* fall through to a fresh start */ }
  const ex = tidyRows(exampleIdea());
  return { ideas: [ex], current: ex.id };
}

let timer: ReturnType<typeof setTimeout> | null = null;
export function saveIdeas(s: IdeaStore) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    try { file().writeSync(JSON.stringify(s)); } catch { /* best effort */ }
  }, 400);
}

export function freshIdea(n: number): Idea {
  return newIdea(`Idea ${n}`);
}
