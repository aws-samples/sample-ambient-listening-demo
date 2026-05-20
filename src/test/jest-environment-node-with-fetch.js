const NodeEnvironment = require('jest-environment-node').TestEnvironment;

/**
 * Custom Jest environment that extends the Node environment
 * and eagerly sets all Web API globals needed by MSW v2.
 * 
 * MSW v2 and @mswjs/interceptors require fetch API globals (Request, Response, etc.)
 * to be available at module evaluation time. Jest's default node environment uses
 * lazy getters which may not resolve in time for class definitions like
 * `class FetchRequest extends Request`.
 */
class NodeWithFetchEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context);

    // Eagerly set Web API globals that MSW v2 needs at module evaluation time.
    this.global.Request = globalThis.Request;
    this.global.Response = globalThis.Response;
    this.global.Headers = globalThis.Headers;
    this.global.fetch = globalThis.fetch;
    this.global.ReadableStream = globalThis.ReadableStream;
    this.global.WritableStream = globalThis.WritableStream;
    this.global.TransformStream = globalThis.TransformStream;
    this.global.FormData = globalThis.FormData;
    this.global.Blob = globalThis.Blob;
    this.global.File = globalThis.File;
    this.global.TextEncoder = globalThis.TextEncoder;
    this.global.TextDecoder = globalThis.TextDecoder;
    this.global.URL = globalThis.URL;
    this.global.URLSearchParams = globalThis.URLSearchParams;
    this.global.AbortController = globalThis.AbortController;
    this.global.AbortSignal = globalThis.AbortSignal;
    this.global.EventTarget = globalThis.EventTarget;
    this.global.Event = globalThis.Event;
    this.global.MessageEvent = globalThis.MessageEvent;
    this.global.structuredClone = globalThis.structuredClone;
    this.global.BroadcastChannel = globalThis.BroadcastChannel;
    this.global.MessageChannel = globalThis.MessageChannel;
    this.global.MessagePort = globalThis.MessagePort;
    this.global.DOMException = globalThis.DOMException;
    this.global.ByteLengthQueuingStrategy = globalThis.ByteLengthQueuingStrategy;
    this.global.CountQueuingStrategy = globalThis.CountQueuingStrategy;
  }
}

module.exports = NodeWithFetchEnvironment;
