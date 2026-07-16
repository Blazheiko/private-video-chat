import type { IceConfig, ServerMessage } from '@shared';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PrivateCall } from '@web/rtc/PrivateCall.js';
import { ReplayGuard, decryptText, encryptText } from '@web/crypto/e2e.js';
import { newLink, readAndClearFragmentKey } from '@web/crypto/link.js';
import { connectionState, errorText, messages, peers, roomInstanceId, rtcSignals, selfId } from '@web/state/app.js';
import { WsClient } from '@web/ws/client.js';

function routeFromPath(): { kind: 'group' | 'private'; room?: string } {
  const match = location.pathname.match(/^\/r\/(g|p)\/([A-Za-z0-9_-]{22})$/);

  return {
    kind: match?.[1] === 'p' ? 'private' : 'group',
    room: match?.[2],
  };
}

export function App() {
  const [groupLink, setGroupLink] = useState('');
  const [privateLink, setPrivateLink] = useState('');
  const [text, setText] = useState('');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [client, setClient] = useState<WsClient>();
  const [iceConfig, setIceConfig] = useState<IceConfig>();
  const [roomUnavailable, setRoomUnavailable] = useState(false);
  const [replacementPrivateLink, setReplacementPrivateLink] = useState('');
  const [linkKey] = useState(() => readAndClearFragmentKey());
  const [senderId] = useState(() => crypto.randomUUID().slice(0, 8));
  const intentionalClose = useRef(false);
  const guard = useMemo(() => new ReplayGuard(), []);
  const current = routeFromPath();
  const isPrivateRoom = current.kind === 'private' && Boolean(current.room);
  const isJoined = connectionState.value === 'joined';
  const isConnecting = connectionState.value === 'connecting';

  const join = () => {
    if (isConnecting || isJoined) {
      return;
    }

    if (!current.room || !linkKey) {
      errorText.value = 'Open a room link with #k= key to join.';
      return;
    }

    errorText.value = undefined;
    setRoomUnavailable(false);
    setReplacementPrivateLink('');
    connectionState.value = 'connecting';

    const ws = new WsClient({
      onMessage: async (msg: ServerMessage) => {
        await handleServerMessage(msg, linkKey, guard, setIceConfig, () => {
          setRoomUnavailable(true);
          setClient(undefined);
        });
      },
      onError: message => {
        errorText.value = message;
        connectionState.value = 'error';
      },
      onClose: () => {
        setClient(undefined);
        setIceConfig(undefined);

        if (intentionalClose.current) {
          intentionalClose.current = false;
          resetRoomState();
          return;
        }

        if (connectionState.value === 'connecting') {
          connectionState.value = 'error';
          errorText.value = 'Signaling connection closed before joining. Check that the server app is running.';
          return;
        }

        if (connectionState.value !== 'error') {
          resetRoomState();
        }
      },
    });

    ws.connectJoin(current.room, current.kind, senderId);
    setClient(ws);
  };

  const leave = () => {
    intentionalClose.current = true;
    client?.leave();

    if (!client) {
      intentionalClose.current = false;
    }

    setClient(undefined);
    setIceConfig(undefined);
    setRoomUnavailable(false);
    setReplacementPrivateLink('');
    resetRoomState();
  };

  const createReplacementPrivateLink = () => {
    setReplacementPrivateLink(newLink('private').url);
  };

  const send = async () => {
    if (!client || !linkKey || !text.trim()) {
      return;
    }

    const nextSequence = messages.value.filter(message => message.mine).length + 1;
    const env = await encryptText(linkKey, text, senderId, nextSequence);

    client.relay(env);
    messages.value = [
      ...messages.value,
      {
        id: env.aad.msgId,
        from: selfId.value ?? senderId,
        text,
        ts: env.aad.ts,
        mine: true,
      },
    ];
    setText('');
  };

  return (
    <main className={isPrivateRoom ? 'app-shell private-room-shell' : 'app-shell'}>
      {!isPrivateRoom && <h1>Private Video Chat</h1>}

      {!current.room && <MainOverview open={aboutOpen} onToggle={() => setAboutOpen(current => !current)} />}

      {!isPrivateRoom && (
        <section>
          <button onClick={() => setGroupLink(newLink('group').url)}>Create group chat</button>
          <button onClick={() => setPrivateLink(newLink('private').url)}>Create private chat (P2P)</button>

          {groupLink && <ShareLink value={groupLink} />}
          {privateLink && <ShareLink value={privateLink} />}
        </section>
      )}

      {current.room && (
        <section className={current.kind === 'private' ? 'room-panel private-room-panel' : 'room-panel'}>
          {current.kind === 'group' ? (
            <>
              <h2>{current.kind} room</h2>
              <p>
                Status: {connectionState.value} {roomInstanceId.value ? `instance ${roomInstanceId.value}` : ''}
              </p>
              <button onClick={join}>Join</button>
              <p>
                Participants: {[selfId.value, ...peers.value.map(peer => peer.participantId)].filter(Boolean).join(', ')}
              </p>
              <div>
                {messages.value.map(message => (
                  <p key={message.id}>
                    <b>{message.mine ? 'me' : message.from}</b>: {message.text}
                  </p>
                ))}
              </div>
              <input value={text} onInput={event => setText(event.currentTarget.value)} />
              <button onClick={send}>Send</button>
            </>
          ) : (
            <>
              {roomUnavailable ? (
                <RoomRecovery
                  replacementPrivateLink={replacementPrivateLink}
                  onCreateReplacementPrivateLink={createReplacementPrivateLink}
                />
              ) : (
                <PrivateCall
                  client={client}
                  selfId={selfId.value}
                  peers={peers.value}
                  iceConfig={iceConfig}
                  roomState={connectionState.value}
                  roomInstanceId={roomInstanceId.value}
                  onJoin={join}
                  onLeave={leave}
                />
              )}
            </>
          )}
        </section>
      )}

      {errorText.value && <p role="alert">{errorText.value}</p>}
    </main>
  );
}

