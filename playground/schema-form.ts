import type { JsonObject, JsonValue } from 'simkind/format';

/** Small schema form: ordinary scalar fields, with lossless JSON for complex values. */
export function schemaForm(container: HTMLElement, schema: JsonObject, initial: JsonObject = {}, onEdit = () => {}): () => JsonObject {
  const readers = new Map<string, () => JsonValue | undefined>();
  container.replaceChildren();
  for (const [key, value] of Object.entries(schema.properties as JsonObject ?? {})) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const field = value as JsonObject;
    const label = document.createElement('label');
    label.textContent = String(field.title ?? key);
    const optional = !(schema.required as string[] | undefined)?.includes(key);
    const include = document.createElement('input'); include.type = 'checkbox'; include.className = 'include-field';
    include.checked = Object.hasOwn(initial, key) || !optional;
    include.setAttribute('aria-label', `Include ${key}`);
    const wrapper = document.createElement('div'); wrapper.className = 'schema-field';
    if (optional) { const toggle = document.createElement('label'); toggle.className = 'include-label'; toggle.append(include, `Include ${key}`); wrapper.append(toggle); }
    const content = document.createElement('div'); content.hidden = !include.checked;
    include.addEventListener('change', () => { content.hidden = !include.checked; onEdit(); });
    const starting = Object.hasOwn(initial, key) ? initial[key] : field.default;
    let control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    let read: () => JsonValue;
    if (Object.hasOwn(field, 'const')) {
      control = document.createElement('input'); control.value = String(field.const); control.disabled = true;
      read = () => field.const;
    } else if (field.type === 'object' && field.properties) {
      const group = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = String(field.title ?? key); group.append(legend);
      const children = document.createElement('div'); group.append(children);
      const nested = schemaForm(children, field, starting && typeof starting === 'object' && !Array.isArray(starting) ? starting : {}, onEdit);
      readers.set(key, () => nested());
      content.append(group); wrapper.append(content); container.append(wrapper);
      if (optional) readers.set(key, () => include.checked ? nested() : undefined);
      continue;
    } else if (Array.isArray(field.enum) || field.type === 'boolean') {
      control = document.createElement('select');
      const options = Array.isArray(field.enum) ? field.enum : [true, false];
      for (const option of options) control.add(new Option(typeof option === 'string' ? option : String(option), JSON.stringify(option)));
      if (starting !== undefined) control.value = JSON.stringify(starting);
      const select = control;
      read = () => JSON.parse(select.value);
    } else if (field.type === 'string') {
      control = document.createElement('textarea'); control.rows = 3;
      control.value = typeof starting === 'string' ? starting : '';
      if (typeof field.minLength === 'number') control.minLength = field.minLength;
      if (typeof field.maxLength === 'number') control.maxLength = field.maxLength;
      const input = control;
      read = () => input.value;
    } else if (field.type === 'number' || field.type === 'integer') {
      control = document.createElement('input'); control.type = 'number';
      control.step = field.type === 'integer' ? '1' : 'any';
      if (typeof field.minimum === 'number') control.min = String(field.minimum);
      if (typeof field.maximum === 'number') control.max = String(field.maximum);
      control.value = String(starting ?? field.minimum ?? 0);
      const input = control;
      read = () => { if (!input.value || !input.checkValidity()) throw new Error(`Enter a valid ${key}.`); return Number(input.value); };
    } else {
      // Unions, arrays and nested extension data retain exact JSON types.
      control = document.createElement('textarea'); control.rows = 3;
      control.value = JSON.stringify(starting ?? (Array.isArray(field.type) && field.type.includes('null') ? null : field.type === 'array' ? [] : {}), null, 2);
      const input = control;
      read = () => JSON.parse(input.value);
      label.append(' · JSON');
    }
    control.setAttribute('aria-label', String(field.title ?? key));
    control.addEventListener('input', onEdit); control.addEventListener('change', onEdit);
    label.append(control);
    if (field.description) { const help = document.createElement('small'); help.textContent = String(field.description); label.append(help); }
    content.append(label); wrapper.append(content); container.append(wrapper);
    readers.set(key, () => include.checked ? read() : undefined);
  }
  return () => {
    const result = structuredClone(initial);
    for (const [key, read] of readers) {
      const value = read();
      if (value === undefined) delete result[key];
      else Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
    }
    return result;
  };
}
