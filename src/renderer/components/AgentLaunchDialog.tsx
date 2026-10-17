import { useEffect, useRef, useState } from 'react';
import type { AgentId } from '../../shared/types';
import {
  AGENT_LAUNCH,
  configureAgentCommand,
  isLaunchAgent,
  validateLaunchOptions,
} from '../../shared/agent-launch';

export function AgentLaunchDialog({
  agent: initialAgent,
  onClose,
}: {
  agent: AgentId;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [agent, setAgent] = useState(initialAgent);
  const [approvalMode, setApprovalMode] = useState('default');
  const [model, setModel] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const provider = AGENT_LAUNCH[agent];
  const selectedMode = provider.modes.find((mode) => mode.id === approvalMode);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    setSaveError('');
    setAcknowledged(false);
    void window.api.agents
      .getLaunchSettings()
      .then((settings) => {
        if (!active) return;
        const options = validateLaunchOptions(
          agent,
          settings[agent] ?? { approvalMode: 'default', model: '' },
        );
        setApprovalMode(options.approvalMode);
        setModel(options.model);
      })
      .catch((error: unknown) => {
        if (active)
          setLoadError(
            `Could not load launch settings: ${error instanceof Error ? error.message : String(error)}`,
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agent]);

  let preview = '';
  let validationError = '';
  if (!loading && !loadError) {
    try {
      preview = configureAgentCommand(agent, agent, { approvalMode, model });
    } catch (error) {
      validationError = error instanceof Error ? error.message : String(error);
    }
  }
  const blocked =
    loading ||
    busy ||
    !!loadError ||
    !!validationError ||
    !selectedMode ||
    (selectedMode.risky && !acknowledged);
  const error = loadError || validationError || saveError;
  return (
    <dialog
      ref={dialog}
      className="workflow-dialog agent-launch-dialog"
      aria-label="Agent launch settings"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (blocked) return;
          setBusy(true);
          setSaveError('');
          try {
            const options = validateLaunchOptions(agent, { approvalMode, model });
            await window.api.agents.setLaunchOptions(agent, options, acknowledged);
            onClose();
          } catch (error) {
            setSaveError(
              `Could not save launch settings: ${error instanceof Error ? error.message : String(error)}`,
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>Agent launch settings</h2>
        <p>
          Saved separately for each agent. Applies to future new, resumed and restarted agent
          terminals. Running terminals are not changed.
        </p>
        <label className="workflow-field">
          Agent
          <select
            aria-label="Agent"
            value={agent}
            disabled={busy}
            onChange={(event) => {
              if (isLaunchAgent(event.target.value)) {
                setLoading(true);
                setAgent(event.target.value);
              }
            }}
          >
            {Object.entries(AGENT_LAUNCH).map(([id, provider]) => (
              <option key={id} value={id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
        <label className="workflow-field">
          Approval mode
          <select
            aria-label="Approval mode"
            value={approvalMode}
            disabled={loading || busy || !!loadError}
            onChange={(event) => {
              setApprovalMode(event.target.value);
              setAcknowledged(false);
            }}
          >
            {provider.modes.map((mode) => (
              <option key={mode.id} value={mode.id}>
                {mode.label}
              </option>
            ))}
          </select>
        </label>
        {selectedMode && <p>{selectedMode.description}</p>}
        <label className="workflow-field">
          Model ID (optional)
          <input
            aria-label="Model ID"
            value={model}
            list={`agent-models-${agent}`}
            placeholder="Leave empty to use this CLI's default model"
            disabled={loading || busy || !!loadError}
            maxLength={200}
            onChange={(event) => setModel(event.target.value)}
          />
          <datalist id={`agent-models-${agent}`}>
            {provider.modelExamples.map((example) => (
              <option key={example} value={example} />
            ))}
          </datalist>
        </label>
        <p>
          {provider.modelHint} This app does not query your provider account or verify model
          availability.
        </p>
        {loading && <p role="status">Loading agent launch settings...</p>}
        {preview && (
          <div className="agent-launch-preview">
            <span>New-session command preview</span>
            <code>{preview}</code>
          </div>
        )}
        {selectedMode?.risky && !loading && !loadError && (
          <div className="agent-launch-warning">
            <p>
              Fewer prompts can allow edits or commands without review. Only use this mode in a
              trusted project. A separate confirmation is required before every actual launch.
            </p>
            <label className="settings-row">
              <input
                aria-label="Acknowledge reduced approvals"
                type="checkbox"
                checked={acknowledged}
                disabled={busy}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              I understand the reduced-approval behavior of this agent.
            </label>
          </div>
        )}
        <p>
          Flags and model availability depend on your installed CLI version, provider configuration
          and organization policies. Unsupported options fail in the terminal; the app does not
          silently change modes.
        </p>
        {error && (
          <p className="inventory-error" role="alert">
            {error}
          </p>
        )}
        <div className="workflow-actions">
          <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={blocked}>
            {busy ? 'Saving...' : 'Save launch settings'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
