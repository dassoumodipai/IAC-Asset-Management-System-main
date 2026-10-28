import { useState, type FormEvent } from 'react';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, queryString } from '../api';
import { useAction } from '../hooks';
import { hasRole, useSession } from '../session';
import { Empty, ErrorNotice, Field, Loading, Metric, PageTitle, Panel } from './ui';

interface FinanceAsset {
  id: string;
  assetCode: string;
  description: string;
  assetType: string;
  assetVersion: number;
  financeVersion: number | null;
  state: string | null;
  purchaseCost: string | null;
  purchaseDate: string | null;
  invoiceNumber: string | null;
  supplier: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  submittedByName: string | null;
  submissionReason: string | null;
  reviewReason: string | null;
  reviewedByName: string | null;
  submittedAssetVersion: number | null;
  approvedCost: string | null;
  approvedAt: string | null;
  history: { id: string; action: string; reason: string; actor: string; occurredAt: string }[];
}
const money = (value: string | number | null) =>
  value == null
    ? 'Not set'
    : new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 2,
      }).format(Number(value));
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString('en-IN') : 'Not recorded';
export function FinanceQueue() {
  const { user } = useSession();
  const [state, setState] = useState('SUBMITTED'),
    [q, setQ] = useState('');
  const query = useInfiniteQuery({
    queryKey: ['finance-queue', state, q],
    enabled: hasRole(user, 'ADMIN') || hasRole(user, 'FINANCE'),
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) =>
      api<{ items: FinanceAsset[]; nextCursor: string | null }>(
        '/finance/queue' + queryString({ state, q: q || undefined, after: pageParam || undefined }),
        { signal },
      ),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  if (!hasRole(user, 'ADMIN') && !hasRole(user, 'FINANCE'))
    return (
      <Empty title="Finance access required">
        Only registrars and Finance reviewers can open this queue.
      </Empty>
    );
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageTitle
        title="Finance review"
        description="Registrars submit asset records. A separate Finance reviewer approves the cost and invoice details."
        action={
          <Link className="button secondary" to="/executive">
            Executive overview
          </Link>
        }
      />
      <section className="panel">
        <div className="finance-filters">
          <Field label="Review state" htmlFor="finance-state">
            <select id="finance-state" value={state} onChange={(e) => setState(e.target.value)}>
              {['SUBMITTED', 'RETURNED', 'APPROVED', 'UNSUBMITTED', 'ALL'].map((v) => (
                <option key={v} value={v}>
                  {v === 'UNSUBMITTED'
                    ? 'Not submitted'
                    : v === 'ALL'
                      ? 'All records'
                      : v.charAt(0) + v.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Asset code or description" htmlFor="finance-search">
            <input
              id="finance-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search asset records"
              maxLength={100}
            />
          </Field>
        </div>
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        {query.isPending ? (
          <Loading />
        ) : items.length ? (
          <div className="table-scroll finance-responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Review state</th>
                  <th>Entered cost</th>
                  <th>Last approved cost</th>
                  <th>Submitted by</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Asset">
                      <strong>{a.assetCode}</strong>
                      <p>{a.description}</p>
                    </td>
                    <td data-label="Review state">
                      <span className={`finance-status ${a.state?.toLowerCase() ?? 'new'}`}>
                        {a.state ?? 'NOT SUBMITTED'}
                      </span>
                    </td>
                    <td data-label="Entered cost">{money(a.purchaseCost)}</td>
                    <td data-label="Last approved cost">{money(a.approvedCost)}</td>
                    <td data-label="Submitted by">{a.submittedByName ?? 'Not submitted'}</td>
                    <td data-label="Open record">
                      <Link className="button secondary small" to={`/finance/${a.id}`}>
                        Review {a.assetCode}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No matching records">
            Choose another state or search. No records have been hidden by a row limit.
          </Empty>
        )}
        {query.hasNextPage ? (
          <button
            className="button secondary"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more records'}
          </button>
        ) : null}
      </section>
    </>
  );
}
export function FinanceDetail() {
  const { id } = useParams(),
    { user } = useSession();
  const query = useQuery({
    queryKey: ['finance-asset', id],
    enabled: hasRole(user, 'ADMIN') || hasRole(user, 'FINANCE'),
    queryFn: ({ signal }) => api<FinanceAsset>(`/finance/assets/${id}`, { signal }),
  });
  if (!hasRole(user, 'ADMIN') && !hasRole(user, 'FINANCE'))
    return <Empty title="Finance access required" />;
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorNotice error={query.error} retry={() => void query.refetch()} />;
  return query.data ? (
    <FinanceRecord
      key={`${id}-${query.data.assetVersion}-${query.data.financeVersion}`}
      asset={query.data}
    />
  ) : null;
}
function FinanceRecord({ asset: a }: { asset: FinanceAsset }) {
  const { user } = useSession(),
    action = useAction(),
    client = useQueryClient();
  const [cost, setCost] = useState(a.purchaseCost ?? ''),
    [purchaseDate, setPurchaseDate] = useState(a.purchaseDate?.slice(0, 10) ?? ''),
    [invoice, setInvoice] = useState(a.invoiceNumber ?? ''),
    [supplier, setSupplier] = useState(a.supplier ?? ''),
    [reason, setReason] = useState(''),
    [decision, setDecision] = useState('APPROVE'),
    [saved, setSaved] = useState('');
  const canReview =
    hasRole(user, 'FINANCE') && a.state === 'SUBMITTED' && a.submittedBy !== user?.id;
  const stale = a.state === 'SUBMITTED' && a.submittedAssetVersion !== a.assetVersion;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved('');
    try {
      await action.mutateAsync({
        path: `/finance/assets/${a.id}/submit`,
        body: { reason },
        version: a.assetVersion,
      });
      setSaved('Current asset version submitted for Finance review.');
      setReason('');
    } catch {
      /* shared error notice */
    }
  }
  async function review(event: FormEvent) {
    event.preventDefault();
    setSaved('');
    try {
      await action.mutateAsync({
        path: `/finance/assets/${a.id}/review`,
        body: {
          decision,
          reason,
          ...(decision === 'APPROVE'
            ? { purchaseCost: cost, purchaseDate, invoiceNumber: invoice, supplier }
            : {}),
        },
        version: a.financeVersion ?? undefined,
      });
      setSaved(
        decision === 'APPROVE'
          ? 'Finance approval recorded.'
          : 'Returned to registrar with your reason.',
      );
    } catch {
      /* shared error notice */
    }
  }
  return (
    <>
      <PageTitle
        title={`Finance · ${a.assetCode}`}
        description={a.description}
        action={
          <Link className="button secondary" to="/finance">
            Back to queue
          </Link>
        }
      />
      <ErrorNotice
        error={action.error}
        retry={() => void client.invalidateQueries({ queryKey: ['finance-asset', a.id] })}
      />
      {saved ? (
        <p role="status" className="notice success">
          {saved}
        </p>
      ) : null}
      {stale ? (
        <p className="notice warning" role="alert">
          The asset changed after submission. The registrar must resubmit this version before
          Finance can review it.
        </p>
      ) : null}
      <div className="finance-layout">
        <Panel title="Review record">
          <dl className="finance-facts">
            <div>
              <dt>State</dt>
              <dd>{a.state ?? 'NOT SUBMITTED'}</dd>
            </div>
            <div>
              <dt>Submitted by</dt>
              <dd>{a.submittedByName ?? 'Not submitted'}</dd>
            </div>
            <div>
              <dt>Submitted</dt>
              <dd>{date(a.submittedAt)}</dd>
            </div>
            <div>
              <dt>Submission reason</dt>
              <dd>{a.submissionReason ?? 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Latest review note</dt>
              <dd>{a.reviewReason ?? 'No review yet'}</dd>
            </div>
            <div>
              <dt>Last approved cost</dt>
              <dd>{money(a.approvedCost)}</dd>
            </div>
            <div>
              <dt>Last approved</dt>
              <dd>{date(a.approvedAt)}</dd>
            </div>
          </dl>
          <p className="muted">
            A pending amendment keeps the last approved cost in executive totals until Finance
            approves the replacement.
          </p>
        </Panel>
        <Panel title={canReview ? 'Review financial details' : 'Registrar submission'}>
          {canReview ? (
            <form className="form-stack" onSubmit={(e) => void review(e)}>
              <Field label="Decision" htmlFor="decision">
                <select
                  id="decision"
                  value={decision}
                  onChange={(e) => setDecision(e.target.value)}
                >
                  <option value="APPROVE">Approve financial details</option>
                  <option value="RETURN">Return for correction</option>
                </select>
              </Field>
              {decision === 'APPROVE' ? (
                <>
                  <Field label="Purchase cost (INR)" htmlFor="cost">
                    <input
                      id="cost"
                      inputMode="decimal"
                      pattern="[0-9]+(\.[0-9]{1,2})?"
                      value={cost}
                      onChange={(e) => setCost(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Purchase date" htmlFor="purchase-date">
                    <input
                      id="purchase-date"
                      type="date"
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Invoice number" htmlFor="invoice">
                    <input
                      id="invoice"
                      value={invoice}
                      onChange={(e) => setInvoice(e.target.value)}
                      required
                      maxLength={160}
                    />
                  </Field>
                  <Field label="Supplier" htmlFor="supplier">
                    <input
                      id="supplier"
                      value={supplier}
                      onChange={(e) => setSupplier(e.target.value)}
                      required
                      maxLength={160}
                    />
                  </Field>
                </>
              ) : null}
              <Field label="Review reason" htmlFor="review-reason">
                <textarea
                  id="review-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  minLength={3}
                  maxLength={2000}
                />
              </Field>
              <button className="button" disabled={action.isPending || stale}>
                {action.isPending
                  ? 'Recording…'
                  : decision === 'APPROVE'
                    ? 'Record Finance approval'
                    : 'Return to registrar'}
              </button>
            </form>
          ) : hasRole(user, 'ADMIN') ? (
            <form className="form-stack" onSubmit={(e) => void submit(e)}>
              <p>
                Entered cost: <strong>{money(a.purchaseCost)}</strong>. Submit the current catalog
                version for independent Finance review. Approved records may be submitted again for
                an amendment.
              </p>
              <Field label="Submission reason" htmlFor="submission-reason">
                <textarea
                  id="submission-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  minLength={3}
                  maxLength={2000}
                />
              </Field>
              <button
                className="button"
                disabled={action.isPending || (a.state === 'SUBMITTED' && !stale)}
              >
                {action.isPending
                  ? 'Submitting…'
                  : a.approvedAt
                    ? 'Submit amendment'
                    : 'Submit to Finance'}
              </button>
            </form>
          ) : (
            <p className="muted">
              {a.state === 'SUBMITTED'
                ? 'A separate reviewer must review a record you submitted.'
                : a.state === 'APPROVED'
                  ? 'Approval recorded. A registrar can submit an amendment when these details change.'
                  : 'The registrar must submit this record before Finance can review it.'}
            </p>
          )}
        </Panel>
      </div>
      <Panel title="Finance history">
        <p className="muted">
          Latest 50 Finance events, newest first. The full evidence remains in the audit database.
        </p>
        {a.history.length ? (
          <ol className="finance-history">
            {a.history.map((e) => (
              <li key={e.id}>
                <strong>{e.action}</strong>
                <span>
                  {e.actor} · {date(e.occurredAt)}
                </span>
                <p>{e.reason}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p>No Finance events yet.</p>
        )}
      </Panel>
    </>
  );
}
interface ExecutiveSummary {
  asOf: string;
  totalAssets: number;
  assignedAssets: number;
  pendingReviews: number;
  returnedReviews: number;
  unsubmittedAssets: number;
  approvedAssets: number;
  approvedAcquisitionCost: string;
  missingAssets: number;
  warrantyExpiring: number;
  openTickets: number;
  highPriorityOpen: number;
  departments: {
    department: string;
    assetCount: number;
    approvedCount: number;
    approvedCost: string;
  }[];
  definitions: { approvedAcquisitionCost: string; approvedAssets: string; scope: string };
}
export function ExecutiveDashboard() {
  const { user } = useSession(),
    allowed = hasRole(user, 'ADMIN') || hasRole(user, 'FINANCE') || hasRole(user, 'EXECUTIVE');
  const query = useQuery({
    queryKey: ['executive-summary'],
    queryFn: ({ signal }) => api<ExecutiveSummary>('/finance/executive-summary', { signal }),
    enabled: allowed,
  });
  if (!allowed) return <Empty title="Executive access required" />;
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorNotice error={query.error} retry={() => void query.refetch()} />;
  const d = query.data!;
  return (
    <>
      <PageTitle
        title="Executive overview"
        description="A read-only view of asset coverage, Finance approvals and operational risk."
        action={
          <button
            className="button secondary"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {query.isFetching ? 'Refreshing…' : 'Refresh summary'}
          </button>
        }
      />
      <p className="muted">Updated {date(d.asOf)} · Organization-wide · INR</p>
      <div className="metric-grid four">
        <Metric label="Registered assets" value={d.totalAssets} />
        <Metric label="Finance-approved assets" value={d.approvedAssets} />
        <Metric label="Approved acquisition cost" value={money(d.approvedAcquisitionCost)} />
        <Metric label="Awaiting Finance review" value={d.pendingReviews} />
      </div>
      <div className="finance-layout">
        <Panel title="Review coverage">
          <dl className="finance-facts">
            <div>
              <dt>Not submitted</dt>
              <dd>{d.unsubmittedAssets}</dd>
            </div>
            <div>
              <dt>Returned for correction</dt>
              <dd>{d.returnedReviews}</dd>
            </div>
            <div>
              <dt>Currently assigned</dt>
              <dd>{d.assignedAssets}</dd>
            </div>
          </dl>
          {hasRole(user, 'ADMIN') || hasRole(user, 'FINANCE') ? (
            <Link className="button secondary" to="/finance">
              Open Finance queue
            </Link>
          ) : (
            <p className="muted">Your executive role has read-only summary access.</p>
          )}
        </Panel>
        <Panel title="Operational attention">
          <dl className="finance-facts">
            <div>
              <dt>Lost or stolen assets</dt>
              <dd>{d.missingAssets}</dd>
            </div>
            <div>
              <dt>Warranties expiring in 30 days</dt>
              <dd>{d.warrantyExpiring}</dd>
            </div>
            <div>
              <dt>Open support tickets</dt>
              <dd>{d.openTickets}</dd>
            </div>
            <div>
              <dt>High-priority open tickets</dt>
              <dd>{d.highPriorityOpen}</dd>
            </div>
          </dl>
        </Panel>
      </div>
      <Panel title="Department overview">
        <div className="table-scroll finance-responsive-table">
          <table>
            <thead>
              <tr>
                <th>Department</th>
                <th>Assets</th>
                <th>Finance-approved</th>
                <th>Approved cost (INR)</th>
              </tr>
            </thead>
            <tbody>
              {d.departments.map((v) => (
                <tr key={v.department}>
                  <td data-label="Department">{v.department}</td>
                  <td data-label="Assets">{v.assetCount}</td>
                  <td data-label="Finance-approved">{v.approvedCount}</td>
                  <td data-label="Approved cost (INR)">{money(v.approvedCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="How to read these numbers">
        <p>{d.definitions.approvedAcquisitionCost}</p>
        <p>{d.definitions.approvedAssets}</p>
        <p>{d.definitions.scope}</p>
      </Panel>
    </>
  );
}
