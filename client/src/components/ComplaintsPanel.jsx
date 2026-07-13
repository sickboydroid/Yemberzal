import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { fmtDateTime } from '../lib/geo';
import { Modal, IconBtn, icons } from './Ui';

/**
 * Complaint threads — shared by parents and schools.
 * List -> thread. The thread is a chat with ONE composer; the school resolves
 * via a compact header action (with an optional closing note in a dialog).
 */
export default function ComplaintsPanel({ role, busId = null }) {
  const [list, setList] = useState([]);
  const [active, setActive] = useState(null);
  const [text, setText] = useState('');
  const [dialog, setDialog] = useState(null); // 'new' | 'resolve'
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  const refreshList = () => api('/complaints').then((rows) => {
    setList(busId ? rows.filter((r) => r.busId === busId) : rows);
  }).catch((e) => setError(e.message));

  useEffect(() => { refreshList(); }, [busId]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !active) return;
    socket.emit('watch:complaint', active.id, () => {});
    const onMsg = (m) => {
      if (m.complaintId !== active.id) return;
      setActive((a) => a && ({ ...a, messages: [...a.messages, { sender_role: m.senderRole, sender_name: m.senderName, text: m.text, ts: m.ts }] }));
    };
    const onResolved = (r) => {
      if (r.complaintId !== active.id) return;
      setActive((a) => a && ({ ...a, status: 'resolved', resolveMessage: r.message }));
      refreshList();
    };
    socket.on('complaint:message', onMsg);
    socket.on('complaint:resolved', onResolved);
    return () => {
      socket.emit('unwatch:complaint', active.id);
      socket.off('complaint:message', onMsg);
      socket.off('complaint:resolved', onResolved);
    };
  }, [active?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [active?.messages?.length]);

  const openThread = (id) => api(`/complaints/${id}`).then(setActive).catch((e) => setError(e.message));

  const send = async () => {
    if (!text.trim() || !active) return;
    try {
      await api(`/complaints/${active.id}/messages`, { method: 'POST', body: { text } });
      setText('');
    } catch (e) { setError(e.message); }
  };

  // ---------- thread view ----------
  if (active) {
    const resolved = active.status === 'resolved';
    return (
      <div className="card complaints">
        <div className="thread-head">
          <IconBtn label="Back to complaints" onClick={() => { setActive(null); refreshList(); }}>{icons.back}</IconBtn>
          <div className="grow">
            <h2>{active.title}</h2>
            <p className="thread-sub">
              {active.plate} · opened {fmtDateTime(active.createdAt)}{role === 'school' ? ` · by ${active.parentName}` : ''}
            </p>
          </div>
          <span className={`pill ${resolved ? 'pill-green' : 'pill-amber'}`}>{resolved ? 'Resolved' : 'Open'}</span>
          {role === 'school' && !resolved && (
            <button className="btn secondary sm" onClick={() => setDialog('resolve')}>{icons.check} Resolve</button>
          )}
        </div>

        <div className="chat">
          {active.messages.map((m, i) => (
            <div key={i} className={`bubble ${m.sender_role === role ? 'mine' : ''}`}>
              <div className="from">{m.sender_name}</div>
              <div>{m.text}</div>
              <div className="when">{fmtDateTime(m.ts)}</div>
            </div>
          ))}
          {active.messages.length === 0 && <p className="empty">No messages yet.</p>}
          <div ref={bottomRef} />
        </div>

        {resolved ? (
          <p className="resolved-note">Resolved — {active.resolveMessage}</p>
        ) : (
          <div className="composer">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…"
              onKeyDown={(e) => e.key === 'Enter' && send()} />
            <IconBtn label="Send" onClick={send}>{icons.send}</IconBtn>
          </div>
        )}
        {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}

        {dialog === 'resolve' && (
          <ResolveDialog
            onClose={() => setDialog(null)}
            onResolve={async (message) => {
              try {
                await api(`/complaints/${active.id}/resolve`, { method: 'POST', body: { message } });
                setDialog(null);
              } catch (e) { setError(e.message); }
            }}
          />
        )}
      </div>
    );
  }

  // ---------- list view ----------
  return (
    <div className="card complaints">
      <div className="row spread" style={{ marginBottom: 10 }}>
        <div className="card-title" style={{ margin: 0 }}>{role === 'parent' ? 'My complaints' : 'Complaint threads'}</div>
        {role === 'parent' && (
          <button className="btn sm" onClick={() => setDialog('new')}>{icons.plus} New complaint</button>
        )}
      </div>

      {list.length === 0 && <p className="empty">No complaints{busId ? ' for this bus' : ''} yet.</p>}
      <ul className="thread-list">
        {list.map((c) => (
          <li key={c.id} onClick={() => openThread(c.id)}>
            <div className="row spread">
              <strong>{c.title}</strong>
              <span className={`pill ${c.status === 'resolved' ? 'pill-green' : 'pill-amber'}`}>{c.status === 'resolved' ? 'Resolved' : 'Open'}</span>
            </div>
            <div className="thread-sub">{c.plate}{role === 'school' ? ` · ${c.parentName}` : ''} · {fmtDateTime(c.createdAt)}</div>
          </li>
        ))}
      </ul>
      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}

      {dialog === 'new' && (
        <NewComplaintDialog
          onClose={() => setDialog(null)}
          onCreate={async (title, firstMessage) => {
            try {
              const { id } = await api('/complaints', { method: 'POST', body: { title, text: firstMessage } });
              setDialog(null);
              await refreshList();
              openThread(id);
            } catch (e) { setError(e.message); }
          }}
        />
      )}
    </div>
  );
}

function NewComplaintDialog({ onClose, onCreate }) {
  const [title, setTitle] = useState('');
  const [msg, setMsg] = useState('');
  return (
    <Modal title="New complaint" onClose={onClose}
      footer={
        <>
          <button className="btn secondary sm" onClick={onClose}>Cancel</button>
          <button className="btn sm" disabled={!title.trim()} onClick={() => onCreate(title, msg)}>Submit</button>
        </>
      }>
      <label>Subject</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Bus was very late today" />
      <label>Describe what happened</label>
      <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={4} placeholder="Optional details for the school…" />
    </Modal>
  );
}

function ResolveDialog({ onClose, onResolve }) {
  const [msg, setMsg] = useState('');
  return (
    <Modal title="Resolve complaint" onClose={onClose}
      footer={
        <>
          <button className="btn secondary sm" onClick={onClose}>Cancel</button>
          <button className="btn success sm" onClick={() => onResolve(msg.trim() || 'Resolved')}>{icons.check} Mark resolved</button>
        </>
      }>
      <p className="muted small">The parent will see this closing note. Once resolved, the thread is locked and no further messages can be sent.</p>
      <label>Closing note</label>
      <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} placeholder="e.g. Spoke to the driver; route timing adjusted." />
    </Modal>
  );
}
