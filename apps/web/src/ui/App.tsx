import type { IceConfig, ServerMessage } from '@shared';
import { useEffect, useRef, useState } from 'preact/hooks';
import { PrivateCall } from '@web/rtc/PrivateCall.js';
import { newLink, readAndClearFragmentKey } from '@web/crypto/link.js';
import { connectionState, errorText, peers, roomInstanceId, rtcSignals, selfId } from '@web/state/app.js';
import { isAppleMobileDevice, isStandalonePwa } from '@web/pwa.js';
import { roomEntry } from '@web/ui/room-entry.js';
import { reconnectDelayMs } from '@web/ws/reconnect.js';
import { WsClient } from '@web/ws/client.js';

function routeFromPath(): { room?: string; legacyGroupLink: boolean } {
  const match = location.pathname.match(/^\/r\/(g|p)\/([A-Za-z0-9_-]{22})$/);

  return {
    room: match?.[1] === 'p' ? match[2] : undefined,
    legacyGroupLink: match?.[1] === 'g',
  };
}

export function App() {
  const [privateLink, setPrivateLink] = useState('');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [client, setClient] = useState<WsClient>();
  const [iceConfig, setIceConfig] = useState<IceConfig>();
  const [roomUnavailable, setRoomUnavailable] = useState(false);
  const [replacementPrivateLink, setReplacementPrivateLink] = useState('');
  const [callNotice, setCallNotice] = useState<string>();
  const [showIosInstallHint, setShowIosInstallHint] = useState(false);
  const [linkKey] = useState(() => readAndClearFragmentKey());
  const [senderId] = useState(() => crypto.randomUUID().slice(0, 8));
  const intentionalClose = useRef(false);
  const activeClient = useRef<WsClient>();
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const reconnectAttempt = useRef(0);
  const resumeToken = useRef<string>();
  const reconnectCancelled = useRef(false);
  const autoJoinStarted = useRef(false);
  const leaveFallbackTimer = useRef<ReturnType<typeof setTimeout>>();
  const current = routeFromPath();
  const entry = roomEntry({ room: current.room, linkKey, roomUnavailable });
  const isPrivateRoom = Boolean(current.room);
  const isJoined = connectionState.value === 'joined';
  const isConnecting = connectionState.value === 'connecting';

  const clearReconnectTimer = () => {
    clearTimeout(reconnectTimer.current);
    reconnectTimer.current = undefined;
  };

  useEffect(
    () => () => {
      clearReconnectTimer();
      clearTimeout(leaveFallbackTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (entry !== 'auto-join' || autoJoinStarted.current) {
      return;
    }

    autoJoinStarted.current = true;
    join();
  }, []);

  useEffect(() => {
    const dismissed = readLocalStorage(IOS_INSTALL_HINT_DISMISSED_KEY) === 'true';

    if (!dismissed && isAppleMobileDevice() && !isStandalonePwa()) {
      setShowIosInstallHint(true);
    }
  }, []);

  const dismissIosInstallHint = () => {
    writeLocalStorage(IOS_INSTALL_HINT_DISMISSED_KEY, 'true');
    setShowIosInstallHint(false);
  };

  const connectSignaling = (token?: string) => {
    if (!current.room || !linkKey) {
      errorText.value = 'Open a room link with #k= key to join.';
      return;
    }

    clearReconnectTimer();
    connectionState.value = 'connecting';

    const ws = new WsClient({
      onMessage: (msg: ServerMessage) => {
        handleServerMessage(
          msg,
          setIceConfig,
          setCallNotice,
          nextResumeToken => {
            resumeToken.current = nextResumeToken;
            reconnectAttempt.current = 0;
            errorText.value = undefined;
          },
          () => {
            reconnectCancelled.current = true;
            activeClient.current = undefined;
            clearReconnectTimer();
            setRoomUnavailable(true);
            setClient(undefined);
          },
        );
      },
      onError: message => {
        errorText.value = message;
      },
      onClose: () => {
        if (activeClient.current !== ws) {
          return;
        }

        activeClient.current = undefined;
        setClient(undefined);
        setIceConfig(undefined);

        if (intentionalClose.current) {
          goHome();
          return;
        }

        scheduleReconnect();
      },
    });

    activeClient.current = ws;
    ws.connectJoin(current.room, senderId, token);
    setClient(ws);
  };

  const scheduleReconnect = () => {
    if (reconnectCancelled.current || !current.room || !linkKey) {
      resetRoomState();
      return;
    }

    const delayMs = reconnectDelayMs(reconnectAttempt.current);
    reconnectAttempt.current += 1;
    connectionState.value = 'connecting';
    errorText.value = `Signaling connection lost. Reconnecting in ${Math.ceil(delayMs / 1000)}s...`;
    clearReconnectTimer();
    reconnectTimer.current = setTimeout(() => connectSignaling(resumeToken.current), delayMs);
  };

  const join = () => {
    if (isConnecting || isJoined) {
      return;
    }

    errorText.value = undefined;
    setCallNotice(undefined);
    setRoomUnavailable(false);
    setReplacementPrivateLink('');
    reconnectCancelled.current = false;
    reconnectAttempt.current = 0;
    resumeToken.current = undefined;
    connectSignaling();
  };

  // Navigate only after the socket closes so the `leave` frame reaches the server first;
  // otherwise the peer sees a disconnect and gets `peer-left` only after the grace period.
  const leave = () => {
    reconnectCancelled.current = true;
    clearReconnectTimer();

    if (!client) {
      goHome();
      return;
    }

    intentionalClose.current = true;
    leaveFallbackTimer.current = setTimeout(goHome, LEAVE_FALLBACK_MS);
    client.leave();
  };

  const goHome = () => {
    clearTimeout(leaveFallbackTimer.current);
    location.href = '/';
  };

  const createReplacementPrivateLink = () => {
    setReplacementPrivateLink(newLink().url);
  };

  return (
    <main className={isPrivateRoom ? 'app-shell private-room-shell' : 'app-shell'}>
      {!isPrivateRoom && <h1>Private Video Chat</h1>}

      {!isPrivateRoom && showIosInstallHint && <IosInstallHint onDismiss={dismissIosInstallHint} />}

      {current.legacyGroupLink && (
        <p role="status">Group chats are no longer supported. Create a private chat link below instead.</p>
      )}

      {!current.room && <MainOverview open={aboutOpen} onToggle={() => setAboutOpen(current => !current)} />}

      {!isPrivateRoom && (
        <section>
          <button onClick={() => setPrivateLink(newLink().url)}>Create private chat (P2P)</button>

          {privateLink && <ShareLink value={privateLink} />}
        </section>
      )}

      {current.room && (
        <section className="room-panel private-room-panel">
          {entry === 'missing-key' ? (
            <RoomRecovery
              title="This link has no encryption key"
              description="The room key is missing from the link. Ask the other participant for a new private link, or create one and send it to them."
              replacementPrivateLink={replacementPrivateLink}
              onCreateReplacementPrivateLink={createReplacementPrivateLink}
            />
          ) : entry === 'unavailable' ? (
            <RoomRecovery
              title="This private link is no longer available"
              description="Private room links are single-session. Create a new private link and send it to the participant again."
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
              roomNotice={callNotice}
              onRetry={autoJoinStarted.current && !isJoined && !isConnecting ? join : undefined}
              onLeave={leave}
            />
          )}
        </section>
      )}

      {errorText.value && <p role="alert">{errorText.value}</p>}
    </main>
  );
}

const IOS_INSTALL_HINT_DISMISSED_KEY = 'private-video-chat:ios-install-hint-dismissed';
const LEAVE_FALLBACK_MS = 1_000;


function readLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures in private browsing modes; the hint can still be dismissed for this render.
  }
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
            <span className="author-links">
              <a href="https://github.com/Blazheiko/private-video-chat" target="_blank" rel="noreferrer">
                Open source repository
              </a>
              <a href="mailto:blazheiko@gmail.com">blazheiko@gmail.com</a>
            </span>
          </article>
        </div>
      )}
    </section>
  );
}

function IosInstallHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section className="ios-install-card" aria-label="Install app on iPhone or iPad">
      <div>
        <p className="eyebrow">Install web app</p>
        <h2>Add Private Video Chat to your Home Screen</h2>
        <p>
          On iPhone or iPad, tap the <strong>Share</strong> button in Safari, then choose{' '}
          <strong>Add to Home Screen</strong> to launch it like an app.
        </p>
      </div>
      <button className="secondary" onClick={onDismiss} aria-label="Dismiss installation instructions">
        Got it
      </button>
    </section>
  );
}

function resetRoomState(): void {
  connectionState.value = 'closed';
  selfId.value = undefined;
  roomInstanceId.value = undefined;
  peers.value = [];
  rtcSignals.value = [];
  errorText.value = undefined;
}

function RoomRecovery({
  title,
  description,
  replacementPrivateLink,
  onCreateReplacementPrivateLink,
}: {
  title: string;
  description: string;
  replacementPrivateLink: string;
  onCreateReplacementPrivateLink: () => void;
}) {
  return (
    <div className="room-recovery-card">
      <div>
        <span className="status-dot error" aria-hidden="true" />
        <h2>{title}</h2>
      </div>
      <p>{description}</p>
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

function handleServerMessage(
  msg: ServerMessage,
  setIceConfig: (iceConfig: IceConfig) => void,
  setCallNotice: (message: string | undefined) => void,
  onJoined: (resumeToken: string) => void,
  onPrivateRoomUnavailable: () => void,
): void {
  switch (msg.t) {
    case 'joined':
      selfId.value = msg.selfId;
      roomInstanceId.value = msg.roomInstanceId;
      peers.value = msg.peers;
      connectionState.value = 'joined';
      setCallNotice(undefined);
      setIceConfig(msg.ice);
      onJoined(msg.resumeToken);
      return;

    case 'peer-joined':
      peers.value = [
        ...peers.value.filter(peer => peer.participantId !== msg.peer.participantId),
        msg.peer,
      ];
      return;

    case 'peer-left':
      peers.value = peers.value.filter(peer => peer.participantId !== msg.participantId);

      if (msg.reason === 'left') {
        setCallNotice('Opponent ended the call.');
      }

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
