export const H264_CODECS = ['avc1.640028', 'avc1.42e028'] as const;
export async function videoCapability(): Promise<{ codec: string | null; message: string }> {
  if (typeof VideoDecoder === 'undefined') return { codec: null, message: 'H.264 decode unavailable · VideoDecoder missing' };
  for (const codec of H264_CODECS) {
    try {
      const result = await VideoDecoder.isConfigSupported({ codec, hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true });
      if (result.supported) return { codec, message: `H.264 decode supported · ${codec} · hardware preferred` };
    } catch {
      /* Try the next profile before retaining raw output. */
    }
  }
  return { codec: null, message: 'H.264 decode unsupported · raw output available' };
}
