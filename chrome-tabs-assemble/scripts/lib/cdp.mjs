// Minimal Chrome DevTools Protocol client over the browser-level WebSocket.
// Playwright cannot drive browser windows or the tab strip, so the capture script talks CDP directly.

const CALL_TIMEOUT_MS = 30000;

export async function connect(port, { timeoutMs = 15000 } = {}) {
  const version = await (
    await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
  ).json();

  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out opening the CDP socket")), timeoutMs);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("could not open the CDP socket"));
      },
      { once: true },
    );
  });

  let nextId = 0;
  const pending = new Map();

  // Without this, losing the browser mid-run leaves every awaited call hanging forever.
  const failAll = (reason) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error(reason));
    }
    pending.clear();
  };
  socket.addEventListener("close", () => failAll("the CDP connection closed"));
  socket.addEventListener("error", () => failAll("the CDP connection failed"));

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const call = message.id && pending.get(message.id);
    if (!call) return;
    clearTimeout(call.timer);
    pending.delete(message.id);
    if (message.error) call.reject(new Error(`${message.error.message} (${message.method})`));
    else call.resolve(message.result ?? {});
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, CALL_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer, method });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  return {
    send,
    close: () => {
      failAll("the CDP connection was closed by the script");
      socket.close();
    },

    // Attaches to an extension's service worker so extension APIs can be called from Node.
    async attachToServiceWorker(extensionId, { timeoutMs: attachTimeoutMs = 15000 } = {}) {
      const deadline = Date.now() + attachTimeoutMs;
      while (Date.now() < deadline) {
        const { targetInfos } = await send("Target.getTargets");
        const target = targetInfos.find(
          (info) => info.type === "service_worker" && info.url.startsWith(`chrome-extension://${extensionId}/`),
        );
        if (target) {
          const { sessionId } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
          return sessionId;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(`service worker of ${extensionId} never showed up`);
    },

    // Runs an async expression inside that service worker and returns its value.
    async evaluate(sessionId, expression) {
      const response = await send(
        "Runtime.evaluate",
        { expression, awaitPromise: true, returnByValue: true },
        sessionId,
      );
      if (response.exceptionDetails) {
        const details = response.exceptionDetails;
        throw new Error(details.exception?.description ?? details.text);
      }
      return response.result?.value;
    },
  };
}
