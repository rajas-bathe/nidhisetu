/** Notification inbox: workflow events addressed to the viewer. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { markAllNotificationsRead, markNotificationRead, fetchNotifications } from "../../services/portal";
import { errorToMessage, useToasts } from "../../components/ui/Toasts";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { EmptyState, ErrorState, PageHeader, Spinner } from "../../components/ui/States";
import { Button } from "../../components/ui/Button";
import { formatDateTimeShort } from "../../utils/format";

export function NotificationsPage() {
  const toasts = useToasts();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchNotifications,
    placeholderData: keepPreviousData,
  });

  const readOne = useMutation({
    mutationFn: (id: number) => markNotificationRead(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const readAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      toasts.success("All notifications marked as read.");
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (error) => toasts.error(errorToMessage(error)),
  });

  const items = list.data?.items ?? [];
  const unread = items.filter((item) => item.readAt == null);

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Workflow events addressed to you. Opening a notification marks it read."
        actions={
          unread.length > 0 ? (
            <Button type="button" variant="secondary" disabled={readAll.isPending} onClick={() => readAll.mutate()}>
              Mark all read ({unread.length})
            </Button>
          ) : undefined
        }
      />

      {list.isPending ? (
        <Spinner label="Loading notifications..." />
      ) : list.isError ? (
        <ErrorState title="Could not load notifications" detail={errorToMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState title="No notifications" detail="Workflow events that involve you appear here." />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={list.data?.unreadCount === 0 ? "All caught up" : `${list.data?.unreadCount ?? 0} unread`}
            subtitle="Newest first."
          />
          <CardBody className="divide-y divide-slate-100 !px-0 !py-0">
            {items.map((item) => {
              const content = (
                <div className={`flex items-start justify-between gap-3 px-4 py-3 ${item.readAt == null ? "bg-teal-50/40" : ""}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{item.title}</p>
                    {item.body != null && <p className="mt-0.5 text-xs text-slate-600">{item.body}</p>}
                    <p className="mt-1 text-xs text-slate-400">{formatDateTimeShort(item.createdAt)}</p>
                  </div>
                  {item.readAt == null && (
                    <button
                      type="button"
                      className="shrink-0 text-xs font-medium text-teal-700 hover:underline"
                      onClick={(event) => {
                        event.preventDefault();
                        readOne.mutate(item.id);
                      }}
                    >
                      Mark read
                    </button>
                  )}
                </div>
              );
              return item.linkPath != null ? (
                <Link key={item.id} to={item.linkPath} className="block hover:bg-slate-50" onClick={() => item.readAt == null && readOne.mutate(item.id)}>
                  {content}
                </Link>
              ) : (
                <div key={item.id}>{content}</div>
              );
            })}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
