import React from 'react';
import Chart from 'chart.js/auto';
import { Button, Chip, Group } from '@mantine/core';

function formatNumber(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toLocaleString();
}

function formatShares(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString();
}

function scoreTone(bucket) {
  if (bucket === 'high') return { label: 'High', className: 'toneBad' };
  if (bucket === 'medium') return { label: 'Medium', className: 'toneWarn' };
  if (bucket === 'low') return { label: 'Low', className: 'toneOk' };
  return { label: 'Unknown', className: 'toneNeutral' };
}

function uniq(arr) {
  const out = [];
  const seen = new Set();
  for (const x of arr || []) {
    const s = String(x || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export default function DilutionTab({ ticker, overview, charts, ai, loading, error }) {
  const [tagFilter, setTagFilter] = React.useState([]);

  const sharesCanvasRef = React.useRef(null);
  const sharesChartRef = React.useRef(null);

  const availableTags = React.useMemo(() => {
    const ev = Array.isArray(overview?.evidence) ? overview.evidence : [];
    const tags = ev.flatMap((e) => (Array.isArray(e.tags) ? e.tags : []));
    return uniq(tags).sort();
  }, [overview]);

  const filteredEvidence = React.useMemo(() => {
    const ev = Array.isArray(overview?.evidence) ? overview.evidence : [];
    if (!tagFilter.length) return ev;
    return ev.filter((e) => {
      const tags = Array.isArray(e.tags) ? e.tags : [];
      return tagFilter.every((t) => tags.includes(t));
    });
  }, [overview, tagFilter]);

  React.useEffect(() => {
    const canvas = sharesCanvasRef.current;
    const points = Array.isArray(charts?.sharesOutstanding) ? charts.sharesOutstanding : [];

    if (!canvas) return;

    if (sharesChartRef.current) {
      sharesChartRef.current.destroy();
      sharesChartRef.current = null;
    }

    if (!points.length) return;

    const labels = points.map((p) => p.date);
    const values = points.map((p) => p.shares);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    sharesChartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Shares outstanding',
            data: values,
            borderColor: 'rgba(99, 102, 241, 0.9)',
            backgroundColor: 'rgba(99, 102, 241, 0.15)',
            fill: true,
            tension: 0.25,
            pointRadius: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx2) => ` ${formatNumber(ctx2.parsed.y)} shares`
            }
          }
        },
        scales: {
          x: {
            ticks: { maxTicksLimit: 8 }
          },
          y: {
            ticks: {
              callback: (v) => formatShares(v)
            }
          }
        }
      }
    });

    return () => {
      if (sharesChartRef.current) {
        sharesChartRef.current.destroy();
        sharesChartRef.current = null;
      }
    };
  }, [charts]);

  const tone = scoreTone(overview?.bucket);

  return (
    <div className="dilution">
      <div className="dilutionTop">
        {loading ? <div className="muted">Loading…</div> : null}
        {error ? <div className="error">{error}</div> : null}

        {overview ? (
          <div className="dilutionSummary">
            <div className="scoreCard">
              <div className="label">Dilution Risk</div>
              <div className={`scoreValue ${tone.className}`}>Score {overview.score} / 100 • {tone.label}</div>
              <div className="muted small">{overview.summary || '—'}</div>
            </div>

            {ai?.summary ? (
              <div className="warnBox">
                <div className="label">AI summary</div>
                <div className="muted small" style={{ whiteSpace: 'pre-wrap' }}>
                  {ai.summary}
                </div>
                {Array.isArray(ai?.riskFactors) && ai.riskFactors.length ? (
                  <ul className="warnList">
                    {ai.riskFactors.map((rf) => (
                      <li key={rf.label}>
                        <strong>{rf.severity?.toUpperCase?.() || 'MEDIUM'}</strong>: {rf.label}
                        {rf.rationale ? <span className="muted"> — {rf.rationale}</span> : null}
                        {Array.isArray(rf.evidenceIds) && rf.evidenceIds.length ? (
                          <span className="muted"> (evidence: {rf.evidenceIds.join(', ')})</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {Array.isArray(ai?.watchlist) && ai.watchlist.length ? (
                  <div className="muted small">Watchlist: {ai.watchlist.join(' • ')}</div>
                ) : null}
              </div>
            ) : null}

            <div className="metricRow">
              <div className="metric">
                <div className="label">CIK</div>
                <div className="value mono">{overview.cik}</div>
              </div>
              <div className="metric">
                <div className="label">Shares (latest)</div>
                <div className="value">{formatShares(overview?.metrics?.sharesOutstanding)}</div>
              </div>
              <div className="metric">
                <div className="label">Shelf</div>
                <div className="value">{overview?.metrics?.shelfDetected ? 'Detected' : '—'}</div>
              </div>
              <div className="metric">
                <div className="label">ATM</div>
                <div className="value">{overview?.metrics?.atmDetected ? 'Detected' : '—'}</div>
              </div>
              <div className="metric">
                <div className="label">Offering</div>
                <div className="value">{overview?.metrics?.takedownDetected ? 'Detected' : '—'}</div>
              </div>
              <div className="metric">
                <div className="label">Going concern</div>
                <div className="value">{overview?.metrics?.goingConcernDetected ? 'Detected' : '—'}</div>
              </div>
            </div>

            {Array.isArray(overview?.warnings) && overview.warnings.length ? (
              <div className="warnBox">
                <div className="label">Warnings</div>
                <ul className="warnList">
                  {overview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="muted">Pick a ticker and run Analyze to see SEC evidence.</div>
        )}
      </div>

      {overview ? (
        <div className="dilutionGrid">
          <div className="box full">
            <div className="boxHeader">
              <div>
                <div className="label">Top drivers</div>
                <div className="muted small">Evidence-first signals contributing to the score</div>
              </div>
            </div>

            {!Array.isArray(overview?.drivers) || !overview.drivers.length ? (
              <div className="muted">—</div>
            ) : (
              <ul className="driverList">
                {overview.drivers.map((d) => (
                  <li key={d.key}>
                    <span className="driverWeight">+{d.weight}</span>
                    <span>{d.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="box full">
            <div className="boxHeader">
              <div>
                <div className="label">Shares outstanding</div>
                <div className="muted small">From SEC XBRL company facts (when available)</div>
              </div>
              {charts?.sources?.companyFactsUrl ? (
                <a className="miniLink" href={charts.sources.companyFactsUrl} target="_blank" rel="noreferrer">
                  companyfacts JSON
                </a>
              ) : null}
            </div>
            <div className="chartWrap">
              {Array.isArray(charts?.sharesOutstanding) && charts.sharesOutstanding.length ? (
                <canvas ref={sharesCanvasRef} />
              ) : (
                <div className="muted">No share series found for this issuer.</div>
              )}
            </div>
          </div>

          <div className="box full">
            <div className="boxHeader">
              <div>
                <div className="label">Evidence timeline</div>
                <div className="muted small">Filings scanned for dilution-related signals (newest first)</div>
              </div>
              {overview?.sources?.submissionsUrl ? (
                <a className="miniLink" href={overview.sources.submissionsUrl} target="_blank" rel="noreferrer">
                  submissions JSON
                </a>
              ) : null}
            </div>

            {availableTags.length ? (
              <div className="tagRow" role="group" aria-label="Evidence tag filters">
                <Chip.Group multiple value={tagFilter} onChange={setTagFilter}>
                  <Group gap="xs" wrap="wrap">
                    {availableTags.map((t) => (
                      <Chip key={t} value={t} size="xs" variant="filled" title="Filter evidence by tag">
                        {t}
                      </Chip>
                    ))}
                    {tagFilter.length ? (
                      <Button variant="subtle" size="xs" type="button" onClick={() => setTagFilter([])}>
                        Clear
                      </Button>
                    ) : null}
                  </Group>
                </Chip.Group>
              </div>
            ) : null}

            {!filteredEvidence.length ? (
              <div className="muted">No evidence items match the selected filters.</div>
            ) : (
              <div className="evidenceList">
                {filteredEvidence.map((e) => (
                  <div key={e.id} className="evidenceCard">
                    <div className="evidenceTop">
                      <div>
                        <div className="evidenceTitle">
                          {e.form} • {e.date}
                          {e.title ? <span className="muted"> • {e.title}</span> : null}
                        </div>
                        <div className="muted small mono">Accession {e.accession}</div>
                      </div>
                      {e.url ? (
                        <a className="miniLink" href={e.url} target="_blank" rel="noreferrer">
                          open filing
                        </a>
                      ) : null}
                    </div>

                    {Array.isArray(e.tags) && e.tags.length ? (
                      <div className="tagRow">
                        {e.tags.map((t) => (
                          <span key={t} className="tag">
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {typeof e?.facts?.offeringAmountUsd === 'number' ? (
                      <div className="muted small">Offering amount detected: ${formatNumber(e.facts.offeringAmountUsd)}</div>
                    ) : null}

                    {e.snippet ? <div className="snippet">{e.snippet}</div> : <div className="muted">(no snippet extracted)</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
