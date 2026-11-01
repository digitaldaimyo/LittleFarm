import { store, useStore } from './store';
import { visibleTips, type Tip } from '../game/coach';
import { chapterById, startChapter } from '../game/tutorial';

export function Tips({ tips }: { tips: Tip[] }) {
  const s = useStore();
  const shown = visibleTips(s.state, tips);
  if (!shown.length) return null;
  return (
    <div className="tips" aria-label="Coaching tips">
      {shown.map((t) => (
        <div key={t.id} className="diag info small tip">
          <span><strong>Coach:</strong> {t.text}</span>
          <span className="row gap wrap">
            {t.lesson && chapterById(t.lesson) && s.state.progress.guide?.active !== t.lesson && (
              <button className="btn ghost small" onClick={() => { store.mutate((g) => startChapter(g, t.lesson!)); store.setUi({ screen: 'guide' }); }}>Lesson: {chapterById(t.lesson)!.title}</button>
            )}
            <button className="btn ghost small" onClick={() => store.mutate((g) => { g.progress.flags[`tip:${t.id}`] = true; })}>Don’t show again</button>
          </span>
        </div>
      ))}
    </div>
  );
}
