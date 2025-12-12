import { UmpReader, CompositeBuffer } from 'googlevideo/ump';
import { u8ToBase64 } from 'googlevideo/utils';
import type { Part } from 'googlevideo/shared-types';
import { saveToFile } from "./injected";

import {
  UMPPartId,
  FormatInitializationMetadata,
  NextRequestPolicy,
  SabrError,
  SabrRedirect,
  SabrContextUpdate,
  SabrContextSendingPolicy,
  StreamProtectionStatus,
  ReloadPlaybackContext,
  MediaHeader,
  PlaybackStartPolicy,
  RequestCancellationPolicy,
  RequestIdentifier,
  VideoPlaybackAbrRequest,
  OnesieRequest,
  OnesieHeader,
  SnackbarMessage,
  FormatSelectionConfig
} from 'googlevideo/protos';

import { formatSize, getPalette, logSeparator } from './helpers';

type UmpPartHandler = (part: Part) => any;

interface ParsedPart {
  type: string;
  data: any;
}

interface Segment {
  headerId?: number;
  mediaHeader: MediaHeader;
  complete?: boolean;
  bufferedChunks: Uint8Array[];
  lastChunkSize: number;
}

  let formatInitMetadata: FormatInitializationMetadata[] = [];
  let desiredHeaderId: number | null;
  let partialSegments = new Map<number, Segment>();

  function handleMediaHeader(part: Part) {
    const mediaHeader = MediaHeader.decode(part.data.chunks[0])

    if (!mediaHeader) {
      return undefined;
    }
    if (mediaHeader) {
      const segmentObj = {
        headerId: mediaHeader.headerId,
        mediaHeader: mediaHeader,
        bufferedChunks: [],
        lastChunkSize: 0
      };
      partialSegments.set(<number>mediaHeader.headerId, segmentObj);
    }

    return mediaHeader;
  }

  function handleMedia(part: Part) {
    const headerId = part.data.getUint8(0);
    const buffer = part.data.split(1).remainingBuffer;
    const segment = partialSegments.get(headerId);
    if (segment) {
      segment.lastChunkSize = buffer.getLength();
      for (const chunk of buffer.chunks) {
        segment.bufferedChunks.push(chunk);
      }
    }
    return { headerId: headerId, size: part.data.getLength() };
  }

  function concatenateChunks(chunks: Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  function saveUint8Array(
    bytes: Uint8Array,
    filename: string = "output.bin"
  ): void {
    saveToFile(bytes, filename)
  }

  function handleMediaEnd(part: Part) {
    const headerId = part.data.getUint8(0);
    const segment = partialSegments.get(headerId);

    if (segment) {
      const segmentData = concatenateChunks(segment.bufferedChunks);
      const name = `media_${segment.mediaHeader.itag}_${segment.mediaHeader.sequenceNumber}.m4s`;
      console.log(`download ${name} ${segmentData.byteLength}`)
      saveUint8Array(segmentData, name);
      partialSegments.delete(headerId)
    }
    return { headerId: headerId };
  }

const umpPartHandlers = new Map<UMPPartId, UmpPartHandler>([
  [ UMPPartId.FORMAT_INITIALIZATION_METADATA, (part: Part) => FormatInitializationMetadata.decode(part.data.chunks[0]) ],
  [ UMPPartId.NEXT_REQUEST_POLICY, (part: Part) => NextRequestPolicy.decode(part.data.chunks[0]) ],
  [ UMPPartId.SABR_ERROR, (part: Part) => SabrError.decode(part.data.chunks[0]) ],
  [ UMPPartId.SABR_REDIRECT, (part: Part) => SabrRedirect.decode(part.data.chunks[0]) ],
  [ UMPPartId.SABR_CONTEXT_UPDATE, (part: Part) => SabrContextUpdate.decode(part.data.chunks[0]) ],
  [ UMPPartId.SABR_CONTEXT_SENDING_POLICY, (part: Part) => SabrContextSendingPolicy.decode(part.data.chunks[0]) ],
  [ UMPPartId.STREAM_PROTECTION_STATUS, (part: Part) => StreamProtectionStatus.decode(part.data.chunks[0]) ],
  [ UMPPartId.RELOAD_PLAYER_RESPONSE, (part: Part) => ReloadPlaybackContext.decode(part.data.chunks[0]) ],
  [ UMPPartId.MEDIA_HEADER, handleMediaHeader ],
  [ UMPPartId.MEDIA, handleMedia ],
  [ UMPPartId.MEDIA_END, handleMediaEnd ],
  [ UMPPartId.PLAYBACK_START_POLICY, (part: Part) => PlaybackStartPolicy.decode(part.data.chunks[0]) ],
  [ UMPPartId.REQUEST_CANCELLATION_POLICY, (part: Part) => RequestCancellationPolicy.decode(part.data.chunks[0]) ],
  [ UMPPartId.REQUEST_IDENTIFIER, (part: Part) => RequestIdentifier.decode(part.data.chunks[0]) ],
  [ UMPPartId.ONESIE_HEADER, (part: Part) => OnesieHeader.decode(part.data.chunks[0]) ],
  [ UMPPartId.ONESIE_DATA, (part: Part) => ({ size: part.data.getLength() }) ],
  [ UMPPartId.ONESIE_ENCRYPTED_MEDIA, (part: Part) => ({ size: part.data.getLength() }) ],
  [ UMPPartId.SNACKBAR_MESSAGE, (part: Part) => SnackbarMessage.decode(part.data.chunks[0]) ],
  [ UMPPartId.FORMAT_SELECTION_CONFIG, (part: Part) => FormatSelectionConfig.decode(part.data.chunks[0]) ]
]);

export function processUmpResponse(url: string, requestBody: ArrayBuffer, responseBuffer: ArrayBuffer): void {
  const colors = getPalette();
  try {
    const requestURL = new URL(url);
    const isOnesie = requestURL.pathname === '/initplayback';
    const payloadBuffer = new Uint8Array(requestBody);

    const decodedRequestPayload =
      payloadBuffer.length === 2 ? 'Nothing to see here.' :
        (isOnesie ? OnesieRequest.decode(payloadBuffer) : VideoPlaybackAbrRequest.decode(payloadBuffer));

    const decodedResponse: [ string, any ][] = [];
    const googUmp = new UmpReader(new CompositeBuffer([ new Uint8Array(responseBuffer) ]));

    googUmp.read((part) => {
      const partTypeName = UMPPartId[part.type];
      const handler = umpPartHandlers.get(part.type);
      if (handler) {
        decodedResponse.push([ partTypeName, handler(part) ]);
      } else {
        decodedResponse.push([
          '(Unhandled) ' + partTypeName,
          part.data.getLength() > 0 ? u8ToBase64(part.data.chunks[0]) : ''
        ]);
      }
    });

    console.log('');
    logSeparator(colors, 'UMP TRACE START');

    console.log(
      '%c🚀 UMP Request %c' + requestURL.pathname,
      `background:${colors.headerBg};color:${colors.headerFg};padding:4px 8px 4px 6px;border-radius:4px 0 0 4px;font-weight:600;`,
      `background:${colors.headerBg};color:${colors.payload};padding:4px 8px 4px 0;border-radius:0 4px 4px 0;font-weight:500;`
    );
    console.log('%c📤 Payload:', `color:${colors.payload};font-weight:600;`, decodedRequestPayload);
    console.log('%c📥 Decoded Parts:', `color:${colors.section};font-weight:600;`);

    let totalMediaSize = 0;
    const mediaGroups = new Map<number, ParsedPart[]>();
    const otherParts: ParsedPart[] = [];

    decodedResponse.forEach(([ partType, part ]) => {
      if (partType === 'MEDIA_HEADER' || partType === 'MEDIA' || partType === 'MEDIA_END') {
        const headerId = part.headerId;

        if (partType === 'MEDIA')
          totalMediaSize += part.size;

        if (!mediaGroups.has(headerId))
          mediaGroups.set(headerId, []);

        mediaGroups.get(headerId)?.push({ type: partType, data: part });
      } else {
        otherParts.push({ type: partType, data: part });
      }
    });

    // Log non-media parts first...
    otherParts.forEach(({ type, data }) => console.log(
      '%c  ▶ ' + type + ':',
      `color:${colors.part};font-weight:600;`,
      data
    ));

    // Now do the media parts, but collapsed (it's quite spammy when there are 10+ groups).
    if (mediaGroups.size > 0) {
      const totalParts = Array.from(mediaGroups.values()).flat().length;

      console.groupCollapsed(
        '%c🎬 Media Groups%c %d group%s • %d part%s • %s',
        `background:${colors.mediaGroupBadgeBg};color:${colors.mediaGroupBadgeFg};padding:3px 10px;border-radius:6px;font-weight:600;`,
        `color:${colors.subtle};font-weight:400;margin-left:6px;`,
        mediaGroups.size,
        mediaGroups.size === 1 ? '' : 's',
        totalParts,
        totalParts === 1 ? '' : 's',
        formatSize(totalMediaSize)
      );

      for (const [headerId, parts] of mediaGroups) {
        console.log(
          '%c  📦 Group %c headerId=' + headerId,
          `background:${colors.mediaGroupBg};color:${colors.mediaGroupBadgeBg};padding:2px 8px;border-radius:4px 0 0 4px;font-weight:600;`,
          `background:${colors.mediaGroupBadgeBg};color:${colors.mediaGroupBadgeFg};padding:2px 8px;border-radius:0 4px 4px 0;font-weight:600;`
        );

        for (const { type, data } of parts) {
          console.log(
            '%c     • ' + type,
            `color:${colors.mediaPart};font-weight:600;`,
            data
          );
        }
      }

      console.groupEnd();
    }

    logSeparator(colors, 'UMP TRACE END');
    console.log('');
  } catch (error) {
    console.error(
      '%c❌ UMP Inspector Error:',
      `color:${colors.error};font-weight:700;`,
      error
    );
  }
}