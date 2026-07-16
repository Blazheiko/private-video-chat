import type { IceConfig, PeerInfo, RTCSignal, ServerMessage } from '@shared';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { rtcSignals } from '@web/state/app.js';
import { WsClient } from '@web/ws/client.js';

type Props = {
  client?: WsClient;
  selfId?: string;
  peers: PeerInfo[];
  iceConfig?: IceConfig;
  roomState: 'closed' | 'connecting' | 'joined' | 'error';
  roomInstanceId?: string;
  onJoin: () => void;
  onLeave: () => void;
};

type CallState = 'idle' | 'waiting-for-peer' | 'requesting-media' | 'calling' | 'connected' | 'ended' | 'error';
type IconName = 'camera' | 'mic' | 'mic-off' | 'screen' | 'screen-off' | 'chat' | 'settings' | 'hangup';
type ChatMessage =
  | {
      id: string;
      from: string;
      text: string;
      ts: number;
      mine?: boolean;
      kind: 'text';
    }
  | {
      id: string;
      from: string;
      ts: number;
      mine?: boolean;
      kind: 'file';
      file: ChatFile;
    };
type ChatFile = {
  name: string;
  mime: string;
  size: number;
  dataUrl: string;
};
export type ChatFileMeta = Omit<ChatFile, 'dataUrl'>;
type PendingFileTransfer = {
  from: string;
  meta: ChatFileMeta;
  chunks: string[];
  receivedChunks: number;
  totalChunks: number;
};
export type DataChannelMessage =
  | { t: 'chat'; text: string }
  | { t: 'typing'; active: boolean }
  | { t: 'file-start'; id: string; file: ChatFileMeta; totalChunks: number }
  | { t: 'file-chunk'; id: string; index: number; data: string };
type MediaDeviceOption = {
  deviceId: string;
  kind: 'videoinput' | 'audioinput';
  label: string;
};

const TYPING_IDLE_MS = 2_500;
const TYPING_SEND_THROTTLE_MS = 1_200;
export const MAX_CHAT_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_CHUNK_CHARS = 12 * 1024;
const MAX_DATA_URL_PREFIX_CHARS = 512;
export const MAX_INCOMING_FILE_CHUNKS = Math.ceil((MAX_CHAT_FILE_BYTES * 4) / 3 / FILE_CHUNK_CHARS) +
  Math.ceil(MAX_DATA_URL_PREFIX_CHARS / FILE_CHUNK_CHARS);
const DATA_CHANNEL_BUFFER_HIGH_WATERMARK = 256 * 1024;

