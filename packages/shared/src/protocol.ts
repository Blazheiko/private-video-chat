export type RoomKind = 'group' | 'private';
export type PeerLeftReason = 'left' | 'grace-expired';

export type ErrorCode =
  | 'PROTOCOL_VERSION'
  | 'BAD_MESSAGE'
  | 'MSG_TOO_LARGE'
  | 'NOT_JOINED'
  | 'ALREADY_JOINED'
  | 'ROOM_FULL'
  | 'ROOM_CLOSED'
  | 'WRONG_KIND'
  | 'UNKNOWN_PEER'
  | 'RATE_LIMITED'
  | 'JOIN_TIMEOUT'
  | 'BACKPRESSURE'
  | 'BAD_RESUME_TOKEN'
  | 'CAPACITY'
  | 'INTERNAL';

export type EncryptedEnvelope = {
  iv: string;
  ciphertext: string;
  aad: {
    msgId: string;
    senderId: string;
    seq: number;
    ts: number;
  };
  sig?: string;
};

export type RTCSignal =
  | { type: 'offer' | 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit };

export type IceConfig = {
  iceServers: RTCIceServer[];
  ttlSec: number;
  policy: 'all' | 'relay';
};

export type PeerInfo = {
  participantId: string;
  senderId: string;
  sessionNonce: string;
  senderPubKey?: string;
};

export type ClientMessage =
  | {
      v: number;
      t: 'join';
      room: string;
      kind: RoomKind;
      senderId: string;
      sessionNonce: string;
      resumeToken?: string;
      senderPubKey?: string;
    }
  | { v: number; t: 'leave' }
  | { v: number; t: 'relay'; cid: number; env: EncryptedEnvelope }
  | { v: number; t: 'signal'; to: string; data: RTCSignal }
  | { v: number; t: 'auth'; to: string; mac: string }
  | { v: number; t: 'ping' };

export type ServerMessage =
  | {
      v: number;
      t: 'joined';
      selfId: string;
      roomInstanceId: string;
      resumeToken: string;
      resumed: boolean;
      peers: PeerInfo[];
      ice: IceConfig;
    }
  | { v: number; t: 'peer-joined'; peer: PeerInfo }
  | { v: number; t: 'peer-left'; participantId: string; reason: PeerLeftReason }
  | { v: number; t: 'relay'; from: string; env: EncryptedEnvelope }
  | { v: number; t: 'signal'; from: string; data: RTCSignal }
  | { v: number; t: 'auth'; from: string; mac: string }
  | { v: number; t: 'ack'; cid: number }
  | { v: number; t: 'ice-refresh'; ice: IceConfig }
  | { v: number; t: 'pong' }
  | { v: number; t: 'error'; code: ErrorCode; message: string; fatal: boolean };

export const CLOSE_CODES: Record<ErrorCode, number | undefined> = {
  PROTOCOL_VERSION: 4400,
  BAD_MESSAGE: 4400,
  MSG_TOO_LARGE: 4400,
  NOT_JOINED: 4409,
  ALREADY_JOINED: undefined,
  ROOM_FULL: 4403,
  ROOM_CLOSED: 4403,
  WRONG_KIND: 4400,
  UNKNOWN_PEER: undefined,
  RATE_LIMITED: 4429,
  JOIN_TIMEOUT: 4408,
  BACKPRESSURE: 4413,
  BAD_RESUME_TOKEN: undefined,
  CAPACITY: 1013,
  INTERNAL: 1011,
};
