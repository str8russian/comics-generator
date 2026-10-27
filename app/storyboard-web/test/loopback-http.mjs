import http from "node:http";

export function listen(server) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      server.off("error", onError);
      server.off("listening", onListening);
      settle(value);
    };
    function onError(error) {
      finish(reject, error);
    }
    function onListening() {
      const address = server.address();
      if (address == null || typeof address !== "object" || typeof address.port !== "number") {
        finish(reject, new Error("loopback listen did not assign a TCP port"));
        return;
      }
      finish(resolve, address.port);
    }
    server.on("error", onError);
    server.on("listening", onListening);
    try {
      server.listen(0, "127.0.0.1");
    } catch (error) {
      finish(reject, error);
    }
  });
}

export function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function request(port, { method = "GET", path = "/", headers, body } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    let req;
    try {
      req = http.request({
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers,
      }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("error", fail);
        res.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      });
    } catch (error) {
      fail(error);
      return;
    }
    req.on("error", fail);
    if (body == null) req.end();
    else req.end(body);
  });
}
