/** Compression gzip native du navigateur (Compression Streams API). */

async function pipe(bytes: BlobPart, transform: GenericTransformStream): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const gzip = (text: string): Promise<Uint8Array> =>
  pipe(text, new CompressionStream('gzip'));

export const gunzip = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  new TextDecoder().decode(await pipe(bytes, new DecompressionStream('gzip')));
