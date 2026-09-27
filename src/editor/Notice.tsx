/** Message court (confirmation ou refus, ex. « objet verrouillé ») affiché quelques secondes. */
import { useEffect } from 'react';
import { clearNotice, useEditor } from '../store/editorStore.ts';

export function Notice() {
  const notice = useEditor((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => clearNotice(notice.id), notice.kind === 'error' ? 4000 : 2500);
    return () => clearTimeout(t);
  }, [notice]);
  if (!notice) return null;
  return (
    <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      {notice.text}
    </div>
  );
}
