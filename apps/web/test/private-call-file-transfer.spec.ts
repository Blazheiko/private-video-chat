import { describe, expect, it } from 'vitest';
import {
  MAX_CHAT_FILE_BYTES,
  MAX_INCOMING_FILE_CHUNKS,
  isAcceptableIncomingFileChunk,
  isSafeIncomingFileDataUrl,
  isValidIncomingFileStart,
  maxIncomingChunksForFileSize,
  parseDataChannelMessage,
  type DataChannelMessage,
} from '@web/rtc/PrivateCall.js';

function fileStart(totalChunks: number, size = 1024): Extract<DataChannelMessage, { t: 'file-start' }> {
  return {
    t: 'file-start',
    id: 'transfer-1',
    file: { name: 'sample.txt', mime: 'text/plain', size },
    totalChunks,
  };
}

describe('PrivateCall incoming file-start validation', () => {
  it('rejects malformed chunk counts before allocation', () => {
    for (const totalChunks of [Infinity, Number.NaN, 0, -1, 1.5, 1e9]) {
      expect(isValidIncomingFileStart(fileStart(totalChunks)), `${totalChunks}`).toBe(false);
    }
  });

  it('rejects file metadata outside the chat file size bound', () => {
    expect(isValidIncomingFileStart(fileStart(1, MAX_CHAT_FILE_BYTES + 1))).toBe(false);
    expect(isValidIncomingFileStart(fileStart(1, -1))).toBe(false);
    expect(isValidIncomingFileStart(fileStart(1, 1.5))).toBe(false);
  });

  it('caps accepted totalChunks by advertised file size and global maximum', () => {
    const maxForSmallFile = maxIncomingChunksForFileSize(1024);

    expect(isValidIncomingFileStart(fileStart(maxForSmallFile, 1024))).toBe(true);
    expect(isValidIncomingFileStart(fileStart(maxForSmallFile + 1, 1024))).toBe(false);
    expect(maxIncomingChunksForFileSize(MAX_CHAT_FILE_BYTES)).toBeLessThanOrEqual(MAX_INCOMING_FILE_CHUNKS);
    expect(isValidIncomingFileStart(fileStart(MAX_INCOMING_FILE_CHUNKS + 1, MAX_CHAT_FILE_BYTES))).toBe(false);
  });

  it('accepts an empty chunk only once', () => {
    const chunks: Array<string | undefined> = [undefined];
    const message: Extract<DataChannelMessage, { t: 'file-chunk' }> = {
      t: 'file-chunk',
      id: 'transfer-1',
      index: 0,
      data: '',
    };

    expect(isAcceptableIncomingFileChunk(chunks, 1, message)).toBe(true);
    chunks[0] = message.data;
    expect(isAcceptableIncomingFileChunk(chunks, 1, message)).toBe(false);
  });

  it('rejects completed file payloads that are not data URLs', () => {
    const meta = { name: 'sample.txt', mime: 'text/plain', size: 12 };

    expect(isSafeIncomingFileDataUrl('data:text/plain;base64,aGVsbG8=', meta)).toBe(true);
    expect(isSafeIncomingFileDataUrl('javascript:alert(1)', meta)).toBe(false);
    expect(isSafeIncomingFileDataUrl('https://example.test/file.txt', meta)).toBe(false);
    expect(isSafeIncomingFileDataUrl('data:text/plain;base64,' + 'a'.repeat(1024), meta)).toBe(false);
  });

  it('parses peer call-ended control messages', () => {
    expect(parseDataChannelMessage(JSON.stringify({ t: 'call-ended' }))).toEqual({ t: 'call-ended' });
  });

  it('normalizes malformed parsed file-start totalChunks to a rejected message', () => {
    const parsed = parseDataChannelMessage(
      JSON.stringify({
        t: 'file-start',
        id: 'transfer-1',
        file: { name: 'sample.txt', mime: 'text/plain', size: 1024 },
        totalChunks: Infinity,
      }),
    );

    expect(parsed.t).toBe('file-start');
    if (parsed.t === 'file-start') {
      expect(isValidIncomingFileStart(parsed)).toBe(false);
    }
  });
});
