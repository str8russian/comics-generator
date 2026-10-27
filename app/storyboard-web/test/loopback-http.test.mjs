import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { close, listen, request } from "./loopback-http.mjs";

test("listen binds an ephemeral loopback port and removes its temporary error listener", async () => {
  const server = http.createServer();
  const errorListeners = server.listenerCount("error");
  const listeningListeners = server.listenerCount("listening");
  const port = await listen(server);
  try {
    assert.equal(typeof port, "number");
    assert.equal(port > 0, true);
    assert.deepEqual(server.address(), {
      address: "127.0.0.1",
      family: "IPv4",
      port,
    });
    assert.equal(server.listenerCount("error"), errorListeners);
    assert.equal(server.listenerCount("listening"), listeningListeners);
  } finally {
    await close(server);
  }
});

test("listen rejects a second bind and does not leave its error listener", async () => {
  const server = http.createServer();
  await listen(server);
  try {
    const before = server.listenerCount("error");
    await assert.rejects(listen(server), (error) => {
      assert.equal(error.code, "ERR_SERVER_ALREADY_LISTEN");
      return true;
    });
    assert.equal(server.listenerCount("error"), before);
  } finally {
    await close(server);
  }
});

test("close rejects when the passed server is not listening", async () => {
  const server = http.createServer();
  await assert.rejects(close(server), (error) => {
    assert.equal(error.code, "ERR_SERVER_NOT_RUNNING");
    return true;
  });
});

test("request returns raw status, headers, and bytes, and rejects a dead port", async () => {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (req.url === "/empty") {
        res.writeHead(204, { "X-Empty": "1" });
        res.end();
        return;
      }
      if (req.url === "/echo") {
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end(Buffer.concat(chunks));
        return;
      }
      res.writeHead(503, {
        Allow: "GET",
        "Content-Type": "text/plain",
        "X-Marker": "kept",
        "Set-Cookie": ["a=1", "b=2"],
      });
      res.end("not-json");
    });
  });
  const port = await listen(server);
  try {
    assert.equal(server.address().address, "127.0.0.1");
    const failed = await request(port, { path: "/fail" });
    assert.equal(failed.status, 503);
    assert.ok(Buffer.isBuffer(failed.body));
    assert.equal(failed.body.toString("utf8"), "not-json");
    assert.equal(failed.headers.allow, "GET");
    assert.equal(failed.headers["content-type"], "text/plain");
    assert.equal(failed.headers["x-marker"], "kept");
    assert.deepEqual(failed.headers["set-cookie"], ["a=1", "b=2"]);

    const empty = await request(port, { path: "/empty" });
    assert.equal(empty.status, 204);
    assert.equal(empty.body.length, 0);
    assert.equal(empty.headers["x-empty"], "1");

    const text = await request(port, {
      method: "POST",
      path: "/echo",
      headers: { "content-type": "text/plain" },
      body: "{",
    });
    assert.equal(text.body.toString("utf8"), "{");

    const bytes = await request(port, {
      method: "POST",
      path: "/echo",
      body: Buffer.from([0, 255, 10]),
    });
    assert.deepEqual(bytes.body, Buffer.from([0, 255, 10]));
  } finally {
    await close(server);
  }

  await assert.rejects(request(port, { path: "/fail" }), (error) => {
    assert.equal(error.code === "ECONNREFUSED" || error.code === "ECONNRESET", true);
    return true;
  });
});
