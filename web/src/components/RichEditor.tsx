import { useEffect, useRef, useState } from 'react';
import { uploadImage } from '../lib/api';

/** YouTube / VK Видео / Rutube → ссылка для встраивания */
function embedUrl(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const rt = url.match(/rutube\.ru\/video\/([\w]+)/);
  if (rt) return `https://rutube.ru/play/embed/${rt[1]}`;
  const vk = url.match(/(?:vk\.com|vkvideo\.ru)\/video(-?\d+)_(\d+)/);
  if (vk) return `https://vk.com/video_ext.php?oid=${vk[1]}&id=${vk[2]}`;
  return null;
}

/**
 * Простой визуальный редактор (contentEditable) с режимом HTML.
 * Итоговый HTML дополнительно очищается на сервере.
 */
export function RichEditor({ value, onChange, placeholder = 'Начните писать…' }: { value: string; onChange: (html: string) => void; placeholder?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [html, setHtml] = useState(false);
  const [busy, setBusy] = useState(false);
  const saved = useRef<Range | null>(null);

  // Синхронизация внешнего значения (например, после загрузки статьи)
  useEffect(() => {
    if (!html && ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value;
  }, [value, html]);

  const emit = () => ref.current && onChange(ref.current.innerHTML);
  const saveSel = () => {
    const s = window.getSelection();
    if (s && s.rangeCount && ref.current?.contains(s.anchorNode)) saved.current = s.getRangeAt(0).cloneRange();
  };
  const restoreSel = () => {
    ref.current?.focus();
    if (saved.current) { const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(saved.current); }
  };
  const cmd = (c: string, arg?: string) => { restoreSel(); document.execCommand(c, false, arg); emit(); saveSel(); };
  const insert = (h: string) => { restoreSel(); document.execCommand('insertHTML', false, h); emit(); };

  const onLink = () => {
    saveSel();
    const url = prompt('Адрес ссылки (https://…)');
    if (url && /^(https?:|mailto:|tel:|\/)/.test(url)) cmd('createLink', url);
  };
  const onVideo = () => {
    saveSel();
    const url = prompt('Ссылка на видео YouTube, VK Видео или Rutube');
    if (!url) return;
    const src = embedUrl(url);
    if (!src) return alert('Не удалось распознать ссылку на видео');
    insert(`<iframe src="${src}" allowfullscreen frameborder="0"></iframe><p><br></p>`);
  };
  const onImage = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try { insert(`<img src="${await uploadImage(f)}" alt=""><p><br></p>`); }
    catch { alert('Не удалось загрузить: нужен JPG, PNG, WebP или GIF до 5 МБ'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const B = ({ label, title, on }: { label: string; title: string; on: () => void }) => (
    <button type="button" title={title} aria-label={title} disabled={html} onMouseDown={(e) => { e.preventDefault(); on(); }}>{label}</button>
  );

  return (
    <div>
      <div className="toolbar">
        <B label="B" title="Жирный" on={() => cmd('bold')} />
        <B label="I" title="Курсив" on={() => cmd('italic')} />
        <B label="U" title="Подчёркнутый" on={() => cmd('underline')} />
        <span className="sep" />
        <B label="H2" title="Заголовок" on={() => cmd('formatBlock', 'H2')} />
        <B label="H3" title="Подзаголовок" on={() => cmd('formatBlock', 'H3')} />
        <B label="¶" title="Обычный текст" on={() => cmd('formatBlock', 'P')} />
        <B label="❝" title="Цитата" on={() => cmd('formatBlock', 'BLOCKQUOTE')} />
        <span className="sep" />
        <B label="• Список" title="Маркированный список" on={() => cmd('insertUnorderedList')} />
        <B label="1. Список" title="Нумерованный список" on={() => cmd('insertOrderedList')} />
        <span className="sep" />
        <B label="Ссылка" title="Вставить ссылку" on={onLink} />
        <B label={busy ? 'Загрузка…' : 'Фото'} title="Вставить картинку" on={() => { saveSel(); fileRef.current?.click(); }} />
        <B label="Видео" title="Вставить видео" on={onVideo} />
        <B label="⌫ Формат" title="Очистить форматирование" on={() => cmd('removeFormat')} />
        <span className="spacer" />
        <button type="button" className={html ? 'on' : ''} onClick={() => setHtml(!html)} title="Редактировать HTML">&lt;/&gt; HTML</button>
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => onImage(e.target.files?.[0])} />
      {html ? (
        <textarea className="html-src" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} aria-label="HTML" />
      ) : (
        <div
          ref={ref}
          className="rich"
          contentEditable
          suppressContentEditableWarning
          data-placeholder={placeholder}
          onInput={emit}
          onBlur={() => { saveSel(); emit(); }}
          onKeyUp={saveSel}
          onMouseUp={saveSel}
          onPaste={(e) => {
            // Вставляем чистый текст, чтобы не тащить стили из Word/сайтов
            e.preventDefault();
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
          }}
        />
      )}
    </div>
  );
}
