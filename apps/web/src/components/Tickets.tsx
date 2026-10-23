import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { usePages, useAction } from '../hooks';
import { hasRole, isStaff, useSession } from '../session';
import type { Asset, Page, Ticket, TimelineEvent, User } from '../types';
import { fetchAllPages } from '../transfer-files';
import { BulkTransfer, ExportRecords, FormTransfer } from './DataTransfer';
import {
  useReferences,
  ReferenceSelect,
  ReferenceBadge,
  referenceLabel,
  referenceOptions,
} from './References';
import {
  Empty,
  ErrorNotice,
  Field,
  Loading,
  LoadMore,
  PageTitle,
  Panel,
  Timeline,
  displayDate,
} from './ui';
const ticketExportColumns = [
  'ticketNumber',
  'subject',
  'description',
  'category',
  'priority',
  'status',
  'assetId',
  'ownerId',
  'createdAt',
  'updatedAt',
  'resolution',
];
function ticketExportRow(ticket: Ticket) {
  return Object.fromEntries(
    ticketExportColumns.map((key) => [key, ticket[key as keyof Ticket] ?? '']),
  );
}
export function TicketList() {
  const refs = useReferences();
  const { user } = useSession();
  const staff = isStaff(user);
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const priority = params.get('priority') ?? '';
  const query = usePages<Ticket>('/tickets', {
    status: status || undefined,
    priority: priority || undefined,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  function filter(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next);
  }
  return (
    <>
      <PageTitle
        eyebrow={staff ? 'SUPPORT / TEAM QUEUE' : 'MY WORKSPACE / SUPPORT'}
        title={staff ? 'Support desk' : 'My support tickets'}
        description={
          staff
            ? 'Keep requests moving, share updates, and close the loop.'
            : 'Track your requests and stay in touch with the support team.'
        }
        action={
          <Link className="button" to="/tickets/new">
            Raise a ticket
          </Link>
        }
      />
      <ExportRecords
        name="tickets"
        columns={ticketExportColumns}
        load={async () =>
          (
            await fetchAllPages('/tickets', {
              status: status || undefined,
              priority: priority || undefined,
            })
          ).map((item) =>
            Object.fromEntries(ticketExportColumns.map((key) => [key, item[key] ?? ''])),
          )
        }
      />
      <BulkTransfer module="tickets" />
      <Panel>
        <div className="filter-bar">
          <Field label="Status" htmlFor="ticket-status-filter">
            <ReferenceSelect
              refs={refs.data}
              kind="TICKET_STATUS"
              id="ticket-status-filter"
              value={status}
              onChange={(value) => filter('status', value)}
              required={false}
              allowEmpty
              includeInactive
            />
          </Field>
          <Field label="Priority" htmlFor="ticket-priority-filter">
            <ReferenceSelect
              refs={refs.data}
              kind="TICKET_PRIORITY"
              id="ticket-priority-filter"
              value={priority}
              onChange={(value) => filter('priority', value)}
              required={false}
              allowEmpty
              includeInactive
            />
          </Field>
          <p className="muted filter-hint">
            {staff
              ? 'Public replies notify the employee. Internal notes stay with your team.'
              : 'Your tickets remain available after equipment is returned.'}
          </p>
        </div>
        <ErrorNotice
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
        {query.isPending ? (
          <Loading label="Loading support requests..." />
        ) : items.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Ticket / subject</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Updated</th>
                  {staff ? <th>Ownership</th> : null}
                  <th>
                    <span className="sr-only">View</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>
                      <Link className="asset-code" to={`/tickets/${ticket.id}`}>
                        #{ticket.ticketNumber}
                      </Link>
                      <span className="cell-description">{ticket.subject}</span>
                    </td>
                    <td>
                      <ReferenceBadge refs={refs.data} kind="TICKET_STATUS" value={ticket.status} />
                    </td>
                    <td>
                      <ReferenceBadge
                        refs={refs.data}
                        kind="TICKET_PRIORITY"
                        value={ticket.priority}
                      />
                    </td>
                    <td>{displayDate(ticket.updatedAt ?? ticket.createdAt)}</td>
                    {staff ? <td>{ticket.ownerId ? 'Assigned' : 'Unassigned'}</td> : null}
                    <td>
                      <Link
                        to={`/tickets/${ticket.id}`}
                        className="table-link"
                        aria-label={`View ticket ${ticket.ticketNumber}`}
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !query.error ? (
          <Empty
            title="No tickets here"
            action={
              <Link className="button secondary" to="/tickets/new">
                Raise a ticket
              </Link>
            }
          >
            New requests and their updates will appear here. Try a different filter if needed.
          </Empty>
        ) : null}
        <LoadMore
          available={query.hasNextPage}
          loading={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        />
      </Panel>
    </>
  );
}
export function TicketForm() {
  const refs = useReferences();
  const { user } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const assets = usePages<Asset>('/assets', {}, hasRole(user, 'EMPLOYEE'));
  const [assetId, setAssetId] = useState(params.get('assetId') ?? '');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('HARDWARE');
  const [priority, setPriority] = useState('MEDIUM');
  const [validation, setValidation] = useState('');
  const action = useAction<Ticket>();
  const eligible =
    assets.data?.pages
      .flatMap((page) => page.items)
      .filter((asset) => asset.currentAssignment?.userId === user?.id) ?? [];
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!subject.trim() || !description.trim()) {
      setValidation('Please enter a subject and details.');
      return;
    }
    setValidation('');
    const result = await action
      .mutateAsync({
        path: '/tickets',
        body: {
          ...(assetId ? { assetId } : {}),
          subject: subject.trim(),
          description: description.trim(),
          category,
          priority,
          ...(params.get('relatedTicketId')
            ? { relatedTicketId: params.get('relatedTicketId') }
            : {}),
        },
        idempotent: true,
      })
      .catch(() => undefined);
    if (result) navigate(`/tickets/${result.id}`, { state: { created: true } });
  }
  return (
    <>
      <Link className="back-link" to="/tickets">
        ← Support tickets
      </Link>
      <PageTitle
        title="How can we help?"
        description="Share the details with your support team. You will receive an email confirmation."
      />
      <div className="ticket-form-layout">
        <Panel title="New support request">
          <FormTransfer
            formId="ticket-create"
            fields={[
              { key: 'subject', required: true },
              { key: 'description', required: true },
              {
                key: 'category',
                required: true,
                options: referenceOptions(refs.data, 'TICKET_CATEGORY').map((item) => item.code),
              },
              {
                key: 'priority',
                required: true,
                options: referenceOptions(refs.data, 'TICKET_PRIORITY').map((item) => item.code),
              },
              {
                key: 'assetId',
                label: 'Related asset ID',
                options: eligible.map((item) => item.id),
              },
            ]}
            values={{ subject, description, category, priority, assetId }}
            disabled={action.isPending || refs.isPending || !!refs.error}
            description="Load one request for review. A linked asset must be one of your loaded current assignments. Submit ticket remains a separate action."
            onImport={(data) => {
              if (typeof data.subject === 'string') setSubject(data.subject);
              if (typeof data.description === 'string') setDescription(data.description);
              if (typeof data.category === 'string') setCategory(data.category);
              if (typeof data.priority === 'string') setPriority(data.priority);
              if (
                typeof data.assetId === 'string' &&
                (!data.assetId || eligible.some((item) => item.id === data.assetId))
              )
                setAssetId(data.assetId);
              setValidation('');
              action.reset();
            }}
          />
          <form className="form-stack" onSubmit={submit}>
            <ErrorNotice error={action.error} />
            <ErrorNotice
              error={refs.error}
              retry={() => {
                void refs.refetch();
              }}
            />
            {validation ? (
              <div role="alert" className="notice danger">
                {validation}
              </div>
            ) : null}
            <Field
              label="Related asset (optional)"
              htmlFor="ticket-asset"
              hint="Choose no asset for a portal access issue. Only currently assigned equipment is eligible."
            >
              <select
                id="ticket-asset"
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
              >
                <option value="">No asset / general support</option>
                {assetId && !eligible.some((asset) => asset.id === assetId) ? (
                  <option value={assetId} disabled>
                    Loading selected asset...
                  </option>
                ) : null}
                {eligible.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.assetCode} · {asset.description}
                  </option>
                ))}
              </select>
            </Field>
            <ErrorNotice
              error={assets.error}
              retry={() => {
                void assets.refetch();
              }}
            />
            <LoadMore
              available={assets.hasNextPage}
              loading={assets.isFetchingNextPage}
              onClick={() => {
                void assets.fetchNextPage();
              }}
            />
            <Field label="Subject" htmlFor="ticket-subject">
              <input
                id="ticket-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                maxLength={160}
                required
                placeholder="A short summary of the issue"
              />
            </Field>
            <div className="form-grid">
              <Field label="Category" htmlFor="ticket-category">
                <ReferenceSelect
                  refs={refs.data}
                  kind="TICKET_CATEGORY"
                  id="ticket-category"
                  value={category}
                  onChange={setCategory}
                  preserveCurrent={false}
                />
              </Field>
              <Field label="Priority" htmlFor="ticket-priority">
                <ReferenceSelect
                  refs={refs.data}
                  kind="TICKET_PRIORITY"
                  id="ticket-priority"
                  value={priority}
                  onChange={setPriority}
                  preserveCurrent={false}
                />
              </Field>
            </div>
            <Field
              label="What happened?"
              htmlFor="ticket-description"
              hint={`${description.length}/5000 characters. Include symptoms, when it began, and steps you have tried.`}
            >
              <textarea
                id="ticket-description"
                rows={7}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={5000}
                required
              />
            </Field>
            <div className="form-actions">
              <Link className="button secondary" to="/tickets">
                Cancel
              </Link>
              <button
                className="button"
                disabled={
                  action.isPending ||
                  refs.isPending ||
                  !!refs.error ||
                  !referenceOptions(refs.data, 'TICKET_CATEGORY').some(
                    (item) => item.code === category,
                  ) ||
                  !referenceOptions(refs.data, 'TICKET_PRIORITY').some(
                    (item) => item.code === priority,
                  )
                }
              >
                {action.isPending ? 'Submitting...' : 'Submit ticket →'}
              </button>
            </div>
          </form>
        </Panel>
        <aside className="help-card">
          <h2>Help us help you.</h2>
          <p>Describe the issue clearly and add any useful error message.</p>
          <ul>
            <li>Choose the affected equipment.</li>
            <li>Tell us what you expected to happen.</li>
            <li>Share what you already tried.</li>
          </ul>
          <hr />
          <p className="small-text">
            Keep passwords, clinical records, and unnecessary personal information out of your
            request.
          </p>
          <p className="small-text">
            Your request is saved before email delivery. Notification delays do not erase your
            ticket.
          </p>
        </aside>
      </div>
    </>
  );
}
export function TicketDetail() {
  const refs = useReferences();
  const { id } = useParams();
  const { user } = useSession();
  const staff = isStaff(user);
  const query = useQuery({
    queryKey: ['ticket', id],
    queryFn: ({ signal }) => api<Ticket>(`/tickets/${id}`, { signal }),
  });
  const history = usePages<TimelineEvent>(`/tickets/${id}/updates`);
  const staffUsers = useQuery({
    queryKey: ['staff-users'],
    queryFn: () => api<Page<User>>('/users?limit=100'),
    enabled: hasRole(user, 'ADMIN'),
  });
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState('PUBLIC');
  const [resolution, setResolution] = useState('');
  const [completing, setCompleting] = useState(false);
  const [statusVersion, setStatusVersion] = useState<number>();
  const [ownerVersion, setOwnerVersion] = useState<number>();
  const [ownerId, setOwnerId] = useState('');
  const action = useAction();
  const [draftVersion, setDraftVersion] = useState<number>();
  if (query.isPending) return <Loading label="Loading conversation..." />;
  if (query.error)
    return (
      <ErrorNotice
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const ticket = query.data;
  if (!ticket) return <Empty title="Ticket unavailable" />;
  const updates = history.data?.pages.flatMap((page) => page.items) ?? ticket.updates ?? [];
  async function reply(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    await action
      .mutateAsync({
        path: `/tickets/${id}/updates`,
        body: { body: body.trim(), visibility: staff ? visibility : 'PUBLIC' },
        version: draftVersion ?? ticket?.version,
      })
      .then(() => {
        setBody('');
        setDraftVersion(undefined);
      })
      .catch(() => undefined);
  }
  async function status(next: string) {
    await action
      .mutateAsync({
        path: `/tickets/${id}/status`,
        method: 'PATCH',
        body: { status: next, ...(next === 'COMPLETED' ? { resolution: resolution.trim() } : {}) },
        version: statusVersion ?? ticket?.version,
      })
      .then(() => {
        setCompleting(false);
        setResolution('');
      })
      .catch(() => undefined);
  }
  async function owner(value: string) {
    await action
      .mutateAsync({
        path: `/tickets/${id}/owner`,
        method: 'PATCH',
        body: { ownerId: value },
        version: ownerVersion ?? ticket?.version,
      })
      .catch(() => undefined);
  }
  return (
    <>
      <Link className="back-link" to="/tickets">
        ← Support desk
      </Link>
      <PageTitle
        eyebrow={`SUPPORT / #${ticket.ticketNumber}`}
        title={ticket.subject}
        description={`Opened ${displayDate(ticket.createdAt, true)} · ${referenceLabel(refs.data, 'TICKET_CATEGORY', ticket.category)}`}
        action={
          ticket.status === 'COMPLETED' ? (
            <Link to={`/tickets/new?relatedTicketId=${ticket.id}`} className="button secondary">
              Create follow-up ticket
            </Link>
          ) : undefined
        }
      />
      <ExportRecords
        name={`ticket-${ticket.ticketNumber}`}
        columns={[
          ...ticketExportColumns,
          'updateKind',
          'updateVisibility',
          'updateBody',
          'updateCreatedAt',
        ]}
        load={async () => {
          const [current, updates] = await Promise.all([
            api<Ticket>(`/tickets/${ticket.id}`),
            fetchAllPages(`/tickets/${ticket.id}/updates`),
          ]);
          const rows = updates.filter((item) => staff || item.visibility === 'PUBLIC');
          const details = ticketExportRow(current);
          return rows.length
            ? rows.map((item) => ({
                ...details,
                updateKind: item.kind ?? '',
                updateVisibility: item.visibility ?? '',
                updateBody: item.body ?? '',
                updateCreatedAt: item.createdAt ?? '',
              }))
            : [details];
        }}
      />
      <ErrorNotice
        error={action.error}
        retry={() => {
          void Promise.all([query.refetch(), history.refetch()]).then(() => {
            setDraftVersion(undefined);
            setStatusVersion(undefined);
            setOwnerVersion(undefined);
          });
        }}
      />
      <div className="ticket-detail-layout">
        <div className="stack">
          <Panel title="Conversation">
            <div className="ticket-description preserve">{ticket.description}</div>
            <ErrorNotice
              error={history.error}
              retry={() => {
                void history.refetch();
              }}
            />
            {history.isPending ? (
              <Loading label="Loading updates..." />
            ) : (
              <Timeline items={updates} />
            )}
            <LoadMore
              available={history.hasNextPage}
              loading={history.isFetchingNextPage}
              onClick={() => {
                void history.fetchNextPage();
              }}
            />
          </Panel>
          {ticket.status !== 'COMPLETED' ? (
            <Panel title="Add an update">
              <form className="form-stack" onSubmit={reply}>
                <FormTransfer
                  formId={staff ? 'ticket-staff-reply' : 'ticket-employee-reply'}
                  fields={[
                    { key: 'body', label: 'Reply', required: true },
                    ...(staff
                      ? [{ key: 'visibility', options: ['PUBLIC', 'INTERNAL'], required: true }]
                      : []),
                  ]}
                  values={{ body, ...(staff ? { visibility } : {}) }}
                  disabled={action.isPending}
                  onImport={(data) => {
                    if (typeof data.body === 'string') {
                      if (!body) setDraftVersion(ticket.version);
                      setBody(data.body);
                    }
                    if (staff && (data.visibility === 'PUBLIC' || data.visibility === 'INTERNAL'))
                      setVisibility(data.visibility);
                    action.reset();
                  }}
                />
                <Field
                  label={visibility === 'INTERNAL' ? 'Internal note' : 'Reply'}
                  htmlFor="reply-body"
                >
                  <textarea
                    id="reply-body"
                    value={body}
                    onChange={(event) => {
                      if (!body) setDraftVersion(ticket.version);
                      setBody(event.target.value);
                    }}
                    maxLength={5000}
                    rows={5}
                    required
                  />
                </Field>
                {staff ? (
                  <Field label="Visibility" htmlFor="reply-visibility">
                    <select
                      id="reply-visibility"
                      value={visibility}
                      onChange={(event) => setVisibility(event.target.value)}
                    >
                      <option value="PUBLIC">Public reply · employee is notified</option>
                      <option value="INTERNAL">Internal note · staff only</option>
                    </select>
                  </Field>
                ) : null}
                <button className="button" disabled={action.isPending || !body.trim()}>
                  {action.isPending
                    ? 'Saving...'
                    : visibility === 'INTERNAL'
                      ? 'Save internal note'
                      : 'Send reply'}
                </button>
              </form>
            </Panel>
          ) : (
            <div className="notice success">
              <strong>Completed</strong>
              <p className="preserve">
                {ticket.resolution ||
                  'This request is completed. Create a follow-up ticket if you need further help.'}
              </p>
            </div>
          )}
        </div>
        <aside className="stack">
          <Panel title="Ticket details">
            <dl className="details">
              <dt>Status</dt>
              <dd>
                <ReferenceBadge refs={refs.data} kind="TICKET_STATUS" value={ticket.status} />
              </dd>
              <dt>Priority</dt>
              <dd>
                <ReferenceBadge refs={refs.data} kind="TICKET_PRIORITY" value={ticket.priority} />
              </dd>
              <dt>Owner</dt>
              <dd>
                {ticket.ownerId === user?.id
                  ? 'You'
                  : ticket.ownerId
                    ? 'Assigned staff member'
                    : 'Unassigned'}
              </dd>
              <dt>Asset</dt>
              <dd>
                {ticket.assetId ? (
                  <Link to={`/assets/${ticket.assetId}`}>View linked asset →</Link>
                ) : (
                  'No asset'
                )}
              </dd>
            </dl>
            {staff && ticket.status !== 'COMPLETED' ? (
              <div className="subsection form-stack">
                {ticket.ownerId !== user?.id ? (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={action.isPending}
                    onClick={() => {
                      void owner(user!.id);
                    }}
                  >
                    Take ownership
                  </button>
                ) : null}
                {hasRole(user, 'ADMIN') ? (
                  <>
                    <FormTransfer
                      formId="ticket-owner"
                      fields={[
                        {
                          key: 'ownerId',
                          label: 'Staff record ID',
                          required: true,
                          options:
                            staffUsers.data?.items
                              .filter(
                                (item) =>
                                  item.state === 'ACTIVE' &&
                                  !!item.emailVerifiedAt &&
                                  (item.roles.includes('ADMIN') || item.roles.includes('IT_ADMIN')),
                              )
                              .map((item) => item.id) ?? [],
                        },
                      ]}
                      values={{ ownerId }}
                      disabled={action.isPending || staffUsers.isPending || !!staffUsers.error}
                      onImport={(data) => {
                        if (
                          typeof data.ownerId === 'string' &&
                          staffUsers.data?.items.some(
                            (item) =>
                              item.id === data.ownerId &&
                              item.state === 'ACTIVE' &&
                              !!item.emailVerifiedAt &&
                              (item.roles.includes('ADMIN') || item.roles.includes('IT_ADMIN')),
                          )
                        ) {
                          setOwnerId(data.ownerId);
                          setOwnerVersion(ticket.version);
                          action.reset();
                        }
                      }}
                    />
                    <Field label="Assign to staff" htmlFor="ticket-owner">
                      <select
                        id="ticket-owner"
                        value={ownerId}
                        onChange={(event) => {
                          setOwnerId(event.target.value);
                          setOwnerVersion(ticket.version);
                        }}
                      >
                        <option value="">Select team member</option>
                        {staffUsers.data?.items
                          .filter(
                            (item) =>
                              item.state === 'ACTIVE' &&
                              (item.roles.includes('ADMIN') || item.roles.includes('IT_ADMIN')),
                          )
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.displayName}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={!ownerId || action.isPending}
                      onClick={() => {
                        void owner(ownerId);
                      }}
                    >
                      Update owner
                    </button>
                  </>
                ) : null}
                {ticket.status === 'OPEN' ? (
                  <button
                    className="button secondary"
                    type="button"
                    disabled={action.isPending}
                    onClick={() => {
                      void status('IN_PROGRESS');
                    }}
                  >
                    Start progress
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button"
                  disabled={action.isPending}
                  onClick={() => {
                    setCompleting(!completing);
                    setStatusVersion(ticket.version);
                  }}
                >
                  Mark completed
                </button>
                {completing ? (
                  <form
                    className="form-stack"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void status('COMPLETED');
                    }}
                  >
                    <FormTransfer
                      formId="ticket-completion"
                      fields={[{ key: 'resolution', required: true }]}
                      values={{ resolution }}
                      disabled={action.isPending}
                      description="Review the resolution, then confirm completion separately. Importing does not change ticket status."
                      onImport={(data) => {
                        if (typeof data.resolution === 'string') setResolution(data.resolution);
                        action.reset();
                      }}
                    />
                    <Field
                      label="Resolution"
                      htmlFor="resolution"
                      hint="The employee receives this resolution."
                    >
                      <textarea
                        id="resolution"
                        value={resolution}
                        onChange={(event) => setResolution(event.target.value)}
                        maxLength={5000}
                        required
                      />
                    </Field>
                    <button className="button" disabled={action.isPending || !resolution.trim()}>
                      Confirm completion
                    </button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </Panel>
          <div className="help-card">
            <h3>Keep the loop closed</h3>
            <p>
              Public replies and completion updates notify the employee. Internal notes stay visible
              to authorized staff.
            </p>
            <p className="small-text">
              Ticket completion does not change asset custody or inventory status.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
