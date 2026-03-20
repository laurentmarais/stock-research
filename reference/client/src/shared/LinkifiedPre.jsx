import React from 'react';

function splitTextIntoLinks(text) {
  const s = typeof text === 'string' ? text : '';
  if (!s) return [{ type: 'text', value: '' }];

  const re = /(https?:\/\/[^\s)\]}>'\"]+)/gi;
  const parts = [];
  let lastIndex = 0;

  for (;;) {
    const m = re.exec(s);
    if (!m) break;
    const href = m[1];
    const idx = m.index;
    if (idx > lastIndex) {
      parts.push({ type: 'text', value: s.slice(lastIndex, idx) });
    }
    parts.push({ type: 'link', href, text: href });
    lastIndex = idx + href.length;
  }

  if (lastIndex < s.length) {
    parts.push({ type: 'text', value: s.slice(lastIndex) });
  }

  return parts.length ? parts : [{ type: 'text', value: s }];
}

export default function LinkifiedPre({ text }) {
  const parts = React.useMemo(() => splitTextIntoLinks(text), [text]);
  return (
    <div style={{ whiteSpace: 'pre-wrap' }}>
      {parts.map((p, idx) =>
        p.type === 'link' ? (
          <a key={idx} href={p.href} target="_blank" rel="noreferrer">
            {p.text}
          </a>
        ) : (
          <React.Fragment key={idx}>{p.value}</React.Fragment>
        )
      )}
    </div>
  );
}
