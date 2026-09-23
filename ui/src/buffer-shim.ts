/**
 * Browser shim for the Node.js built-ins that the `avsc` dependency reaches for.
 *
 * WHAT: minimal, browser-safe stand-ins for `Buffer`, `util`, `events` (EventEmitter),
 * and `stream` (Transform/Readable/Writable/Duplex), installed under a global `require`.
 *
 * WHY: `avsc` is a CommonJS module that does `require("buffer" | "util" | "events" | "stream")`
 * at load time. Those Node built-ins do not exist in the browser bundle, so without this shim
 * the explorer UI throws "require is not defined" / "module not found" as soon as `avsc` loads.
 * See commit 59e3a16. The shims implement only the surface `avsc` actually touches — they are
 * deliberately incomplete and are NOT general-purpose Node polyfills.
 */
import { Buffer } from "buffer";

// Shim for Node's `events` module: the EventEmitter surface avsc subscribes/emits on.
// Just enough of on/once/off/emit/removeListener/removeAllListeners/listenerCount to work.
class EventEmitter {
  private _events: Record<string, ((...args: unknown[]) => void)[]> = {};

  public on(event: string, listener: (...args: unknown[]) => void): this {
    (this._events[event] ??= []).push(listener);
    return this;
  }

  public once(event: string, listener: (...args: unknown[]) => void): this {
    const w = (...args: unknown[]): void => {
      this.off(event, w);
      listener(...args);
    };
    return this.on(event, w);
  }

  public off(event: string, listener: (...args: unknown[]) => void): this {
    if (this._events[event]) {
      this._events[event] = this._events[event].filter((l) => l !== listener);
    }
    return this;
  }

  public emit(event: string, ...args: unknown[]): boolean {
    const ls = this._events[event]?.slice() ?? [];
    ls.forEach((l) => l(...args));
    return ls.length > 0;
  }

  public removeListener(event: string, listener: (...args: unknown[]) => void): this {
    return this.off(event, listener);
  }

  public removeAllListeners(event?: string): this {
    if (event) delete this._events[event];
    else this._events = {};
    return this;
  }

  public listenerCount(event: string): number {
    return this._events[event]?.length ?? 0;
  }
}

// Shim for Node's `stream` classes (Transform/Readable/Writable/Duplex/Stream). avsc pipes
// data through streams; in the browser we never actually stream, so every method is a no-op
// that keeps the call chain intact (write/end invoke their callback, pipe returns the dest).
class Transform extends EventEmitter {
  public readable = true;
  public writable = true;

  public constructor(_opts?: unknown) {
    super();
  }

  public push(_chunk: unknown): boolean {
    return true;
  }

  public write(_chunk: unknown, _enc?: unknown, cb?: () => void): boolean {
    if (typeof cb === "function") cb();
    return true;
  }

  public end(_chunk?: unknown, _enc?: unknown, cb?: () => void): this {
    if (typeof cb === "function") cb();
    this.emit("finish");
    return this;
  }

  public pipe<T>(dest: T): T {
    return dest;
  }

  public destroy(_err?: unknown): this {
    return this;
  }

  public read(_size?: number): null {
    return null;
  }
}

// Shim for Node's `util` module: the formatting/inspection helpers avsc uses for error and
// debug messages (debuglog is a no-op logger; format/inspect/inherits/deprecate/custom mirror
// the Node API closely enough for avsc's call sites).
const utilShim = {
  debuglog:
    (_name: string): ((..._args: unknown[]) => void) =>
    (..._args: unknown[]): void => {},
  format(fmt: string, ...args: unknown[]): string {
    let i = 0;
    return String(fmt).replace(/%[sdj%]/g, (m) => {
      if (m === "%%") return "%";
      if (i >= args.length) return m;
      const a = args[i++];
      if (m === "%d") return String(Number(a));
      if (m === "%j") {
        try {
          return JSON.stringify(a);
        } catch {
          return "[Circular]";
        }
      }
      return String(a);
    });
  },
  inspect: (obj: unknown): string => {
    try {
      return JSON.stringify(obj);
    } catch {
      return String(obj);
    }
  },
  inherits(ctor: { prototype: object }, superCtor: { prototype: object }): void {
    Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
  },
  deprecate<T extends (...args: unknown[]) => unknown>(fn: T, _msg: string): T {
    return fn;
  },
  custom: Symbol.for("nodejs.util.inspect.custom"),
};

// SAFETY: globalThis does not declare `require` in its TypeScript type, but we need to
// install a CJS-compatible shim so that avsc's CJS require() calls resolve in the browser
// bundle. The double cast via unknown is the standard pattern for assigning to an untyped
// global property.
(globalThis as unknown as Record<string, unknown>).require ??= function (id: string): unknown {
  if (id === "buffer") return { Buffer };
  if (id === "util") return utilShim;
  if (id === "events") return { EventEmitter };
  if (id === "stream")
    return {
      Transform,
      Readable: Transform,
      Writable: Transform,
      Duplex: Transform,
      Stream: EventEmitter,
    };
  throw new Error(
    `require('${id}') is not available in browser. Only 'buffer', 'util', 'events', and 'stream' are shimmed.`,
  );
};
