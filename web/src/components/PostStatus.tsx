import { POST_STATUS } from '../lib/labels';

export function PostStatus({ status }: { status: string }) {
  const s = POST_STATUS[status] ?? { label: status, color: 'var(--muted)' };
  return <span className="badge"><span className="dot" style={{ background: s.color }} />{s.label}</span>;
}
