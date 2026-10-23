import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { References, LocationReference } from '../types';
import { Badge } from './ui';

export function useReferences() {
  return useQuery({
    queryKey: ['references'],
    queryFn: ({ signal }) => api<References>('/references', { signal }),
    staleTime: 120_000,
  });
}
const aliases: Record<string, string> = { ownershipType: 'OWNERSHIP', riskLevel: 'RISK' };
const normalize = (value: string) => value.toLowerCase().replaceAll(/[^a-z]/g, '');
function kindMatches(left: string, right: string) {
  return normalize(left) === normalize(aliases[right] ?? right);
}
export function referenceOptions(
  refs: References | undefined,
  kind: string,
  includeInactive = false,
) {
  return (
    refs?.values.filter(
      (value) => (includeInactive || value.active) && kindMatches(value.kind, kind),
    ) ?? []
  );
}
export function referenceLabel(
  refs: References | undefined,
  kind: string,
  code: string | null | undefined,
) {
  if (!code) return 'Unknown';
  return (
    refs?.values.find((value) => value.code === code && kindMatches(value.kind, kind))?.label ??
    code
  );
}
export function locationLabel(item: LocationReference) {
  return (
    item.name ||
    [item.site, item.building, item.floor, item.room].filter(Boolean).join(' / ') ||
    item.code
  );
}
export function ReferenceBadge({
  refs,
  kind,
  value,
}: {
  refs?: References;
  kind: string;
  value?: string | null;
}) {
  return <Badge value={value} label={referenceLabel(refs, kind, value)} />;
}
export function ReferenceSelect({
  refs,
  kind,
  id,
  value,
  onChange,
  required = true,
  allowEmpty = false,
  includeInactive = false,
  preserveCurrent = true,
}: {
  refs?: References;
  kind: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  allowEmpty?: boolean;
  includeInactive?: boolean;
  preserveCurrent?: boolean;
}) {
  const values = referenceOptions(refs, kind, includeInactive);
  const current = refs?.values.find((item) => item.code === value && kindMatches(item.kind, kind));
  const unavailable = value && !values.some((item) => item.code === value);
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required={required}
    >
      <option value="">{allowEmpty ? 'All' : required ? 'Select...' : 'Not set'}</option>
      {unavailable ? (
        <option value={value} disabled={!preserveCurrent}>
          {preserveCurrent
            ? `${current?.label ?? value}${current?.active === false ? ' (inactive)' : ''}`
            : 'Select an active option...'}
        </option>
      ) : null}
      {values.map((item) => (
        <option key={item.code} value={item.code}>
          {item.label}
          {!item.active ? ' (inactive)' : ''}
        </option>
      ))}
    </select>
  );
}
