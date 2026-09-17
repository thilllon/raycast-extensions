// Minimal Chrome DevTools Protocol client over the browser-level WebSocket.
// Playwright cannot drive browser windows or the tab strip, so the capture script talks CDP directly.

export async function connect(port) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  return {
    send,
    close: () => socket.close(),

    // Attaches to an extension's service worker so extension APIs can be called from Node.
    async attachToServiceWorker(extensionId, { timeoutMs = 15000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const { result } = await send("Target.getTargets");
        const target = result.targetInfos.find(
          (info) => info.type === "service_worker" && info.url.startsWith(`chrome-extension://${extensionId}/`),
        );
        if (target) {
          const attached = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
          return attached.result.sessionId;
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
      const details = response.result?.exceptionDetails;
      if (details) throw new Error(details.exception?.description ?? details.text);
      return response.result?.result?.value;
    },
  };
}