export function PrivateCall({
  client,
  selfId,
  peers,
  iceConfig,
  roomState,
  roomInstanceId,
  onJoin,
  onLeave,
}: Props) {
  const [callState, setCallState] = useState<CallState>('idle');
  const [callError, setCallError] = useState<string>();
  const [text, setText] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [dataChannelOpen, setDataChannelOpen] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [remoteVideoActive, setRemoteVideoActive] = useState(false);
  const [presenceNotice, setPresenceNotice] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mediaDevices, setMediaDevices] = useState<MediaDeviceOption[]>([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState('');
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState('');

  const peer = peers[0];
  const peerConnection = useRef<RTCPeerConnection>();
  const dataChannel = useRef<RTCDataChannel>();
  const localStream = useRef<MediaStream>();
  const cameraVideoTrack = useRef<MediaStreamTrack>();
  const screenVideoTrack = useRef<MediaStreamTrack>();
  const localPreviewStream = useRef(new MediaStream());
  const remoteStream = useRef(new MediaStream());
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const processedSignalCount = useRef(0);
  const peerTypingTimer = useRef<ReturnType<typeof setTimeout>>();
  const presenceNoticeTimer = useRef<ReturnType<typeof setTimeout>>();
  const previousPeerId = useRef<string>();
  const lastTypingSentAt = useRef(0);
  const pendingFileTransfers = useRef(new Map<string, PendingFileTransfer>());

  const callActive = Boolean(peerConnection.current);
  const canStartCall = Boolean(client && selfId && peer && callState !== 'calling' && callState !== 'connected');
  const isJoined = roomState === 'joined';
  const isConnecting = roomState === 'connecting';
  const statusText = useMemo(() => statusLabel(callState, Boolean(peer), dataChannelOpen), [callState, peer, dataChannelOpen]);
  const statusDotClass = callState === 'idle' && peer ? 'peer-present' : callState;

  useEffect(() => {
    if (localVideo.current) {
      muteLocalPreview(localVideo.current);
      localVideo.current.srcObject = localPreviewStream.current;
    }

    if (remoteVideo.current) {
      remoteVideo.current.srcObject = remoteStream.current;
    }
  }, []);

  useEffect(() => {
    void processIncomingSignals();
  }, [rtcSignals.value, peer?.participantId, client, iceConfig]);

  useEffect(() => {
    void loadMediaDevices();

    navigator.mediaDevices?.addEventListener('devicechange', loadMediaDevices);

    return () => navigator.mediaDevices?.removeEventListener('devicechange', loadMediaDevices);
  }, []);

  useEffect(() => {
    const currentPeerId = peer?.participantId;

    if (currentPeerId && currentPeerId !== previousPeerId.current) {
      showPresenceNotice('Opponent joined the private chat.');
    }

    if (!currentPeerId && previousPeerId.current) {
      showPresenceNotice('Opponent left the private chat.');
    }

    previousPeerId.current = currentPeerId;
  }, [peer?.participantId]);

  useEffect(() => () => {
    clearTimeout(peerTypingTimer.current);
    clearTimeout(presenceNoticeTimer.current);
    endCall();
  }, []);

  const startCall = async () => {
    if (!client || !peer) {
      setCallState('waiting-for-peer');
      return;
    }

    try {
      setCallError(undefined);
      setCallState('requesting-media');

      const connection = await ensurePeerConnection(peer.participantId);
      const channel = connection.createDataChannel('chat');

      attachDataChannel(channel);

      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      sendSignal(peer.participantId, sessionDescriptionSignal(offer, 'offer'));
      setCallState('calling');
    } catch (error) {
      handleCallError(error);
    }
  };

  const toggleMicrophone = async () => {
    const stream = await ensureLocalMedia();
    const nextEnabled = !microphoneEnabled;

    for (const track of stream.getAudioTracks()) {
      track.enabled = nextEnabled;
    }

    setMicrophoneEnabled(nextEnabled);
  };

  const toggleScreenShare = async () => {
    if (screenSharing) {
      await stopScreenShare();
      return;
    }

    await startScreenShare();
  };

  const selectVideoDevice = async (deviceId: string) => {
    setSelectedVideoDeviceId(deviceId);

    if (localStream.current) {
      await replaceLocalVideoDevice(deviceId);
    }
  };

  const selectAudioDevice = async (deviceId: string) => {
    setSelectedAudioDeviceId(deviceId);

    if (localStream.current) {
      await replaceLocalAudioDevice(deviceId);
    }
  };

  const sendChatMessage = () => {
    const trimmed = text.trim();

    if (!trimmed || dataChannel.current?.readyState !== 'open') {
      return;
    }

    sendDataChannelMessage({ t: 'chat', text: trimmed });
    sendTypingNotification(false);
    setChatMessages(current => [
      ...current,
      {
        id: crypto.randomUUID(),
        from: 'me',
        kind: 'text',
        text: trimmed,
        ts: Date.now(),
        mine: true,
      },
    ]);
    setText('');
  };

  const handleChatInput = (nextText: string) => {
    setText(nextText);
    sendTypingNotification(Boolean(nextText.trim()));
  };

  const sendFile = async (file?: File) => {
    if (!file || dataChannel.current?.readyState !== 'open') {
      return;
    }

    if (file.size > MAX_CHAT_FILE_BYTES) {
      setCallError(`File is too large. Maximum file size is ${formatFileSize(MAX_CHAT_FILE_BYTES)}.`);
      return;
    }

    try {
      const chatFile: ChatFile = {
        name: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl: await readFileAsDataUrl(file),
      };

      await sendFileInChunks(chatFile);
      setChatMessages(current => [
        ...current,
        {
          id: crypto.randomUUID(),
          from: 'me',
          kind: 'file',
          file: chatFile,
          ts: Date.now(),
          mine: true,
        },
      ]);
    } catch (error) {
      handleCallError(error);
    } finally {
      if (fileInput.current) {
        fileInput.current.value = '';
      }
    }
  };

  async function processIncomingSignals(): Promise<void> {
    if (!client) {
      return;
    }

    const pendingSignals = rtcSignals.value.slice(processedSignalCount.current);
    processedSignalCount.current = rtcSignals.value.length;

    for (const signal of pendingSignals) {
      await handleSignal(signal);
    }
  }

  async function handleSignal(signal: Extract<ServerMessage, { t: 'signal' }>): Promise<void> {
    try {
      setCallError(undefined);

      const connection = await ensurePeerConnection(signal.from);

      if (signal.data.type === 'offer') {
        await connection.setRemoteDescription(signal.data);
        const answer = await connection.createAnswer();

        await connection.setLocalDescription(answer);
        sendSignal(signal.from, sessionDescriptionSignal(answer, 'answer'));
        setCallState('calling');
        return;
      }

      if (signal.data.type === 'answer') {
        await connection.setRemoteDescription(signal.data);
        return;
      }

      if (signal.data.type === 'ice') {
        await connection.addIceCandidate(signal.data.candidate);
      }
    } catch (error) {
      handleCallError(error);
    }
  }

  async function ensurePeerConnection(peerId: string): Promise<RTCPeerConnection> {
    if (peerConnection.current) {
      return peerConnection.current;
    }

    const connection = new RTCPeerConnection({
      iceServers: iceConfig?.iceServers ?? [],
      iceTransportPolicy: iceConfig?.policy ?? 'all',
    });

    peerConnection.current = connection;
    wirePeerConnection(connection, peerId);

    const stream = await ensureLocalMedia();

    for (const track of stream.getTracks()) {
      connection.addTrack(track, stream);
    }

    return connection;
  }

  async function ensureLocalMedia(): Promise<MediaStream> {
    if (localStream.current) {
      return localStream.current;
    }

    localStream.current = await navigator.mediaDevices.getUserMedia(localMediaConstraints());
    cameraVideoTrack.current = localStream.current.getVideoTracks()[0];

    for (const track of localStream.current.getAudioTracks()) {
      track.enabled = microphoneEnabled;
    }

    if (cameraVideoTrack.current) {
      setLocalPreviewTrack(cameraVideoTrack.current);
    }

    return localStream.current;
  }

  async function loadMediaDevices(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const supportedDevices = devices.filter(isSupportedInputDevice);
      const cameraCount = { videoinput: 0, audioinput: 0 };

      setMediaDevices(
        supportedDevices.map(device => {
          cameraCount[device.kind] += 1;

          return {
            deviceId: device.deviceId,
            kind: device.kind,
            label: device.label || `${device.kind === 'videoinput' ? 'Camera' : 'Microphone'} ${cameraCount[device.kind]}`,
          };
        }),
      );
    } catch (error) {
      handleCallError(error);
    }
  }

  function localMediaConstraints(): MediaStreamConstraints {
    return {
      video: selectedVideoDeviceId ? { deviceId: { exact: selectedVideoDeviceId } } : true,
      audio: selectedAudioDeviceId ? { deviceId: { exact: selectedAudioDeviceId } } : true,
    };
  }

  async function replaceLocalVideoDevice(deviceId: string): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      });
      const nextTrack = stream.getVideoTracks()[0];

      if (!nextTrack) {
        return;
      }

      cameraVideoTrack.current?.stop();
      cameraVideoTrack.current = nextTrack;
      replaceTrackInLocalStream('video', nextTrack);

      if (!screenSharing) {
        await replaceOutgoingTrack('video', nextTrack);
        setLocalPreviewTrack(nextTrack);
      }
    } catch (error) {
      handleCallError(error);
    }
  }

  async function replaceLocalAudioDevice(deviceId: string): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      const nextTrack = stream.getAudioTracks()[0];

      if (!nextTrack) {
        return;
      }

      nextTrack.enabled = microphoneEnabled;
      localStream.current?.getAudioTracks().forEach(track => track.stop());
      replaceTrackInLocalStream('audio', nextTrack);
      await replaceOutgoingTrack('audio', nextTrack);
    } catch (error) {
      handleCallError(error);
    }
  }

  async function startScreenShare(): Promise<void> {
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const screenTrack = displayStream.getVideoTracks()[0];

      if (!screenTrack) {
        return;
      }

      screenVideoTrack.current = screenTrack;
      screenTrack.onended = () => {
        void stopScreenShare();
      };

      await replaceOutgoingVideoTrack(screenTrack);
      setLocalPreviewTrack(screenTrack);
      setScreenSharing(true);
    } catch (error) {
      handleCallError(error);
    }
  }

  async function stopScreenShare(): Promise<void> {
    screenVideoTrack.current?.stop();
    screenVideoTrack.current = undefined;

    const cameraTrack = cameraVideoTrack.current ?? localStream.current?.getVideoTracks()[0];

    if (cameraTrack) {
      await replaceOutgoingVideoTrack(cameraTrack);
      setLocalPreviewTrack(cameraTrack);
    }

    setScreenSharing(false);
  }

  async function replaceOutgoingVideoTrack(track: MediaStreamTrack): Promise<void> {
    await replaceOutgoingTrack('video', track);
  }

  async function replaceOutgoingTrack(kind: 'audio' | 'video', track: MediaStreamTrack): Promise<void> {
    const sender = peerConnection.current
      ?.getSenders()
      .find(candidate => candidate.track?.kind === kind);

    await sender?.replaceTrack(track);
  }

  function replaceTrackInLocalStream(kind: 'audio' | 'video', nextTrack: MediaStreamTrack): void {
    if (!localStream.current) {
      localStream.current = new MediaStream([nextTrack]);
      return;
    }

    for (const track of localStream.current.getTracks().filter(track => track.kind === kind)) {
      localStream.current.removeTrack(track);
    }

    localStream.current.addTrack(nextTrack);
  }

  function setLocalPreviewTrack(videoTrack: MediaStreamTrack): void {
    for (const track of localPreviewStream.current.getVideoTracks()) {
      localPreviewStream.current.removeTrack(track);
    }

    localPreviewStream.current.addTrack(videoTrack);

    if (localVideo.current) {
      muteLocalPreview(localVideo.current);
      localVideo.current.srcObject = localPreviewStream.current;
    }
  }

  function muteLocalPreview(video: HTMLVideoElement): void {
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
  }

  function wirePeerConnection(connection: RTCPeerConnection, peerId: string): void {
    connection.onicecandidate = event => {
      if (event.candidate) {
        sendSignal(peerId, { type: 'ice', candidate: event.candidate.toJSON() });
      }
    };

    connection.ontrack = event => {
      for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
        remoteStream.current.addTrack(track);

        if (track.kind === 'video') {
          setRemoteVideoActive(track.readyState === 'live');
          track.onended = () => setRemoteVideoActive(false);
          track.onmute = () => setRemoteVideoActive(false);
          track.onunmute = () => setRemoteVideoActive(true);
        }
      }

      if (remoteVideo.current) {
        remoteVideo.current.srcObject = remoteStream.current;
      }
    };

    connection.ondatachannel = event => attachDataChannel(event.channel);

    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'connected') {
        setCallState('connected');
      }

      if (connection.connectionState === 'failed') {
        setCallState('error');
        setCallError('WebRTC connection failed. Try ending the call and calling again.');
      }

      if (connection.connectionState === 'closed' || connection.connectionState === 'disconnected') {
        setCallState('ended');
      }
    };
  }

  function attachDataChannel(channel: RTCDataChannel): void {
    dataChannel.current = channel;
    channel.onopen = () => setDataChannelOpen(true);
    channel.onclose = () => {
      setDataChannelOpen(false);
      setPeerTyping(false);
      clearTimeout(peerTypingTimer.current);
    };
    channel.onmessage = event => {
      const message = parseDataChannelMessage(event.data);

      if (message.t === 'typing') {
        showPeerTyping(message.active);
        return;
      }

      showPeerTyping(false);

      if (message.t === 'file-start') {
        if (!isValidIncomingFileStart(message)) {
          pendingFileTransfers.current.delete(message.id);
          return;
        }

        pendingFileTransfers.current.set(message.id, {
          from: peer?.participantId ?? 'peer',
          meta: message.file,
          chunks: Array.from<string>({ length: message.totalChunks }),
          receivedChunks: 0,
          totalChunks: message.totalChunks,
        });
        return;
      }

      if (message.t === 'file-chunk') {
        receiveFileChunk(message);
        return;
      }

      setChatMessages(current => [
        ...current,
        {
          id: crypto.randomUUID(),
          from: peer?.participantId ?? 'peer',
          kind: 'text',
          text: message.text,
          ts: Date.now(),
        },
      ]);
    };
  }

  function sendDataChannelMessage(message: DataChannelMessage): void {
    if (dataChannel.current?.readyState === 'open') {
      dataChannel.current.send(JSON.stringify(message));
    }
  }

  async function sendFileInChunks(file: ChatFile): Promise<void> {
    const transferId = crypto.randomUUID();
    const chunks = chunkString(file.dataUrl, FILE_CHUNK_CHARS);

    sendDataChannelMessage({
      t: 'file-start',
      id: transferId,
      file: {
        name: file.name,
        mime: file.mime,
        size: file.size,
      },
      totalChunks: chunks.length,
    });

    for (const [index, data] of chunks.entries()) {
      await waitForDataChannelBuffer(dataChannel.current);
      sendDataChannelMessage({ t: 'file-chunk', id: transferId, index, data });
    }
  }

  function receiveFileChunk(message: Extract<DataChannelMessage, { t: 'file-chunk' }>): void {
    const transfer = pendingFileTransfers.current.get(message.id);

    if (!transfer || !isAcceptableIncomingFileChunk(transfer.chunks, transfer.totalChunks, message)) {
      return;
    }

    transfer.chunks[message.index] = message.data;
    transfer.receivedChunks += 1;

    if (transfer.receivedChunks !== transfer.totalChunks) {
      return;
    }

    pendingFileTransfers.current.delete(message.id);

    const dataUrl = transfer.chunks.join('');

    if (!isSafeIncomingFileDataUrl(dataUrl, transfer.meta)) {
      return;
    }

    setChatMessages(current => [
      ...current,
      {
        id: message.id,
        from: transfer.from,
        kind: 'file',
        file: {
          ...transfer.meta,
          dataUrl,
        },
        ts: Date.now(),
      },
    ]);
  }

  function sendTypingNotification(active: boolean): void {
    if (dataChannel.current?.readyState !== 'open') {
      return;
    }

    const now = Date.now();

    if (active && now - lastTypingSentAt.current < TYPING_SEND_THROTTLE_MS) {
      return;
    }

    lastTypingSentAt.current = now;
    sendDataChannelMessage({ t: 'typing', active });
  }

  function showPeerTyping(active: boolean): void {
    clearTimeout(peerTypingTimer.current);
    setPeerTyping(active);

    if (active) {
      peerTypingTimer.current = setTimeout(() => setPeerTyping(false), TYPING_IDLE_MS);
    }
  }

  function showPresenceNotice(message: string): void {
    clearTimeout(presenceNoticeTimer.current);
    setPresenceNotice(message);
    presenceNoticeTimer.current = setTimeout(() => setPresenceNotice(undefined), 4_000);
  }

  function sessionDescriptionSignal(
    description: RTCSessionDescriptionInit,
    type: 'offer' | 'answer',
  ): RTCSignal {
    return {
      type,
      sdp: description.sdp ?? '',
    };
  }

  function sendSignal(to: string, data: RTCSignal): void {
    client?.signal(to, data);
  }

  function endCall(): void {
    dataChannel.current?.close();
    peerConnection.current?.close();

    screenVideoTrack.current?.stop();

    for (const track of localStream.current?.getTracks() ?? []) {
      track.stop();
    }

    dataChannel.current = undefined;
    peerConnection.current = undefined;
    localStream.current = undefined;
    cameraVideoTrack.current = undefined;
    screenVideoTrack.current = undefined;
    localPreviewStream.current = new MediaStream();
    remoteStream.current = new MediaStream();
    setDataChannelOpen(false);
    setRemoteVideoActive(false);
    setScreenSharing(false);
    setMicrophoneEnabled(true);
    setCallState('ended');
  }

  function handleCallError(error: unknown): void {
    setCallState('error');
    setCallError(error instanceof Error ? error.message : 'Unknown call error');
  }

  return (
    <div className={`meet-layout${chatOpen ? ' chat-open' : ''}`}>
      <div className="meet-stage">
        <video ref={remoteVideo} className="remote-video" autoPlay playsInline />

        <div className="stage-top-bar">
          <button
            className="home-link-button"
            aria-label="Back to home page"
            title={remoteVideoActive ? 'Home is disabled while opponent video is streaming' : 'Back to home page'}
            disabled={remoteVideoActive}
            onClick={() => {
              location.href = '/';
            }}
          >
            <HomeIcon />
          </button>

          <div className="stage-status">
            <span className={`status-dot ${statusDotClass}`} aria-hidden="true" />
            <div>
              <strong>Private call</strong>
              <span>{statusText}</span>
            </div>
          </div>

          <div className="private-room-meta">
            <span className={`status-dot ${roomState}`} aria-hidden="true" />
            <strong>Private room</strong>
            <span className="room-state">{roomState}</span>
            {roomInstanceId && <span className="room-instance">{roomInstanceId}</span>}
            {isJoined ? (
              <button className="leave-room-button" onClick={onLeave}>
                Exit
              </button>
            ) : (
              <button disabled={isConnecting} onClick={onJoin}>
                {isConnecting ? 'Joining...' : 'Join'}
              </button>
            )}
          </div>
        </div>

        {presenceNotice && (
          <p className="presence-notice" role="status">
            {presenceNotice}
          </p>
        )}

        {callError && (
          <p className="call-alert" role="alert">
            {callError}
          </p>
        )}

        <figure className="local-video-overlay">
          <video ref={localVideo} autoPlay playsInline muted defaultMuted />
          <figcaption>{screenSharing ? 'You are presenting' : 'You'}</figcaption>
        </figure>

        <div className="call-controls" aria-label="Call controls">
          {settingsOpen && (
            <DeviceSettingsPanel
              audioDevices={mediaDevices.filter(device => device.kind === 'audioinput')}
              videoDevices={mediaDevices.filter(device => device.kind === 'videoinput')}
              selectedAudioDeviceId={selectedAudioDeviceId}
              selectedVideoDeviceId={selectedVideoDeviceId}
              onRefresh={() => void loadMediaDevices()}
              onSelectAudio={deviceId => void selectAudioDevice(deviceId)}
              onSelectVideo={deviceId => void selectVideoDevice(deviceId)}
            />
          )}
          <CallControlButton
            icon="camera"
            label="Start video call"
            disabled={!canStartCall}
            onClick={startCall}
          />
          <CallControlButton
            icon={microphoneEnabled ? 'mic' : 'mic-off'}
            label={microphoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
            active={!microphoneEnabled}
            disabled={!callActive}
            onClick={toggleMicrophone}
          />
          <CallControlButton
            icon={screenSharing ? 'screen-off' : 'screen'}
            label={screenSharing ? 'Stop sharing screen' : 'Share screen'}
            active={screenSharing}
            disabled={!callActive}
            onClick={toggleScreenShare}
          />
          <CallControlButton
            icon="settings"
            label={settingsOpen ? 'Close device settings' : 'Open device settings'}
            active={settingsOpen}
            onClick={() => {
              setSettingsOpen(current => !current);
              void loadMediaDevices();
            }}
          />
          <CallControlButton
            icon="chat"
            label={chatOpen ? 'Close chat' : 'Open chat'}
            active={chatOpen}
            onClick={() => setChatOpen(current => !current)}
          />
          <CallControlButton icon="hangup" label="End call" danger disabled={!callActive} onClick={endCall} />
        </div>
      </div>

      {chatOpen && (
        <aside className="chat-sidebar" aria-label="P2P chat">
          <header className="chat-sidebar-header">
            <div>
              <h3>P2P chat</h3>
              <p>{dataChannelOpen ? 'Connected through WebRTC data channel.' : 'Available after the call connects.'}</p>
            </div>
            <button className="icon-close" aria-label="Close chat" onClick={() => setChatOpen(false)}>
              ×
            </button>
          </header>

          <div className="messages" aria-live="polite">
            {chatMessages.length === 0 ? (
              <p className="muted">No private P2P messages yet.</p>
            ) : (
              chatMessages.map(message => (
                <div key={message.id} className={message.mine ? 'message mine' : 'message'}>
                  <b>{message.mine ? 'me' : message.from}</b>
                  {message.kind === 'file' ? <FileMessage file={message.file} /> : <span>{message.text}</span>}
                </div>
              ))
            )}
          </div>

          <div className="chat-form">
            <input
              ref={fileInput}
              className="file-input"
              type="file"
              disabled={!dataChannelOpen}
              onChange={event => {
                void sendFile(event.currentTarget.files?.[0]);
              }}
            />
            <button
              className="chat-file-button"
              aria-label="Send file"
              title="Send file"
              disabled={!dataChannelOpen}
              onClick={() => fileInput.current?.click()}
            >
              <FileIcon />
            </button>
            <label className="chat-input-shell">
              {peerTyping && <span className="typing-indicator">Typing…</span>}
              <input
                value={text}
                disabled={!dataChannelOpen}
                placeholder={dataChannelOpen ? 'Type a private P2P message' : 'Connect the call to enable P2P chat'}
                onInput={event => handleChatInput(event.currentTarget.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    sendChatMessage();
                  }
                }}
              />
            </label>
            <button
              className="chat-send-button"
              aria-label="Send message"
              title="Send message"
              disabled={!dataChannelOpen || !text.trim()}
              onClick={sendChatMessage}
            >
              <SendIcon />
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}

export function parseDataChannelMessage(data: unknown): DataChannelMessage {
  if (typeof data !== 'string') {
    return { t: 'chat', text: String(data) };
  }

  try {
    const parsed = JSON.parse(data) as Partial<DataChannelMessage>;

    if (parsed.t === 'typing' && typeof parsed.active === 'boolean') {
      return { t: 'typing', active: parsed.active };
    }

    if (parsed.t === 'chat' && typeof parsed.text === 'string') {
      return { t: 'chat', text: parsed.text };
    }

    if (parsed.t === 'file-start' && typeof parsed.id === 'string' && isChatFileMeta(parsed.file)) {
      return {
        t: 'file-start',
        id: parsed.id,
        file: parsed.file,
        totalChunks: typeof parsed.totalChunks === 'number' ? parsed.totalChunks : 0,
      };
    }

    if (
      parsed.t === 'file-chunk' &&
      typeof parsed.id === 'string' &&
      typeof parsed.index === 'number' &&
      typeof parsed.data === 'string'
    ) {
      return {
        t: 'file-chunk',
        id: parsed.id,
        index: parsed.index,
        data: parsed.data,
      };
    }
  } catch {
    return { t: 'chat', text: data };
  }

  return { t: 'chat', text: data };
}

function isSupportedInputDevice(device: MediaDeviceInfo): device is MediaDeviceInfo & { kind: 'videoinput' | 'audioinput' } {
  return device.kind === 'videoinput' || device.kind === 'audioinput';
}

function chunkString(value: string, chunkSize: number): string[] {
  const chunks: string[] = [];

  for (let index = 0; index < value.length; index += chunkSize) {
    chunks.push(value.slice(index, index + chunkSize));
  }

  return chunks;
}

function waitForDataChannelBuffer(channel?: RTCDataChannel): Promise<void> {
  return new Promise(resolve => {
    const tick = () => {
      if (!channel || channel.bufferedAmount < DATA_CHANNEL_BUFFER_HIGH_WATERMARK) {
        resolve();
        return;
      }

      setTimeout(tick, 25);
    };

    tick();
  });
}

export function isAcceptableIncomingFileChunk(
  chunks: Array<string | undefined>,
  totalChunks: number,
  message: Extract<DataChannelMessage, { t: 'file-chunk' }>,
): boolean {
  return (
    Number.isSafeInteger(message.index) &&
    message.index >= 0 &&
    message.index < totalChunks &&
    chunks[message.index] === undefined
  );
}

export function isSafeIncomingFileDataUrl(dataUrl: string, file: ChatFileMeta): boolean {
  if (!dataUrl.startsWith('data:') || !dataUrl.includes(',')) {
    return false;
  }

  try {
    const url = new URL(dataUrl);
    return url.protocol === 'data:' && dataUrl.length <= maxIncomingDataUrlCharsForFileSize(file.size);
  } catch {
    return false;
  }
}

export function maxIncomingDataUrlCharsForFileSize(fileSize: number): number {
  if (!Number.isSafeInteger(fileSize) || fileSize < 0 || fileSize > MAX_CHAT_FILE_BYTES) {
    return 0;
  }

  return Math.ceil((fileSize * 4) / 3) + MAX_DATA_URL_PREFIX_CHARS;
}

function mediaDeviceOptionKey(device: MediaDeviceOption, index: number): string {
  return `${device.kind}:${device.deviceId || 'default'}:${device.label || 'unlabeled'}:${index}`;
}

export function isValidIncomingFileStart(message: Extract<DataChannelMessage, { t: 'file-start' }>): boolean {
  const { file, totalChunks } = message;

  return (
    typeof message.id === 'string' &&
    message.id.length > 0 &&
    isChatFileMeta(file) &&
    Number.isSafeInteger(file.size) &&
    file.size >= 0 &&
    file.size <= MAX_CHAT_FILE_BYTES &&
    Number.isSafeInteger(totalChunks) &&
    totalChunks > 0 &&
    totalChunks <= maxIncomingChunksForFileSize(file.size)
  );
}

export function maxIncomingChunksForFileSize(fileSize: number): number {
  if (!Number.isSafeInteger(fileSize) || fileSize < 0 || fileSize > MAX_CHAT_FILE_BYTES) {
    return 0;
  }

  return Math.max(1, Math.min(MAX_INCOMING_FILE_CHUNKS, Math.ceil(maxIncomingDataUrlCharsForFileSize(fileSize) / FILE_CHUNK_CHARS)));
}

function isChatFileMeta(value: unknown): value is ChatFileMeta {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ChatFileMeta>;

  return (
    typeof candidate.name === 'string' &&
    typeof candidate.mime === 'string' &&
    typeof candidate.size === 'number'
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function FileMessage({ file }: { file: ChatFile }) {
  return (
    <div className="file-message">
      <FileIcon />
      <div>
        <span>{file.name}</span>
        <small>{formatFileSize(file.size)}</small>
      </div>
      <a className="file-download-button" href={file.dataUrl} download={file.name}>
        <DownloadIcon />
        <span>Download</span>
      </a>
    </div>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.7 6.3a4.3 4.3 0 0 0-6.1 0l-6.4 6.4a3 3 0 0 0 4.2 4.2l7-7 1.4 1.4-7 7a5 5 0 0 1-7.1-7.1l6.4-6.4a6.3 6.3 0 0 1 8.9 8.9l-7.1 7.1a3.8 3.8 0 0 1-5.4-5.4l6.8-6.8L14.7 10l-6.8 6.8a1.8 1.8 0 0 0 2.6 2.6l7.1-7.1a4.3 4.3 0 0 0 .1-6Z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 4h2v8l3-3 1.4 1.4L12 15.8l-5.4-5.4L8 9l3 3V4ZM5 18h14v2H5v-2Z" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 3 10.6 4.3 12 5 11.4V20h5v-5h4v5h5v-8.6l.7.6 1.3-1.4L12 3Zm5 15h-1v-5H8v5H7v-8.3l5-4.2 5 4.2V18Z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.4 20.4 21.7 12 3.4 3.6 3 10.1l11.3 1.9L3 13.9l.4 6.5Z" />
    </svg>
  );
}

function CallControlButton({
  icon,
  label,
  active = false,
  danger = false,
  disabled = false,
  onClick,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const className = [
    'call-control-button',
    active ? 'active' : '',
    danger ? 'danger' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={className} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

function DeviceSettingsPanel({
  audioDevices,
  videoDevices,
  selectedAudioDeviceId,
  selectedVideoDeviceId,
  onRefresh,
  onSelectAudio,
  onSelectVideo,
}: {
  audioDevices: MediaDeviceOption[];
  videoDevices: MediaDeviceOption[];
  selectedAudioDeviceId: string;
  selectedVideoDeviceId: string;
  onRefresh: () => void;
  onSelectAudio: (deviceId: string) => void;
  onSelectVideo: (deviceId: string) => void;
}) {
  return (
    <div className="device-settings-panel" role="dialog" aria-label="Device settings">
      <header>
        <strong>Device settings</strong>
        <button onClick={onRefresh}>Refresh</button>
      </header>
      <label>
        Camera
        <select value={selectedVideoDeviceId} onChange={event => onSelectVideo(event.currentTarget.value)}>
          <option value="">Default camera</option>
          {videoDevices.map((device, index) => (
            <option key={mediaDeviceOptionKey(device, index)} value={device.deviceId}>
              {device.label || `Camera ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      <label>
        Microphone
        <select value={selectedAudioDeviceId} onChange={event => onSelectAudio(event.currentTarget.value)}>
          <option value="">Default microphone</option>
          {audioDevices.map((device, index) => (
            <option key={mediaDeviceOptionKey(device, index)} value={device.deviceId}>
              {device.label || `Microphone ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function Icon({ name }: { name: IconName }) {
  switch (name) {
    case 'camera':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h7A2.5 2.5 0 0 1 16 7.5v1.2l3.6-2.1A.9.9 0 0 1 21 7.4v9.2a.9.9 0 0 1-1.4.8L16 15.3v1.2a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 4 16.5v-9Z" />
        </svg>
      );
    case 'mic':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1a7 7 0 0 0 6-6.9h-2Z" />
        </svg>
      );
    case 'mic-off':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m4.7 3.3 16 16-1.4 1.4-3.4-3.4a6.9 6.9 0 0 1-2.9.9V21h-2v-2.8A7 7 0 0 1 5 11h2a5 5 0 0 0 7.4 4.4L12.9 14H12a3 3 0 0 1-3-3v-.9L3.3 4.7l1.4-1.4ZM12 3a3 3 0 0 1 3 3v5c0 .4-.1.8-.2 1.1L9.9 7.2V6A3 3 0 0 1 12 3Zm7 8a7 7 0 0 1-1.2 3.9l-1.5-1.5A5 5 0 0 0 17 11h2Z" />
        </svg>
      );
    case 'screen':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6v2h3v2H7v-2h3v-2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v9h16V7H4Zm8 2 4 4h-3v2h-2v-2H8l4-4Z" />
        </svg>
      );
    case 'screen-off':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m4.7 3.3 16 16-1.4 1.4-2.7-2.7H14v2h3v2H7v-2h3v-2H4a2 2 0 0 1-2-2V7.4L3.4 8.8V16h11.2l-2-2H11v-1.6L2.7 4.7l2-1.4ZM20 5a2 2 0 0 1 2 2v9.2L12.8 7H20Z" />
        </svg>
      );
    case 'chat':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 5h12V7H6v2Zm0 4h9v-2H6v2Z" />
        </svg>
      );
    case 'settings':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m19.4 13.5 1.6 1.2-2 3.5-1.9-.8a7.3 7.3 0 0 1-1.8 1l-.3 2.1h-4l-.3-2.1a7.3 7.3 0 0 1-1.8-1l-1.9.8-2-3.5 1.6-1.2a6.5 6.5 0 0 1 0-2.1L5 10.2l2-3.5 1.9.8a7.3 7.3 0 0 1 1.8-1L11 4.5h4l.3 2.1a7.3 7.3 0 0 1 1.8 1l1.9-.8 2 3.5-1.6 1.2a6.5 6.5 0 0 1 0 2ZM13 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
        </svg>
      );
    case 'hangup':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 8c3.3 0 6.4 1 9 2.8.7.5.9 1.4.5 2.1l-1.4 2.4a1.6 1.6 0 0 1-2 .7l-2.8-1.1a1.6 1.6 0 0 1-1-1.5V12a11 11 0 0 0-4.6 0v1.4a1.6 1.6 0 0 1-1 1.5L5.9 16a1.6 1.6 0 0 1-2-.7l-1.4-2.4a1.6 1.6 0 0 1 .5-2.1A15.8 15.8 0 0 1 12 8Z" />
        </svg>
      );
  }
}

function statusLabel(callState: CallState, hasPeer: boolean, dataChannelOpen: boolean): string {
  if (!hasPeer) {
    return 'Waiting for the second participant to join.';
  }

  if (dataChannelOpen) {
    return 'Connected. Video and P2P chat are available.';
  }

  switch (callState) {
    case 'idle':
      return 'Peer is present. Start a video call when ready.';
    case 'requesting-media':
      return 'Requesting camera and microphone access...';
    case 'calling':
      return 'Calling peer...';
    case 'connected':
      return 'Media connected. Opening data channel...';
    case 'ended':
      return 'Call ended.';
    case 'error':
      return 'Call failed.';
    case 'waiting-for-peer':
      return 'Waiting for peer.';
  }
}
