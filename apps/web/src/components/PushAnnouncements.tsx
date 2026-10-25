import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useAction } from '../hooks';
import { ErrorNotice, Field, PageTitle, Panel, Select } from './ui';

export function PushAnnouncements() {
  const config = useQuery({
    queryKey: ['push-config'],
    queryFn: () => api<{ enabled: boolean; publicKey: string | null }>('/push/public-key'),
    refetchInterval: 10_000,
    refetchOnWindowFocus: 'always',
  });
  const action = useAction<{ subscribedDevices: number; sent: number; failed: number; failureStatuses: { statusCode: number | null; count: number }[] }>();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [path, setPath] = useState('/dashboard');
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<{ subscribedDevices: number; sent: number; failed: number; failureStatuses: { statusCode: number | null; count: number }[] }>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setResult(undefined);
    try {
      const response = await action.mutateAsync({ path: '/push/broadcast', body: { title, message, path } });
      setResult(response);
      setTitle('');
      setMessage('');
      setConfirmed(false);
    } catch {
      // The mutation error is shown below.
    }
  }

  return (
    <>
      <PageTitle title="PWA announcements" description="Send a short push notification to everyone who enabled notifications on a device." />
      <ErrorNotice error={config.error} retry={() => void config.refetch()} />
      <ErrorNotice error={action.error} />
      <Panel title="Send to subscribed devices">
        {!config.isPending && !config.data?.enabled ? <div className="notice warning"><p>Push sending is not configured on the API this page reached. Recheck the API environment and restart that API service.</p><button type="button" className="button secondary small" onClick={() => void config.refetch()} disabled={config.isFetching}>Recheck server configuration</button></div> : null}
        <p className="muted">Recipients are active devices that have installed or opened the portal and granted notification permission. The operating system may delay or suppress delivery according to the user’s settings.</p>
        <form className="form-stack push-announcement-form" onSubmit={(event) => void submit(event)}>
          <Field label="Notification title" htmlFor="push-title" hint={`${title.length}/100 characters`}>
            <input id="push-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} required />
          </Field>
          <Field label="Message" htmlFor="push-message" hint={`${message.length}/500 characters`}>
            <textarea id="push-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={500} rows={4} required />
          </Field>
          <Select label="Open when tapped" htmlFor="push-path" value={path} onChange={setPath} options={[
            { value: '/dashboard', label: 'Overview' },
            { value: '/assets', label: 'Asset catalog' },
            { value: '/tickets', label: 'Support desk' },
          ]} />
          <label className="checkbox">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required />
            <span>I have reviewed this message. It will be sent to all subscribed devices.</span>
          </label>
          <button className="button" type="submit" disabled={!confirmed || !config.data?.enabled || action.isPending}>
            {action.isPending ? 'Sending…' : 'Send announcement'}
          </button>
        </form>
      </Panel>
      {result ? <div className={result.failed ? 'notice warning' : 'notice success'} role="status"><strong>Announcement submitted.</strong><p>Push service accepted {result.sent} of {result.subscribedDevices} device notifications{result.failed ? `; ${result.failed} failed` : ''}.</p>{result.failureStatuses?.length ? <p>Provider status: {result.failureStatuses.map(({ statusCode, count }) => `${statusCode === null ? 'network error' : `HTTP ${statusCode}`} (${count})`).join(', ')}. HTTP 401/403 usually means the server VAPID keys do not match the key used when the device subscribed.</p> : null}{result.failed && result.subscribedDevices === result.failed ? <p>Refresh notifications on each device after the server keys are corrected.</p> : null}</div> : null}
    </>
  );
}
