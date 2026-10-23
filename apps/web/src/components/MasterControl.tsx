import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { MasterData, MasterKind } from '../types';
import { BulkTransfer, ExportRecords, FormTransfer } from './DataTransfer';
import { Badge, Empty, ErrorNotice, Field, Loading, Metric, PageTitle, Panel, Select } from './ui';

type Entry = {
  id?: string;
  code: string;
  name?: string;
  label?: string;
  site?: string | null;
  building?: string | null;
  floor?: string | null;
  room?: string | null;
  active: boolean;
  version: number;
};
type Group = {
  key: string;
  title: string;
  singular: string;
  section: string;
  description: string;
  fixed?: boolean;
};
const groups: Group[] = [
  {
    key: 'departments',
    title: 'Departments',
    singular: 'department',
    section: 'Organization',
    description: 'Maintain the departments used to organize your asset register.',
  },
  {
    key: 'locations',
    title: 'Locations',
    singular: 'location',
    section: 'Organization',
    description: 'Define sites, buildings, floors and rooms for equipment and returns.',
  },
  {
    key: 'CATEGORY',
    title: 'Categories',
    singular: 'category',
    section: 'Assets',
    description: 'Group similar assets for consistent cataloging and filtering.',
  },
  {
    key: 'ASSET_TYPE',
    title: 'Asset types',
    singular: 'asset type',
    section: 'Assets',
    description: 'Maintain the equipment types available when creating assets.',
  },
  {
    key: 'OWNERSHIP',
    title: 'Ownership types',
    singular: 'ownership type',
    section: 'Assets',
    description: 'Record how equipment is owned or held by IAC.',
  },
  {
    key: 'CONDITION',
    title: 'Conditions',
    singular: 'condition',
    section: 'Assets',
    description: 'Describe equipment condition during creation, editing and returns.',
  },
  {
    key: 'RISK',
    title: 'Risk levels',
    singular: 'risk level',
    section: 'Assets',
    description: 'Maintain risk classifications for asset records.',
  },
  {
    key: 'STATUS',
    title: 'Asset statuses',
    singular: 'asset status',
    section: 'Assets',
    description: 'Choose how the existing asset workflow statuses are displayed.',
    fixed: true,
  },
  {
    key: 'DEPRECIATION_METHOD',
    title: 'Depreciation methods',
    singular: 'depreciation method',
    section: 'Assets',
    description:
      'Maintain financial metadata options. Finance policy approval is still required for calculations.',
  },
  {
    key: 'DISPOSAL_METHOD',
    title: 'Disposal methods',
    singular: 'disposal method',
    section: 'Assets',
    description: 'Define the methods recorded with disposal evidence.',
  },
  {
    key: 'COMMENT_TYPE',
    title: 'Comment types',
    singular: 'comment type',
    section: 'Assets',
    description: 'Classify asset remarks for consistent records.',
  },
  {
    key: 'DATA_WIPE',
    title: 'Data wipe options',
    singular: 'data wipe option',
    section: 'Assets',
    description: 'Edit labels for the existing data wipe requirements.',
    fixed: true,
  },
  {
    key: 'TICKET_CATEGORY',
    title: 'Ticket categories',
    singular: 'ticket category',
    section: 'Support',
    description: 'Maintain the categories employees choose when raising support tickets.',
  },
  {
    key: 'TICKET_STATUS',
    title: 'Ticket statuses',
    singular: 'ticket status',
    section: 'Support',
    description: 'Choose how the existing support workflow statuses are displayed.',
    fixed: true,
  },
  {
    key: 'TICKET_PRIORITY',
    title: 'Ticket priorities',
    singular: 'ticket priority',
    section: 'Support',
    description: 'Edit the labels shown for the three supported priority levels.',
    fixed: true,
  },
];
function entriesFor(data: MasterData, key: string): Entry[] {
  if (key === 'departments') return data.departments;
  if (key === 'locations') return data.locations;
  return data.values.filter((entry) => entry.kind === key);
}
function entryName(entry: Entry, scope: string) {
  if (scope === 'locations')
    return (
      [entry.site, entry.building, entry.floor, entry.room].filter(Boolean).join(' / ') ||
      entry.code
    );
  return entry.name || entry.label || entry.code;
}

