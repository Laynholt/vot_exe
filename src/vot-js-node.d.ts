declare module "@vot.js/node" {
  const VOTClient: new (options?: unknown) => unknown;
  export default VOTClient;
  export const VOTWorkerClient: new (options?: unknown) => unknown;
}

declare module "@vot.js/node/utils/videoData" {
  export function getVideoData(url: string, options?: unknown): Promise<unknown>;
}