function MainOverview({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <section className="app-overview">
      <div>
        <p className="eyebrow">Secure browser-to-browser communication</p>
        <h2>Private video chats by secure link</h2>
        <p>
          Create a private link, share it with another participant, and communicate through a P2P video call, chat,
          screen sharing, and file transfer.
        </p>
      </div>

      <button className="secondary" onClick={onToggle}>
        {open ? 'Show less' : 'Learn more'}
      </button>

      {open && (
        <div className="overview-details">
          <article>
            <strong>Private P2P call</strong>
            <span>Use video, microphone, screen sharing, and device switching directly during the call.</span>
          </article>
          <article>
            <strong>Encrypted links</strong>
            <span>The room key is kept in the URL fragment and is not sent to the server as part of the HTTP request.</span>
          </article>
          <article>
            <strong>Chat and files</strong>
            <span>Send messages, typing indicators, and files up to 10 MB through the WebRTC data channel.</span>
          </article>
          <article>
            <strong>Author</strong>
            <span>Created by Olexandr Blazheiko.</span>
          </article>
        </div>
      )}
    </section>
  );
}

function resetRoomState(): void {
  connectionState.value = 'closed';
  selfId.value = undefined;
  roomInstanceId.value = undefined;
  peers.value = [];
  messages.value = [];
  rtcSignals.value = [];
  errorText.value = undefined;
}

function RoomRecovery({
  replacementPrivateLink,
  onCreateReplacementPrivateLink,
}: {
  replacementPrivateLink: string;
  onCreateReplacementPrivateLink: () => void;
}) {
  return (
    <div className="room-recovery-card">
      <div>
        <span className="status-dot error" aria-hidden="true" />
        <h2>This private link is no longer available</h2>
      </div>
      <p>
        Private room links are single-session. Create a new private link and send it to the participant again.
      </p>
      <button onClick={onCreateReplacementPrivateLink}>Create new private link</button>
      {replacementPrivateLink && <ShareLink value={replacementPrivateLink} />}
    </div>
  );
}

function ShareLink({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setCopied(false);
    clearTimeout(copyResetTimer.current);
  }, [value]);

  useEffect(() => () => clearTimeout(copyResetTimer.current), []);

  const copyLink = async () => {
    await navigator.clipboard.writeText(value);
    clearTimeout(copyResetTimer.current);
    setCopied(true);
    copyResetTimer.current = setTimeout(() => setCopied(false), 5_000);
  };

  return (
    <p className="share-link">
      <input aria-label="Generated room link" readOnly value={value} />
      <button
        className={`link-action-button${copied ? ' copied' : ''}`}
        aria-label={copied ? 'Room link copied' : 'Copy room link'}
        title={copied ? 'Room link copied' : 'Copy room link'}
        onClick={copyLink}
      >
        <LinkActionIcon name="copy" />
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      <a className="link-action-button" aria-label="Open room link" title="Open room link" href={value}>
        <LinkActionIcon name="open" />
        <span>Open</span>
      </a>
    </p>
  );
}

function LinkActionIcon({ name }: { name: 'copy' | 'open' }) {
  if (name === 'copy') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-1v1a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3h1V7Zm3-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-6Zm-3 4H7a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1h-3a3 3 0 0 1-3-3v-3Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 4h6v6h-2V7.4l-7.3 7.3-1.4-1.4L16.6 6H14V4ZM5 6h6v2H7v9h9v-4h2v6H5V6Z" />
    </svg>
  );
}

async function handleServerMessage(
  msg: ServerMessage,
  linkKey: string,
  guard: ReplayGuard,
  setIceConfig: (iceConfig: IceConfig) => void,
  onPrivateRoomUnavailable: () => void,
): Promise<void> {
  switch (msg.t) {
    case 'joined':
      selfId.value = msg.selfId;
      roomInstanceId.value = msg.roomInstanceId;
      peers.value = msg.peers;
      connectionState.value = 'joined';
      setIceConfig(msg.ice);
      guard.resetAll();
      return;

    case 'peer-joined':
      peers.value = [
        ...peers.value.filter(peer => peer.participantId !== msg.peer.participantId),
        msg.peer,
      ];
      return;

    case 'peer-left':
      peers.value = peers.value.filter(peer => peer.participantId !== msg.participantId);

      if (msg.reason === 'grace-expired') {
        guard.resetParticipant(msg.participantId);
      }

      return;

    case 'relay':
      if (!guard.accept(msg.from, msg.env)) {
        return;
      }

      messages.value = [
        ...messages.value,
        {
          id: msg.env.aad.msgId,
          from: msg.from,
          text: await decryptText(linkKey, msg.env),
          ts: msg.env.aad.ts,
        },
      ];
      return;

    case 'signal':
      rtcSignals.value = [...rtcSignals.value, msg];
      return;

    case 'ice-refresh':
      setIceConfig(msg.ice);
      return;

    case 'error':
      errorText.value = `${msg.code}: ${msg.message}`;
      connectionState.value = 'error';

      if (msg.fatal && (msg.code === 'ROOM_CLOSED' || msg.code === 'ROOM_FULL')) {
        onPrivateRoomUnavailable();
      }

      return;

    default:
      return;
  }
}