export function MasterControl() {
  const [params, setParams] = useSearchParams();
  const group = groups.find((item) => item.key === params.get('group')) ?? groups[0];
  return (
    <MasterControlPage
      key={group.key}
      group={group}
      onSelectGroup={(key) => setParams({ group: key })}
    />
  );
}
function MasterControlPage({
  group,
  onSelectGroup,
}: {
  group: Group;
  onSelectGroup: (key: string) => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['master-data'],
    queryFn: ({ signal }) => api<MasterData>('/master-data', { signal }),
  });
  const [editor, setEditor] = useState<Entry | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [availability, setAvailability] = useState('active');
  const [success, setSuccess] = useState('');
  const data = query.data;
  const kind = data?.kinds.find((item) => item.kind === group.key);
  const fixed = kind?.mode === 'FIXED' || !!group.fixed;
  const rows = data ? entriesFor(data, group.key) : [];
  const filtered = rows.filter(
    (entry) =>
      `${entry.code} ${entryName(entry, group.key)}`.toLowerCase().includes(search.toLowerCase()) &&
      (availability === 'all' || entry.active === (availability === 'active')),
  );
  function selectGroup(key: string) {
    onSelectGroup(key);
    setEditor(null);
    setSearch('');
    setAvailability('active');
    setSuccess('');
  }
  async function saved(label: string) {
    setEditor(null);
    setSuccess(label);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['master-data'] }),
      queryClient.invalidateQueries({ queryKey: ['references'] }),
    ]);
  }
  const allEntries = data ? [...data.values, ...data.departments, ...data.locations] : [];
  return (
    <>
      <PageTitle
        eyebrow="ADMINISTRATION / SETUP"
        title="Master Control"
        description="Keep your organization, asset and support options consistent in one place."
      />
      <ErrorNotice
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
      {query.isPending ? (
        <Loading label="Loading master setup..." />
      ) : data ? (
        <>
          <div className="metric-grid master-summary">
            <Metric
              label="Setup groups"
              value={groups.length}
              detail="Organization, assets and support"
            />
            <Metric
              label="Active entries"
              value={allEntries.filter((item) => item.active).length}
              detail="Available throughout the workspace"
            />
            <Metric
              label="Inactive entries"
              value={allEntries.filter((item) => !item.active).length}
              detail="Retained with existing records"
            />
          </div>
          <div className="master-layout">
            <Panel className="master-groups">
              <nav aria-label="Master setup groups">
                {['Organization', 'Assets', 'Support'].map((section) => (
                  <div key={section} className="master-group-section">
                    <p className="group-label">{section}</p>
                    {groups
                      .filter((item) => item.section === section)
                      .map((item) => (
                        <button
                          type="button"
                          key={item.key}
                          className={`master-group-button ${item.key === group.key ? 'selected' : ''}`}
                          aria-label={item.title}
                          aria-current={item.key === group.key ? 'page' : undefined}
                          onClick={() => selectGroup(item.key)}
                        >
                          <span>{item.title}</span>
                          <span className="master-group-count">
                            {entriesFor(data, item.key).length}
                          </span>
                        </button>
                      ))}
                  </div>
                ))}
              </nav>
            </Panel>
            <div className="master-content">
              <Panel
                title={group.title}
                action={
                  !fixed ? (
                    <button
                      type="button"
                      className="button small"
                      aria-label={`Add ${group.singular}`}
                      onClick={() => {
                        setEditor('new');
                        setSuccess('');
                      }}
                    >
                      + Add {group.singular}
                    </button>
                  ) : undefined
                }
              >
                <p className="muted small-text">{group.description}</p>
                {fixed ? (
                  <div className="notice master-policy">
                    {group.key === 'STATUS' || group.key === 'TICKET_STATUS'
                      ? 'Status codes drive custody and support workflows. You can edit their display labels here. Change an individual record status from its asset or ticket page.'
                      : 'These options use fixed codes. You can edit their display labels while the supported choices stay available.'}
                  </div>
                ) : (
                  <p className="muted small-text">
                    Inactive options remain on saved records and disappear from new selections.
                    Codes are permanent.
                  </p>
                )}
                {success ? (
                  <div role="status" className="notice success">
                    {success}
                  </div>
                ) : null}
                <div className="filter-bar master-filter">
                  <Field label="Find an entry" htmlFor="master-search">
                    <input
                      type="search"
                      id="master-search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search code or name"
                      maxLength={100}
                    />
                  </Field>
                  <Field label="Availability" htmlFor="master-availability">
                    <Select
                      label=""
                      htmlFor="master-availability"
                      value={availability}
                      onChange={setAvailability}
                      options={[
                        { value: 'all', label: 'All entries' },
                        { value: 'active', label: 'Active only' },
                        { value: 'inactive', label: 'Inactive only' },
                      ]}
                    />
                  </Field>
                </div>
                <ExportRecords
                  name={`master-${group.key.toLowerCase()}`}
                  columns={
                    group.key === 'locations'
                      ? ['id', 'code', 'site', 'building', 'floor', 'room', 'active', 'version']
                      : group.key === 'departments'
                        ? ['id', 'code', 'name', 'active', 'version']
                        : ['code', 'label', 'active', 'version']
                  }
                  load={async () => {
                    const current = await api<MasterData>('/master-data');
                    return entriesFor(current, group.key)
                      .filter(
                        (entry) =>
                          `${entry.code} ${entryName(entry, group.key)}`
                            .toLowerCase()
                            .includes(search.toLowerCase()) &&
                          (availability === 'all' || entry.active === (availability === 'active')),
                      )
                      .map((entry) => ({
                        id: entry.id,
                        code: entry.code,
                        name: entry.name,
                        label: entry.label,
                        site: entry.site,
                        building: entry.building,
                        floor: entry.floor,
                        room: entry.room,
                        active: entry.active,
                        version: entry.version,
                      }));
                  }}
                />
                <BulkTransfer module={`masters:${group.key}`} />
                {filtered.length ? (
                  <div className="table-scroll">
                    <table className="master-table">
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>
                            {group.key === 'locations'
                              ? 'Location'
                              : group.key === 'departments'
                                ? 'Name'
                                : 'Label'}
                          </th>
                          <th>Availability</th>
                          <th>
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((entry) => (
                          <tr key={entry.id ?? entry.code}>
                            <td className="mono">{entry.code}</td>
                            <td>{entryName(entry, group.key)}</td>
                            <td>
                              <Badge value={entry.active ? 'ACTIVE' : 'INACTIVE'} />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="button secondary small"
                                aria-label={`Edit ${entryName(entry, group.key)}`}
                                onClick={() => {
                                  setEditor(entry);
                                  setSuccess('');
                                }}
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title={
                      rows.length ? 'No matching entries' : `No ${group.title.toLowerCase()} yet`
                    }
                  >
                    {rows.length
                      ? 'Try another search or availability filter.'
                      : `Add your first ${group.singular} to make it available in the workspace.`}
                  </Empty>
                )}
              </Panel>
              {editor ? (
                <MasterEditor
                  key={`${group.key}:${editor === 'new' ? 'new' : editor.code}`}
                  group={group}
                  kind={kind}
                  entry={editor === 'new' ? undefined : editor}
                  onCancel={() => setEditor(null)}
                  onSaved={saved}
                  onReload={() => {
                    setEditor(null);
                    void query.refetch();
                  }}
                />
              ) : null}
              <div className="master-related">
                <span>Other administration</span>
                <Link to="/admin/users">People &amp; access</Link>
                <Link to="/admin/notifications">Email notifications</Link>
                <Link to="/admin/audit">Audit trail</Link>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

function MasterEditor({
  group,
  kind,
  entry,
  onCancel,
  onSaved,
  onReload,
}: {
  group: Group;
  kind?: MasterKind;
  entry?: Entry;
  onCancel: () => void;
  onSaved: (message: string) => Promise<void>;
  onReload: () => void;
}) {
  const location = group.key === 'locations';
  const department = group.key === 'departments';
  const fixed = kind?.mode === 'FIXED' || !!group.fixed;
  const [code, setCode] = useState(entry?.code ?? '');
  const [name, setName] = useState(entry?.name ?? entry?.label ?? '');
  const [site, setSite] = useState(entry?.site ?? '');
  const [building, setBuilding] = useState(entry?.building ?? '');
  const [floor, setFloor] = useState(entry?.floor ?? '');
  const [room, setRoom] = useState(entry?.room ?? '');
  const [active, setActive] = useState(entry?.active ?? true);
  const [reason, setReason] = useState('');
  const siteRequired = !entry || !!entry.site?.trim();
  const invalidMain = location ? siteRequired && !site.trim() : !name.trim();
  const dirty =
    !entry ||
    active !== entry.active ||
    (location
      ? site.trim() !== (entry.site ?? '') ||
        building.trim() !== (entry.building ?? '') ||
        floor.trim() !== (entry.floor ?? '') ||
        room.trim() !== (entry.room ?? '')
      : name.trim() !== (entry.name ?? entry.label ?? ''));
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(
        `/master-data/${group.key}${entry ? `/${encodeURIComponent(entry.id ?? entry.code)}` : ''}`,
        { method: entry ? 'PATCH' : 'POST', version: entry?.version, body },
      ),
  });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim() || (!entry && !code.trim()) || invalidMain) return;
    const body: Record<string, unknown> = {
      reason: reason.trim(),
      ...(!entry ? { code: code.trim() } : {}),
    };
    if (!fixed && (!entry || active !== entry.active)) body.active = active;
    if (location) {
      for (const [key, value] of Object.entries({ site, building, floor, room })) {
        const before = entry?.[key as 'site' | 'building' | 'floor' | 'room'] ?? '';
        if (!entry || value.trim() !== before) body[key] = value.trim() || null;
      }
    } else if (!entry || name.trim() !== (entry.name ?? entry.label ?? ''))
      body[department ? 'name' : 'label'] = name.trim();
    try {
      await mutation.mutateAsync(body);
      await onSaved(
        `${location ? site.trim() || code : name.trim()} ${entry ? 'updated' : 'created'}.`,
      );
    } catch {
      /* The API error is shown with the draft intact. */
    }
  }
  return (
    <Panel
      className="master-editor"
      title={entry ? `Edit ${group.singular}` : `Add ${group.singular}`}
    >
      <FormTransfer
        formId={`master:${group.key}:${entry?.id ?? entry?.code ?? 'new'}`}
        fields={[
          ...(!entry ? [{ key: 'code', required: true }] : []),
          ...(location
            ? [
                { key: 'site', required: siteRequired },
                { key: 'building' },
                { key: 'floor' },
                { key: 'room' },
              ]
            : [{ key: department ? 'name' : 'label', required: true }]),
          ...(!fixed ? [{ key: 'active', type: 'boolean' as const }] : []),
          { key: 'reason', required: true },
        ]}
        values={{
          ...(!entry ? { code } : {}),
          ...(location ? { site, building, floor, room } : department ? { name } : { label: name }),
          ...(!fixed ? { active } : {}),
          reason,
        }}
        disabled={mutation.isPending}
        description={
          entry
            ? 'Load editable fields for this entry, then review and save. The permanent code stays unchanged.'
            : 'Load one setup entry, then review and create it.'
        }
        onImport={(record) => {
          if (!entry && 'code' in record) setCode(String(record.code ?? ''));
          if (location) {
            if ('site' in record) setSite(String(record.site ?? ''));
            if ('building' in record) setBuilding(String(record.building ?? ''));
            if ('floor' in record) setFloor(String(record.floor ?? ''));
            if ('room' in record) setRoom(String(record.room ?? ''));
          } else if ((department ? 'name' : 'label') in record) {
            setName(String(record[department ? 'name' : 'label'] ?? ''));
          }
          if (!fixed && typeof record.active === 'boolean') setActive(record.active);
          if ('reason' in record) setReason(String(record.reason ?? ''));
        }}
      />
      <form
        className="form-stack"
        onSubmit={submit}
        aria-label={entry ? `Edit ${group.singular}` : `Add ${group.singular}`}
      >
        <ErrorNotice error={mutation.error} />
        {mutation.error ? (
          <button type="button" className="button secondary small" onClick={onReload}>
            Close editor and reload
          </button>
        ) : null}
        <div className="form-grid">
          <Field
            label="Code"
            htmlFor="master-code"
            hint={
              entry
                ? 'Permanent identifier. Existing records keep this code.'
                : 'Choose a unique, permanent code.'
            }
          >
            <input
              id="master-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              readOnly={!!entry}
              required
              maxLength={100}
              autoFocus={!entry}
            />
          </Field>
          {location ? (
            <>
              <Field label="Site" htmlFor="master-site">
                <input
                  id="master-site"
                  value={site}
                  onChange={(event) => setSite(event.target.value)}
                  maxLength={150}
                  required={siteRequired}
                  autoFocus={!!entry}
                />
              </Field>
              <Field label="Building" htmlFor="master-building">
                <input
                  id="master-building"
                  value={building}
                  onChange={(event) => setBuilding(event.target.value)}
                  maxLength={150}
                />
              </Field>
              <Field label="Floor" htmlFor="master-floor">
                <input
                  id="master-floor"
                  value={floor}
                  onChange={(event) => setFloor(event.target.value)}
                  maxLength={150}
                />
              </Field>
              <Field label="Room" htmlFor="master-room">
                <input
                  id="master-room"
                  value={room}
                  onChange={(event) => setRoom(event.target.value)}
                  maxLength={150}
                />
              </Field>
            </>
          ) : (
            <Field label={department ? 'Name' : 'Label'} htmlFor="master-name">
              <input
                id="master-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={150}
                autoFocus={!!entry}
              />
            </Field>
          )}
        </div>
        {!fixed ? (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            Active for new records
          </label>
        ) : null}
        {!active && !fixed ? (
          <div className="notice warning">
            This entry will be hidden from new selections. Existing assets, tickets and history keep
            their saved values.
          </div>
        ) : null}
        <Field
          label="Change reason"
          htmlFor="master-reason"
          hint="Saved with your identity and timestamp in the audit trail."
        >
          <textarea
            id="master-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            maxLength={1000}
            rows={3}
          />
        </Field>
        <div className="form-actions">
          <button
            type="button"
            className="button secondary"
            disabled={mutation.isPending}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="button"
            disabled={
              mutation.isPending ||
              !dirty ||
              !reason.trim() ||
              invalidMain ||
              (!entry && !code.trim())
            }
          >
            {mutation.isPending ? 'Saving...' : entry ? 'Save changes' : `Create ${group.singular}`}
          </button>
        </div>
      </form>
    </Panel>
  );
}
