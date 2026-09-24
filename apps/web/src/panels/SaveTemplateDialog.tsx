import { useState } from 'react';
import { useEditor } from '../editor/context';
import { SUGGESTED_TEMPLATE_CATEGORIES, useUserLib } from '../storage/userLibrary';
import { useUI } from '../store/ui';
import { Field, Modal } from './common';

/** Save the selection as a new template, or rename / re-categorise an existing one. */
export function SaveTemplateDialog() {
  const ed = useEditor();
  const editingId = useUI((s) => s.editingTemplate);
  const templates = useUserLib((s) => s.templates);
  const existing = templates.find((t) => t.id === editingId);
  const [name, setName] = useState(existing?.name ?? '');
  const [category, setCategory] = useState(existing?.category ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const categories = [
    ...new Set([...templates.map((t) => t.category), ...SUGGESTED_TEMPLATE_CATEGORIES]),
  ];
  const count = ed.selection().length;

  const close = () => useUI.getState().set({ modal: null, editingTemplate: null });
  const save = () => {
    if (!name.trim()) return;
    if (existing) {
      useUserLib.getState().updateTemplate(existing.id, {
        name: name.trim(),
        category: category.trim() || 'My templates',
        description: description.trim(),
      });
    } else {
      ed.saveSelectionAsTemplate({ name, category, description });
      useUI.getState().set({ leftTab: 'templates', leftPanel: true });
    }
    close();
  };

  return (
    <Modal title={existing ? 'Edit template' : 'Save as template'} onClose={close}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {!existing && (
          <p className="muted small">
            {count} selected item{count > 1 ? 's' : ''} will be saved in your personal library
            (available in every project). Custom symbols they use are saved with them.
          </p>
        )}
        <Field label="Name">
          <input
            autoFocus
            value={name}
            placeholder="e.g. Synchronous buck"
            onChange={(e) => setName(e.target.value)}
            data-testid="template-name"
          />
        </Field>
        <Field label="Category (pick one or type a new one)">
          <input
            list="template-categories"
            value={category}
            placeholder="My templates"
            onChange={(e) => setCategory(e.target.value)}
            data-testid="template-category"
          />
          <datalist id="template-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Description (optional)">
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="modal-foot">
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={!name.trim() || (!existing && !count)}
            data-testid="template-save"
          >
            {existing ? 'Save' : 'Save template'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
