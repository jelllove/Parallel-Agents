import { useEffect, useId, useRef, useState } from 'react';
import { folderIconUrl } from '../icons/iconResolver';

export function RecentFolderDropdown({
  folders,
  value,
  disabled,
  onSelect,
}: {
  folders: string[];
  value: string;
  disabled: boolean;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, id]);
  const choose = (index: number) => {
    if (folders[index]) onSelect(folders[index]);
    close();
  };
  const label = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  return (
    <div
      ref={root}
      className="recent-folder-dropdown"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="btn-secondary recent-folder-trigger"
        disabled={disabled || !folders.length}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setActive(Math.max(0, folders.indexOf(value)));
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setActive(
              event.key === 'ArrowUp' ? folders.length - 1 : Math.max(0, folders.indexOf(value)),
            );
            setOpen(true);
          }
        }}
      >
        <span className="recent-folder-text">
          <span className="recent-folder-name">
            {value ? label(value) : 'Choose a project folder'}
          </span>
          {value && (
            <span className="recent-folder-path" title={value}>
              {value}
            </span>
          )}
        </span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul
          ref={list}
          id={id}
          role="listbox"
          tabIndex={0}
          aria-label="Recently opened folder paths"
          aria-activedescendant={`${id}-${active}`}
          className="recent-folders recent-folder-menu"
          onKeyDown={(event) => {
            if (
              ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)
            ) {
              event.preventDefault();
              event.stopPropagation();
            }
            if (event.key === 'ArrowDown')
              setActive((index) => Math.min(folders.length - 1, index + 1));
            if (event.key === 'ArrowUp') setActive((index) => Math.max(0, index - 1));
            if (event.key === 'Home') setActive(0);
            if (event.key === 'End') setActive(folders.length - 1);
            if (event.key === 'Enter' || event.key === ' ') choose(active);
            if (event.key === 'Escape') close();
          }}
        >
          {folders.map((folder, index) => (
            <li
              key={folder}
              id={`${id}-${index}`}
              role="option"
              aria-selected={folder === value}
              className={`recent-folder${index === active ? ' selected' : ''}`}
              title={folder}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActive(index)}
              onClick={() => choose(index)}
            >
              <img
                className="recent-folder-icon"
                src={folderIconUrl(label(folder), folder === value)}
                alt=""
                draggable={false}
              />
              <span className="recent-folder-text">
                <span className="recent-folder-name">{label(folder)}</span>
                <span className="recent-folder-path">{folder}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
