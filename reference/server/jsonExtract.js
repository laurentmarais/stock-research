export function parseJsonFromText(text) {
  if (typeof text !== 'string') return null;

  const tryParse = (candidate) => {
    if (typeof candidate !== 'string') return null;
    const s = candidate.trim();
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  const raw = text.trim();
  const direct = tryParse(raw);
  if (direct) return direct;

  // Strip common Markdown code fences like ```json ... ```.
  const fenced = raw.match(/^```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```$/);
  if (fenced) {
    const inner = tryParse(fenced[1]);
    if (inner) return inner;
  }

  // Heuristic: parse the first JSON object/array substring.
  const firstObj = raw.indexOf('{');
  const lastObj = raw.lastIndexOf('}');
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    const inner = tryParse(raw.slice(firstObj, lastObj + 1));
    if (inner) return inner;
  }

  const firstArr = raw.indexOf('[');
  const lastArr = raw.lastIndexOf(']');
  if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
    const inner = tryParse(raw.slice(firstArr, lastArr + 1));
    if (inner) return inner;
  }

  return null;
}
