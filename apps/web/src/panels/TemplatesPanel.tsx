import { useEditor } from '../editor/context';
import { TEMPLATES, templateClip } from '../examples/templates';

export const TEMPLATE_DND_TYPE = 'application/x-overleagger-template';

const CATEGORIES = ['Power electronics', 'Control', 'Analog'] as const;

/** Ready-made circuits and loops, inserted as normal (editable) elements. */
export function TemplatesPanel() {
  const ed = useEditor();
  return (
    <div className="library-scroll pad" data-testid="templates">
      <p className="muted small">
        Click to insert at the centre of the view, or drag onto the sheet. Everything stays
        editable.
      </p>
      {CATEGORIES.map((cat) => (
        <section key={cat}>
          <h4 className="lib-cat-title">{cat}</h4>
          {TEMPLATES.filter((t) => t.category === cat).map((t) => (
            <button
              key={t.id}
              type="button"
              className="template-card"
              draggable
              data-testid={`template-${t.id}`}
              onDragStart={(e) => {
                e.dataTransfer.setData(TEMPLATE_DND_TYPE, t.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => ed.insertClip(templateClip(t))}
            >
              <b>{t.name}</b>
              <span>
                {t.description.replace(/\$[^$]*\$/g, (m) =>
                  m.slice(1, -1).replace(/\\\w+|[{}\\_^]/g, ''),
                )}
              </span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
