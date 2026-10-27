import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAction } from '../hooks';
import { Empty, ErrorNotice, Loading, PageTitle, Panel } from './ui';

interface Announcement {
  id: string;
  title: string;
  message: string;
  path: '/dashboard' | '/assets' | '/tickets' | '/notifications';
  audience: 'ALL' | 'ADMIN' | 'DEPARTMENT';
  departmentName: string | null;
  createdAt: string;
  read: boolean;
  attachment: { name: string; type: 'image/jpeg' | 'application/pdf'; size: number } | null;
}

interface Inbox {
  items: Announcement[];
  total: number;
  unreadCount: number;
}

export function useNotificationInbox() {
  return useQuery({
    queryKey: ['notification-inbox'],
    queryFn: () => api<Inbox>('/notifications'),
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: ['notification-unread-count'],
    queryFn: () => api<{ unreadCount: number }>('/notifications/unread-count'),
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function NotificationsPage() {
  const inbox = useNotificationInbox();
  const action = useAction<{ read: boolean }>();

  return (
    <>
      <PageTitle
        title="Notifications"
        description="Notices from your IT team, shared with your account or department."
        action={
          inbox.data?.unreadCount ? (
            <button
              type="button"
              className="button secondary"
              disabled={action.isPending}
              onClick={() =>
                action.mutate({ path: '/notifications/read-all', method: 'POST', body: {} })
              }
            >
              Mark all as read
            </button>
          ) : undefined
        }
      />
      <ErrorNotice error={inbox.error} retry={() => void inbox.refetch()} />
      <ErrorNotice error={action.error} />
      {inbox.isPending ? <Loading label="Loading notifications…" /> : null}
      {inbox.data && inbox.data.items.length === 0 ? (
        <Panel className="notification-empty-panel">
          <Empty title="No announcements yet">
            New messages from your IT team will appear here.
          </Empty>
        </Panel>
      ) : null}
      {inbox.data?.items.length ? (
        <section className="notification-inbox" aria-label="Announcements">
          <div className="notification-inbox-heading">
            <div>
              <span className="eyebrow">YOUR INBOX</span>
              <p className="notification-summary">
                {inbox.data.unreadCount
                  ? `${inbox.data.unreadCount} unread`
                  : 'You’re all caught up'}
              </p>
            </div>
            <span className="muted">
              {inbox.data.total} {inbox.data.total === 1 ? 'notice' : 'notices'}
            </span>
          </div>
          {inbox.data.items.map((item) => (
            <article
              id={`notice-${item.id}`}
              key={item.id}
              className={`notification-card${item.read ? '' : ' is-unread'}`}
              tabIndex={-1}
            >
              <div className="notification-card-heading">
                <span className="notification-status" aria-label={item.read ? 'Read' : 'Unread'} />
                <h2>{item.title}</h2>
                <span className="notification-audience">
                  {item.audience === 'ADMIN'
                    ? 'Admins'
                    : item.audience === 'DEPARTMENT'
                      ? item.departmentName
                      : 'All staff'}
                </span>
              </div>
              <p className="notification-message">{item.message}</p>
              {item.attachment?.type === 'image/jpeg' ? (
                <a
                  className="notification-attachment-image"
                  href={`/api/v1/notifications/${item.id}/attachment`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={`/api/v1/notifications/${item.id}/attachment`}
                    alt={item.attachment.name}
                    loading="lazy"
                  />
                  <span>{item.attachment.name}</span>
                </a>
              ) : null}
              {item.attachment?.type === 'application/pdf' ? (
                <a
                  className="notification-attachment-file"
                  href={`/api/v1/notifications/${item.id}/attachment`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span aria-hidden="true">PDF</span>
                  <span>{item.attachment.name}</span>
                  <span className="muted">Open attachment ↗</span>
                </a>
              ) : null}
              <div className="notification-card-footer">
                <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
                <div className="notification-actions">
                  {!item.read ? (
                    <button
                      type="button"
                      className="button text small"
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate({
                          path: `/notifications/${item.id}/read`,
                          method: 'POST',
                          body: {},
                        })
                      }
                    >
                      Mark as read
                    </button>
                  ) : null}
                  <Link
                    className="button secondary small"
                    to={
                      item.path === '/notifications'
                        ? `/notifications#notice-${item.id}`
                        : item.path
                    }
                    aria-label={
                      item.path === '/notifications' ? `View ${item.title}` : `Open ${item.title}`
                    }
                  >
                    {item.path === '/notifications' ? 'View notice' : 'Open'}
                  </Link>
                </div>
              </div>
            </article>
          ))}
          {inbox.data.total > inbox.data.items.length ? (
            <p className="muted">Showing the latest {inbox.data.items.length} announcements.</p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
