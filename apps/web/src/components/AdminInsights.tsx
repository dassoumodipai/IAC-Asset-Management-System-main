import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, queryString } from '../api';
import { barPercent, formatInr, fyOptions, humaniseAction } from '../admin-insights';
import { useReferences } from './References';
import { displayDate, ErrorNotice, Loading, Metric, Panel, Select } from './ui';

interface AdminDashboardData {
  filters: { fy: number; fyLabel: string };
  kpis: {
    totalAssets: number;
    totalSpend: number;
    fySpend: number;
    missingCost: number;
    assigned: number;
    assignedPct: number;
    openTickets: number;
    warrantyExpiring: number;
  };
  spendByYear: { label: string; spend: number; count: number }[];
  spendByCategory: { label: string; spend: number; count: number }[];
  spendByDepartment: { label: string; spend: number; count: number }[];
  statusCounts: { label: string; count: number }[];
  ticketWeeks: { weekStart: string; opened: number; completed: number }[];
  expiring: {
    assetId: string;
    assetCode: string;
    assetType: string;
    kind: 'Warranty' | 'AMC';
    date: string;
  }[];
  topReported: { assetId: string; assetCode: string; assetType: string; tickets: number }[];
  financeGaps: {
    assetId: string;
    assetCode: string;
    assetType: string;
    missingCost: boolean;
    missingDate: boolean;
  }[];
  recentActivity: { action: string; entityType: string; actor: string; occurredAt: string }[];
}

function Bars({
  data,
  valueKey,
  format = String,
  empty = 'No priced assets yet',
}: {
  data: { label: string; spend?: number; count?: number }[];
  valueKey: 'spend' | 'count';
  format?: (value: number) => string;
  empty?: string;
}) {
  const rows = data.map((item) => ({ label: item.label, value: item[valueKey] ?? 0 }));
  const max = Math.max(0, ...rows.map((row) => row.value));
  if (!rows.length || max === 0) return <p className="muted admin-insights-empty">{empty}</p>;
  return (
    <>
      <div
        className="viz-bars"
        role="img"
        aria-label={rows.map((row) => `${row.label}: ${format(row.value)}`).join('; ')}
      >
        {rows.map((row) => (
          <div className="viz-bar-row" key={row.label}>
            <span className="viz-bar-label" title={row.label}>
              {row.label}
            </span>
            <span className="viz-bar-track" title={`${row.label}: ${format(row.value)}`}>
              <span className="viz-bar" style={{ width: `${barPercent(row.value, max)}%` }} />
            </span>
            <span className="viz-bar-value">{format(row.value)}</span>
          </div>
        ))}
      </div>
      <details className="viz-table-details">
        <summary>View as table</summary>
        <DataTable
          headers={['Label', 'Value']}
          rows={rows.map((row) => [row.label, format(row.value)])}
        />
      </details>
    </>
  );
}

