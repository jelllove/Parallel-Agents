import { useEffect, useState } from 'react';
import { useAppStore } from '../store/app-store';
import type { FsNode } from '../../shared/types';
import { fileIconUrl, folderIconUrl } from '../icons/iconResolver';

interface TreeNodeProps {
  node: FsNode;
  level: number;
}

function TreeNode({ node, level }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FsNode[] | null>(null);

  async function toggle() {
    if (!node.isDirectory) return;
    if (!expanded && children === null) {
      const c = await window.api.fs.readDir(node.path);
      setChildren(c);
    }
    setExpanded(!expanded);
  }

  const iconUrl = node.isDirectory
    ? folderIconUrl(node.name, expanded)
    : fileIconUrl(node.name);

  return (
    <>
      <div
        className={`tree-node ${node.isDirectory ? 'dir' : 'file'}`}
        style={{ paddingLeft: 8 + level * 12 }}
        onClick={toggle}
        title={node.path}
      >
        <span className="twisty">
          {node.isDirectory ? (expanded ? '▾' : '▸') : ''}
        </span>
        <img className="file-icon" src={iconUrl} alt="" draggable={false} />
        <span className="name">{node.name}</span>
      </div>
      {expanded && children?.map((c) => (
        <TreeNode key={c.path} node={c} level={level + 1} />
      ))}
    </>
  );
}

export function Explorer() {
  const selectedId = useAppStore((s) => s.selectedProjectId);
  const project = useAppStore((s) => s.projects.find((p) => p.id === selectedId));
  const [nodes, setNodes] = useState<FsNode[]>([]);

  useEffect(() => {
    if (!project || !project.exists) {
      setNodes([]);
      return;
    }
    let cancelled = false;
    window.api.fs.readDir(project.realPath).then((list) => {
      if (!cancelled) setNodes(list);
    });
    return () => {
      cancelled = true;
    };
  }, [project?.realPath, project?.exists]);

  return (
    <div className="explorer">
      <div className="explorer-header section-explorer">
        <span className="section-glyph">⌥</span>
        <span>Explorer{project ? ` — ${project.displayName}` : ''}</span>
      </div>
      <div className="explorer-body">
        {!project ? (
          <div className="list-item-sub" style={{ padding: '8px 12px' }}>No project selected.</div>
        ) : !project.exists ? (
          <div className="list-item-sub" style={{ padding: '8px 12px' }}>Directory not found on disk.</div>
        ) : nodes.length === 0 ? (
          <div className="list-item-sub" style={{ padding: '8px 12px' }}>(empty)</div>
        ) : (
          nodes.map((n) => <TreeNode key={n.path} node={n} level={0} />)
        )}
      </div>
    </div>
  );
}