function YearBars({ data }: { data: AdminDashboardData['spendByYear'] }) {
  const max = Math.max(0, ...data.map((row) => row.spend));
  if (!data.length || max === 0)
    return <p className="muted admin-insights-empty">No priced assets yet</p>;
  return (
    <>
      <div
        className="viz-year-chart"
        role="img"
        aria-label={data.map((row) => `${row.label}: ${formatInr(row.spend)}`).join('; ')}
      >
        {data.map((row) => (
          <div
            className="viz-year-column"
            key={row.label}
            title={`${row.label}: ${formatInr(row.spend)} (${row.count} assets)`}
          >
            <span className="viz-year-value">{formatInr(row.spend)}</span>
            <span className="viz-year-track">
              <span style={{ height: `${barPercent(row.spend, max)}%` }} />
            </span>
            <span className="viz-year-label">{row.label}</span>
          </div>
        ))}
      </div>
      <details className="viz-table-details">
        <summary>View as table</summary>
        <DataTable
          headers={['Financial year', 'Spend', 'Assets']}
          rows={data.map((row) => [row.label, formatInr(row.spend), String(row.count)])}
        />
      </details>
    </>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${cellIndex}-${cell}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TicketLine({ weeks }: { weeks: AdminDashboardData['ticketWeeks'] }) {
  if (!weeks.some((week) => week.opened || week.completed))
    return <p className="muted admin-insights-empty">No ticket activity yet</p>;
  const width = 640,
    height = 220,
    left = 36,
    right = 70,
    top = 18,
    bottom = 34;
  const max = Math.max(1, ...weeks.flatMap((week) => [week.opened, week.completed]));
  const x = (index: number) =>
    left + (index * (width - left - right)) / Math.max(weeks.length - 1, 1);
  const y = (value: number) => top + ((max - value) * (height - top - bottom)) / max;
  const opened = weeks
    .map((week, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(week.opened)}`)
    .join(' ');
  const completed = weeks
    .map((week, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(week.completed)}`)
    .join(' ');
  const weekLabel = (value: string) => displayDate(value);
  return (
    <>
      <div className="viz-legend">
        <span>
          <i className="viz-swatch opened" />
          Opened
        </span>
        <span>
          <i className="viz-swatch completed" />
          Completed
        </span>
      </div>
      <div className="viz-line-wrap">
        <svg
          className="viz-line-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Tickets opened and completed over the last 12 weeks"
        >
          {[0, 1, 2, 3].map((step) => {
            const value = (max * step) / 3;
            const yy = y(value);
            return (
              <g key={step}>
                <line className="viz-gridline" x1={left} x2={width - right} y1={yy} y2={yy} />
                <text className="viz-axis-label" x={left - 8} y={yy + 4} textAnchor="end">
                  {Math.round(value)}
                </text>
              </g>
            );
          })}
          <path className="viz-line-opened" d={opened} />
          <path className="viz-line-completed" d={completed} />
          {weeks.map((week, index) => (
            <g key={week.weekStart} className="viz-week-point" tabIndex={0}>
              <line
                className="viz-hover-line"
                x1={x(index)}
                x2={x(index)}
                y1={top}
                y2={height - bottom}
              />
              <text className="viz-week-label" x={x(index)} y={height - 8} textAnchor="middle">
                {displayDate(week.weekStart).replace(/,?\s*\d{4}/, '')}
              </text>
              <circle
                className="viz-hit-area"
                cx={x(index)}
                cy={(y(week.opened) + y(week.completed)) / 2}
                r="13"
              >
                <title>{`${weekLabel(week.weekStart)} — opened ${week.opened}, completed ${week.completed}`}</title>
              </circle>
              <circle className="viz-dot-opened" cx={x(index)} cy={y(week.opened)} r="3" />
              <circle className="viz-dot-completed" cx={x(index)} cy={y(week.completed)} r="3" />
            </g>
          ))}
          <text
            className="viz-end-label opened-label"
            x={width - right + 8}
            y={y(weeks.at(-1)!.opened) + 4}
          >
            Opened
          </text>
          <text
            className="viz-end-label completed-label"
            x={width - right + 8}
            y={y(weeks.at(-1)!.completed) + 4}
          >
            Completed
          </text>
        </svg>
      </div>
      <details className="viz-table-details">
        <summary>View as table</summary>
        <DataTable
          headers={['Week', 'Opened', 'Completed']}
          rows={weeks.map((week) => [
            weekLabel(week.weekStart),
            String(week.opened),
            String(week.completed),
          ])}
        />
      </details>
    </>
  );
}

function AssetLink({ id, code }: { id: string; code: string }) {
  return <Link to={`/assets/${id}`}>{code}</Link>;
}

export function AdminInsights() {
  const today = new Date();
  const yearOptions = fyOptions(today);
  const [fy, setFy] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [category, setCategory] = useState('');
  const refs = useReferences();
  const filters = { fy, departmentId, category };
  const query = useQuery({
    queryKey: ['dashboard-admin', filters],
    queryFn: ({ signal }) =>
      api<AdminDashboardData>(`/dashboard/admin${queryString(filters)}`, { signal }),
  });
  const data = query.data;
  return (
    <section className="admin-insights">
      <div className="admin-insights-filters">
        <Select
          label="Financial year"
          htmlFor="admin-dashboard-fy"
          value={fy}
          onChange={setFy}
          options={[{ value: '', label: 'Current FY' }, ...yearOptions]}
        />
        <Select
          label="Department"
          htmlFor="admin-dashboard-department"
          value={departmentId}
          onChange={setDepartmentId}
          options={[
            { value: '', label: 'All departments' },
            ...(refs.data?.departments ?? []).map((item) => ({
              value: item.id,
              label: `${item.name}${item.active ? '' : ' (inactive)'}`,
            })),
          ]}
        />
        <Select
          label="Category"
          htmlFor="admin-dashboard-category"
          value={category}
          onChange={setCategory}
          options={[
            { value: '', label: 'All categories' },
            ...(
              refs.data?.values.filter((item) => item.kind.toLowerCase() === 'category') ?? []
            ).map((item) => ({
              value: item.code,
              label: `${item.label}${item.active ? '' : ' (inactive)'}`,
            })),
          ]}
        />
      </div>
      <ErrorNotice
        error={query.error ?? refs.error}
        retry={() => {
          void query.refetch();
          void refs.refetch();
        }}
      />
      {query.isPending ? <Loading label="Loading dashboard insights..." /> : null}
      {data ? (
        <>
          <div className="metric-grid admin-insights-kpis">
            <Metric
              label="Total assets"
              value={data.kpis.totalAssets}
              detail="Assets in the register"
              to="/assets"
            />
            <Metric
              label="Total spend"
              value={formatInr(data.kpis.totalSpend)}
              detail="Recorded purchase cost"
            />
            <Metric
              label={`Spend in ${data.filters.fyLabel}`}
              value={formatInr(data.kpis.fySpend)}
              detail="Purchase cost in selected FY"
            />
            <Metric
              label="Missing cost"
              value={data.kpis.missingCost}
              detail="Assets without purchase cost"
              to="/assets"
            />
            <Metric
              label="Assigned"
              value={`${data.kpis.assigned} (${data.kpis.assignedPct}%)`}
              detail="Currently in custody"
              to="/assets?status=Assigned"
            />
            <Metric
              label="Open tickets"
              value={data.kpis.openTickets}
              detail="Needs support attention"
              to="/tickets"
            />
          </div>
          <div className="admin-insights-grid admin-insights-charts">
            <Panel title="Spend by financial year" className="admin-insights-panel">
              <YearBars data={data.spendByYear} />
            </Panel>
            <Panel title="Spend by category" className="admin-insights-panel">
              <Bars data={data.spendByCategory} valueKey="spend" format={formatInr} />
            </Panel>
            <Panel title="Spend by department" className="admin-insights-panel">
              <Bars data={data.spendByDepartment} valueKey="spend" format={formatInr} />
            </Panel>
            <Panel title="Assets by status" className="admin-insights-panel">
              <Bars data={data.statusCounts} valueKey="count" empty="No assets yet" />
            </Panel>
            <Panel
              title="Tickets, last 12 weeks"
              className="admin-insights-panel admin-insights-wide"
            >
              <TicketLine weeks={data.ticketWeeks} />
            </Panel>
          </div>
          <div className="admin-insights-grid admin-insights-watch">
            <Panel title="Warranty & AMC expiring (60 days)" className="admin-insights-panel">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Type</th>
                      <th>Kind</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.expiring.map((row) => (
                      <tr key={`${row.assetId}-${row.kind}`}>
                        <td>
                          <AssetLink id={row.assetId} code={row.assetCode} />
                        </td>
                        <td>{row.assetType}</td>
                        <td>{row.kind}</td>
                        <td>{displayDate(row.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.expiring.length ? (
                  <p className="muted">Nothing expiring in the next 60 days.</p>
                ) : null}
              </div>
            </Panel>
            <Panel title="Most-reported assets" className="admin-insights-panel">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Type</th>
                      <th>Tickets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topReported.map((row) => (
                      <tr key={row.assetId}>
                        <td>
                          <AssetLink id={row.assetId} code={row.assetCode} />
                        </td>
                        <td>{row.assetType}</td>
                        <td>{row.tickets}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.topReported.length ? <p className="muted">No reported assets yet.</p> : null}
              </div>
            </Panel>
            <Panel title="Finance gaps" className="admin-insights-panel">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Type</th>
                      <th>Missing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.financeGaps.map((row) => (
                      <tr key={row.assetId}>
                        <td>
                          <AssetLink id={row.assetId} code={row.assetCode} />
                        </td>
                        <td>{row.assetType}</td>
                        <td>
                          {[row.missingCost ? 'Cost' : '', row.missingDate ? 'Date' : '']
                            .filter(Boolean)
                            .map((value) => (
                              <span className="badge warning admin-insights-badge" key={value}>
                                {value}
                              </span>
                            ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.financeGaps.length ? <p className="muted">No finance gaps found.</p> : null}
              </div>
              <Link className="table-link" to="/assets">
                Fix in catalog →
              </Link>
            </Panel>
            <Panel title="Recent activity" className="admin-insights-panel">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Activity</th>
                      <th>By</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentActivity.map((row, index) => (
                      <tr key={`${row.occurredAt}-${index}`}>
                        <td>{humaniseAction(row.action)}</td>
                        <td>{row.actor}</td>
                        <td>
                          <time dateTime={row.occurredAt}>{displayDate(row.occurredAt, true)}</time>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.recentActivity.length ? <p className="muted">No recent activity.</p> : null}
              </div>
            </Panel>
          </div>
        </>
      ) : null}
    </section>
  );
}
